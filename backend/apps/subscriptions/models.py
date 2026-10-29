"""Nexora's own subscription: what each organization pays Nexora.

Separate from the landlord's billing of tenants. Plans are platform-wide (no organization);
each organization has one Subscription and receives SubscriptionInvoices from Nexora.
"""

import secrets

from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel
from apps.core.money import MoneyField


class Plan(TimeStampedModel):
    """A tier limited by the number of units. Prices are edited by platform admins."""

    code = models.SlugField(max_length=32, unique=True)
    name = models.CharField(max_length=60)
    description = models.CharField(max_length=255, blank=True)
    max_units = models.PositiveIntegerField(null=True, blank=True, help_text="Empty = unlimited.")
    monthly_price = MoneyField(help_text="0 = priced by agreement (not invoiced automatically).")
    currency = models.CharField(max_length=3, default="KES")
    is_active = models.BooleanField(default=True, help_text="Offered to organizations.")
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "monthly_price"]

    def __str__(self) -> str:
        return self.name


def _account_code() -> str:
    # Short, unambiguous (no 0/O/1/I), used as the M-Pesa account number.
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "NX" + "".join(secrets.choice(alphabet) for _ in range(6))


class Subscription(TimeStampedModel):
    class Status(models.TextChoices):
        TRIALING = "trialing", "Free trial"
        ACTIVE = "active", "Active"
        PAST_DUE = "past_due", "Payment overdue"
        LAPSED = "lapsed", "Lapsed (read-only)"
        CANCELLED = "cancelled", "Cancelled"

    organization = models.OneToOneField(
        "organizations.Organization", on_delete=models.CASCADE, related_name="subscription"
    )
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.TRIALING)
    trial_ends_on = models.DateField(null=True, blank=True)
    paid_until = models.DateField(null=True, blank=True, help_text="Paid service through this day.")
    complimentary = models.BooleanField(
        default=False, help_text="Free of charge (never invoiced, never lapses)."
    )
    account_code = models.CharField(max_length=12, unique=True, default=_account_code)
    notes = models.TextField(blank=True, help_text="Platform staff only.")

    def __str__(self) -> str:
        return f"{self.organization} · {self.plan}"

    @property
    def access_ends_on(self):
        """The last day already covered (by the trial or by payment)."""
        return max((d for d in (self.trial_ends_on, self.paid_until) if d), default=None)


class SubscriptionInvoice(TimeStampedModel):
    class Status(models.TextChoices):
        OPEN = "open", "Unpaid"
        PAID = "paid", "Paid"
        VOID = "void", "Void"

    class Method(models.TextChoices):
        MPESA = "mpesa", "M-Pesa"
        BANK = "bank", "Bank transfer"
        OTHER = "other", "Other"

    organization = models.ForeignKey(
        "organizations.Organization", on_delete=models.PROTECT, related_name="nexora_invoices"
    )
    number = models.CharField(max_length=32)
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="+")
    plan_name = models.CharField(max_length=60)
    period_start = models.DateField()
    period_end = models.DateField()
    amount = MoneyField()
    currency = models.CharField(max_length=3, default="KES")
    due_date = models.DateField()
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.OPEN)
    paid_at = models.DateTimeField(null=True, blank=True)
    payment_method = models.CharField(max_length=8, choices=Method.choices, blank=True)
    payment_reference = models.CharField(max_length=64, blank=True)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-period_start"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "number"], name="subscriptions_invoice_number_unique"
            ),
            # One live invoice per organization and period, however often the job runs.
            models.UniqueConstraint(
                fields=["organization", "period_start"],
                condition=~models.Q(status="void"),
                name="subscriptions_invoice_once_per_period",
            ),
        ]

    def __str__(self) -> str:
        return self.number


class SubscriptionPaymentRequest(TimeStampedModel):
    """An M-Pesa payment prompt sent for a Nexora invoice (via Nexora's own paybill)."""

    class Status(models.TextChoices):
        PENDING = "pending", "Waiting for the customer"
        SUCCEEDED = "succeeded", "Paid"
        FAILED = "failed", "Failed or cancelled"

    invoice = models.ForeignKey(
        SubscriptionInvoice, on_delete=models.PROTECT, related_name="payment_requests"
    )
    phone = models.CharField(max_length=16)
    amount = MoneyField()
    checkout_request_id = models.CharField(max_length=64, unique=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    receipt = models.CharField(max_length=32, blank=True)
    result = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    def __str__(self) -> str:
        return self.checkout_request_id
