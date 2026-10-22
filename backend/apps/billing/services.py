"""Posting invoices and corrections, and managing charge rules.

Money never moves without a ledger entry and an audit event in the same transaction.
Posted invoices are immutable: mistakes are fixed with a credit (partial) or a void
(whole invoice, only while nothing has been credited or paid against it).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone
from django.utils.text import slugify

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.core.models import next_reference
from apps.core.money import ZERO, quantize
from apps.leases.models import Lease
from apps.organizations.models import organization_today
from apps.utilities.models import MeterReading

from .engine import DraftInvoice, MonthDraft, draft_month
from .models import (
    BillingRun,
    BillingSettings,
    ChargeRule,
    ChargeType,
    Invoice,
    InvoiceLine,
    LedgerEntry,
)

# --- Balances -------------------------------------------------------------------


def amount_due(invoice: Invoice) -> Decimal:
    total = invoice.ledger_entries.aggregate(s=Sum("amount"))["s"]
    return quantize(total or ZERO)


def lease_balance(lease, on: date | None = None) -> Decimal:
    entries = LedgerEntry.objects.filter(lease=lease)
    if on is not None:
        entries = entries.filter(effective_date__lte=on)
    return quantize(entries.aggregate(s=Sum("amount"))["s"] or ZERO)


def statement(lease, start: date | None, end: date | None) -> dict:
    """Opening balance, entries with a running balance, and closing balance."""
    entries = LedgerEntry.objects.filter(lease=lease).select_related("invoice")
    opening = ZERO
    if start is not None:
        opening = quantize(
            entries.filter(effective_date__lt=start).aggregate(s=Sum("amount"))["s"] or ZERO
        )
        entries = entries.filter(effective_date__gte=start)
    if end is not None:
        entries = entries.filter(effective_date__lte=end)
    running = opening
    rows = []
    for entry in entries.order_by("effective_date", "created_at"):
        running += entry.amount
        rows.append((entry, running))
    return {"opening_balance": opening, "rows": rows, "closing_balance": running}


# --- Billing runs ----------------------------------------------------------------


@dataclass
class RunResult:
    run: BillingRun | None
    draft: MonthDraft
    invoices: list[Invoice]
    skipped: list[str]


def _lock_organization_billing(organization) -> BillingSettings:
    settings_row, _ = BillingSettings.objects.get_or_create(organization=organization)
    # Serializes billing runs per organization; dedupe keys are the second safety net.
    return BillingSettings.objects.select_for_update().get(pk=settings_row.pk)


def _post_invoice(
    *, organization, draft: DraftInvoice, actor, run=None, issue_date: date
) -> Invoice:
    lease = draft.lease
    invoice = Invoice.objects.create(
        organization=organization,
        number=next_reference(organization, "invoice", "INV", width=5),
        lease=lease,
        tenant=lease.tenant,
        unit=lease.unit,
        kind=draft.kind,
        period_start=draft.period_start,
        period_end=draft.period_end,
        issue_date=issue_date,
        due_date=draft.due_date,
        currency=organization.currency,
        total=draft.total,
        billing_run=run,
        created_by=actor,
    )
    for line in draft.lines:
        created = InvoiceLine.objects.create(
            organization=organization,
            invoice=invoice,
            charge_type=line.charge_type,
            description=line.description[:255],
            quantity=line.quantity,
            unit_price=line.unit_price if line.unit_price is not None else line.amount,
            amount=line.amount,
            income_category=line.charge_type.income_category,
            period_start=line.period_start,
            period_end=line.period_end,
            charge_rule=line.charge_rule,
            rent_term=line.rent_term,
            shared_cost=line.shared_cost,
            dedupe_key=line.dedupe_key,
        )
        if line.readings:
            updated = MeterReading.objects.filter(
                pk__in=[r.pk for r in line.readings], invoice_line__isnull=True
            ).update(invoice_line=created)
            if updated != len(line.readings):
                raise IntegrityError("Meter readings were billed concurrently.")
    LedgerEntry.objects.create(
        organization=organization,
        lease=lease,
        tenant=lease.tenant,
        entry_type=LedgerEntry.EntryType.INVOICE,
        amount=invoice.total,
        invoice=invoice,
        reference=invoice.number,
        effective_date=issue_date,
        description=f"Invoice {invoice.number}",
        created_by=actor,
    )
    return invoice


def preview_billing(*, organization, month: date) -> MonthDraft:
    return draft_month(organization, month)


@transaction.atomic
def run_billing(
    *, request, organization, month: date, trigger=BillingRun.Trigger.MANUAL
) -> RunResult:
    """Bill a month. Safe to repeat: only lines not already billed are posted."""
    month = month.replace(day=1)
    _lock_organization_billing(organization)
    actor = request.user if request is not None else None
    draft = draft_month(organization, month)
    issue_date = organization_today(organization)

    run = BillingRun.objects.create(
        organization=organization, period=month, trigger=trigger, created_by=actor
    )
    invoices, skipped = [], list(draft.notes)
    for invoice_draft in draft.invoices:
        try:
            with transaction.atomic():
                invoices.append(
                    _post_invoice(
                        organization=organization,
                        draft=invoice_draft,
                        actor=actor,
                        run=run,
                        issue_date=issue_date,
                    )
                )
        except IntegrityError:
            skipped.append(
                f"{invoice_draft.lease.reference}: already billed by a concurrent run; skipped."
            )

    run.invoices_created = len(invoices)
    run.lines_created = InvoiceLine.objects.filter(invoice__in=invoices).count()
    run.total_billed = sum((i.total for i in invoices), ZERO)
    run.skipped = skipped
    run.save()
    record_event(
        request,
        "billing.run",
        target=run,
        organization=organization,
        metadata={
            "period": f"{month:%Y-%m}",
            "trigger": trigger,
            "invoices": run.invoices_created,
            "total": str(run.total_billed),
        },
    )
    return RunResult(run=run, draft=draft, invoices=invoices, skipped=skipped)


def run_scheduled_billing(organization) -> BillingRun | None:
    """Monthly automatic run: once the configured day arrives, at most one scheduled run
    per month (and the run itself is idempotent anyway)."""
    settings_row = BillingSettings.objects.filter(
        organization=organization, auto_generate=True
    ).first()
    if settings_row is None:
        return None
    today = organization_today(organization)
    month = today.replace(day=1)
    if today.day < settings_row.generate_day:
        return None
    if BillingRun.objects.filter(
        organization=organization, period=month, trigger=BillingRun.Trigger.SCHEDULED
    ).exists():
        return None
    return run_billing(
        request=None, organization=organization, month=month, trigger=BillingRun.Trigger.SCHEDULED
    ).run


# --- One-off invoices and corrections -----------------------------------------------


@transaction.atomic
def create_one_off_invoice(
    *,
    request,
    organization,
    lease: Lease,
    lines: list[dict],
    due_date: date | None,
    notes: str = "",
) -> Invoice:
    if lease.status not in Lease.OCCUPYING_STATUSES:
        raise BusinessRuleViolation("Invoices can only be raised on active or ended leases.")
    if not lines:
        raise BusinessRuleViolation("Add at least one line.")
    today = organization_today(organization)
    from .engine import DraftLine

    draft = DraftInvoice(
        lease=lease,
        kind=Invoice.Kind.ONE_OFF,
        period_start=None,
        period_end=None,
        due_date=due_date or today,
        lines=[
            DraftLine(
                charge_type=line["charge_type"],
                description=line["description"],
                amount=quantize(line["amount"]),
                dedupe_key="",
            )
            for line in lines
        ],
    )
    if draft.total <= 0:
        raise BusinessRuleViolation("The invoice total must be more than zero.")
    invoice = _post_invoice(
        organization=organization, draft=draft, actor=request.user, issue_date=today
    )
    if notes:
        invoice.notes = notes
        invoice.save(update_fields=["notes", "updated_at"])
    record_event(
        request,
        "invoice.created",
        target=invoice,
        metadata={"kind": "one_off", "total": str(invoice.total), "lease": lease.reference},
    )
    return invoice


@transaction.atomic
def void_invoice(*, request, invoice: Invoice, reason: str) -> Invoice:
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if invoice.status == Invoice.Status.VOID:
        raise BusinessRuleViolation("This invoice is already void.")
    if not reason.strip():
        raise BusinessRuleViolation("Give a reason for voiding the invoice.")
    if invoice.ledger_entries.exclude(entry_type=LedgerEntry.EntryType.INVOICE).exists():
        raise BusinessRuleViolation(
            "This invoice has credits or payments against it. Issue a credit for the "
            "remaining balance instead of voiding it."
        )
    invoice.status = Invoice.Status.VOID
    invoice.voided_at = timezone.now()
    invoice.voided_by = request.user
    invoice.void_reason = reason.strip()
    invoice.save()
    # Free the lines' dedupe keys and meter readings so the period can be billed again.
    InvoiceLine.objects.filter(invoice=invoice).update(is_void=True)
    MeterReading.objects.filter(invoice_line__invoice=invoice).update(invoice_line=None)
    LedgerEntry.objects.create(
        organization=invoice.organization,
        lease=invoice.lease,
        tenant=invoice.tenant,
        entry_type=LedgerEntry.EntryType.VOID,
        amount=-invoice.total,
        invoice=invoice,
        reference=invoice.number,
        effective_date=organization_today(invoice.organization),
        description=f"Invoice {invoice.number} voided",
        reason=invoice.void_reason,
        created_by=request.user,
    )
    record_event(
        request,
        "invoice.voided",
        target=invoice,
        changes={"status": {"from": "issued", "to": "void"}},
        metadata={"reason": invoice.void_reason, "total": str(invoice.total)},
    )
    return invoice


@transaction.atomic
def credit_invoice(*, request, invoice: Invoice, amount: Decimal, reason: str) -> LedgerEntry:
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    amount = quantize(amount)
    if invoice.status == Invoice.Status.VOID:
        raise BusinessRuleViolation("You cannot credit a void invoice.")
    if not reason.strip():
        raise BusinessRuleViolation("Give a reason for the credit.")
    due = amount_due(invoice)
    if amount <= 0:
        raise BusinessRuleViolation("The credit must be more than zero.")
    if amount > due:
        raise BusinessRuleViolation(f"The credit cannot exceed the amount due ({due}).")
    organization = invoice.organization
    entry = LedgerEntry.objects.create(
        organization=organization,
        lease=invoice.lease,
        tenant=invoice.tenant,
        entry_type=LedgerEntry.EntryType.CREDIT,
        amount=-amount,
        invoice=invoice,
        reference=next_reference(organization, "credit", "CRN", width=5),
        effective_date=organization_today(organization),
        description=f"Credit on invoice {invoice.number}",
        reason=reason.strip(),
        created_by=request.user,
    )
    record_event(
        request,
        "invoice.credited",
        target=invoice,
        metadata={"credit": entry.reference, "amount": str(amount), "reason": entry.reason},
    )
    return entry


# --- Charge types and rules -----------------------------------------------------------


@transaction.atomic
def create_charge_type(*, request, organization, name: str, **fields) -> ChargeType:
    base = slugify(name).replace("-", "_")[:30] or "charge"
    code, n = base, 2
    while ChargeType.objects.filter(organization=organization, code=code).exists():
        code = f"{base}_{n}"
        n += 1
    charge_type = ChargeType.objects.create(
        organization=organization, code=code, name=name, **fields
    )
    record_event(request, "charge_type.created", target=charge_type)
    return charge_type


def _validate_rule(fields: dict) -> None:
    charge_type: ChargeType = fields["charge_type"]
    if charge_type.code == ChargeType.RENT:
        raise BusinessRuleViolation("Rent comes from each lease's rent terms, not charge rules.")
    method = fields["method"]
    if method == ChargeRule.Method.METERED and not charge_type.meter_utility:
        raise BusinessRuleViolation(
            f"{charge_type.name} is not linked to a meter type, so it can't be metered."
        )
    if method == ChargeRule.Method.SHARED:
        fields["amount"] = Decimal("0")
    if fields.get("effective_to") and fields["effective_to"] < fields["effective_from"]:
        raise BusinessRuleViolation("The end date must be on or after the start date.")
    scope = fields["scope"]
    targets = {
        "property": fields.get("property"),
        "unit_type": fields.get("unit_type"),
        "unit": fields.get("unit"),
    }
    for key, value in targets.items():
        if key != scope and value is not None:
            raise BusinessRuleViolation(
                f"A {scope.replace('_', ' ')} rule cannot also target a {key.replace('_', ' ')}."
            )
    if scope != ChargeRule.Scope.ORGANIZATION and targets[scope] is None:
        raise BusinessRuleViolation(f"Choose the {scope.replace('_', ' ')} this rule applies to.")


def _save_rule(rule: ChargeRule) -> ChargeRule:
    try:
        with transaction.atomic():
            rule.save()
    except IntegrityError as exc:
        raise BusinessRuleViolation(
            "Another rule for this charge and scope covers some of the same dates. End it "
            "first or choose different dates."
        ) from exc
    return rule


@transaction.atomic
def create_rule(*, request, organization, **fields) -> ChargeRule:
    _validate_rule(fields)
    rule = _save_rule(ChargeRule(organization=organization, created_by=request.user, **fields))
    record_event(
        request,
        "charge_rule.created",
        target=rule,
        metadata={
            "charge_type": rule.charge_type.code,
            "scope": rule.scope_key,
            "method": rule.method,
            "amount": str(rule.amount),
            "enabled": rule.is_enabled,
        },
    )
    return rule


def rule_is_billed(rule: ChargeRule) -> bool:
    return rule.lines.filter(is_void=False).exists()


@transaction.atomic
def update_rule(*, request, rule: ChargeRule, **fields) -> ChargeRule:
    rule = ChargeRule.objects.select_for_update().get(pk=rule.pk)
    if rule_is_billed(rule) and set(fields) - {"description"}:
        raise BusinessRuleViolation(
            "This rule has already been billed. End it and add a new rule from a later date "
            "so past invoices keep their original terms."
        )
    merged = {
        f: fields.get(f, getattr(rule, f))
        for f in (
            "charge_type",
            "scope",
            "property",
            "unit_type",
            "unit",
            "method",
            "amount",
            "usage_unit",
            "is_enabled",
            "included_in_rent",
            "effective_from",
            "effective_to",
            "description",
        )
    }
    _validate_rule(merged)
    changes = {
        k: {"from": str(getattr(rule, k)), "to": str(v)}
        for k, v in merged.items()
        if getattr(rule, k) != v
    }
    for k, v in merged.items():
        setattr(rule, k, v)
    _save_rule(rule)
    if changes:
        record_event(request, "charge_rule.updated", target=rule, changes=changes)
    return rule


@transaction.atomic
def end_rule(*, request, rule: ChargeRule, effective_to: date) -> ChargeRule:
    rule = ChargeRule.objects.select_for_update().get(pk=rule.pk)
    if effective_to < rule.effective_from:
        raise BusinessRuleViolation("The end date must be on or after the rule's start date.")
    last_billed = (
        rule.lines.filter(is_void=False)
        .order_by("-period_end")
        .values_list("period_end", flat=True)
        .first()
    )
    if last_billed and effective_to < last_billed:
        raise BusinessRuleViolation(
            f"This rule has been billed up to {last_billed:%d %b %Y}; it can't end earlier."
        )
    previous = rule.effective_to
    rule.effective_to = effective_to
    _save_rule(rule)
    record_event(
        request,
        "charge_rule.ended",
        target=rule,
        changes={"effective_to": {"from": str(previous), "to": str(effective_to)}},
    )
    return rule


@transaction.atomic
def delete_rule(*, request, rule: ChargeRule) -> None:
    if rule.lines.exists():
        raise BusinessRuleViolation(
            "This rule has been billed and is kept for history. End it instead."
        )
    record_event(request, "charge_rule.deleted", target=rule, metadata={"scope": rule.scope_key})
    rule.delete()
