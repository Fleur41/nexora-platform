from rest_framework import serializers

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = [
            "id",
            "action",
            "actor_email",
            "target_type",
            "target_id",
            "target_repr",
            "changes",
            "metadata",
            "ip_address",
            "request_id",
            "created_at",
        ]
        read_only_fields = fields
