from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, mixins, status
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import services
from .access import OrganizationPermission, OrganizationScopedViewSet
from .models import Invitation, Membership, Organization
from .serializers import (
    CapabilityCatalogSerializer,
    InvitationPreviewRequestSerializer,
    InvitationPreviewSerializer,
    InvitationSerializer,
    MembershipSerializer,
    MembershipUpdateSerializer,
    MyOrganizationSerializer,
    OrganizationSerializer,
)


def _my_memberships(user):
    return (
        Membership.objects.select_related("organization")
        .filter(
            user=user,
            status=Membership.Status.ACTIVE,
            organization__status=Organization.Status.ACTIVE,
        )
        .order_by("organization__name")
    )


class OrganizationListCreateView(APIView):
    """Organizations the current user belongs to; POST creates one with the user as owner."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=MyOrganizationSerializer(many=True))
    def get(self, request):
        memberships = list(_my_memberships(request.user))
        if request.user.is_staff:
            from apps.platform_admin.models import SupportGrant
            from apps.platform_admin.support import support_membership

            member_of = {m.organization_id for m in memberships}
            memberships += [
                support_membership(grant)
                for grant in SupportGrant.objects.active()
                .select_related("organization", "user")
                .filter(user=request.user, organization__status=Organization.Status.ACTIVE)
                if grant.organization_id not in member_of
            ]
        return Response(MyOrganizationSerializer(memberships, many=True).data)

    @extend_schema(request=OrganizationSerializer, responses={201: MyOrganizationSerializer})
    def post(self, request):
        serializer = OrganizationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        organization = services.create_organization(
            request=request, user=request.user, **serializer.validated_data
        )
        membership = Membership.objects.get(organization=organization, user=request.user)
        return Response(MyOrganizationSerializer(membership).data, status=status.HTTP_201_CREATED)


class CurrentOrganizationView(APIView):
    """The active organization selected by the X-Organization-ID header."""

    permission_classes = [IsAuthenticated, OrganizationPermission]
    required_capabilities = {"get": None, "patch": "organization.manage"}

    @extend_schema(responses=MyOrganizationSerializer)
    def get(self, request):
        return Response(MyOrganizationSerializer(request.membership).data)

    @extend_schema(request=OrganizationSerializer, responses=OrganizationSerializer)
    def patch(self, request):
        serializer = OrganizationSerializer(request.organization, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        organization = services.update_organization(
            request=request, organization=request.organization, **serializer.validated_data
        )
        return Response(OrganizationSerializer(organization).data)


class MembershipViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    OrganizationScopedViewSet,
):
    queryset = Membership.objects.select_related("user", "organization")
    serializer_class = MembershipSerializer
    required_capabilities = {
        "list": "members.view",
        "retrieve": "members.view",
        "partial_update": "members.manage",
        "destroy": "members.manage",
    }
    filterset_fields = ["role", "status"]
    search_fields = ["user__full_name", "user__email"]
    ordering_fields = ["joined_at", "user__full_name"]
    ordering = ["user__full_name"]
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == "list" and "status" not in self.request.query_params:
            queryset = queryset.exclude(status=Membership.Status.REMOVED)
        return queryset

    @extend_schema(request=MembershipUpdateSerializer, responses=MembershipSerializer)
    def partial_update(self, request, *args, **kwargs):
        membership = self.get_object()
        serializer = MembershipUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership = services.update_membership(
            request=request,
            actor=request.membership,
            membership=membership,
            **serializer.validated_data,
        )
        return Response(MembershipSerializer(membership).data)

    def perform_destroy(self, instance):
        # Soft removal: membership history is retained for audit purposes.
        services.remove_membership(
            request=self.request, actor=self.request.membership, membership=instance
        )


class InvitationViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    OrganizationScopedViewSet,
):
    queryset = Invitation.objects.select_related("invited_by")
    serializer_class = InvitationSerializer
    required_capabilities = {
        "list": "members.view",
        "retrieve": "members.view",
        "create": "members.manage",
        "resend": "members.manage",
        "revoke": "members.manage",
    }
    filterset_fields = ["status", "role"]
    search_fields = ["email"]
    ordering_fields = ["created_at", "email"]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invitation = services.create_invitation(
            request=request,
            actor=request.membership,
            email=serializer.validated_data["email"],
            role=serializer.validated_data["role"],
        )
        return Response(InvitationSerializer(invitation).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses=InvitationSerializer)
    @action(detail=True, methods=["post"])
    def resend(self, request, pk=None):
        invitation = services.resend_invitation(
            request=request, actor=request.membership, invitation=self.get_object()
        )
        return Response(InvitationSerializer(invitation).data)

    @extend_schema(request=None, responses=InvitationSerializer)
    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        invitation = services.revoke_invitation(
            request=request, actor=request.membership, invitation=self.get_object()
        )
        return Response(InvitationSerializer(invitation).data)


class InvitationPreviewView(APIView):
    """Lets an invitee see who invited them before signing in. Token is sent in the body."""

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(
        request=InvitationPreviewRequestSerializer, responses=InvitationPreviewSerializer
    )
    def post(self, request):
        serializer = InvitationPreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invitation = services.find_invitation_by_token(serializer.validated_data["token"])
        if invitation is None:
            raise exceptions.NotFound("This invitation link is invalid.")
        return Response(InvitationPreviewSerializer(invitation).data)


class InvitationAcceptView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(request=InvitationPreviewRequestSerializer, responses=MyOrganizationSerializer)
    def post(self, request):
        serializer = InvitationPreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership = services.accept_invitation(
            request=request, user=request.user, token=serializer.validated_data["token"]
        )
        return Response(MyOrganizationSerializer(membership).data)


class CapabilityCatalogView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=dict)
    def get(self, request):
        return Response(CapabilityCatalogSerializer.build())
