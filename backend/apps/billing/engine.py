"""Work out what each lease should be billed for a month, without saving anything.

`draft_month(organization, month)` returns DraftInvoices. The service layer persists them;
the same drafts power the preview shown before a run is confirmed.

What gets billed for a month:
- Rent and fixed monthly charges for the lease's billing period starting this month
  (prorated by day, following rent terms and charge rules in force on each day).
- One-time charges, once per lease.
- Metered usage from new meter readings taken during the tenancy.
- Shared costs for the month, split evenly between units set up to share them.

Every line carries a dedupe key. Lines whose key is already billed (and not voided) are
dropped, so re-running a month only bills what is new.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_DOWN, Decimal

from apps.core.money import ZERO, quantize
from apps.leases.models import Lease
from apps.organizations.models import organization_today
from apps.utilities.models import MeterReading

from .defaults import ensure_default_charge_types
from .models import ChargeRule, ChargeType, Invoice, InvoiceLine, SharedCost
from .periods import billing_period, clip, describe_range, month_end, prorate
from .rules import RuleBook


@dataclass
class DraftLine:
    charge_type: ChargeType
    description: str
    amount: Decimal
    dedupe_key: str
    quantity: Decimal = Decimal("1")
    unit_price: Decimal | None = None
    period_start: date | None = None
    period_end: date | None = None
    charge_rule: ChargeRule | None = None
    rent_term: object | None = None
    shared_cost: SharedCost | None = None
    readings: list = field(default_factory=list)
    recurring: bool = False  # rent / fixed charges for the billing period


@dataclass
class DraftInvoice:
    lease: Lease
    kind: str
    period_start: date
    period_end: date
    due_date: date
    lines: list[DraftLine]

    @property
    def total(self) -> Decimal:
        return sum((line.amount for line in self.lines), ZERO)


@dataclass
class MonthDraft:
    month: date
    invoices: list[DraftInvoice]
    notes: list[str]


def _occupied_leases(organization, month: date):
    return (
        Lease.objects.filter(
            organization=organization,
            status__in=Lease.OCCUPYING_STATUSES,
            start_date__lte=month_end(month),
        )
        .exclude(ended_on__lt=month)
        .select_related("unit__property", "unit__unit_type", "tenant")
        .prefetch_related("rent_terms")
        .order_by("unit__property__name", "unit__number")
    )


def _readings_by_unit(unit_ids, upto: date):
    by_meter = defaultdict(list)
    for reading in (
        MeterReading.objects.filter(meter__unit_id__in=unit_ids, reading_date__lte=upto)
        .select_related("meter")
        .order_by("reading_date")
    ):
        by_meter[reading.meter].append(reading)
    by_unit = defaultdict(list)
    for meter, readings in by_meter.items():
        by_unit[meter.unit_id].append((meter, readings))
    return by_unit


def _split_evenly(total: Decimal, n: int) -> list[Decimal]:
    """Split into n cent amounts that add up exactly to total (remainder to the first)."""
    base = (total / n).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    remainder_cents = int((total - base * n) * 100)
    return [base + (Decimal("0.01") if i < remainder_cents else ZERO) for i in range(n)]


class _Drafter:
    def __init__(self, organization, month: date):
        self.organization = organization
        self.month = month
        self.month_end = month_end(month)
        self.today = organization_today(organization)
        self.rules = RuleBook(organization)
        self.types = {ct.pk: ct for ct in ensure_default_charge_types(organization)}
        self.rent_type = next(ct for ct in self.types.values() if ct.code == ChargeType.RENT)
        self.notes: list[str] = []

    def _billable(self, charge_type_id, unit, on: date, method: str) -> ChargeRule | None:
        rule = self.rules.resolve(charge_type_id, unit, on)
        if rule is not None and rule.method == method and rule.is_billable:
            return rule
        return None

    # --- per-lease line builders ------------------------------------------------

    def recurring_lines(self, lease: Lease) -> tuple[list[DraftLine], tuple[date, date] | None]:
        period = billing_period(lease.start_date, lease.billing_frequency, self.month)
        if period is None:
            return [], None
        span = clip(*period, lease.start_date, lease.ended_on)
        if span is None:
            return [], period
        a, b = span
        unit = lease.unit
        lines = []

        terms = sorted(lease.rent_terms.all(), key=lambda t: t.effective_from)

        def term_on(d):
            current = None
            for term in terms:
                if term.effective_from <= d:
                    current = term
            return current

        rent = quantize(
            prorate(
                lambda d: (t := term_on(d)) and t.monthly_rent,
                [t.effective_from for t in terms],
                a,
                b,
            )
        )
        if rent > 0:
            lines.append(
                DraftLine(
                    charge_type=self.rent_type,
                    description=f"Rent · {describe_range(a, b)}",
                    amount=rent,
                    unit_price=rent,
                    period_start=a,
                    period_end=b,
                    rent_term=term_on(a),
                    dedupe_key=f"recurring:{lease.pk}:{self.rent_type.pk}:{period[0]}",
                    recurring=True,
                )
            )

        for ct_id in self.rules.charge_type_ids():
            fixed = ChargeRule.Method.FIXED_MONTHLY

            def rate_on(d, ct_id=ct_id, fixed=fixed):
                rule = self._billable(ct_id, unit, d, fixed)
                return rule.amount if rule else None

            amount = quantize(prorate(rate_on, self.rules.change_dates(ct_id), a, b))
            if amount <= 0:
                continue
            charge_type = self.types[ct_id]
            rule = next((r for d in (a, b) if (r := self._billable(ct_id, unit, d, fixed))), None)
            lines.append(
                DraftLine(
                    charge_type=charge_type,
                    description=f"{charge_type.name} · {describe_range(a, b)}",
                    amount=amount,
                    unit_price=amount,
                    period_start=a,
                    period_end=b,
                    charge_rule=rule,
                    dedupe_key=f"recurring:{lease.pk}:{ct_id}:{period[0]}",
                    recurring=True,
                )
            )
        return lines, period

    def one_time_lines(self, lease: Lease, span: tuple[date, date]) -> list[DraftLine]:
        lines = []
        for ct_id in self.rules.charge_type_ids():
            rule = next(
                (
                    r
                    for d in span
                    if (r := self._billable(ct_id, lease.unit, d, ChargeRule.Method.ONE_TIME))
                ),
                None,
            )
            if rule is None:
                continue
            charge_type = self.types[ct_id]
            amount = quantize(rule.amount)
            lines.append(
                DraftLine(
                    charge_type=charge_type,
                    description=charge_type.name,
                    amount=amount,
                    unit_price=amount,
                    charge_rule=rule,
                    dedupe_key=f"once:{lease.pk}:{ct_id}",
                )
            )
        return lines

    def metered_lines(self, lease: Lease, meters) -> list[DraftLine]:
        lines = []
        tenancy_end = lease.ended_on or self.month_end
        for meter, readings in meters:
            charge_types = [ct for ct in self.types.values() if ct.meter_utility == meter.utility]
            quantity, amount, billed, rule_used, charge_type = (
                Decimal("0"),
                Decimal("0"),
                [],
                None,
                None,
            )
            for previous, reading in zip(readings, readings[1:], strict=False):
                # Only usage measured entirely within this tenancy, and not billed before.
                if reading.invoice_line_id or previous.reading_date < lease.start_date:
                    continue
                if reading.reading_date > min(tenancy_end, self.month_end):
                    continue
                consumption = reading.value - previous.value
                if consumption < 0:
                    self.notes.append(
                        f"{lease.unit}: {meter.get_utility_display()} reading on "
                        f"{reading.reading_date} is lower than the previous one; not billed."
                    )
                    continue
                for ct in charge_types:
                    rule = self._billable(
                        ct.pk, lease.unit, reading.reading_date, ChargeRule.Method.METERED
                    )
                    if rule:
                        quantity += consumption
                        amount += consumption * rule.amount
                        billed.append(reading)
                        rule_used, charge_type = rule, ct
                        break
            amount = quantize(amount)
            if not billed or amount <= 0:
                continue
            first = readings[readings.index(billed[0]) - 1]
            unit_label = f" {rule_used.usage_unit}" if rule_used.usage_unit else ""
            lines.append(
                DraftLine(
                    charge_type=charge_type,
                    description=(
                        f"{charge_type.name} usage · {quantity.normalize():f}{unit_label} "
                        f"({describe_range(first.reading_date, billed[-1].reading_date)})"
                    ),
                    amount=amount,
                    quantity=quantity,
                    unit_price=(amount / quantity) if quantity else amount,
                    period_start=first.reading_date,
                    period_end=billed[-1].reading_date,
                    charge_rule=rule_used,
                    readings=billed,
                    dedupe_key=f"meter:{meter.pk}:{billed[-1].pk}",
                )
            )
        return lines

    def shared_allocations(self, leases) -> dict:
        allocations = defaultdict(list)
        for cost in SharedCost.objects.filter(
            organization=self.organization, period=self.month
        ).select_related("charge_type", "property"):
            eligible = []
            for lease in leases:
                if lease.unit.property_id != cost.property_id:
                    continue
                span = clip(self.month, self.month_end, lease.start_date, lease.ended_on)
                if span and self._billable(
                    cost.charge_type_id, lease.unit, span[0], ChargeRule.Method.SHARED
                ):
                    eligible.append(lease)
            if not eligible:
                self.notes.append(
                    f"{cost.charge_type.name} for {cost.property.name} ({cost.period:%b %Y}) was "
                    "not allocated: no occupied unit has a shared rule for this charge."
                )
                continue
            for lease, share in zip(
                eligible, _split_evenly(cost.total_amount, len(eligible)), strict=True
            ):
                allocations[lease.pk].append((cost, share, len(eligible)))
        return allocations

    # --- assembly -------------------------------------------------------------

    def draft(self) -> MonthDraft:
        leases = list(_occupied_leases(self.organization, self.month))
        readings = _readings_by_unit([lease.unit_id for lease in leases], self.month_end)
        shared = self.shared_allocations(leases)

        drafts: list[DraftInvoice] = []
        for lease in leases:
            span = clip(self.month, self.month_end, lease.start_date, lease.ended_on)
            if span is None:
                continue
            recurring, period = self.recurring_lines(lease)
            lines = recurring + self.one_time_lines(lease, span)
            lines += self.metered_lines(lease, readings.get(lease.unit_id, []))
            for cost, share, count in shared.get(lease.pk, []):
                lines.append(
                    DraftLine(
                        charge_type=cost.charge_type,
                        description=(
                            f"{cost.charge_type.name} (shared 1/{count}) · {cost.period:%b %Y}"
                        ),
                        amount=share,
                        unit_price=share,
                        period_start=self.month,
                        period_end=self.month_end,
                        shared_cost=cost,
                        dedupe_key=f"shared:{cost.pk}:{lease.pk}",
                    )
                )
            if lines:
                drafts.append(self._invoice_for(lease, lines, period))

        # Drop anything already billed, then any invoice left empty.
        keys = [line.dedupe_key for d in drafts for line in d.lines]
        billed = set(
            InvoiceLine.objects.filter(
                organization=self.organization, is_void=False, dedupe_key__in=keys
            ).values_list("dedupe_key", flat=True)
        )
        result = []
        for draft in drafts:
            draft.lines = [line for line in draft.lines if line.dedupe_key not in billed]
            if not draft.lines:
                continue
            if not any(line.recurring for line in draft.lines):
                draft.kind = Invoice.Kind.SUPPLEMENTARY
                draft.period_start, draft.period_end = self.month, self.month_end
                draft.due_date = max(draft.due_date, self.today)
            result.append(draft)
        return MonthDraft(month=self.month, invoices=result, notes=self.notes)

    def _invoice_for(self, lease, lines, period) -> DraftInvoice:
        recurring = any(line.recurring for line in lines)
        start, end = period if recurring else (self.month, self.month_end)
        due_day = min(lease.rent_due_day, month_end(start).day)
        due = max(start.replace(day=due_day), lease.start_date)
        return DraftInvoice(
            lease=lease,
            kind=Invoice.Kind.REGULAR if recurring else Invoice.Kind.SUPPLEMENTARY,
            period_start=start,
            period_end=end,
            due_date=due,
            lines=lines,
        )


def draft_month(organization, month: date) -> MonthDraft:
    return _Drafter(organization, month.replace(day=1)).draft()
