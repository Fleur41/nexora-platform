from __future__ import annotations

from datetime import date

from django.db import transaction
from django.utils import timezone

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.core.models import next_reference
from apps.core.money import quantize
from apps.leases.models import Lease
from apps.notifications.services import notify

from .models import DEFAULT_CHECKLIST, Inspection, InspectionItem


@transaction.atomic
def schedule(
    *, request, organization, unit, kind: str, scheduled_for: date, lease=None, inspector=None
) -> Inspection:
    if unit.organization_id != organization.pk:
        raise BusinessRuleViolation("That unit belongs to another organization.")
    if lease is not None and lease.unit_id != unit.pk:
        raise BusinessRuleViolation("That lease is for a different unit.")
    if lease is None and kind in (Inspection.Kind.MOVE_IN, Inspection.Kind.MOVE_OUT):
        lease = (
            Lease.objects.filter(unit=unit, status__in=[Lease.Status.ACTIVE, Lease.Status.DRAFT])
            .order_by("-start_date")
            .first()
        )
    if inspector is not None and (
        inspector.organization_id != organization.pk
        or not inspector.has_capability("inspections.manage")
    ):
        raise BusinessRuleViolation("The inspector must be a team member who can do inspections.")
    inspection = Inspection.objects.create(
        organization=organization,
        reference=next_reference(organization, "inspection", "INS"),
        unit=unit,
        lease=lease,
        kind=kind,
        scheduled_for=scheduled_for,
        inspector=inspector,
        created_by=request.user,
    )
    position = 0
    for area, names in DEFAULT_CHECKLIST.items():
        for name in names:
            InspectionItem.objects.create(
                inspection=inspection, area=area, name=name, position=position
            )
            position += 1
    record_event(
        request,
        "inspection.scheduled",
        target=inspection,
        metadata={"kind": kind, "date": str(scheduled_for)},
    )
    if lease is not None and kind != Inspection.Kind.ROUTINE:
        notify(
            organization=organization,
            kind="inspection",
            tenants=[lease.tenant],
            title=f"{inspection.get_kind_display()} inspection on {scheduled_for:%d %b %Y}",
            body=(
                f"An inspection of {unit.property.name} unit {unit.number} "
                f"is scheduled for {scheduled_for:%A %d %B}."
            ),
            tenant_link="/portal",
            dedupe_key=f"inspection:{inspection.pk}:{scheduled_for}",
        )
    return inspection


def _editable(inspection: Inspection) -> None:
    if inspection.status != Inspection.Status.SCHEDULED:
        raise BusinessRuleViolation("Completed or cancelled inspections can't be changed.")


@transaction.atomic
def update_items(*, request, inspection: Inspection, items: list[dict]) -> Inspection:
    _editable(inspection)
    by_id = {str(i.pk): i for i in inspection.items.all()}
    for data in items:
        item = by_id.get(str(data.get("id"))) if data.get("id") else None
        if item is None:
            if not data.get("area") or not data.get("name"):
                raise BusinessRuleViolation("New checklist items need an area and a name.")
            item = InspectionItem(
                inspection=inspection,
                area=data["area"][:60],
                name=data["name"][:100],
                position=len(by_id) + 1,
            )
        for field in ("condition", "notes"):
            if field in data:
                setattr(item, field, data[field])
        if "charge_amount" in data:
            if inspection.kind != Inspection.Kind.MOVE_OUT and data["charge_amount"]:
                raise BusinessRuleViolation("Damage charges only apply to move-out inspections.")
            item.charge_amount = quantize(data["charge_amount"] or 0)
        item.save()
    return inspection


@transaction.atomic
def complete(
    *,
    request,
    inspection: Inspection,
    summary: str = "",
    keys_returned=None,
    tenant_present=False,
    tenant_signature_name: str = "",
    inspector_signature_name: str = "",
) -> Inspection:
    inspection = Inspection.objects.select_for_update().get(pk=inspection.pk)
    _editable(inspection)
    unchecked = inspection.items.filter(condition=InspectionItem.Condition.NOT_CHECKED).count()
    if unchecked:
        raise BusinessRuleViolation(f"{unchecked} checklist items haven't been checked yet.")
    if not inspector_signature_name.strip():
        raise BusinessRuleViolation("The inspector must sign (type their name).")
    inspection.summary = summary
    inspection.keys_returned = keys_returned
    inspection.tenant_present = tenant_present
    inspection.tenant_signature_name = tenant_signature_name.strip()
    inspection.inspector_signature_name = inspector_signature_name.strip()
    inspection.status = Inspection.Status.COMPLETED
    inspection.completed_at = timezone.now()
    inspection.save()
    damages = sum(i.charge_amount for i in inspection.items.all())
    record_event(
        request,
        "inspection.completed",
        target=inspection,
        metadata={"damages": str(damages), "keys_returned": keys_returned},
    )
    return inspection


@transaction.atomic
def cancel(*, request, inspection: Inspection) -> Inspection:
    _editable(inspection)
    inspection.status = Inspection.Status.CANCELLED
    inspection.save(update_fields=["status", "updated_at"])
    record_event(request, "inspection.cancelled", target=inspection)
    return inspection
