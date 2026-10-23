from rest_framework import serializers

from apps.organizations.access import OrganizationScopedPrimaryKeyRelatedField
from apps.properties.models import Property

from .models import Announcement, Notification, NotificationSettings


class NotificationSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(
        source="organization.name", default=None, read_only=True
    )

    class Meta:
        model = Notification
        fields = [
            "id",
            "kind",
            "title",
            "body",
            "link",
            "organization",
            "organization_name",
            "read_at",
            "created_at",
        ]
        read_only_fields = fields


class NotificationSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationSettings
        fields = [
            "email_enabled",
            "sms_enabled",
            "invoice_notifications",
            "receipt_notifications",
            "rent_due_reminder_days",
            "arrears_reminders",
            "lease_expiry_days",
        ]


class AnnouncementSerializer(serializers.ModelSerializer):
    property = OrganizationScopedPrimaryKeyRelatedField(
        queryset=Property.objects.all(), required=False, allow_null=True
    )
    property_name = serializers.CharField(source="property.name", default=None, read_only=True)
    sent_by_name = serializers.CharField(source="sent_by.full_name", default="", read_only=True)

    class Meta:
        model = Announcement
        fields = [
            "id",
            "title",
            "body",
            "property",
            "property_name",
            "send_email",
            "send_sms",
            "recipients",
            "sent_by_name",
            "created_at",
        ]
        read_only_fields = ["id", "recipients", "sent_by_name", "created_at"]


class DeliveryLogSerializer(serializers.ModelSerializer):
    tenant_name = serializers.CharField(
        source="recipient_tenant.full_name", default=None, read_only=True
    )
    user_name = serializers.CharField(
        source="recipient_user.full_name", default=None, read_only=True
    )

    class Meta:
        model = Notification
        fields = [
            "id",
            "kind",
            "channel",
            "title",
            "to_address",
            "tenant_name",
            "user_name",
            "status",
            "error",
            "attempts",
            "sent_at",
            "created_at",
        ]
        read_only_fields = fields
