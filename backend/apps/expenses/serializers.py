from decimal import Decimal

from rest_framework import serializers

from apps.leases.serializers import AccessibleUnitField
from apps.properties.serializers import AccessiblePropertyField

from .models import Expense


class ExpenseSerializer(serializers.ModelSerializer):
    property = AccessiblePropertyField(required=False, allow_null=True)
    unit = AccessibleUnitField(required=False, allow_null=True)
    property_name = serializers.CharField(source="property.name", default=None, read_only=True)
    unit_number = serializers.CharField(source="unit.number", default=None, read_only=True)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    created_by_name = serializers.CharField(
        source="created_by.full_name", default="", read_only=True
    )
    voided_by_name = serializers.CharField(source="voided_by.full_name", default="", read_only=True)

    class Meta:
        model = Expense
        fields = [
            "id",
            "reference",
            "property",
            "property_name",
            "unit",
            "unit_number",
            "category",
            "description",
            "supplier_name",
            "amount",
            "incurred_on",
            "method",
            "payment_reference",
            "notes",
            "status",
            "voided_at",
            "voided_by_name",
            "void_reason",
            "created_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "reference",
            "status",
            "voided_at",
            "void_reason",
            "created_at",
            "updated_at",
        ]


class ExpenseVoidSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)


class ExpenseSummarySerializer(serializers.Serializer):
    count = serializers.IntegerField()
    total = serializers.DecimalField(max_digits=16, decimal_places=2)
    by_category = serializers.ListField(child=serializers.DictField())
