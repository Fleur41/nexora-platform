from decimal import Decimal

from rest_framework import serializers

from apps.leases.serializers import AccessibleUnitField
from apps.organizations.access import OrganizationScopedPrimaryKeyRelatedField
from apps.organizations.models import Membership

from .models import MaintenanceCost, MaintenanceRequest, MaintenanceUpdate


class MaintenanceUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaintenanceUpdate
        fields = [
            "id",
            "author_name",
            "from_tenant",
            "body",
            "is_internal",
            "status_from",
            "status_to",
            "created_at",
        ]
        read_only_fields = fields


class MaintenanceCostSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaintenanceCost
        fields = [
            "id",
            "kind",
            "supplier_name",
            "description",
            "amount",
            "status",
            "incurred_on",
            "created_at",
        ]
        read_only_fields = ["id", "status", "created_at"]


class MaintenanceRequestSerializer(serializers.ModelSerializer):
    unit = AccessibleUnitField()
    unit_number = serializers.CharField(source="unit.number", read_only=True)
    property_id = serializers.UUIDField(source="unit.property_id", read_only=True)
    property_name = serializers.CharField(source="unit.property.name", read_only=True)
    tenant_name = serializers.CharField(source="tenant.full_name", default=None, read_only=True)
    assigned_to_name = serializers.CharField(
        source="assigned_to.user.full_name", default=None, read_only=True
    )

    class Meta:
        model = MaintenanceRequest
        fields = [
            "id",
            "reference",
            "unit",
            "unit_number",
            "property_id",
            "property_name",
            "tenant",
            "tenant_name",
            "source",
            "category",
            "title",
            "description",
            "urgency",
            "status",
            "assigned_to",
            "assigned_to_name",
            "scheduled_for",
            "resolved_at",
            "closed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "reference",
            "tenant",
            "source",
            "status",
            "assigned_to",
            "scheduled_for",
            "resolved_at",
            "closed_at",
            "created_at",
            "updated_at",
        ]


class MaintenanceDetailSerializer(MaintenanceRequestSerializer):
    updates = serializers.SerializerMethodField()
    costs = serializers.SerializerMethodField()

    class Meta(MaintenanceRequestSerializer.Meta):
        fields = [*MaintenanceRequestSerializer.Meta.fields, "updates", "costs"]

    def get_updates(self, req) -> list:
        return MaintenanceUpdateSerializer(req.updates.all(), many=True).data

    def get_costs(self, req) -> list | None:
        membership = self.context.get("membership")
        if membership is None or not membership.has_capability("maintenance.costs"):
            return None  # costs are hidden from roles without maintenance.costs (e.g. caretakers)
        return MaintenanceCostSerializer(req.costs.all(), many=True).data


class StatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=MaintenanceRequest.Status.choices)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class NoteSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=5000)
    internal = serializers.BooleanField(default=False)


class AssignSerializer(serializers.Serializer):
    membership = OrganizationScopedPrimaryKeyRelatedField(
        queryset=Membership.objects.filter(status=Membership.Status.ACTIVE), allow_null=True
    )
    scheduled_for = serializers.DateField(required=False, allow_null=True)


class CostInputSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=MaintenanceCost.Kind.choices)
    description = serializers.CharField(max_length=255)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    supplier_name = serializers.CharField(
        max_length=150, required=False, allow_blank=True, default=""
    )
    incurred_on = serializers.DateField(required=False, allow_null=True)


class DecideSerializer(serializers.Serializer):
    approve = serializers.BooleanField()
