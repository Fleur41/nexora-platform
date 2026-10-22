import builtins

from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.crypto import EncryptedTextField
from apps.core.models import OrganizationScopedModel, TimeStampedModel
from apps.core.money import MoneyField


class PaymentMethod(models.TextChoices):
    MPESA = "mpesa", "M-Pesa"
    BANK = "bank", "Bank transfer"
    CASH = "cash", "Cash"
    CHEQUE = "cheque", "Cheque"
    OTHER = "other", "Other"


class PaymentConfiguration(OrganizationScopedModel):
    """How tenants pay a landlord. Organization-wide, or for one property (which then
    replaces the organization-wide methods for that property).

    Tenant-facing details live here; provider secrets live in IntegrationCredential.
    """

    class Provider(models.TextChoices):
        MPESA_PAYBILL = "mpesa_paybill", "M-Pesa Paybill"
        MPESA_TILL = "mpesa_till", "M-Pesa Till (Buy Goods)"
        BANK = "bank", "Bank account"
        CASH = "cash", "Cash"
        OTHER = "other", "Other"

    class Environment(models.TextChoices):
        SANDBOX = "sandbox", "Sandbox (testing)"
        PRODUCTION = "production", "Production"

    class IntegrationStatus(models.TextChoices):
        NOT_CONFIGURED = "not_configured", "Not configured"
        CREDENTIALS_SAVED = "credentials_saved", "Credentials saved, not verified"
        VERIFIED = "verified", "Connection verified"
        FAILED = "failed", "Connection failed"

    MPESA_PROVIDERS = (Provider.MPESA_PAYBILL, Provider.MPESA_TILL)

    provider = models.CharField(max_length=16, choices=Provider.choices)
    display_name = models.CharField(max_length=100)
    property = models.ForeignKey(
        "properties.Property",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="payment_configurations",
    )
    shortcode = models.CharField(max_length=20, blank=True, help_text="Paybill or till number")
    account_reference_hint = models.CharField(
        max_length=120,
        blank=True,
        help_text='What tenants enter as the account, e.g. "Your unit number"',
    )
    bank_name = models.CharField(max_length=100, blank=True)
    bank_branch = models.CharField(max_length=100, blank=True)
    account_name = models.CharField(max_length=150, blank=True)
    account_number = models.CharField(max_length=40, blank=True)
    instructions = models.TextField(blank=True, help_text="Shown to tenants.")
    currency = models.CharField(max_length=3, default="KES")
    is_enabled = models.BooleanField(default=True)
    valid_from = models.DateField(null=True, blank=True)
    valid_to = models.DateField(null=True, blank=True)

    # Integration state (M-Pesa). Never set to verified without a successful provider call.
    environment = models.CharField(
        max_length=16, choices=Environment.choices, default=Environment.SANDBOX
    )
    integration_status = models.CharField(
        max_length=24, choices=IntegrationStatus.choices, default=IntegrationStatus.NOT_CONFIGURED
    )
    integration_message = models.CharField(max_length=255, blank=True)
    integration_checked_at = models.DateTimeField(null=True, blank=True)
    c2b_registered_at = models.DateTimeField(null=True, blank=True)
    # Secret path segment identifying this configuration in provider callbacks. Stored
    # encrypted (so owners can see their URLs) and as a hash (for lookup).
    callback_token = EncryptedTextField(blank=True)
    callback_token_hash = models.CharField(max_length=64, blank=True, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["property__name", "provider", "display_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["callback_token_hash"],
                condition=~Q(callback_token_hash=""),
                name="payments_config_unique_callback_token",
            ),
            models.CheckConstraint(
                name="payments_config_valid_dates",
                condition=Q(valid_to__isnull=True)
                | Q(valid_from__isnull=True)
                | Q(valid_to__gte=models.F("valid_from")),
            ),
        ]

    def __str__(self) -> str:
        return self.display_name

    @builtins.property  # `property` is shadowed by the field above
    def method(self) -> str:
        if self.provider in self.MPESA_PROVIDERS:
            return PaymentMethod.MPESA
        if self.provider == self.Provider.BANK:
            return PaymentMethod.BANK
        if self.provider == self.Provider.CASH:
            return PaymentMethod.CASH
        return PaymentMethod.OTHER

    def snapshot(self) -> dict:
        """Details as they stood when a payment was received (kept on the payment)."""
        return {
            "id": str(self.pk),
            "provider": self.provider,
            "display_name": self.display_name,
            "shortcode": self.shortcode,
            "bank_name": self.bank_name,
            "bank_branch": self.bank_branch,
            "account_name": self.account_name,
            "account_number": self.account_number,
            "property": str(self.property_id) if self.property_id else None,
        }


