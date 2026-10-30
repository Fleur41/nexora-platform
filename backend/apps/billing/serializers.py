from decimal import Decimal

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.leases.models import Lease
from apps.organizations.access import OrganizationScopedPrimaryKeyRelatedField
from apps.properties.access import accessible_properties
from apps.properties.models import Property, Unit, UnitType
from apps.properties.serializers import AccessiblePropertyField

from .models import (
    BillingRun,
    BillingSettings,
    ChargeRule,
    ChargeType,
    Invoice,
    InvoiceLine,
    LedgerEntry,
    SharedCost,
)


@extend_schema_field(OpenApiTypes.UUID)
class AccessibleLeaseField(serializers.PrimaryKeyRelatedField):
    def get_queryset(self):
        membership = self.context.get("membership")
        if membership is None:
            return Lease.objects.none()
        return Lease.objects.filter(
            unit__property__in=accessible_properties(membership).values("pk")
        )


class ChargeTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChargeType
        fields = [
            "id",
            "code",
            "name",
            "income_category",
            "meter_utility",
            "is_system",
            "is_active",
        ]
        read_only_fields = ["id", "code", "is_system"]


class ChargeRuleSerializer(serializers.ModelSerializer):
    charge_type = OrganizationScopedPrimaryKeyRelatedField(queryset=ChargeType.objects.all())
    property = OrganizationScopedPrimaryKeyRelatedField(
        queryset=Property.objects.all(), required=False, allow_null=True
    )
    unit_type = OrganizationScopedPrimaryKeyRelatedField(
        queryset=UnitType.objects.all(), required=False, allow_null=True
    )
    unit = OrganizationScopedPrimaryKeyRelatedField(
        queryset=Unit.objects.all(), required=False, allow_null=True
    )
    charge_type_name = serializers.CharField(source="charge_type.name", read_only=True)
    target_name = serializers.SerializerMethodField()
    is_billed = serializers.SerializerMethodField()

    class Meta:
        model = ChargeRule
        fields = [
            "id",
            "charge_type",
            "charge_type_name",
            "scope",
            "property",
            "unit_type",
            "unit",
            "target_name",
            "method",
            "amount",
            "usage_unit",
            "is_enabled",
            "included_in_rent",
            "effective_from",
            "effective_to",
            "description",
            "is_billed",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]
        validators = []  # overlap is checked by the database (exclusion constraint)

    def get_target_name(self, rule) -> str:
        if rule.scope == ChargeRule.Scope.ORGANIZATION:
            return "All properties"
        if rule.scope == ChargeRule.Scope.PROPERTY:
            return rule.property.name
        if rule.scope == ChargeRule.Scope.UNIT_TYPE:
            return f"{rule.unit_type.name} · {rule.unit_type.property.name}"
        return f"Unit {rule.unit.number} · {rule.unit.property.name}"

    def get_is_billed(self, rule) -> bool:
        return getattr(rule, "billed_lines", None) is not None and rule.billed_lines > 0


class EndRuleSerializer(serializers.Serializer):
    effective_to = serializers.DateField()


class BillingSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = BillingSettings
        fields = ["auto_generate", "generate_day"]


class SharedCostSerializer(serializers.ModelSerializer):
    property = AccessiblePropertyField()
    charge_type = OrganizationScopedPrimaryKeyRelatedField(queryset=ChargeType.objects.all())
    property_name = serializers.CharField(source="property.name", read_only=True)
    charge_type_name = serializers.CharField(source="charge_type.name", read_only=True)
    allocated_amount = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    allocated_units = serializers.IntegerField(read_only=True)

    class Meta:
        model = SharedCost
        fields = [
            "id",
            "property",
            "property_name",
            "charge_type",
            "charge_type_name",
            "period",
            "total_amount",
            "split_by",
            "description",
            "allocated_amount",
            "allocated_units",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]
        validators = []

    def validate_period(self, value):
        return value.replace(day=1)

    def validate(self, attrs):
        exists = SharedCost.objects.filter(
            property=attrs["property"], charge_type=attrs["charge_type"], period=attrs["period"]
        )
        if self.instance is not None:
            exists = exists.exclude(pk=self.instance.pk)
        if exists.exists():
            raise serializers.ValidationError(
                {"period": ["This charge already has a shared cost for that property and month."]}
            )
        split_by = attrs.get("split_by", SharedCost.SplitBy.EQUAL)
        if split_by == SharedCost.SplitBy.METER_USAGE and not attrs["charge_type"].meter_utility:
            raise serializers.ValidationError(
                {
                    "split_by": [
                        f"{attrs['charge_type'].name} is not linked to a meter type, so it can't "
                        "be split by usage."
                    ]
                }
            )
        return attrs


