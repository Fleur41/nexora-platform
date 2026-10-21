from rest_framework import mixins

from apps.organizations.access import OrganizationScopedViewSet

from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, OrganizationScopedViewSet):
    queryset = AuditLog.objects.select_related("actor")
    serializer_class = AuditLogSerializer
    required_capabilities = {"list": "audit.view", "retrieve": "audit.view"}
    filterset_fields = ["action", "target_type", "target_id"]
    search_fields = ["action", "actor_email", "target_repr"]
    ordering_fields = ["created_at"]
