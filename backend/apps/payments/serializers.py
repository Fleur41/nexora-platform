from decimal import Decimal

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.billing.models import Invoice
from apps.billing.serializers import AccessibleLeaseField
from apps.organizations.access import OrganizationScopedPrimaryKeyRelatedField
from apps.properties.models import Property

from . import mpesa
from .models import (
    Payment,
    PaymentAllocation,
    PaymentConfiguration,
    PaymentMethod,
    PaymentRefund,
    PaymentRequest,
    ProviderEvent,
    StatementImport,
)
from .services import unallocated


class PaymentConfigurationSerializer(serializers.ModelSerializer):
    property = OrganizationScopedPrimaryKeyRelatedField(
        queryset=Property.objects.all(), required=False, allow_null=True
    )
    property_name = serializers.CharField(source="property.name", default=None, read_only=True)
    method = serializers.CharField(read_only=True)
    has_credentials = serializers.SerializerMethodField()
    has_passkey = serializers.SerializerMethodField()
    callback_urls = serializers.SerializerMethodField()

    class Meta:
        model = PaymentConfiguration
        fields = [
            "id",
            "provider",
            "method",
            "display_name",
            "property",
            "property_name",
            "shortcode",
            "account_reference_hint",
            "bank_name",
            "bank_branch",
            "account_name",
            "account_number",
            "instructions",
            "currency",
            "is_enabled",
            "valid_from",
            "valid_to",
            "environment",
            "integration_status",
            "integration_message",
            "integration_checked_at",
            "c2b_registered_at",
            "has_credentials",
            "has_passkey",
            "callback_urls",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "integration_status",
            "integration_message",
            "integration_checked_at",
            "c2b_registered_at",
            "created_at",
            "updated_at",
        ]

    def _credential(self, config):
        return getattr(config, "credential", None) if hasattr(config, "credential") else None

    def get_has_credentials(self, config) -> bool:
        credential = self._credential(config)
        return bool(credential and credential.consumer_key and credential.consumer_secret)

    def get_has_passkey(self, config) -> bool:
        credential = self._credential(config)
        return bool(credential and credential.passkey)

    @extend_schema_field(serializers.DictField(child=serializers.CharField(), allow_null=True))
    def get_callback_urls(self, config):
        membership = self.context.get("membership")
        if membership is None or not membership.has_capability("payment_settings.manage"):
            return None
        return mpesa.callback_urls(config)

    def validate(self, attrs):
        provider = attrs.get("provider", getattr(self.instance, "provider", None))
        merged = {
            f: attrs.get(f, getattr(self.instance, f, ""))
            for f in ("shortcode", "bank_name", "account_number")
        }
        if (
            self.instance is not None
            and "provider" in attrs
            and attrs["provider"] != self.instance.provider
        ):
            raise serializers.ValidationError(
                {"provider": ["The provider can't be changed; add a new payment method."]}
            )
        shortcode = merged["shortcode"] or ""
        if provider in PaymentConfiguration.MPESA_PROVIDERS and not (
            shortcode.isdigit() and 5 <= len(shortcode) <= 7
        ):
            raise serializers.ValidationError(
                {"shortcode": ["Enter the 5–7 digit paybill or till number."]}
            )
        if provider == PaymentConfiguration.Provider.BANK:
            errors = {}
            if not merged["bank_name"]:
                errors["bank_name"] = ["Enter the bank name."]
            if not merged["account_number"]:
                errors["account_number"] = ["Enter the account number."]
            if errors:
                raise serializers.ValidationError(errors)
        currency = attrs.get("currency")
        if currency is not None and (len(currency) != 3 or not currency.isalpha()):
            raise serializers.ValidationError({"currency": ["Use a 3-letter currency code."]})
        return attrs


class CredentialSerializer(serializers.Serializer):
    consumer_key = serializers.CharField(
        required=False, allow_blank=True, write_only=True, max_length=200
    )
    consumer_secret = serializers.CharField(
        required=False, allow_blank=True, write_only=True, max_length=200
    )
    passkey = serializers.CharField(
        required=False, allow_blank=True, write_only=True, max_length=200
    )
    environment = serializers.ChoiceField(
        choices=PaymentConfiguration.Environment.choices, required=False
    )


class AllocationSerializer(serializers.ModelSerializer):
    invoice_number = serializers.CharField(source="invoice.number", read_only=True)

    class Meta:
        model = PaymentAllocation
        fields = ["id", "invoice", "invoice_number", "amount", "is_reversed", "created_at"]
        read_only_fields = fields


class RefundSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(
        source="created_by.full_name", default="", read_only=True
    )

    class Meta:
        model = PaymentRefund
        fields = [
            "id",
            "amount",
            "refunded_on",
            "method",
            "reference",
            "reason",
            "created_by_name",
            "created_at",
        ]
        read_only_fields = fields


class PaymentSerializer(serializers.ModelSerializer):
    lease_reference = serializers.CharField(source="lease.reference", default=None, read_only=True)
    tenant_name = serializers.CharField(source="tenant.full_name", default=None, read_only=True)
    unit_number = serializers.CharField(source="lease.unit.number", default=None, read_only=True)
    property_name = serializers.CharField(
        source="lease.unit.property.name", default=None, read_only=True
    )
    configuration_name = serializers.SerializerMethodField()
    unallocated = serializers.SerializerMethodField()
    is_matched = serializers.BooleanField(read_only=True)

    class Meta:
        model = Payment
        fields = [
            "id",
            "receipt_number",
            "lease",
            "lease_reference",
            "tenant",
            "tenant_name",
            "unit_number",
            "property_name",
            "method",
            "configuration_name",
            "amount",
            "unallocated",
            "received_on",
            "reference",
            "payer_name",
            "payer_phone",
            "account_reference",
            "status",
            "source",
            "is_matched",
            "created_at",
        ]
        read_only_fields = fields

    def get_configuration_name(self, payment) -> str:
        return (
            payment.configuration_snapshot.get("display_name", "")
            if payment.configuration_snapshot
            else ""
        )

    def get_unallocated(self, payment) -> str:
        return str(unallocated(payment))


