"""Lease lifecycle and the unit occupancy transitions it drives.

    draft ──activate──► active ──end──► ended
      │
      └──cancel──► cancelled

Unit status follows the lease: activation marks it occupied (or reserved when the lease
starts in the future); closing a lease moves it to a status the closer chooses. Nothing
else may set occupied/reserved.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.core.models import next_reference
from apps.core.money import quantize
from apps.organizations.models import organization_today
from apps.properties.models import Unit

from .models import Lease, LeaseRentTerm

ACTIVATABLE_UNIT_STATUSES = {Unit.Status.AVAILABLE, Unit.Status.RESERVED}


def rent_on(lease: Lease, on: date) -> Decimal | None:
    """Monthly rent in force on a date, or None before the first term."""
    term = lease.rent_terms.filter(effective_from__lte=on).order_by("-effective_from").first()
    return term.monthly_rent if term else None


def _check_same_organization(lease_org, *objects) -> None:
    for obj in objects:
        if obj.organization_id != lease_org.pk:
            raise BusinessRuleViolation("Related records must belong to the same organization.")


@transaction.atomic
def create_lease(
    *,
    request,
    organization,
    tenant,
    unit,
    start_date: date,
    monthly_rent: Decimal,
    end_date: date | None = None,
    billing_frequency: str = Lease.BillingFrequency.MONTHLY,
    rent_due_day: int = 1,
    deposit_amount: Decimal = Decimal("0"),
    notes: str = "",
    activate: bool = False,
) -> Lease:
    _check_same_organization(organization, tenant, unit)
    if tenant.status != tenant.Status.ACTIVE:
        raise BusinessRuleViolation("Restore this tenant before creating a lease for them.")
    if end_date is not None and end_date < start_date:
        raise BusinessRuleViolation("The end date must be on or after the start date.")
    lease = Lease.objects.create(
        organization=organization,
        reference=next_reference(organization, "lease", "LSE"),
        tenant=tenant,
        unit=unit,
        start_date=start_date,
        end_date=end_date,
        billing_frequency=billing_frequency,
        rent_due_day=rent_due_day,
        deposit_amount=quantize(deposit_amount),
        notes=notes,
        created_by=request.user,
    )
    LeaseRentTerm.objects.create(
        lease=lease,
        effective_from=start_date,
        monthly_rent=quantize(monthly_rent),
        note="Initial rent",
        created_by=request.user,
    )
    record_event(
        request,
        "lease.created",
        target=lease,
        metadata={
            "unit": str(unit.pk),
            "tenant": str(tenant.pk),
            "monthly_rent": str(quantize(monthly_rent)),
            "deposit_amount": str(quantize(deposit_amount)),
        },
    )
    if activate:
        lease = activate_lease(request=request, lease=lease)
    return lease


@transaction.atomic
def update_draft(*, request, lease: Lease, **fields) -> Lease:
    lease = Lease.objects.select_for_update().get(pk=lease.pk)
    if lease.status != Lease.Status.DRAFT:
        raise BusinessRuleViolation(
            "Only draft leases can be edited. Use a rent change or end the lease instead."
        )
    monthly_rent = fields.pop("monthly_rent", None)
    if "unit" in fields or "tenant" in fields:
        _check_same_organization(
            lease.organization, *(fields[k] for k in ("unit", "tenant") if k in fields)
        )
    start = fields.get("start_date", lease.start_date)
    end = fields.get("end_date", lease.end_date)
    if end is not None and end < start:
        raise BusinessRuleViolation("The end date must be on or after the start date.")
    changes = {}
    for key, value in fields.items():
        if getattr(lease, key) != value:
            changes[key] = {"from": str(getattr(lease, key)), "to": str(value)}
            setattr(lease, key, value)
    lease.save()
    # A draft has only its initial term; keep it aligned with the start date and rent.
    initial = lease.rent_terms.order_by("effective_from").first()
    if initial is not None:
        if monthly_rent is not None and initial.monthly_rent != quantize(monthly_rent):
            changes["monthly_rent"] = {
                "from": str(initial.monthly_rent),
                "to": str(quantize(monthly_rent)),
            }
            initial.monthly_rent = quantize(monthly_rent)
        initial.effective_from = lease.start_date
        initial.save()
        lease.rent_terms.filter(effective_from__lt=lease.start_date).delete()
    if changes:
        record_event(request, "lease.updated", target=lease, changes=changes)
    return lease


@transaction.atomic
def activate_lease(*, request, lease: Lease) -> Lease:
    lease = Lease.objects.select_for_update().get(pk=lease.pk)
    if lease.status != Lease.Status.DRAFT:
        raise BusinessRuleViolation("Only draft leases can be activated.")
    unit = Unit.objects.select_for_update().get(pk=lease.unit_id)
    if unit.status not in ACTIVATABLE_UNIT_STATUSES:
        raise BusinessRuleViolation(
            f"Unit {unit.number} is {unit.get_status_display().lower()} "
            "and cannot be let right now."
        )
    if not lease.rent_terms.exists():
        raise BusinessRuleViolation("Add a rent amount before activating the lease.")

    today = organization_today(lease.organization)
    lease.status = Lease.Status.ACTIVE
    lease.activated_at = timezone.now()
    lease.activated_by = request.user
    try:
        with transaction.atomic():
            lease.save()
    except IntegrityError as exc:
        raise BusinessRuleViolation("This unit already has a lease covering these dates.") from exc

    previous = unit.status
    unit.status = Unit.Status.OCCUPIED if lease.start_date <= today else Unit.Status.RESERVED
    unit.save(update_fields=["status", "updated_at"])
    record_event(request, "lease.activated", target=lease)
    record_event(
        request,
        "unit.status_changed",
        target=unit,
        changes={"status": {"from": previous, "to": unit.status}},
        metadata={"lease": lease.reference},
    )
    return lease


@transaction.atomic
def cancel_draft(*, request, lease: Lease, reason: str = "") -> Lease:
    lease = Lease.objects.select_for_update().get(pk=lease.pk)
    if lease.status != Lease.Status.DRAFT:
        raise BusinessRuleViolation(
            "Only draft leases can be cancelled. End an active lease instead."
        )
    lease.status = Lease.Status.CANCELLED
    lease.end_reason = reason
    lease.closed_at = timezone.now()
    lease.closed_by = request.user
    lease.save()
    record_event(request, "lease.cancelled", target=lease, metadata={"reason": reason})
    return lease


@transaction.atomic
def end_lease(
    *, request, lease: Lease, ended_on: date, unit_status: str, reason: str = ""
) -> Lease:
    """Close an active lease. The full move-out workflow (inspection, deposit settlement)
    builds on this in a later phase; this is the authorized closing step."""
    lease = Lease.objects.select_for_update().get(pk=lease.pk)
    if lease.status != Lease.Status.ACTIVE:
        raise BusinessRuleViolation("Only active leases can be ended.")
    if ended_on < lease.start_date:
        raise BusinessRuleViolation("The lease cannot end before it started.")
    if ended_on > organization_today(lease.organization):
        raise BusinessRuleViolation(
            "A lease can only be closed on or after its final day. Record the planned "
            "move-out date and close the lease once the tenant has left."
        )
    if unit_status not in Unit.POST_LEASE_STATUSES:
        raise BusinessRuleViolation(
            "Choose what the unit's status should be after the tenant leaves."
        )

    lease.status = Lease.Status.ENDED
    lease.ended_on = ended_on
    lease.end_reason = reason
    lease.closed_at = timezone.now()
    lease.closed_by = request.user
    try:
        with transaction.atomic():
            lease.save()
    except IntegrityError as exc:
        raise BusinessRuleViolation("The end date overlaps another tenancy on this unit.") from exc
    # Future rent terms never took effect; keep them for history but they no longer apply.

    unit = Unit.objects.select_for_update().get(pk=lease.unit_id)
    previous = unit.status
    unit.status = unit_status
    unit.save(update_fields=["status", "updated_at"])
    record_event(
        request,
        "lease.ended",
        target=lease,
        changes={
            "status": {"from": "active", "to": "ended"},
            "ended_on": {"from": None, "to": str(ended_on)},
        },
        metadata={"reason": reason},
    )
    record_event(
        request,
        "unit.status_changed",
        target=unit,
        changes={"status": {"from": previous, "to": unit_status}},
        metadata={"lease": lease.reference},
    )
    return lease


@transaction.atomic
def add_rent_term(
    *, request, lease: Lease, effective_from: date, monthly_rent: Decimal, note: str = ""
) -> LeaseRentTerm:
    lease = Lease.objects.select_for_update().get(pk=lease.pk)
    if lease.status in (Lease.Status.ENDED, Lease.Status.CANCELLED):
        raise BusinessRuleViolation("This lease is closed; its rent can no longer change.")
    if effective_from <= lease.start_date:
        raise BusinessRuleViolation("A rent change must take effect after the lease start date.")
    if lease.end_date and effective_from > lease.end_date:
        raise BusinessRuleViolation("A rent change cannot start after the lease end date.")
    if lease.status == Lease.Status.ACTIVE and effective_from <= organization_today(
        lease.organization
    ):
        raise BusinessRuleViolation(
            "Rent changes on an active lease must start in the future, so past periods keep "
            "the rent that applied at the time."
        )
    try:
        with transaction.atomic():
            term = LeaseRentTerm.objects.create(
                lease=lease,
                effective_from=effective_from,
                monthly_rent=quantize(monthly_rent),
                note=note,
                created_by=request.user,
            )
    except IntegrityError as exc:
        raise BusinessRuleViolation("A rent change already exists for that date.") from exc
    record_event(
        request,
        "lease.rent_scheduled",
        target=lease,
        metadata={"effective_from": str(effective_from), "monthly_rent": str(term.monthly_rent)},
    )
    return term


@transaction.atomic
def remove_rent_term(*, request, term: LeaseRentTerm) -> None:
    lease = Lease.objects.select_for_update().get(pk=term.lease_id)
    if term.effective_from == lease.start_date:
        raise BusinessRuleViolation("The initial rent cannot be removed.")
    if lease.status != Lease.Status.DRAFT and term.effective_from <= organization_today(
        lease.organization
    ):
        raise BusinessRuleViolation("Rent terms that have already taken effect cannot be removed.")
    if lease.status in (Lease.Status.ENDED, Lease.Status.CANCELLED):
        raise BusinessRuleViolation("This lease is closed.")
    record_event(
        request,
        "lease.rent_unscheduled",
        target=lease,
        metadata={
            "effective_from": str(term.effective_from),
            "monthly_rent": str(term.monthly_rent),
        },
    )
    term.delete()


def sync_reserved_units(organization) -> int:
    """Flip reserved units to occupied once their lease has started. Idempotent."""
    today = organization_today(organization)
    unit_ids = list(
        Lease.objects.filter(
            organization=organization,
            status=Lease.Status.ACTIVE,
            start_date__lte=today,
            unit__status=Unit.Status.RESERVED,
        ).values_list("unit_id", flat=True)
    )
    if not unit_ids:
        return 0
    with transaction.atomic():
        updated = Unit.objects.filter(
            organization=organization, pk__in=unit_ids, status=Unit.Status.RESERVED
        ).update(status=Unit.Status.OCCUPIED, updated_at=timezone.now())
        for unit in Unit.objects.filter(pk__in=unit_ids):
            record_event(
                None,
                "unit.status_changed",
                target=unit,
                organization=organization,
                changes={"status": {"from": "reserved", "to": "occupied"}},
                metadata={"source": "scheduled lease start"},
            )
    return updated
