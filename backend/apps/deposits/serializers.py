from decimal import Decimal

from rest_framework import serializers

from .models import DepositTransaction


class DepositTransactionSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(
        source="created_by.full_name", default="", read_only=True
    )
    reverses_kind = serializers.CharField(source="reverses.kind", default=None, read_only=True)
    is_reversed = serializers.SerializerMethodField()

    class Meta:
        model = DepositTransaction
        fields = [
            "id",
            "kind",
            "amount",
            "transaction_date",
            "method",
            "reference",
            "reason",
            "reverses",
            "reverses_kind",
            "is_reversed",
            "created_by_name",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "reverses",
            "reverses_kind",
            "is_reversed",
            "created_by_name",
            "created_at",
        ]

    def get_is_reversed(self, tx) -> bool:
        return hasattr(tx, "reversed_by")


class RecordDepositSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(
        choices=[
            k for k in DepositTransaction.Kind.choices if k[0] != DepositTransaction.Kind.REVERSAL
        ]
    )
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    transaction_date = serializers.DateField()
    method = serializers.ChoiceField(
        choices=DepositTransaction.Method.choices, required=False, default=""
    )
    reference = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    reason = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class ReverseSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)


def summary_payload(lease, summary) -> dict:
    return {
        "lease": str(lease.pk),
        "lease_reference": lease.reference,
        "lease_status": lease.status,
        "tenant_name": lease.tenant.full_name,
        "unit_number": lease.unit.number,
        "property_name": lease.unit.property.name,
        "agreed": str(summary.agreed),
        "received": str(summary.received),
        "deducted": str(summary.deducted),
        "refunded": str(summary.refunded),
        "held": str(summary.held),
        "outstanding": str(summary.outstanding),
    }
