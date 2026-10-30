import builtins

from django.conf import settings
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import RangeOperators
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import F, Q

from apps.core.models import OrganizationScopedModel
from apps.core.money import MoneyField
from apps.leases.models import DateRange


class IncomeCategory(models.TextChoices):
    """Where billed amounts land in financial reports. Deposits are never income."""

    RENTAL_INCOME = "rental_income", "Rental income"
    UTILITY_RECOVERY = "utility_recovery", "Utility recovery"
    SERVICE_CHARGE = "service_charge", "Service charges"
    OTHER_INCOME = "other_income", "Other income"


class ChargeType(OrganizationScopedModel):
    """A kind of charge, e.g. Water or Security. Billing a charge type needs a charge rule."""

    class MeterUtility(models.TextChoices):
        NONE = "", "Not metered"
        WATER = "water", "Water"
        ELECTRICITY = "electricity", "Electricity"
        GAS = "gas", "Gas"

    RENT = "rent"

    code = models.SlugField(max_length=40)
    name = models.CharField(max_length=100)
    income_category = models.CharField(
        max_length=24, choices=IncomeCategory.choices, default=IncomeCategory.SERVICE_CHARGE
    )
    meter_utility = models.CharField(
        max_length=16, choices=MeterUtility.choices, blank=True, default=""
    )
    is_system = models.BooleanField(
        default=False, help_text="Built-in types (e.g. rent) cannot be renamed or removed."
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "code"], name="billing_chargetype_unique_code"
            )
        ]

    def __str__(self) -> str:
        return self.name


