"""Maintenance requests: reporting, triage, progress, costs.

Tenants see their own requests with tenant-visible updates only. Internal notes and costs
never leave staff views. Every change is audited; tenants and staff are notified.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.core.models import next_reference
from apps.core.money import quantize
from apps.leases.models import Lease
from apps.notifications.services import notify, staff_with

from .models import MaintenanceCost, MaintenanceRequest, MaintenanceUpdate

Status = MaintenanceRequest.Status


def _tenant_link(req) -> str:
    return f"/portal/maintenance/{req.pk}"


def _staff_link(req) -> str:
    return f"/dashboard/maintenance/{req.pk}"


@transaction.atomic
def create_request(
    *,
    request,
    organization,
    unit,
    category: str,
    title: str,
    description: str,
    urgency: str = MaintenanceRequest.Urgency.NORMAL,
    tenant=None,
    source: str = MaintenanceRequest.Source.STAFF,
    actor=None,
) -> MaintenanceRequest:
    actor = actor or request.user
    if unit.organization_id != organization.pk:
        raise BusinessRuleViolation("That unit belongs to another organization.")
    lease = (
        Lease.objects.filter(unit=unit, status=Lease.Status.ACTIVE).select_related("tenant").first()
    )
    if tenant is None and lease is not None:
        tenant = lease.tenant
    req = MaintenanceRequest.objects.create(
        organization=organization,
        reference=next_reference(organization, "maintenance", "MNT"),
        unit=unit,
        lease=lease if lease and lease.tenant_id == getattr(tenant, "pk", None) else None,
        tenant=tenant,
        source=source,
        category=category,
        title=title.strip(),
        description=description.strip(),
        urgency=urgency,
        reported_by=actor,
    )
    record_event(
        request,
        "maintenance.created",
        target=req,
        organization=organization,
        actor=actor,
        metadata={"urgency": urgency, "source": source},
    )
    notify(
        organization=organization,
        kind="maintenance",
        users=[
            u
            for u in staff_with(organization, "maintenance.manage", unit.property_id)
            if u.pk != actor.pk
        ],
        title=(
            f"{'URGENT: ' if urgency in ('high', 'emergency') else ''}"
            f"New maintenance request {req.reference}"
        ),
        body=f"{req.title} at {unit.property.name} unit {unit.number}.",
        link=_staff_link(req),
        dedupe_key=f"maintenance:new:{req.pk}",
        email=urgency in ("high", "emergency"),
    )
    return req


def _note(req, *, actor, body="", internal=False, from_tenant=False, status_from="", status_to=""):
    return MaintenanceUpdate.objects.create(
        request=req,
        author=actor,
        author_name=getattr(actor, "full_name", "") or "System",
        from_tenant=from_tenant,
        body=body.strip(),
        is_internal=internal,
        status_from=status_from,
        status_to=status_to,
    )


@transaction.atomic
def change_status(
    *, request, req: MaintenanceRequest, status: str, note: str = ""
) -> MaintenanceRequest:
    req = MaintenanceRequest.objects.select_for_update().get(pk=req.pk)
    if status not in MaintenanceRequest.TRANSITIONS[req.status]:
        raise BusinessRuleViolation(
            f"A {req.get_status_display().lower()} request can't move to "
            f"{Status(status).label.lower()}."
        )
    previous = req.status
    req.status = status
    now = timezone.now()
    if status == Status.RESOLVED:
        req.resolved_at = now
    if status == Status.CLOSED:
        req.closed_at = now
    if status == Status.IN_PROGRESS and previous == Status.RESOLVED:
        req.resolved_at = None
    req.save()
    _note(req, actor=request.user, body=note, status_from=previous, status_to=status)
    record_event(
        request,
        "maintenance.status_changed",
        target=req,
        changes={"status": {"from": previous, "to": status}},
    )
    if req.tenant_id:
        notify(
            organization=req.organization,
            kind="maintenance",
            tenants=[req.tenant],
            title=f"{req.reference}: {Status(status).label}",
            body=f"Your request “{req.title}” is now {Status(status).label.lower()}."
            + (f" {note.strip()}" if note.strip() else ""),
            tenant_link=_tenant_link(req),
            dedupe_key=f"maintenance:{req.pk}:{status}:{req.updates.count()}",
        )
    return req


@transaction.atomic
def add_update(
    *,
    request,
    req: MaintenanceRequest,
    body: str,
    internal: bool,
    from_tenant: bool = False,
    actor=None,
):
    actor = actor or request.user
    if not body.strip():
        raise BusinessRuleViolation("Write a message.")
    if req.status in (Status.CLOSED, Status.CANCELLED) and from_tenant:
        raise BusinessRuleViolation("This request is closed. Report a new issue instead.")
    update = _note(req, actor=actor, body=body, internal=internal, from_tenant=from_tenant)
    record_event(
        request,
        "maintenance.note_added",
        target=req,
        organization=req.organization,
        actor=actor,
        metadata={"internal": internal, "from_tenant": from_tenant},
    )
    if from_tenant:
        notify(
            organization=req.organization,
            kind="maintenance",
            users=staff_with(req.organization, "maintenance.manage", req.unit.property_id),
            title=f"Tenant replied on {req.reference}",
            body=body.strip()[:300],
            link=_staff_link(req),
            dedupe_key=f"maintenance:reply:{update.pk}",
            email=False,
        )
    elif not internal and req.tenant_id:
        notify(
            organization=req.organization,
            kind="maintenance",
            tenants=[req.tenant],
            title=f"Update on {req.reference}",
            body=body.strip()[:300],
            tenant_link=_tenant_link(req),
            dedupe_key=f"maintenance:update:{update.pk}",
        )
    return update


@transaction.atomic
def assign(
    *, request, req: MaintenanceRequest, membership, scheduled_for: date | None = None
) -> MaintenanceRequest:
    if membership is not None and (
        membership.organization_id != req.organization_id
        or not membership.has_capability("maintenance.manage")
    ):
        raise BusinessRuleViolation("Assign the request to a team member who handles maintenance.")
    previous = req.assigned_to_id
    req.assigned_to = membership
    req.scheduled_for = scheduled_for
    req.save(update_fields=["assigned_to", "scheduled_for", "updated_at"])
    record_event(
        request,
        "maintenance.assigned",
        target=req,
        changes={
            "assigned_to": {"from": str(previous), "to": str(getattr(membership, "pk", None))}
        },
    )
    if membership is not None and membership.user_id != request.user.pk:
        notify(
            organization=req.organization,
            kind="maintenance",
            users=[membership.user],
            title=f"Assigned to you: {req.reference}",
            body=f"{req.title} at {req.unit}.",
            link=_staff_link(req),
            dedupe_key=f"maintenance:assign:{req.pk}:{membership.pk}:{scheduled_for}",
        )
    return req


@transaction.atomic
def add_cost(
    *,
    request,
    req,
    kind: str,
    description: str,
    amount: Decimal,
    supplier_name: str = "",
    incurred_on=None,
):
    cost = MaintenanceCost.objects.create(
        organization=req.organization,
        request=req,
        kind=kind,
        description=description.strip(),
        amount=quantize(amount),
        supplier_name=supplier_name.strip(),
        incurred_on=incurred_on,
        status=MaintenanceCost.Status.PENDING
        if kind == MaintenanceCost.Kind.QUOTATION
        else MaintenanceCost.Status.RECORDED,
        created_by=request.user,
    )
    record_event(
        request,
        "maintenance.cost_added",
        target=req,
        metadata={"kind": kind, "amount": str(cost.amount), "supplier": cost.supplier_name},
    )
    return cost


@transaction.atomic
def decide_quotation(*, request, cost: MaintenanceCost, approve: bool) -> MaintenanceCost:
    cost = MaintenanceCost.objects.select_for_update().get(pk=cost.pk)
    if cost.kind != MaintenanceCost.Kind.QUOTATION or cost.status != MaintenanceCost.Status.PENDING:
        raise BusinessRuleViolation("Only pending quotations can be approved or rejected.")
    cost.status = MaintenanceCost.Status.APPROVED if approve else MaintenanceCost.Status.REJECTED
    cost.decided_by = request.user
    cost.save(update_fields=["status", "decided_by", "updated_at"])
    record_event(
        request,
        f"maintenance.quotation_{cost.status}",
        target=cost.request,
        metadata={"amount": str(cost.amount), "supplier": cost.supplier_name},
    )
    return cost


@transaction.atomic
def tenant_cancel(*, request, req: MaintenanceRequest, actor) -> MaintenanceRequest:
    if req.status != Status.SUBMITTED:
        raise BusinessRuleViolation("Only requests nobody has picked up yet can be cancelled.")
    req.status = Status.CANCELLED
    req.save(update_fields=["status", "updated_at"])
    _note(
        req,
        actor=actor,
        from_tenant=True,
        status_from=Status.SUBMITTED,
        status_to=Status.CANCELLED,
        body="Cancelled by the tenant.",
    )
    record_event(
        request,
        "maintenance.cancelled_by_tenant",
        target=req,
        organization=req.organization,
        actor=actor,
    )
    return req