class PeriodSerializer(serializers.Serializer):
    period = serializers.RegexField(r"^\d{4}-(0[1-9]|1[0-2])$", help_text="YYYY-MM")


class BillingRunSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(
        source="created_by.full_name", default="", read_only=True
    )

    class Meta:
        model = BillingRun
        fields = [
            "id",
            "period",
            "trigger",
            "invoices_created",
            "lines_created",
            "total_billed",
            "skipped",
            "created_by_name",
            "created_at",
        ]
        read_only_fields = fields


class InvoiceLineSerializer(serializers.ModelSerializer):
    charge_type_name = serializers.CharField(source="charge_type.name", read_only=True)

    class Meta:
        model = InvoiceLine
        fields = [
            "id",
            "charge_type",
            "charge_type_name",
            "description",
            "quantity",
            "unit_price",
            "amount",
            "income_category",
            "period_start",
            "period_end",
            "is_void",
        ]
        read_only_fields = fields


class LedgerEntrySerializer(serializers.ModelSerializer):
    invoice_number = serializers.CharField(source="invoice.number", default=None, read_only=True)
    created_by_name = serializers.CharField(
        source="created_by.full_name", default="", read_only=True
    )

    class Meta:
        model = LedgerEntry
        fields = [
            "id",
            "entry_type",
            "amount",
            "invoice",
            "invoice_number",
            "reference",
            "effective_date",
            "description",
            "reason",
            "created_by_name",
            "created_at",
        ]
        read_only_fields = fields


class InvoiceSerializer(serializers.ModelSerializer):
    tenant_name = serializers.CharField(source="tenant.full_name", read_only=True)
    unit_number = serializers.CharField(source="unit.number", read_only=True)
    property_name = serializers.CharField(source="unit.property.name", read_only=True)
    lease_reference = serializers.CharField(source="lease.reference", read_only=True)
    amount_due = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id",
            "number",
            "kind",
            "status",
            "lease",
            "lease_reference",
            "tenant",
            "tenant_name",
            "unit",
            "unit_number",
            "property_name",
            "period_start",
            "period_end",
            "issue_date",
            "due_date",
            "currency",
            "total",
            "amount_due",
            "created_at",
        ]
        read_only_fields = fields


class InvoiceDetailSerializer(InvoiceSerializer):
    lines = InvoiceLineSerializer(many=True, read_only=True)
    ledger_entries = LedgerEntrySerializer(many=True, read_only=True)
    created_by_name = serializers.CharField(
        source="created_by.full_name", default="", read_only=True
    )
    voided_by_name = serializers.CharField(source="voided_by.full_name", default="", read_only=True)

    class Meta(InvoiceSerializer.Meta):
        fields = [
            *InvoiceSerializer.Meta.fields,
            "notes",
            "lines",
            "ledger_entries",
            "created_by_name",
            "voided_at",
            "voided_by_name",
            "void_reason",
        ]
        read_only_fields = fields


class OneOffLineSerializer(serializers.Serializer):
    charge_type = OrganizationScopedPrimaryKeyRelatedField(
        queryset=ChargeType.objects.filter(is_active=True)
    )
    description = serializers.CharField(max_length=255)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))


class OneOffInvoiceSerializer(serializers.Serializer):
    lease = AccessibleLeaseField()
    due_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    lines = OneOffLineSerializer(many=True)

    def validate_lines(self, value):
        if not value:
            raise serializers.ValidationError("Add at least one line.")
        if len(value) > 50:
            raise serializers.ValidationError("Use at most 50 lines.")
        return value


class VoidSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)


class CreditSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    reason = serializers.CharField(max_length=255)


class StatementQuerySerializer(serializers.Serializer):
    start = serializers.DateField(required=False)
    end = serializers.DateField(required=False)
