from rest_framework import serializers

from .models import Tenant

# Visible only to members with tenants.manage (identity and private notes).
SENSITIVE_FIELDS = ("id_type", "id_number", "kra_pin", "notes", "employer", "occupation")


class TenantSerializer(serializers.ModelSerializer):
    active_lease_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Tenant
        fields = [
            "id",
            "full_name",
            "email",
            "phone",
            "alternate_phone",
            "id_type",
            "id_number",
            "kra_pin",
            "occupation",
            "employer",
            "emergency_contact_name",
            "emergency_contact_phone",
            "notes",
            "status",
            "active_lease_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "status", "created_at", "updated_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        membership = self.context.get("membership")
        if membership is None or not membership.has_capability("tenants.manage"):
            for field in SENSITIVE_FIELDS:
                data.pop(field, None)
        return data

    def validate_phone(self, value):
        return _normalize_phone(value, required=True)

    def validate_alternate_phone(self, value):
        return _normalize_phone(value)

    def validate_emergency_contact_phone(self, value):
        return _normalize_phone(value)

    def validate_id_number(self, value):
        return value.strip().upper()

    def validate_kra_pin(self, value):
        return value.strip().upper()

    def validate(self, attrs):
        organization = self.context["organization"]
        id_number = attrs.get("id_number", getattr(self.instance, "id_number", ""))
        id_type = attrs.get("id_type", getattr(self.instance, "id_type", Tenant.IdType.NATIONAL_ID))
        if id_number:
            clash = Tenant.objects.filter(
                organization=organization, id_type=id_type, id_number=id_number
            )
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError(
                    {"id_number": ["A tenant with this ID is already registered."]}
                )
        return attrs


def _normalize_phone(value: str, required: bool = False) -> str:
    """Normalize Kenyan numbers to +254 format; leave other international numbers as typed."""
    raw = "".join(ch for ch in value if ch.isdigit() or ch == "+")
    if not raw:
        if required:
            raise serializers.ValidationError("Enter a phone number.")
        return ""
    if raw.startswith("0") and len(raw) == 10:
        raw = "+254" + raw[1:]
    elif raw.startswith("254") and len(raw) == 12:
        raw = "+" + raw
    elif (raw.startswith("7") or raw.startswith("1")) and len(raw) == 9:
        raw = "+254" + raw
    if not raw.startswith("+") or not 8 <= len(raw) <= 16:
        raise serializers.ValidationError("Enter a valid phone number, e.g. 0712 345 678.")
    return raw
