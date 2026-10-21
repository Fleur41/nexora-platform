from rest_framework import serializers

from apps.accounts.serializers import UserSerializer
from apps.core.modules import registry

from .models import Invitation, Membership, Organization
from .roles import DEFAULT_ACCESS_SCOPE, AccessScope, Role


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = [
            "id",
            "name",
            "slug",
            "legal_name",
            "email",
            "phone",
            "address",
            "country",
            "currency",
            "timezone",
            "status",
            "created_at",
        ]
        read_only_fields = ["id", "slug", "status", "created_at"]

    def validate_timezone(self, value):
        import zoneinfo

        if value not in zoneinfo.available_timezones():
            raise serializers.ValidationError("Unknown timezone.")
        return value

    def validate_currency(self, value):
        value = value.upper()
        if len(value) != 3 or not value.isalpha():
            raise serializers.ValidationError("Use a 3-letter ISO 4217 currency code.")
        return value

    def validate_country(self, value):
        value = value.upper()
        if len(value) != 2 or not value.isalpha():
            raise serializers.ValidationError("Use a 2-letter ISO 3166 country code.")
        return value


class MyOrganizationSerializer(serializers.Serializer):
    """An organization as seen by the current user: includes their role and capabilities."""

    organization = OrganizationSerializer()
    membership_id = serializers.UUIDField(source="id")
    role = serializers.CharField()
    access_scope = serializers.CharField()
    capabilities = serializers.SerializerMethodField()

    def get_capabilities(self, membership: Membership) -> list[str]:
        return sorted(membership.capabilities)


class MembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    capabilities = serializers.SerializerMethodField()

    class Meta:
        model = Membership
        fields = [
            "id",
            "user",
            "role",
            "status",
            "access_scope",
            "extra_permissions",
            "revoked_permissions",
            "capabilities",
            "joined_at",
        ]
        read_only_fields = fields

    def get_capabilities(self, membership: Membership) -> list[str]:
        return sorted(membership.capabilities)


class MembershipUpdateSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=Role.choices, required=False)
    access_scope = serializers.ChoiceField(choices=AccessScope.choices, required=False)
    extra_permissions = serializers.ListField(child=serializers.CharField(), required=False)
    revoked_permissions = serializers.ListField(child=serializers.CharField(), required=False)


class InvitationSerializer(serializers.ModelSerializer):
    invited_by_name = serializers.CharField(source="invited_by.full_name", read_only=True)
    is_expired = serializers.BooleanField(read_only=True)

    class Meta:
        model = Invitation
        fields = [
            "id",
            "email",
            "role",
            "status",
            "expires_at",
            "is_expired",
            "invited_by_name",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "expires_at",
            "is_expired",
            "invited_by_name",
            "created_at",
        ]


class InvitationPreviewRequestSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=128)


class InvitationPreviewSerializer(serializers.Serializer):
    organization_name = serializers.CharField(source="organization.name")
    email = serializers.EmailField()
    role = serializers.CharField()
    role_label = serializers.CharField(source="get_role_display")
    invited_by_name = serializers.CharField(source="invited_by.full_name", default="")
    expires_at = serializers.DateTimeField()
    is_usable = serializers.BooleanField()


class CapabilityCatalogSerializer(serializers.Serializer):
    @staticmethod
    def build() -> dict:
        return {
            "capabilities": [
                {"key": c.key, "label": c.label, "module": c.module}
                for c in registry.capabilities()
            ],
            "access_scopes": [{"key": s.value, "label": s.label} for s in AccessScope],
            "roles": [
                {
                    "key": role.value,
                    "label": role.label,
                    "default_access_scope": DEFAULT_ACCESS_SCOPE[role],
                    "default_capabilities": (
                        sorted(c.key for c in registry.capabilities())
                        if role == Role.OWNER
                        else sorted(registry.role_defaults(role))
                    ),
                }
                for role in Role
            ],
        }
