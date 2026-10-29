from django.db import transaction
from django.db.models import Count, Q
from drf_spectacular.utils import extend_schema
from rest_framework import mixins
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.organizations.access import OrganizationScopedViewSet, RefetchOnWriteMixin
from apps.properties.services import update_instance

from . import portal_access
from .access import accessible_tenants
from .models import Tenant
from .serializers import PortalInviteSerializer, TenantSerializer


class TenantViewSet(
    RefetchOnWriteMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    OrganizationScopedViewSet,
):
    queryset = Tenant.objects.all()
    serializer_class = TenantSerializer
    required_capabilities = {
        "list": "tenants.view",
        "retrieve": "tenants.view",
        "create": "tenants.manage",
        "partial_update": "tenants.manage",
        "archive": "tenants.manage",
        "restore": "tenants.manage",
        "portal_invite": "tenants.portal",
        "portal_revoke": "tenants.portal",
    }
    filterset_fields = ["status"]
    search_fields = ["full_name", "phone", "email", "id_number"]
    ordering_fields = ["full_name", "created_at"]
    ordering = ["full_name"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        from apps.leases.models import Lease

        queryset = accessible_tenants(self.request.membership)
        if self.action == "list" and "status" not in self.request.query_params:
            queryset = queryset.filter(status=Tenant.Status.ACTIVE)
        return queryset.annotate(
            active_lease_count=Count(
                "leases", filter=Q(leases__status=Lease.Status.ACTIVE), distinct=True
            )
        )

    def perform_create(self, serializer):
        with transaction.atomic():
            tenant = serializer.save(
                organization=self.request.organization, created_by=self.request.user
            )
            record_event(self.request, "tenant.created", target=tenant)

    def perform_update(self, serializer):
        update_instance(
            request=self.request,
            instance=serializer.instance,
            action="tenant.updated",
            **serializer.validated_data,
        )

    @extend_schema(request=None, responses=TenantSerializer)
    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        tenant = self.get_object()
        if tenant.active_lease_count:
            raise BusinessRuleViolation("End this tenant's active lease before archiving them.")
        return self._set_status(tenant, Tenant.Status.ARCHIVED)

    @extend_schema(request=None, responses=TenantSerializer)
    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        return self._set_status(self.get_object(), Tenant.Status.ACTIVE)

    def _set_status(self, tenant, status):
        action = "tenant.archived" if status == Tenant.Status.ARCHIVED else "tenant.restored"
        update_instance(request=self.request, instance=tenant, action=action, status=status)
        return Response(self.get_serializer(self.get_queryset().get(pk=tenant.pk)).data)

    @extend_schema(request=PortalInviteSerializer, responses=TenantSerializer)
    @action(detail=True, methods=["post"], url_path="portal-invite")
    def portal_invite(self, request, pk=None):
        tenant = self.get_object()
        serializer = PortalInviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        portal_access.invite(
            request=request, tenant=tenant, email=serializer.validated_data["email"]
        )
        return Response(self.get_serializer(self.get_queryset().get(pk=tenant.pk)).data)

    @extend_schema(request=None, responses=TenantSerializer)
    @action(detail=True, methods=["post"], url_path="portal-revoke")
    def portal_revoke(self, request, pk=None):
        tenant = portal_access.revoke_access(request=request, tenant=self.get_object())
        return Response(self.get_serializer(self.get_queryset().get(pk=tenant.pk)).data)