class PaymentDetailSerializer(PaymentSerializer):
    allocations = AllocationSerializer(many=True, read_only=True)
    refunds = RefundSerializer(many=True, read_only=True)
    created_by_name = serializers.CharField(
        source="created_by.full_name", default="", read_only=True
    )
    reversed_by_name = serializers.CharField(
        source="reversed_by.full_name", default="", read_only=True
    )

    class Meta(PaymentSerializer.Meta):
        fields = [
            *PaymentSerializer.Meta.fields,
            "configuration_snapshot",
            "notes",
            "allocations",
            "refunds",
            "created_by_name",
            "matched_at",
            "reversed_at",
            "reversed_by_name",
            "reversal_reason",
        ]
        read_only_fields = fields


class AllocationInputSerializer(serializers.Serializer):
    invoice = OrganizationScopedPrimaryKeyRelatedField(queryset=Invoice.objects.all())
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))


class RecordPaymentSerializer(serializers.Serializer):
    lease = AccessibleLeaseField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    received_on = serializers.DateField()
    configuration = OrganizationScopedPrimaryKeyRelatedField(
        queryset=PaymentConfiguration.objects.all(), required=False, allow_null=True
    )
    method = serializers.ChoiceField(choices=PaymentMethod.choices, required=False)
    reference = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    payer_name = serializers.CharField(max_length=150, required=False, allow_blank=True, default="")
    payer_phone = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    allocations = AllocationInputSerializer(many=True, required=False)

    def validate(self, attrs):
        if not attrs.get("configuration") and not attrs.get("method"):
            raise serializers.ValidationError({"method": ["Choose how the tenant paid."]})
        method = attrs["configuration"].method if attrs.get("configuration") else attrs["method"]
        if method in (PaymentMethod.MPESA, PaymentMethod.BANK) and not attrs.get("reference"):
            raise serializers.ValidationError(
                {"reference": ["Enter the M-Pesa code or bank reference."]}
            )
        return attrs


class AllocateSerializer(serializers.Serializer):
    allocations = AllocationInputSerializer(many=True, required=False)


class MoveAllocationSerializer(serializers.Serializer):
    from_invoice = OrganizationScopedPrimaryKeyRelatedField(queryset=Invoice.objects.all())
    to_invoice = OrganizationScopedPrimaryKeyRelatedField(
        queryset=Invoice.objects.all(),
        required=False,
        allow_null=True,
        help_text="Leave empty to move it back to the tenant's credit.",
    )
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    reason = serializers.CharField(max_length=255)


class MatchSerializer(serializers.Serializer):
    lease = AccessibleLeaseField()


class PaymentReverseSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)


class RefundInputSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    refunded_on = serializers.DateField()
    method = serializers.ChoiceField(choices=PaymentMethod.choices)
    reference = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    reason = serializers.CharField(max_length=255)


class PaymentRequestSerializer(serializers.ModelSerializer):
    lease_reference = serializers.CharField(source="lease.reference", read_only=True)
    tenant_name = serializers.CharField(source="lease.tenant.full_name", read_only=True)
    receipt_number = serializers.CharField(
        source="payment.receipt_number", default=None, read_only=True
    )
    phone = serializers.SerializerMethodField()

    class Meta:
        model = PaymentRequest
        fields = [
            "id",
            "lease",
            "lease_reference",
            "tenant_name",
            "phone",
            "amount",
            "status",
            "result_description",
            "payment",
            "receipt_number",
            "created_at",
        ]
        read_only_fields = fields

    def get_phone(self, req) -> str:
        return f"07••••{req.phone[-3:]}" if req.phone else ""


class StkRequestSerializer(serializers.Serializer):
    lease = AccessibleLeaseField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("1"))
    phone = serializers.CharField(max_length=20)


class StatementImportSerializer(serializers.ModelSerializer):
    configuration_name = serializers.CharField(source="configuration.display_name", read_only=True)
    created_by_name = serializers.CharField(
        source="created_by.full_name", default="", read_only=True
    )

    class Meta:
        model = StatementImport
        fields = [
            "id",
            "configuration",
            "configuration_name",
            "file_name",
            "rows_total",
            "rows_created",
            "rows_matched",
            "rows_duplicate",
            "rows_skipped",
            "errors",
            "created_by_name",
            "created_at",
        ]
        read_only_fields = fields


class StatementUploadSerializer(serializers.Serializer):
    configuration = OrganizationScopedPrimaryKeyRelatedField(
        queryset=PaymentConfiguration.objects.all()
    )
    file = serializers.FileField()


class ProviderEventSerializer(serializers.ModelSerializer):
    receipt_number = serializers.CharField(
        source="payment.receipt_number", default=None, read_only=True
    )

    class Meta:
        model = ProviderEvent
        fields = [
            "id",
            "event_type",
            "external_id",
            "status",
            "message",
            "receipt_number",
            "created_at",
        ]
        read_only_fields = fields
