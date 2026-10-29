"""Publishing listings and handling enquiries and viewing requests."""

from __future__ import annotations

from datetime import date, timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.core.models import next_reference
from apps.documents.models import Document
from apps.documents.validation import IMAGE_TYPES
from apps.leases.models import MoveOutNotice
from apps.notifications.services import notify, staff_with
from apps.organizations.models import Organization, organization_today
from apps.properties.models import Unit

from .models import Enquiry, Listing, ListingPhoto

# A unit can be advertised while it's free, or while its tenant is on (acknowledged) notice.
LISTABLE_STATUSES = (Unit.Status.AVAILABLE, Unit.Status.NOTICE_SUBMITTED)
MAX_PHOTOS = 12


def public_listings():
    """Listings anyone may see: published, unit free to let, landlord and property active."""
    return Listing.objects.filter(
        is_published=True,
        unit__status__in=LISTABLE_STATUSES,
        unit__property__is_active=True,
        organization__status=Organization.Status.ACTIVE,
    ).select_related("organization", "unit__property", "unit__unit_type")


def is_public(listing: Listing) -> bool:
    return public_listings().filter(pk=listing.pk).exists()


def hidden_reason(listing: Listing) -> str:
    """Why a listing isn't on the website (empty when it is)."""
    if not listing.is_published:
        return "Not published"
    if listing.unit.status not in LISTABLE_STATUSES:
        return f"Hidden while the unit is {listing.unit.get_status_display().lower()}"
    if not listing.unit.property.is_active:
        return "Hidden: the property is archived"
    return ""


def available_from(listing: Listing) -> date | None:
    """When the unit can be moved into: the listing's date, or the day after an outgoing
    tenant's move-out date, whichever is later. None means now."""
    today = organization_today(listing.organization)
    dates = [d for d in (listing.available_from,) if d and d > today]
    if listing.unit.status == Unit.Status.NOTICE_SUBMITTED:
        notice = (
            MoveOutNotice.objects.filter(
                lease__unit=listing.unit, status__in=MoveOutNotice.OPEN_STATUSES
            )
            .order_by("-intended_date")
            .first()
        )
        if notice:
            dates.append(notice.intended_date + timedelta(days=1))
    later = max(dates, default=None)
    return later if later and later > today else None


def public_url(listing: Listing) -> str:
    return f"{settings.FRONTEND_URL}/listings/{listing.pk}"


def eligible_photos(unit: Unit):
    """Photos staff may put on a unit's listing: images of the unit or of its property."""
    return Document.objects.filter(
        Q(unit=unit) | Q(property_id=unit.property_id, unit__isnull=True),
        organization=unit.organization,
        category=Document.Category.PHOTO,
        content_type__in=IMAGE_TYPES,
        deleted_at__isnull=True,
    )


@transaction.atomic
def save_listing(*, request, unit: Unit, photo_ids: list | None = None, **fields) -> Listing:
    listing = Listing.objects.select_for_update().filter(unit=unit).first()
    created = listing is None
    if created:
        listing = Listing(organization=unit.organization, unit=unit, created_by=request.user)
    before = {k: getattr(listing, k) for k in fields} if not created else {}
    for key, value in fields.items():
        setattr(listing, key, value)
    if not (listing.title or "").strip():
        raise BusinessRuleViolation("Give the listing a title.")
    if listing.is_published and not listing.published_at:
        listing.published_at = timezone.now()
    if not listing.is_published:
        listing.published_at = None
    listing.save()

    if photo_ids is not None:
        if len(photo_ids) > MAX_PHOTOS:
            raise BusinessRuleViolation(f"Choose at most {MAX_PHOTOS} photos.")
        allowed = {str(pk) for pk in eligible_photos(unit).values_list("pk", flat=True)}
        if any(str(pk) not in allowed for pk in photo_ids):
            raise BusinessRuleViolation("Choose photos of this unit or its property.")
        listing.photo_links.all().delete()
        ListingPhoto.objects.bulk_create(
            ListingPhoto(listing=listing, document_id=pk, position=i)
            for i, pk in enumerate(photo_ids)
        )

    changes = {
        k: {"from": str(before[k]), "to": str(getattr(listing, k))}
        for k in before
        if before[k] != getattr(listing, k)
    }
    action = "listing.created" if created else "listing.updated"
    if "is_published" in changes or (created and listing.is_published):
        action = "listing.published" if listing.is_published else "listing.unpublished"
    record_event(request, action, target=listing, changes=changes or None)
    return listing


