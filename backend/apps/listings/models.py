from django.conf import settings
from django.db import models

from apps.core.models import OrganizationScopedModel


class Listing(OrganizationScopedModel):
    """A unit advertised on the public website.

    Shown publicly only while it is published *and* the unit is free to let (available, or
    on notice with a move-out date). Photos are chosen explicitly: nothing private becomes
    public unless a staff member picks it for the listing.
    """

    unit = models.OneToOneField("properties.Unit", on_delete=models.PROTECT, related_name="listing")
    title = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    is_published = models.BooleanField(default=False)
    available_from = models.DateField(
        null=True, blank=True, help_text="Leave empty for 'available now'."
    )
    contact_phone = models.CharField(
        max_length=32,
        blank=True,
        help_text="Shown to the public; the organization's phone if empty.",
    )
    published_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-published_at", "-created_at"]

    def __str__(self) -> str:
        return self.title


class ListingPhoto(models.Model):
    """A photo chosen for a listing (a unit or property photo); `position` orders the gallery."""

    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="photo_links")
    document = models.ForeignKey(
        "documents.Document", on_delete=models.CASCADE, related_name="listing_links"
    )
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(fields=["listing", "document"], name="listings_photo_once")
        ]

    def __str__(self) -> str:
        return f"{self.listing_id} · {self.document_id}"


class Enquiry(OrganizationScopedModel):
    """A message or viewing request from the public about a listing."""

    class Kind(models.TextChoices):
        ENQUIRY = "enquiry", "Enquiry"
        VIEWING = "viewing", "Viewing request"

    class Status(models.TextChoices):
        NEW = "new", "New"
        CONTACTED = "contacted", "Contacted"
        VIEWING_BOOKED = "viewing_booked", "Viewing booked"
        CLOSED = "closed", "Closed"

    class TimeOfDay(models.TextChoices):
        ANY = "any", "Any time"
        MORNING = "morning", "Morning"
        AFTERNOON = "afternoon", "Afternoon"
        EVENING = "evening", "Evening"

    class Outcome(models.TextChoices):
        NONE = "", "—"
        LET = "let", "Took the unit"
        NOT_INTERESTED = "not_interested", "Not interested"
        NO_RESPONSE = "no_response", "No response"
        OTHER = "other", "Other"

    OPEN_STATUSES = (Status.NEW, Status.CONTACTED, Status.VIEWING_BOOKED)

    reference = models.CharField(max_length=32, editable=False)
    listing = models.ForeignKey(Listing, on_delete=models.PROTECT, related_name="enquiries")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    name = models.CharField(max_length=150)
    phone = models.CharField(max_length=32)
    email = models.EmailField(blank=True)
    message = models.TextField(blank=True)
    preferred_date = models.DateField(null=True, blank=True)
    preferred_time = models.CharField(
        max_length=16, choices=TimeOfDay.choices, default=TimeOfDay.ANY, blank=True
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.NEW)
    viewing_at = models.DateTimeField(null=True, blank=True)
    outcome = models.CharField(max_length=16, choices=Outcome.choices, default="", blank=True)
    staff_notes = models.TextField(blank=True, help_text="Internal; never shown to the enquirer.")
    handled_by = models.ForeignKey(
        "organizations.Membership",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "reference"], name="listings_enquiry_reference_unique"
            )
        ]

    def __str__(self) -> str:
        return f"{self.reference} · {self.name}"
