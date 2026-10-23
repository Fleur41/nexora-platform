from decimal import Decimal

from rest_framework import serializers

from apps.leases.serializers import AccessibleUnitField
from apps.organizations.access import OrganizationScopedPrimaryKeyRelatedField
from apps.organizations.models import Membership

from .models import Inspection, InspectionItem


class InspectionItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = InspectionItem
        fields = ["id", "area", "name", "condition", "notes", "charge_amount", "position"]
        read_only_fields = ["id", "position"]


class InspectionSerializer(serializers.ModelSerializer):
    unit = AccessibleUnitField()
    inspector = OrganizationScopedPrimaryKeyRelatedField(
        queryset=Membership.objects.filter(status=Membership.Status.ACTIVE),
        required=False,
        allow_null=True,
    )
    unit_number = serializers.CharField(source="unit.number", read_only=True)
    property_name = serializers.CharField(source="unit.property.name", read_only=True)
    tenant_name = serializers.CharField(
        source="lease.tenant.full_name", default=None, read_only=True
    )
    lease_reference = serializers.CharField(source="lease.reference", default=None, read_only=True)
    inspector_name = serializers.CharField(
        source="inspector.user.full_name", default=None, read_only=True
    )
    damages_total = serializers.SerializerMethodField()

    class Meta:
        model = Inspection
        fields = [
            "id",
            "reference",
            "unit",
            "unit_number",
            "property_name",
            "lease",
            "lease_reference",
            "tenant_name",
            "kind",
            "status",
            "scheduled_for",
            "inspector",
            "inspector_name",
            "summary",
            "keys_returned",
            "tenant_present",
            "tenant_signature_name",
            "inspector_signature_name",
            "completed_at",
            "damages_total",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "reference",
            "lease",
            "status",
            "summary",
            "keys_returned",
            "tenant_present",
            "tenant_signature_name",
            "inspector_signature_name",
            "completed_at",
            "created_at",
        ]

    def get_damages_total(self, inspection) -> str:
        return str(sum((i.charge_amount for i in inspection.items.all()), Decimal("0.00")))


class InspectionDetailSerializer(InspectionSerializer):
    items = InspectionItemSerializer(many=True, read_only=True)

    class Meta(InspectionSerializer.Meta):
        fields = [*InspectionSerializer.Meta.fields, "items"]


class ItemUpdateSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    area = serializers.CharField(max_length=60, required=False)
    name = serializers.CharField(max_length=100, required=False)
    condition = serializers.ChoiceField(choices=InspectionItem.Condition.choices, required=False)
    notes = serializers.CharField(max_length=500, required=False, allow_blank=True)
    charge_amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0"), required=False
    )


class ItemsSerializer(serializers.Serializer):
    items = ItemUpdateSerializer(many=True)


class InspectionCompleteSerializer(serializers.Serializer):
    summary = serializers.CharField(required=False, allow_blank=True, default="")
    keys_returned = serializers.IntegerField(
        min_value=0, max_value=50, required=False, allow_null=True
    )
    tenant_present = serializers.BooleanField(default=False)
    tenant_signature_name = serializers.CharField(
        max_length=150, required=False, allow_blank=True, default=""
    )
    inspector_signature_name = serializers.CharField(max_length=150)