class ChargeRule(OrganizationScopedModel):
    """Whether, how and how much a charge type is billed for a scope over a date range.

    The most specific scope wins (unit > unit type > property > organization), so a
    landlord can enable a charge for a property and switch it off for one unit. Rules are
    effective-dated and must not overlap for the same charge type and scope; changing a
    rule that has been billed means ending it and starting a new one.
    """

    class Scope(models.TextChoices):
        ORGANIZATION = "organization", "Whole organization"
        PROPERTY = "property", "Property"
        UNIT_TYPE = "unit_type", "Unit type"
        UNIT = "unit", "Unit"

    class Method(models.TextChoices):
        FIXED_MONTHLY = "fixed_monthly", "Fixed monthly amount"
        ONE_TIME = "one_time", "One-time charge"
        METERED = "metered", "Metered (rate per unit used)"
        SHARED = "shared", "Shared cost split between units"

    SPECIFICITY = {Scope.UNIT: 4, Scope.UNIT_TYPE: 3, Scope.PROPERTY: 2, Scope.ORGANIZATION: 1}

    charge_type = models.ForeignKey(ChargeType, on_delete=models.PROTECT, related_name="rules")
    scope = models.CharField(max_length=16, choices=Scope.choices)
    property = models.ForeignKey(
        "properties.Property", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    unit_type = models.ForeignKey(
        "properties.UnitType", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    unit = models.ForeignKey(
        "properties.Unit", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    # Denormalized scope target, used by the overlap constraint ("organization",
    # "property:<uuid>", ...). Set in save().
    scope_key = models.CharField(max_length=64, editable=False)
    method = models.CharField(max_length=16, choices=Method.choices)
    # Fixed/one-time: the amount. Metered: the rate per unit. Shared: unused (0).
    amount = models.DecimalField(
        max_digits=14, decimal_places=4, default=0, validators=[MinValueValidator(0)]
    )
    usage_unit = models.CharField(max_length=16, blank=True, help_text="e.g. m³ or kWh")
    is_enabled = models.BooleanField(default=True)
    included_in_rent = models.BooleanField(
        default=False, help_text="Shown to tenants as included; never billed separately."
    )
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    description = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["charge_type__name", "-effective_from"]
        constraints = [
            models.CheckConstraint(
                name="billing_rule_scope_target",
                condition=(
                    Q(
                        scope="organization",
                        property__isnull=True,
                        unit_type__isnull=True,
                        unit__isnull=True,
                    )
                    | Q(
                        scope="property",
                        property__isnull=False,
                        unit_type__isnull=True,
                        unit__isnull=True,
                    )
                    | Q(
                        scope="unit_type",
                        property__isnull=True,
                        unit_type__isnull=False,
                        unit__isnull=True,
                    )
                    | Q(
                        scope="unit",
                        property__isnull=True,
                        unit_type__isnull=True,
                        unit__isnull=False,
                    )
                ),
            ),
            models.CheckConstraint(
                name="billing_rule_dates",
                condition=Q(effective_to__isnull=True) | Q(effective_to__gte=F("effective_from")),
            ),
            models.CheckConstraint(name="billing_rule_nonnegative", condition=Q(amount__gte=0)),
            ExclusionConstraint(
                name="billing_rule_no_overlap",
                expressions=[
                    ("organization", RangeOperators.EQUAL),
                    ("charge_type", RangeOperators.EQUAL),
                    ("scope_key", RangeOperators.EQUAL),
                    (DateRange("effective_from", "effective_to"), RangeOperators.OVERLAPS),
                ],
            ),
        ]

    def __str__(self) -> str:
        return f"{self.charge_type} · {self.get_scope_display()} · from {self.effective_from}"

    def save(self, *args, **kwargs):
        target = {
            "property": self.property_id,
            "unit_type": self.unit_type_id,
            "unit": self.unit_id,
        }
        self.scope_key = (
            "organization"
            if self.scope == self.Scope.ORGANIZATION
            else f"{self.scope}:{target[self.scope]}"
        )
        super().save(*args, **kwargs)

    @builtins.property  # `property` is shadowed by the field above
    def is_billable(self) -> bool:
        if not self.is_enabled or self.included_in_rent:
            return False
        if self.method == self.Method.SHARED:
            return True  # amounts come from SharedCost entries
        return self.amount > 0


class BillingSettings(models.Model):
    organization = models.OneToOneField(
        "organizations.Organization", on_delete=models.CASCADE, related_name="billing_settings"
    )
    auto_generate = models.BooleanField(
        default=False, help_text="Generate invoices automatically each month."
    )
    generate_day = models.PositiveSmallIntegerField(
        default=1, validators=[MinValueValidator(1), MaxValueValidator(28)]
    )

    def __str__(self) -> str:
        return f"Billing settings for {self.organization}"


class SharedCost(OrganizationScopedModel):
    """A bill for a whole property (e.g. common-area electricity) to split between units
    whose rule for the charge type uses the shared method."""

    class SplitBy(models.TextChoices):
        EQUAL = "equal", "Evenly between units"
        FLOOR_AREA = "floor_area", "By floor area"
        METER_USAGE = "meter_usage", "By each unit's metered usage"

    property = models.ForeignKey("properties.Property", on_delete=models.PROTECT, related_name="+")
    charge_type = models.ForeignKey(ChargeType, on_delete=models.PROTECT, related_name="+")
    period = models.DateField(help_text="First day of the month the cost belongs to.")
    total_amount = MoneyField()
    split_by = models.CharField(max_length=16, choices=SplitBy.choices, default=SplitBy.EQUAL)
    description = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-period"]
        constraints = [
            models.UniqueConstraint(
                fields=["property", "charge_type", "period"], name="billing_sharedcost_unique"
            ),
            models.CheckConstraint(
                name="billing_sharedcost_positive", condition=Q(total_amount__gt=0)
            ),
        ]

    def __str__(self) -> str:
        return f"{self.charge_type} {self.period:%b %Y} · {self.property}"


class BillingRun(OrganizationScopedModel):
    class Trigger(models.TextChoices):
        MANUAL = "manual", "Manual"
        SCHEDULED = "scheduled", "Scheduled"

    period = models.DateField(help_text="First day of the billed month.")
    trigger = models.CharField(max_length=16, choices=Trigger.choices)
    invoices_created = models.PositiveIntegerField(default=0)
    lines_created = models.PositiveIntegerField(default=0)
    total_billed = MoneyField(default=0)
    skipped = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Billing run {self.period:%b %Y} ({self.trigger})"


class Invoice(OrganizationScopedModel):
    """An issued bill. Never edited or deleted: corrections are credits or a void."""

    class Kind(models.TextChoices):
        REGULAR = "regular", "Regular"
        SUPPLEMENTARY = "supplementary", "Supplementary"
        ONE_OFF = "one_off", "One-off"

    class Status(models.TextChoices):
        ISSUED = "issued", "Issued"
        VOID = "void", "Void"

    number = models.CharField(max_length=32, editable=False)
    lease = models.ForeignKey("leases.Lease", on_delete=models.PROTECT, related_name="invoices")
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.PROTECT, related_name="invoices")
    unit = models.ForeignKey("properties.Unit", on_delete=models.PROTECT, related_name="invoices")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.ISSUED)
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    issue_date = models.DateField()
    due_date = models.DateField()
    currency = models.CharField(max_length=3)
    total = MoneyField()
    notes = models.TextField(blank=True)
    billing_run = models.ForeignKey(
        BillingRun, null=True, blank=True, on_delete=models.SET_NULL, related_name="invoices"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    void_reason = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-issue_date", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "number"], name="billing_invoice_unique_number"
            ),
            # One regular invoice per lease per billing period.
            models.UniqueConstraint(
                fields=["lease", "period_start"],
                condition=Q(kind="regular", status="issued"),
                name="billing_one_regular_invoice_per_period",
            ),
            models.CheckConstraint(name="billing_invoice_nonnegative", condition=Q(total__gte=0)),
        ]
        indexes = [
            models.Index(fields=["organization", "status", "due_date"]),
            models.Index(fields=["lease", "issue_date"]),
        ]

    def __str__(self) -> str:
        return self.number


