from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.organizations.access import OrganizationPermission, OrganizationScopedViewSet
from apps.properties.access import accessible_properties

from .models import Announcement, Notification
from .serializers import (
    AnnouncementSerializer,
    DeliveryLogSerializer,
    NotificationSerializer,
    NotificationSettingsSerializer,
)
from .services import send_announcement, settings_for


class InboxViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """The signed-in user's in-app notifications (staff and tenants alike)."""

    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):  # schema generation
            return Notification.objects.none()
        queryset = Notification.objects.filter(
            recipient_user=self.request.user, channel=Notification.Channel.IN_APP
        ).select_related("organization")
        if self.request.query_params.get("unread") == "true":
            queryset = queryset.filter(read_at__isnull=True)
        return queryset

    @extend_schema(responses=dict)
    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request):
        return Response({"count": self.get_queryset().filter(read_at__isnull=True).count()})

    @extend_schema(request=None, responses={204: None})
    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        self.get_queryset().filter(pk=pk, read_at__isnull=True).update(read_at=timezone.now())
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=None, responses={204: None})
    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        self.get_queryset().filter(read_at__isnull=True).update(read_at=timezone.now())
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationSettingsView(APIView):
    permission_classes = [IsAuthenticated, OrganizationPermission]
    required_capabilities = {"get": None, "patch": "notifications.configure"}

    @extend_schema(responses=NotificationSettingsSerializer)
    def get(self, request):
        return Response(NotificationSettingsSerializer(settings_for(request.organization)).data)

    @extend_schema(request=NotificationSettingsSerializer, responses=NotificationSettingsSerializer)
    def patch(self, request):
        from apps.properties.services import update_instance

        instance = settings_for(request.organization)
        serializer = NotificationSettingsSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        update_instance(
            request=request,
            instance=instance,
            action="notifications.settings_updated",
            **serializer.validated_data,
        )
        return Response(NotificationSettingsSerializer(instance).data)


class DeliveryLogViewSet(mixins.ListModelMixin, OrganizationScopedViewSet):
    """Outbound email/SMS for the organization, with delivery outcomes."""

    queryset = Notification.objects.exclude(channel=Notification.Channel.IN_APP).select_related(
        "recipient_tenant", "recipient_user"
    )
    serializer_class = DeliveryLogSerializer
    required_capabilities = {"list": "notifications.configure"}
    filterset_fields = ["status", "channel", "kind"]


class AnnouncementViewSet(
    mixins.ListModelMixin, mixins.CreateModelMixin, OrganizationScopedViewSet
):
    queryset = Announcement.objects.select_related("property", "sent_by")
    serializer_class = AnnouncementSerializer
    required_capabilities = {"list": "announcements.send", "create": "announcements.send"}

    def get_queryset(self):
        queryset = super().get_queryset()
        if not self.request.membership.has_organization_scope:
            queryset = queryset.filter(
                property__in=accessible_properties(self.request.membership).values("pk")
            )
        return queryset

    @transaction.atomic
    def perform_create(self, serializer):
        membership = self.request.membership
        prop = serializer.validated_data.get("property")
        allowed = accessible_properties(membership)
        if prop is not None and not allowed.filter(pk=prop.pk).exists():
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"property": ["Choose a property you manage."]})
        if prop is None and not membership.has_organization_scope:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"property": ["Choose one of your properties."]})
        send_announcement(
            request=self.request,
            announcement=serializer.save(
                organization=self.request.organization, sent_by=self.request.user
            ),
            properties=allowed,
        )