class IntegrationCredential(OrganizationScopedModel):
    """Provider secrets, encrypted at rest. Never returned by the API."""

    configuration = models.OneToOneField(
        PaymentConfiguration, on_delete=models.CASCADE, related_name="credential"
    )
    consumer_key = EncryptedTextField(blank=True)
    consumer_secret = EncryptedTextField(blank=True)
    passkey = EncryptedTextField(blank=True, help_text="Lipa na M-Pesa Online passkey (STK push)")
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    def __str__(self) -> str:
        return f"Credentials for {self.configuration}"


class StatementImport(OrganizationScopedModel):
    configuration = models.ForeignKey(
        PaymentConfiguration, on_delete=models.PROTECT, related_name="imports"
    )
    file_name = models.CharField(max_length=255)
    rows_total = models.PositiveIntegerField(default=0)
    rows_created = models.PositiveIntegerField(default=0)
    rows_matched = models.PositiveIntegerField(default=0)
    rows_duplicate = models.PositiveIntegerField(default=0)
    rows_skipped = models.PositiveIntegerField(default=0)
    errors = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.file_name


class Payment(OrganizationScopedModel):
    """Money received. Immutable once recorded: corrections are reversals and refunds.

    A payment without a lease is *unmatched* (e.g. an M-Pesa payment with an unknown
    account number) and waits in the reconciliation queue.
    """

    class Status(models.TextChoices):
        COMPLETED = "completed", "Completed"
        REVERSED = "reversed", "Reversed"

    class Source(models.TextChoices):
        MANUAL = "manual", "Recorded manually"
        MPESA_C2B = "mpesa_c2b", "M-Pesa (paybill/till)"
        MPESA_STK = "mpesa_stk", "M-Pesa (payment request)"
        BANK_IMPORT = "bank_import", "Bank statement import"

    receipt_number = models.CharField(max_length=32, editable=False)
    lease = models.ForeignKey(
        "leases.Lease", null=True, blank=True, on_delete=models.PROTECT, related_name="payments"
    )
    tenant = models.ForeignKey(
        "tenants.Tenant", null=True, blank=True, on_delete=models.PROTECT, related_name="payments"
    )
    method = models.CharField(max_length=16, choices=PaymentMethod.choices)
    configuration = models.ForeignKey(
        PaymentConfiguration,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="payments",
    )
    configuration_snapshot = models.JSONField(default=dict, blank=True)
    amount = MoneyField()
    received_on = models.DateField()
    reference = models.CharField(
        max_length=64, blank=True, help_text="e.g. M-Pesa code or bank reference"
    )
    external_id = models.CharField(
        max_length=128, blank=True, help_text="Provider transaction id / import fingerprint"
    )
    payer_name = models.CharField(max_length=150, blank=True)
    payer_phone = models.CharField(max_length=32, blank=True)
    account_reference = models.CharField(
        max_length=64, blank=True, help_text="Account entered by the payer"
    )
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.COMPLETED)
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.MANUAL)
    statement_import = models.ForeignKey(
        StatementImport, null=True, blank=True, on_delete=models.SET_NULL, related_name="payments"
    )
    matched_at = models.DateTimeField(null=True, blank=True)
    matched_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reversal_reason = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-received_on", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "receipt_number"], name="payments_unique_receipt"
            ),
            # The same provider transaction / statement row can only ever be recorded once.
            models.UniqueConstraint(
                fields=["organization", "source", "external_id"],
                condition=~Q(external_id=""),
                name="payments_unique_external_id",
            ),
            # A reference (e.g. M-Pesa code) can't be used by two live payments.
            models.UniqueConstraint(
                fields=["organization", "method", "reference"],
                condition=~Q(reference="") & Q(status="completed"),
                name="payments_unique_live_reference",
            ),
            models.CheckConstraint(name="payments_positive_amount", condition=Q(amount__gt=0)),
            models.CheckConstraint(
                name="payments_lease_and_tenant_together",
                condition=Q(lease__isnull=True, tenant__isnull=True)
                | Q(lease__isnull=False, tenant__isnull=False),
            ),
        ]
        indexes = [
            models.Index(fields=["organization", "status", "received_on"]),
            models.Index(fields=["organization", "lease"]),
        ]

    def __str__(self) -> str:
        return self.receipt_number

    @builtins.property
    def is_matched(self) -> bool:
        return self.lease_id is not None


