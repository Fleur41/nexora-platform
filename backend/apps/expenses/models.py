from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import OrganizationScopedModel
from apps.core.money import MoneyField
from apps.payments.models import PaymentMethod


class Expense(OrganizationScopedModel):
    """Money the landlord spent: a utility bill, salaries, land rates, insurance and so on.

    Belongs to one property, or to the whole organization when `property` is empty (office
    rent, an accountant's fee). Repairs logged on maintenance requests are MaintenanceCost,
    not Expense. Never deleted: a mistaken expense is voided with a reason.
    """

    class Category(models.TextChoices):
        UTILITIES = "utilities", "Utilities (water, power, internet)"
        SECURITY = "security", "Security"
        CLEANING = "cleaning", "Cleaning and garbage"
        SALARIES = "salaries", "Salaries and wages"
        REPAIRS = "repairs", "Repairs and upkeep"
        INSURANCE = "insurance", "Insurance"
        RATES = "rates", "Land rates and taxes"
        MANAGEMENT = "management", "Management and agent fees"
        PROFESSIONAL = "professional", "Legal and professional fees"
        BANK = "bank", "Bank and M-Pesa charges"
        ADVERTISING = "advertising", "Advertising"
        OFFICE = "office", "Office and administration"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        RECORDED = "recorded", "Recorded"
        VOIDED = "voided", "Voided"

    reference = models.CharField(max_length=32, editable=False)
    property = models.ForeignKey(
        "properties.Property",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="expenses",
    )
    unit = models.ForeignKey(
        "properties.Unit", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    category = models.CharField(max_length=16, choices=Category.choices)
    description = models.CharField(max_length=255)
    supplier_name = models.CharField(max_length=150, blank=True)
    amount = MoneyField()
    incurred_on = models.DateField()
    method = models.CharField(max_length=16, choices=PaymentMethod.choices, blank=True)
    payment_reference = models.CharField(max_length=64, blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.RECORDED)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    void_reason = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-incurred_on", "-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "reference"], name="expense_unique_ref"
            ),
            models.CheckConstraint(name="expense_amount_positive", condition=Q(amount__gt=0)),
            models.CheckConstraint(
                name="expense_unit_needs_property",
                condition=Q(unit__isnull=True) | Q(property__isnull=False),
            ),
        ]
        indexes = [models.Index(fields=["organization", "incurred_on"])]

    def __str__(self) -> str:
        return f"{self.reference} · {self.description}"