class InvoiceLine(OrganizationScopedModel):
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name="lines")
    charge_type = models.ForeignKey(ChargeType, on_delete=models.PROTECT, related_name="+")
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=14, decimal_places=3, default=1)
    unit_price = models.DecimalField(max_digits=14, decimal_places=4)
    amount = MoneyField()
    income_category = models.CharField(max_length=24, choices=IncomeCategory.choices)
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    charge_rule = models.ForeignKey(
        ChargeRule, null=True, blank=True, on_delete=models.PROTECT, related_name="lines"
    )
    rent_term = models.ForeignKey(
        "leases.LeaseRentTerm", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    shared_cost = models.ForeignKey(
        SharedCost, null=True, blank=True, on_delete=models.PROTECT, related_name="lines"
    )
    # Identifies what was billed (e.g. "recurring:<lease>:<charge type>:<period>") so the
    # same thing can never be billed twice while the line is live.
    dedupe_key = models.CharField(max_length=160, blank=True)
    is_void = models.BooleanField(default=False)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "dedupe_key"],
                condition=Q(is_void=False) & ~Q(dedupe_key=""),
                name="billing_line_no_duplicate_billing",
            ),
            models.CheckConstraint(name="billing_line_nonnegative", condition=Q(amount__gte=0)),
        ]

    def __str__(self) -> str:
        return f"{self.invoice.number}: {self.description}"


class LedgerQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise PermissionError("Ledger entries are immutable.")

    def delete(self):
        raise PermissionError("Ledger entries are immutable.")


class LedgerEntry(OrganizationScopedModel):
    """Append-only tenant account movements for one lease.

    Positive amounts increase what the tenant owes (invoices); negative amounts reduce it
    (credits, voids and, from Phase 4, payments). A lease's balance is the sum.
    """

    class EntryType(models.TextChoices):
        INVOICE = "invoice", "Invoice"
        CREDIT = "credit", "Credit"
        VOID = "void", "Invoice voided"
        PAYMENT = "payment", "Payment"
        # Moves a payment's unallocated credit onto an invoice (nets to zero on the lease).
        ALLOCATION = "allocation", "Credit applied"
        PAYMENT_REVERSAL = "payment_reversal", "Payment reversed"
        REFUND = "refund", "Credit refunded"

    lease = models.ForeignKey(
        "leases.Lease", on_delete=models.PROTECT, related_name="ledger_entries"
    )
    tenant = models.ForeignKey(
        "tenants.Tenant", on_delete=models.PROTECT, related_name="ledger_entries"
    )
    entry_type = models.CharField(max_length=16, choices=EntryType.choices)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    invoice = models.ForeignKey(
        Invoice, null=True, blank=True, on_delete=models.PROTECT, related_name="ledger_entries"
    )
    payment = models.ForeignKey(
        "payments.Payment",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="ledger_entries",
    )
    reference = models.CharField(max_length=32, blank=True)
    effective_date = models.DateField()
    description = models.CharField(max_length=255)
    reason = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    objects = LedgerQuerySet.as_manager()

    class Meta:
        ordering = ["effective_date", "created_at"]
        indexes = [models.Index(fields=["lease", "effective_date"])]
        constraints = [
            models.CheckConstraint(name="billing_ledger_nonzero", condition=~Q(amount=0)),
        ]

    def __str__(self) -> str:
        return f"{self.entry_type} {self.amount} ({self.lease_id})"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise PermissionError("Ledger entries are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise PermissionError("Ledger entries are immutable.")