class PaymentAllocation(OrganizationScopedModel):
    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name="allocations")
    invoice = models.ForeignKey(
        "billing.Invoice", on_delete=models.PROTECT, related_name="allocations"
    )
    amount = MoneyField()
    is_reversed = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.CheckConstraint(name="payments_allocation_positive", condition=Q(amount__gt=0)),
        ]

    def __str__(self) -> str:
        return f"{self.payment} → {self.invoice}: {self.amount}"


class PaymentRefund(OrganizationScopedModel):
    """Unallocated credit returned to the tenant."""

    payment = models.ForeignKey(Payment, on_delete=models.PROTECT, related_name="refunds")
    amount = MoneyField()
    refunded_on = models.DateField()
    method = models.CharField(max_length=16, choices=PaymentMethod.choices)
    reference = models.CharField(max_length=64, blank=True)
    reason = models.CharField(max_length=255)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.CheckConstraint(name="payments_refund_positive", condition=Q(amount__gt=0))
        ]

    def __str__(self) -> str:
        return f"Refund {self.amount} from {self.payment}"


class PaymentRequest(OrganizationScopedModel):
    """An M-Pesa STK push sent to a tenant's phone, awaiting Safaricom's callback."""

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for the tenant"
        COMPLETED = "completed", "Paid"
        FAILED = "failed", "Failed or cancelled"
        EXPIRED = "expired", "Expired"
        NEEDS_REVIEW = "needs_review", "Needs review"

    configuration = models.ForeignKey(
        PaymentConfiguration, on_delete=models.PROTECT, related_name="requests"
    )
    lease = models.ForeignKey(
        "leases.Lease", on_delete=models.PROTECT, related_name="payment_requests"
    )
    phone = models.CharField(max_length=16)
    amount = MoneyField()
    account_reference = models.CharField(max_length=12)
    merchant_request_id = models.CharField(max_length=64, blank=True)
    checkout_request_id = models.CharField(max_length=64, unique=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    result_code = models.CharField(max_length=16, blank=True)
    result_description = models.CharField(max_length=255, blank=True)
    payment = models.OneToOneField(
        Payment, null=True, blank=True, on_delete=models.PROTECT, related_name="request"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"STK {self.checkout_request_id} ({self.status})"


class ProviderEvent(TimeStampedModel):
    """Every inbound provider callback, stored before processing (idempotency + audit)."""

    class Status(models.TextChoices):
        PROCESSED = "processed", "Processed"
        DUPLICATE = "duplicate", "Duplicate (already processed)"
        REJECTED = "rejected", "Rejected"
        FAILED = "failed", "Failed"

    organization = models.ForeignKey(
        "organizations.Organization",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
    )
    configuration = models.ForeignKey(
        PaymentConfiguration, null=True, blank=True, on_delete=models.PROTECT, related_name="events"
    )
    provider = models.CharField(max_length=16, default="mpesa")
    event_type = models.CharField(max_length=32)
    external_id = models.CharField(max_length=128, blank=True)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=16, choices=Status.choices)
    message = models.CharField(max_length=255, blank=True)
    payment = models.ForeignKey(
        Payment, null=True, blank=True, on_delete=models.SET_NULL, related_name="events"
    )
    remote_addr = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "event_type", "external_id"],
                condition=~Q(external_id="") & Q(status="processed"),
                name="payments_event_processed_once",
            )
        ]

    def __str__(self) -> str:
        return f"{self.provider}:{self.event_type}:{self.external_id} ({self.status})"