def _send_email(to: str, subject: str, body: str) -> None:
    if to:
        transaction.on_commit(
            lambda: send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [to], fail_silently=True)
        )


@transaction.atomic
def submit_enquiry(*, listing: Listing, **data) -> Enquiry:
    """An enquiry or viewing request from the public website."""
    if not is_public(listing):
        raise BusinessRuleViolation("This home is no longer available.")
    org = listing.organization
    if data.get("kind") == Enquiry.Kind.VIEWING and not data.get("preferred_date"):
        raise BusinessRuleViolation("Choose a day you'd like to view.")
    if data.get("preferred_date") and data["preferred_date"] < organization_today(org):
        raise BusinessRuleViolation("Choose a viewing day from today onwards.")
    enquiry = Enquiry.objects.create(
        organization=org,
        reference=next_reference(org, "enquiry", "ENQ"),
        listing=listing,
        **data,
    )
    unit = listing.unit
    where = f"{unit.property.name} unit {unit.number}"
    what = "Viewing request" if enquiry.kind == Enquiry.Kind.VIEWING else "Enquiry"
    record_event(
        None,
        "enquiry.received",
        target=enquiry,
        organization=org,
        actor=None,
        metadata={"kind": enquiry.kind, "listing": str(listing.pk)},
    )
    notify(
        organization=org,
        kind="enquiry",
        users=staff_with(org, "listings.view", unit.property_id),
        title=f"{what}: {where}",
        body=f"{enquiry.name} ({enquiry.phone})"
        + (
            f" would like to view on {enquiry.preferred_date:%a %d %b}."
            if enquiry.preferred_date
            else "."
        ),
        link=f"/dashboard/listings/enquiries/{enquiry.pk}",
        dedupe_key=f"enquiry:{enquiry.pk}",
    )
    _send_email(
        enquiry.email,
        f"We received your {what.lower()} · {org.name}",
        f"Hello {enquiry.name},\n\nThank you for your interest in {listing.title} "
        f"({unit.property.name}). {org.name} will contact you on {enquiry.phone} soon.\n\n"
        f"Your reference: {enquiry.reference}",
    )
    return enquiry


@transaction.atomic
def update_enquiry(*, request, enquiry: Enquiry, **fields) -> Enquiry:
    enquiry = Enquiry.objects.select_for_update().get(pk=enquiry.pk)
    before = {k: getattr(enquiry, k) for k in fields}
    if fields.get("status") == Enquiry.Status.VIEWING_BOOKED and not (
        fields.get("viewing_at") or enquiry.viewing_at
    ):
        raise BusinessRuleViolation("Set the viewing date and time.")
    if (
        fields.get("viewing_at")
        and "status" not in fields
        and enquiry.status != Enquiry.Status.CLOSED
    ):
        fields["status"] = Enquiry.Status.VIEWING_BOOKED
        before["status"] = enquiry.status
    if fields.get("status") == Enquiry.Status.CLOSED and not (
        fields.get("outcome") or enquiry.outcome
    ):
        raise BusinessRuleViolation("Choose how the enquiry ended.")
    for key, value in fields.items():
        setattr(enquiry, key, value)
    if enquiry.handled_by_id is None:
        enquiry.handled_by = request.membership
    enquiry.save()
    changes = {
        k: {"from": str(before[k]), "to": str(getattr(enquiry, k))}
        for k in before
        if before[k] != getattr(enquiry, k)
    }
    if changes:
        record_event(request, "enquiry.updated", target=enquiry, changes=changes)
    if "viewing_at" in changes and enquiry.viewing_at:
        org = enquiry.organization
        when = timezone.localtime(enquiry.viewing_at).strftime("%A %d %B at %H:%M")
        unit = enquiry.listing.unit
        _send_email(
            enquiry.email,
            f"Viewing booked · {enquiry.listing.title}",
            f"Hello {enquiry.name},\n\nYour viewing of {enquiry.listing.title} "
            f"({unit.property.name}, {unit.property.town}) is booked for {when}. "
            f"Contact {org.name} on {enquiry.listing.contact_phone or org.phone} if you need "
            f"to change it.\n\nReference: {enquiry.reference}",
        )
    return enquiry
