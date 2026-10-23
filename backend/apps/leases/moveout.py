"""Move-out workflow.

    submitted ──acknowledge──► acknowledged ──schedule inspection──► inspection_scheduled
        │                          │                                         │
        └──────── withdraw ────────┴──────────────── complete (settlement) ──┘──► completed

A notice is private to staff with moveouts.view (and the tenant who gave it). It never
releases the unit: acknowledging marks the unit "notice submitted"; only the settlement ends
the lease and sets the unit's next status (awaiting inspection, available, ...).

The settlement runs as one transaction:
1. end the lease on the move-out date;
2. post a prorated final bill for the move-out month if it hasn't been billed;
3. deduct confirmed damages from the deposit;
4. optionally apply the remaining deposit to the outstanding balance;
5. refund what's left of the deposit;
6. record everything on the notice and in the audit log.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.core.money import ZERO, quantize
from apps.notifications.services import notify, staff_with
from apps.organizations.models import organization_today
from apps.properties.models import Unit

from .models import Lease, MoveOutNotice
from .services import end_lease

Status = MoveOutNotice.Status


def _staff_link(notice) -> str:
    return f"/dashboard/move-outs/{notice.pk}"


@transaction.atomic
def submit_notice(
    *, request, lease: Lease, intended_date: date, message: str = "", from_tenant: bool, actor=None
) -> MoveOutNotice:
    actor = actor or request.user
    lease = (
        Lease.objects.select_for_update()
        .select_related("tenant", "unit__property")
        .get(pk=lease.pk)
    )
    if lease.status != Lease.Status.ACTIVE:
        raise BusinessRuleViolation("Notice can only be given on an active lease.")
    if intended_date < organization_today(lease.organization):
        raise BusinessRuleViolation("The move-out date can't be in the past.")
    try:
        with transaction.atomic():
            notice = MoveOutNotice.objects.create(
                organization=lease.organization,
                lease=lease,
                tenant=lease.tenant,
                intended_date=intended_date,
                message=message.strip(),
                from_tenant=from_tenant,
                submitted_by=actor,
            )
    except IntegrityError as exc:
        raise BusinessRuleViolation(
            "There is already an open move-out notice for this lease."
        ) from exc
    record_event(
        request,
        "move_out.submitted",
        target=notice,
        organization=lease.organization,
        actor=actor,
        metadata={"intended_date": str(intended_date), "from_tenant": from_tenant},
    )
    notify(
        organization=lease.organization,
        kind="move_out",
        users=[
            u
            for u in staff_with(lease.organization, "moveouts.view", lease.unit.property_id)
            if u.pk != actor.pk
        ],
        title=f"Move-out notice: {lease.unit.property.name} {lease.unit.number}",
        body=f"{lease.tenant.full_name} plans to move out on {intended_date:%d %b %Y}.",
        link=_staff_link(notice),
        dedupe_key=f"moveout:{notice.pk}",
    )
    return notice


def _set_unit(unit_id, frm: set, to: str) -> None:
    Unit.objects.filter(pk=unit_id, status__in=frm).update(status=to, updated_at=timezone.now())


@transaction.atomic
def acknowledge(*, request, notice: MoveOutNotice, staff_notes: str = "") -> MoveOutNotice:
    notice = MoveOutNotice.objects.select_for_update().get(pk=notice.pk)
    if notice.status != Status.SUBMITTED:
        raise BusinessRuleViolation("Only new notices can be acknowledged.")
    notice.status, notice.acknowledged_at = Status.ACKNOWLEDGED, timezone.now()
    if staff_notes:
        notice.staff_notes = staff_notes
    notice.save()
    # The unit is still let; it becomes "notice submitted" (not available) so it can be marketed.
    _set_unit(notice.lease.unit_id, {Unit.Status.OCCUPIED}, Unit.Status.NOTICE_SUBMITTED)
    record_event(request, "move_out.acknowledged", target=notice)
    notify(
        organization=notice.organization,
        kind="move_out",
        tenants=[notice.tenant],
        title="Move-out notice received",
        body=(
            "Your landlord has acknowledged your notice to move out on "
            f"{notice.intended_date:%d %b %Y}."
        ),
        tenant_link="/portal/move-out",
        dedupe_key=f"moveout:ack:{notice.pk}",
    )
    return notice


@transaction.atomic
def withdraw(
    *, request, notice: MoveOutNotice, by_tenant: bool = False, actor=None
) -> MoveOutNotice:
    actor = actor or request.user
    notice = MoveOutNotice.objects.select_for_update().get(pk=notice.pk)
    if notice.status not in MoveOutNotice.OPEN_STATUSES:
        raise BusinessRuleViolation("This notice is already closed.")
    if by_tenant and notice.status != Status.SUBMITTED:
        raise BusinessRuleViolation(
            "Your landlord has already acknowledged this notice; contact them to withdraw it."
        )
    notice.status = Status.WITHDRAWN
    notice.save(update_fields=["status", "updated_at"])
    _set_unit(notice.lease.unit_id, {Unit.Status.NOTICE_SUBMITTED}, Unit.Status.OCCUPIED)
    if notice.inspection_id and notice.inspection.status == "scheduled":
        from apps.inspections.services import cancel

        cancel(request=request, inspection=notice.inspection)
    record_event(
        request,
        "move_out.withdrawn",
        target=notice,
        organization=notice.organization,
        actor=actor,
        metadata={"by_tenant": by_tenant},
    )
    return notice


@transaction.atomic
def schedule_inspection(
    *, request, notice: MoveOutNotice, scheduled_for: date, inspector=None
) -> MoveOutNotice:
    from apps.inspections.models import Inspection
    from apps.inspections.services import schedule

    notice = MoveOutNotice.objects.select_for_update().get(pk=notice.pk)
    if notice.status not in (Status.ACKNOWLEDGED, Status.INSPECTION_SCHEDULED):
        raise BusinessRuleViolation("Acknowledge the notice before scheduling the inspection.")
    if notice.inspection_id and notice.inspection.status == Inspection.Status.SCHEDULED:
        raise BusinessRuleViolation("A move-out inspection is already scheduled.")
    notice.inspection = schedule(
        request=request,
        organization=notice.organization,
        unit=notice.lease.unit,
        kind=Inspection.Kind.MOVE_OUT,
        scheduled_for=scheduled_for,
        lease=notice.lease,
        inspector=inspector,
    )
    notice.status = Status.INSPECTION_SCHEDULED
    notice.save(update_fields=["inspection", "status", "updated_at"])
    record_event(
        request,
        "move_out.inspection_scheduled",
        target=notice,
        metadata={"date": str(scheduled_for)},
    )
    return notice


@dataclass
class SettlementPreview:
    deposit_held: Decimal
    damages_found: Decimal
    damages_deducted: Decimal
    balance_before: Decimal
    applied_to_balance: Decimal
    refund: Decimal
    balance_after: Decimal
    move_out_month_billed: bool
    notes: list

    def as_dict(self) -> dict:
        return {k: (str(v) if isinstance(v, Decimal) else v) for k, v in asdict(self).items()}


def preview_settlement(
    notice: MoveOutNotice,
    *,
    moved_out_on: date,
    apply_deposit_to_balance: bool,
    damages: Decimal | None = None,
) -> SettlementPreview:
    from apps.billing.models import Invoice
    from apps.billing.services import lease_balance
    from apps.deposits.services import summarize

    lease = notice.lease
    held = summarize(lease).held
    found = ZERO
    notes = []
    if notice.inspection_id and notice.inspection.status == "completed":
        found = quantize(sum((i.charge_amount for i in notice.inspection.items.all()), ZERO))
    elif notice.inspection_id:
        notes.append("The move-out inspection hasn't been completed; no damages are taken from it.")
    damages = quantize(found if damages is None else damages)
    deducted = min(damages, held)
    if damages > held:
        notes.append(
            f"Damages exceed the deposit by {damages - held}; bill the rest with a one-off invoice."
        )
    month = moved_out_on.replace(day=1)
    billed = Invoice.objects.filter(
        lease=lease,
        status=Invoice.Status.ISSUED,
        kind=Invoice.Kind.REGULAR,
        period_start__lte=moved_out_on,
        period_end__gte=month,
    ).first()
    if billed and billed.period_end > moved_out_on:
        notes.append(
            f"{billed.number} already billed the period through {billed.period_end:%d %b %Y}. "
            "Credit any unused days on that invoice if your agreement allows it."
        )
    balance = lease_balance(lease)
    remaining = held - deducted
    applied = min(max(balance, ZERO), remaining) if apply_deposit_to_balance else ZERO
    return SettlementPreview(
        deposit_held=held,
        damages_found=found,
        damages_deducted=deducted,
        balance_before=balance,
        applied_to_balance=applied,
        refund=remaining - applied,
        balance_after=balance - applied,
        move_out_month_billed=billed is not None,
        notes=notes,
    )


@transaction.atomic
def complete_move_out(
    *,
    request,
    notice: MoveOutNotice,
    moved_out_on: date,
    unit_status: str,
    apply_deposit_to_balance: bool = True,
    damages: Decimal | None = None,
    refund_method: str = "",
    refund_reference: str = "",
    notes: str = "",
) -> MoveOutNotice:
    from apps.billing.services import run_billing
    from apps.deposits import services as deposits
    from apps.payments.models import Payment
    from apps.payments.services import record_payment

    membership = request.membership
    for capability in ("moveouts.manage", "leases.manage", "deposits.settle"):
        if not membership.has_capability(capability):
            raise BusinessRuleViolation(
                f"Completing a move-out needs the “{capability}” permission."
            )
    # Lock only the notice row (the inspection join is optional and can't be locked).
    notice = (
        MoveOutNotice.objects.select_for_update(of=("self",))
        .select_related("lease__unit", "inspection")
        .get(pk=notice.pk)
    )
    if notice.status not in MoveOutNotice.OPEN_STATUSES:
        raise BusinessRuleViolation("This notice is already closed.")
    lease = notice.lease
    today = organization_today(lease.organization)

    # 1-2. End the lease, then bill the final (prorated) month if it wasn't billed yet.
    end_lease(
        request=request,
        lease=lease,
        ended_on=moved_out_on,
        unit_status=unit_status,
        reason=f"Moved out (notice given {notice.created_at:%d %b %Y})",
    )
    lease.refresh_from_db()
    run_billing(
        request=request,
        organization=lease.organization,
        month=moved_out_on.replace(day=1),
        lease_ids=[lease.pk],
    )
    preview = preview_settlement(
        notice,
        moved_out_on=moved_out_on,
        apply_deposit_to_balance=apply_deposit_to_balance,
        damages=damages,
    )

    # 3-5. Deposit: damages, then rent owed, then refund.
    if preview.damages_deducted > 0:
        deposits.record(
            request=request,
            lease=lease,
            kind="deduction",
            amount=preview.damages_deducted,
            transaction_date=today,
            reason=notes.strip() or "Damages found at move-out inspection",
        )
    if preview.applied_to_balance > 0:
        deposits.record(
            request=request,
            lease=lease,
            kind="deduction",
            amount=preview.applied_to_balance,
            transaction_date=today,
            reason="Applied to outstanding rent and charges",
        )
        record_payment(
            request=request,
            organization=lease.organization,
            amount=preview.applied_to_balance,
            received_on=today,
            method="other",
            lease=lease,
            reference=f"DEP-{lease.reference}",
            source=Payment.Source.DEPOSIT,
            notes="Deposit applied at move-out",
        )
    if preview.refund > 0:
        if not refund_method:
            raise BusinessRuleViolation(
                f"Choose how the {preview.refund} deposit refund is paid back."
            )
        deposits.record(
            request=request,
            lease=lease,
            kind="refund",
            amount=preview.refund,
            transaction_date=today,
            method=refund_method,
            reference=refund_reference,
            reason="Deposit balance refunded at move-out",
        )

    notice.status, notice.completed_at = Status.COMPLETED, timezone.now()
    notice.settlement = {
        **preview.as_dict(),
        "moved_out_on": str(moved_out_on),
        "unit_status": unit_status,
    }
    if notes:
        notice.staff_notes = f"{notice.staff_notes}\n{notes}".strip()
    notice.save()
    record_event(request, "move_out.completed", target=notice, metadata=notice.settlement)
    notify(
        organization=lease.organization,
        kind="move_out",
        tenants=[notice.tenant],
        title="Your move-out is complete",
        body=f"Deposit refund: {lease.organization.currency} {preview.refund:,.2f}. "
        f"Balance remaining: {lease.organization.currency} "
        f"{max(preview.balance_after, ZERO):,.2f}.",
        tenant_link="/portal",
        dedupe_key=f"moveout:done:{notice.pk}",
    )
    return notice
