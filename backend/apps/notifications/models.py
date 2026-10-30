from django.conf import settings
from django.core.validators import MaxValueValidator
from django.db import models
from django.db.models import Q

from apps.core.models import OrganizationScopedModel, TimeStampedModel


class NotificationSettings(models.Model):
    """Per-organization switches. SMS is off by default (it costs the landlord money)."""

    organization = models.OneToOneField(
        "organizations.Organization", on_delete=models.CASCADE, related_name="notification_settings"
    )
    email_enabled = models.BooleanField(default=True)
    sms_enabled = models.BooleanField(default=False)
    invoice_notifications = models.BooleanField(default=True)
    receipt_notifications = models.BooleanField(default=True)
    rent_due_reminder_days = models.PositiveSmallIntegerField(
        default=3, validators=[MaxValueValidator(14)], help_text="0 turns due-date reminders off."
    )
    arrears_reminders = models.BooleanField(default=True)
    lease_expiry_days = models.PositiveSmallIntegerField(
        default=30, validators=[MaxValueValidator(120)]
    )

    def __str__(self) -> str:
        return f"Notification settings for {self.organization}"


class Notification(TimeStampedModel):
    """One message on one channel to one recipient. In-app rows are the inbox."""

    class Channel(models.TextChoices):
        IN_APP = "in_app", "In-app"
        EMAIL = "email", "Email"
        SMS = "sms", "SMS"

    class Kind(models.TextChoices):
        INVOICE_ISSUED = "invoice_issued", "Invoice issued"
        RECEIPT = "receipt", "Payment receipt"
        RENT_DUE = "rent_due", "Rent due reminder"
        ARREARS = "arrears", "Arrears reminder"
        LEASE_EXPIRING = "lease_expiring", "Lease expiring"
        MAINTENANCE = "maintenance", "Maintenance update"
        MOVE_OUT = "move_out", "Move-out notice"
        INSPECTION = "inspection", "Inspection"
        ANNOUNCEMENT = "announcement", "Announcement"
        PORTAL_INVITE = "portal_invite", "Portal invitation"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"

    organization = models.ForeignKey(
        "organizations.Organization",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="+",
    )
    recipient_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    recipient_tenant = models.ForeignKey(
        "tenants.Tenant",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    # Stable identity of the recipient on this channel, used for de-duplication.
    recipient_key = models.CharField(max_length=80)
    to_address = models.CharField(max_length=254, blank=True)
    channel = models.CharField(max_length=8, choices=Channel.choices)
    kind = models.CharField(max_length=24, choices=Kind.choices)
    title = models.CharField(max_length=160)
    body = models.TextField()
    link = models.CharField(
        max_length=255, blank=True, help_text="App path, e.g. /portal/invoices/…"
    )
    dedupe_key = models.CharField(max_length=160, blank=True)
    # Emails only: a document rendered as PDF when sent, e.g. "invoice:<id>" (see attachments.py).
    attachment = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PENDING)
    attempts = models.PositiveSmallIntegerField(default=0)
    sent_at = models.DateTimeField(null=True, blank=True)
    error = models.CharField(max_length=255, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # The same reminder/notice is never sent twice to the same recipient on a channel.
            models.UniqueConstraint(
                fields=["channel", "recipient_key", "dedupe_key"],
                condition=~Q(dedupe_key=""),
                name="notifications_no_duplicates",
            )
        ]
        indexes = [models.Index(fields=["recipient_user", "channel", "read_at"])]

    def __str__(self) -> str:
        return f"{self.kind} → {self.recipient_key} ({self.channel}, {self.status})"


class Announcement(OrganizationScopedModel):
    title = models.CharField(max_length=160)
    body = models.TextField()
    property = models.ForeignKey(
        "properties.Property", null=True, blank=True, on_delete=models.PROTECT, related_name="+"
    )
    send_email = models.BooleanField(default=True)
    send_sms = models.BooleanField(default=False)
    recipients = models.PositiveIntegerField(default=0)
    sent_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title
