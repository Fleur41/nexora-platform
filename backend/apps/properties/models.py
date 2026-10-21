from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import OrganizationScopedModel
from apps.core.money import MoneyField


class Property(OrganizationScopedModel):
    class PropertyType(models.TextChoices):
        APARTMENTS = "apartments", "Apartment block"
        ESTATE = "estate", "Estate / gated community"
        MAISONETTES = "maisonettes", "Maisonettes / townhouses"
        HOSTEL = "hostel", "Hostel"
        COMMERCIAL = "commercial", "Commercial"
        MIXED_USE = "mixed_use", "Mixed use"
        OTHER = "other", "Other"

    name = models.CharField(max_length=200)
    reference = models.CharField(max_length=32, editable=False)
    slug = models.SlugField(max_length=120, unique=True, editable=False)
    property_type = models.CharField(
        max_length=24, choices=PropertyType.choices, default=PropertyType.APARTMENTS
    )
    address_line = models.CharField(max_length=255, blank=True)
    town = models.CharField(max_length=100, blank=True)
    county = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=2, default="KE")
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    map_url = models.URLField(blank=True)
    description = models.TextField(blank=True)
    amenities = models.JSONField(default=list, blank=True)
    # Public listing is opt-in. Nothing is published unless this is explicitly enabled.
    is_listed_publicly = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "properties"
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "reference"], name="properties_property_unique_ref"
            ),
            models.CheckConstraint(
                condition=Q(latitude__isnull=True) | Q(latitude__gte=-90, latitude__lte=90),
                name="properties_property_valid_lat",
            ),
            models.CheckConstraint(
                condition=Q(longitude__isnull=True) | Q(longitude__gte=-180, longitude__lte=180),
                name="properties_property_valid_lng",
            ),
        ]

    def __str__(self) -> str:
        return self.name


class UnitType(OrganizationScopedModel):
    """A configurable kind of unit within one property, e.g. "2 bedroom, balcony"."""

    class Category(models.TextChoices):
        BEDSITTER = "bedsitter", "Bedsitter"
        STUDIO = "studio", "Studio"
        ONE_BEDROOM = "one_bedroom", "One bedroom"
        TWO_BEDROOM = "two_bedroom", "Two bedroom"
        THREE_BEDROOM = "three_bedroom", "Three bedroom"
        FOUR_BEDROOM = "four_bedroom", "Four bedroom"
        SHOP = "shop", "Shop / commercial space"
        CUSTOM = "custom", "Custom"

    property = models.ForeignKey(Property, on_delete=models.PROTECT, related_name="unit_types")
    name = models.CharField(max_length=100)
    category = models.CharField(max_length=24, choices=Category.choices, default=Category.CUSTOM)
    bedrooms = models.PositiveSmallIntegerField(default=0)
    bathrooms = models.PositiveSmallIntegerField(default=1)
    default_rent = MoneyField(default=0)
    default_deposit = MoneyField(default=0)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["property__name", "bedrooms", "name"]
        constraints = [
            models.UniqueConstraint(fields=["property", "name"], name="properties_unittype_unique"),
            models.CheckConstraint(
                condition=Q(default_rent__gte=0) & Q(default_deposit__gte=0),
                name="properties_unittype_nonnegative_amounts",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.property})"


class Unit(OrganizationScopedModel):
    class Status(models.TextChoices):
        AVAILABLE = "available", "Available"
        RESERVED = "reserved", "Reserved"
        OCCUPIED = "occupied", "Occupied"
        NOTICE_SUBMITTED = "notice_submitted", "Notice submitted"
        AWAITING_INSPECTION = "awaiting_inspection", "Awaiting inspection"
        UNDER_MAINTENANCE = "under_maintenance", "Under maintenance"
        UNAVAILABLE = "unavailable", "Unavailable"

    # Statuses staff may set by hand. The others are driven by lease and move-out workflows.
    MANUAL_STATUSES = {Status.AVAILABLE, Status.UNDER_MAINTENANCE, Status.UNAVAILABLE}
    # Statuses a unit may move to when a lease is closed.
    POST_LEASE_STATUSES = MANUAL_STATUSES | {Status.AWAITING_INSPECTION}

    property = models.ForeignKey(Property, on_delete=models.PROTECT, related_name="units")
    unit_type = models.ForeignKey(UnitType, on_delete=models.PROTECT, related_name="units")
    number = models.CharField(max_length=32, help_text="Door number or label, e.g. A4")
    floor = models.CharField(max_length=32, blank=True)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.AVAILABLE)
    market_rent = MoneyField(help_text="Current asking rent. Existing leases keep their own terms.")
    water_meter_number = models.CharField(max_length=64, blank=True)
    electricity_meter_number = models.CharField(max_length=64, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["property__name", "number"]
        constraints = [
            models.UniqueConstraint(fields=["property", "number"], name="properties_unit_unique"),
            models.CheckConstraint(
                condition=Q(market_rent__gte=0), name="properties_unit_nonnegative_rent"
            ),
        ]
        indexes = [models.Index(fields=["organization", "status"])]

    def __str__(self) -> str:
        return f"{self.property} · {self.number}"


class PropertyAssignment(OrganizationScopedModel):
    """Gives an assigned-scope member (e.g. a caretaker) access to one property."""

    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="assignments")
    membership = models.ForeignKey(
        "organizations.Membership", on_delete=models.CASCADE, related_name="property_assignments"
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["property", "membership"], name="properties_assignment_unique"
            )
        ]

    def __str__(self) -> str:
        return f"{self.membership.user} → {self.property}"
