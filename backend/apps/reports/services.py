"""Financial and occupancy reports.

Every report returns the same shape, so one exporter can render any of them:

    {key, title, subtitle, organization, currency, period: {start, end, label}, property,
     summary: [{label, value, kind}], sections: [{title, note, columns, rows, totals}],
     chart: [{label, billed, collected}] (optional)}

Column kinds: text, date, money, number, percent. Money values are strings ("1234.50").

Figures come from posted records only: issued invoices and their credits, completed payments,
deposit transactions and recorded maintenance costs. A member who doesn't cover the whole
organization only ever sees the properties they're assigned to.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Max, Q, Sum
from django.db.models.functions import Coalesce

from apps.billing.models import IncomeCategory, Invoice, InvoiceLine, LedgerEntry
from apps.billing.periods import month_end, month_start
from apps.core.money import ZERO, quantize
from apps.deposits.models import DepositTransaction
from apps.leases.models import Lease
from apps.maintenance.models import MaintenanceCost
from apps.organizations.models import organization_today
from apps.payments.models import Payment, PaymentMethod
from apps.properties.models import Property, Unit

MAX_DAYS = 366 * 3


@dataclass
class Scope:
    organization: object
    properties: object  # QuerySet[Property]
    property: Property | None  # a single property filter, if any
    org_wide: bool  # sees the whole organization and isn't filtered to one property
    start: date
    end: date
    can_see_costs: bool

    @property
    def property_ids(self):
        return self.properties.values("pk")


def _money(v) -> str:
    return str(quantize(v or ZERO))


def _col(key, label, kind="text"):
    return {"key": key, "label": label, "kind": kind}


def _pct(part: Decimal, whole: Decimal) -> str | None:
    if not whole:
        return None
    return str((Decimal(100) * part / whole).quantize(Decimal("0.1")))


def period_label(start: date, end: date) -> str:
    if start.day == 1 and end == month_end(start) and start.month == end.month:
        return f"{start:%B %Y}"
    if start == date(start.year, 1, 1) and end == date(start.year, 12, 31):
        return str(start.year)
    return f"{start:%d %b %Y} – {end:%d %b %Y}"


def _envelope(scope: Scope, key: str, title: str, subtitle: str) -> dict:
    org = scope.organization
    return {
        "key": key,
        "title": title,
        "subtitle": subtitle,
        "organization": org.name,
        "currency": org.currency,
        "period": {
            "start": str(scope.start),
            "end": str(scope.end),
            "label": period_label(scope.start, scope.end),
        },
        "property": scope.property.name if scope.property else None,
        "summary": [],
        "sections": [],
    }


def _months(start: date, end: date):
    current = month_start(start)
    while current <= end:
        yield current
        current = (current + timedelta(days=32)).replace(day=1)


# --- shared calculations ------------------------------------------------------------------


def _billed_lines(scope: Scope, start: date, end: date):
    """Live lines of issued invoices whose income falls in [start, end].

    Income is dated by the period a line bills for (so September's rent counts in September
    even if it was invoiced in October); lines without a period use the invoice's issue date.
    """
    return (
        InvoiceLine.objects.filter(
            invoice__organization=scope.organization,
            invoice__status=Invoice.Status.ISSUED,
            invoice__unit__property__in=scope.property_ids,
            is_void=False,
        )
        .annotate(income_date=Coalesce("period_start", "invoice__issue_date"))
        .filter(income_date__range=(start, end))
    )


def _credits(scope: Scope, start: date, end: date):
    """Credits given in [start, end] (negative ledger entries against invoices)."""
    return LedgerEntry.objects.filter(
        organization=scope.organization,
        entry_type=LedgerEntry.EntryType.CREDIT,
        effective_date__range=(start, end),
        lease__unit__property__in=scope.property_ids,
    ).select_related("invoice")


def _billed_by_category(scope: Scope, start: date, end: date) -> dict[str, dict[str, Decimal]]:
    """Invoiced and credited amounts per income category.

    Credits are apportioned across the credited invoice's categories in proportion to its lines.
    """
    result = {c: {"invoiced": ZERO, "credits": ZERO} for c in IncomeCategory.values}
    for row in _billed_lines(scope, start, end).values("income_category").annotate(s=Sum("amount")):
        result[row["income_category"]]["invoiced"] += row["s"] or ZERO

    for credit in _credits(scope, start, end):
        split = list(
            InvoiceLine.objects.filter(invoice=credit.invoice, is_void=False)
            .values("income_category")
            .annotate(s=Sum("amount"))
        )
        total = sum((r["s"] for r in split), ZERO)
        amount = -credit.amount  # credits are negative ledger entries
        if not total:
            result[IncomeCategory.OTHER_INCOME]["credits"] += amount
            continue
        for r in split:
            result[r["income_category"]]["credits"] += amount * r["s"] / total
    return result


def _payments(scope: Scope, start: date, end: date):
    lease_scope = Q(lease__unit__property__in=scope.property_ids)
    if scope.org_wide:
        lease_scope |= Q(lease__isnull=True)  # not matched to a tenant yet
    return Payment.objects.filter(
        lease_scope,
        organization=scope.organization,
        status=Payment.Status.COMPLETED,
        received_on__range=(start, end),
    )


def _ledger_balances(scope: Scope, on: date) -> dict:
    """Ledger balance per lease on a date: positive = owed, negative = credit held."""
    rows = (
        LedgerEntry.objects.filter(
            organization=scope.organization,
            effective_date__lte=on,
            lease__unit__property__in=scope.property_ids,
        )
        .values("lease")
        .annotate(s=Sum("amount"))
    )
    return {r["lease"]: r["s"] or ZERO for r in rows}


def _deposit_totals(scope: Scope, start: date | None, end: date, lease_ids=None) -> dict:
    """Received, deducted and refunded per lease for transactions dated in [start, end]."""
    txs = DepositTransaction.objects.filter(
        organization=scope.organization,
        transaction_date__lte=end,
        lease__unit__property__in=scope.property_ids,
    ).select_related("reverses")
    if start is not None:
        txs = txs.filter(transaction_date__gte=start)
    if lease_ids is not None:
        txs = txs.filter(lease__in=lease_ids)
    totals: dict = defaultdict(lambda: {"received": ZERO, "deduction": ZERO, "refund": ZERO})
    for tx in txs:
        if tx.kind == DepositTransaction.Kind.REVERSAL:
            totals[tx.lease_id][tx.reverses.kind] -= tx.amount
        else:
            totals[tx.lease_id][tx.kind] += tx.amount
    return totals


def _held(t: dict) -> Decimal:
    return t["received"] - t["deduction"] - t["refund"]


def _expenses(scope: Scope):
    in_period = Q(incurred_on__range=(scope.start, scope.end)) | Q(
        incurred_on__isnull=True, created_at__date__range=(scope.start, scope.end)
    )
    return MaintenanceCost.objects.filter(
        in_period,
        organization=scope.organization,
        kind=MaintenanceCost.Kind.EXPENSE,
        request__unit__property__in=scope.property_ids,
    ).select_related("request__unit__property")


# --- reports ----------------------------------------------------------------------------


def financial_summary(scope: Scope) -> dict:
    report = _envelope(
        scope,
        "financial-summary",
        "Financial summary",
        "What was billed and received, maintenance spending, deposits and arrears.",
    )
    by_category = _billed_by_category(scope, scope.start, scope.end)
    income_rows, gross, credits = [], ZERO, ZERO
    for key, label in IncomeCategory.choices:
        c = by_category[key]
        if not c["invoiced"] and not c["credits"]:
            continue
        gross += c["invoiced"]
        credits += c["credits"]
        income_rows.append(
            {
                "category": label,
                "invoiced": _money(c["invoiced"]),
                "credits": _money(c["credits"]),
                "net": _money(c["invoiced"] - c["credits"]),
            }
        )
    net_billed = gross - credits

    payments = _payments(scope, scope.start, scope.end)
    received = defaultdict(lambda: [0, ZERO])
    labels = dict(PaymentMethod.choices)
    for p in payments.only("method", "source", "lease_id", "amount"):
        if p.lease_id is None:
            key = "Not yet matched to a tenant"
        elif p.source == Payment.Source.DEPOSIT:
            key = "Deposit applied to arrears"
        else:
            key = labels.get(p.method, p.method)
        received[key][0] += 1
        received[key][1] += p.amount
    collected = sum((v[1] for v in received.values()), ZERO)
    matched = collected - received.get("Not yet matched to a tenant", [0, ZERO])[1]

    balances = _ledger_balances(scope, scope.end)
    arrears = sum((b for b in balances.values() if b > 0), ZERO)
    credit_held = -sum((b for b in balances.values() if b < 0), ZERO)

    deposits_before = _deposit_totals(scope, None, scope.start - timedelta(days=1))
    deposits_during = _deposit_totals(scope, scope.start, scope.end)
    held_start = sum((_held(t) for t in deposits_before.values()), ZERO)
    during = {
        k: sum((t[k] for t in deposits_during.values()), ZERO)
        for k in ("received", "deduction", "refund")
    }
    held_end = held_start + during["received"] - during["deduction"] - during["refund"]

    report["summary"] = [
        {"label": "Net billed", "value": _money(net_billed), "kind": "money"},
        {"label": "Received", "value": _money(collected), "kind": "money"},
        {"label": "Collection rate", "value": _pct(matched, net_billed), "kind": "percent"},
        {"label": "Owed at period end", "value": _money(arrears), "kind": "money"},
        {"label": "Deposits held at period end", "value": _money(held_end), "kind": "money"},
    ]
    report["sections"].append(
        {
            "title": "Income billed",
            "note": "Amounts billed for the period by income category (rent for September "
            "counts in September, whenever it was invoiced), less credits given in the period. "
            "Deposits are never income.",
            "columns": [
                _col("category", "Category"),
                _col("invoiced", "Invoiced", "money"),
                _col("credits", "Credits", "money"),
                _col("net", "Net billed", "money"),
            ],
            "rows": income_rows,
            "totals": {
                "category": "Total",
                "invoiced": _money(gross),
                "credits": _money(credits),
                "net": _money(net_billed),
            },
        }
    )
    report["sections"].append(
        {
            "title": "Money received",
            "note": "Completed payments received in the period. Reversed payments are excluded.",
            "columns": [
                _col("method", "How it was paid"),
                _col("count", "Payments", "number"),
                _col("amount", "Amount", "money"),
            ],
            "rows": [
                {"method": k, "count": v[0], "amount": _money(v[1])}
                for k, v in sorted(received.items(), key=lambda kv: -kv[1][1])
            ],
            "totals": {
                "method": "Total",
                "count": sum(v[0] for v in received.values()),
                "amount": _money(collected),
            },
        }
    )
    if scope.can_see_costs:
        spent = defaultdict(lambda: ZERO)
        for cost in _expenses(scope):
            spent[cost.request.unit.property.name] += cost.amount
        total_spent = sum(spent.values(), ZERO)
        report["summary"].insert(
            3, {"label": "Maintenance costs", "value": _money(total_spent), "kind": "money"}
        )
        report["sections"].append(
            {
                "title": "Maintenance costs",
                "note": "Costs recorded on repairs (not quotations), by property.",
                "columns": [_col("property", "Property"), _col("amount", "Spent", "money")],
                "rows": [{"property": k, "amount": _money(v)} for k, v in sorted(spent.items())],
                "totals": {"property": "Total", "amount": _money(total_spent)},
            }
        )
    report["sections"].append(
        {
            "title": "Deposits and balances",
            "note": "Deposits are held for tenants and kept apart from income.",
            "columns": [_col("item", "Item"), _col("amount", "Amount", "money")],
            "rows": [
                {"item": "Deposits held at start", "amount": _money(held_start)},
                {"item": "Deposits received", "amount": _money(during["received"])},
                {
                    "item": "Deposits deducted (damages, arrears)",
                    "amount": _money(during["deduction"]),
                },
                {"item": "Deposits refunded", "amount": _money(during["refund"])},
                {"item": "Deposits held at end", "amount": _money(held_end)},
                {"item": "Owed by tenants at end", "amount": _money(arrears)},
                {"item": "Credit held for tenants at end", "amount": _money(credit_held)},
            ],
            "totals": None,
        }
    )
    report["chart"] = monthly_chart(scope)
    return report


def monthly_chart(scope: Scope) -> list[dict]:
    """Net billed and received for each month of the period."""
    points = []
    for m in _months(scope.start, scope.end):
        a, b = max(m, scope.start), min(month_end(m), scope.end)
        by_category = _billed_by_category(scope, a, b)
        billed = sum((c["invoiced"] - c["credits"] for c in by_category.values()), ZERO)
        received = _payments(scope, a, b).aggregate(s=Sum("amount"))["s"] or ZERO
        points.append(
            {
                "label": f"{m:%b %Y}",
                "month": f"{m:%Y-%m}",
                "billed": _money(billed),
                "collected": _money(received),
            }
        )
    return points


def _leases_in_period(scope: Scope):
    return (
        Lease.objects.filter(
            organization=scope.organization,
            unit__property__in=scope.property_ids,
            status__in=Lease.OCCUPYING_STATUSES,
            start_date__lte=scope.end,
        )
        .filter(Q(ended_on__isnull=True) | Q(ended_on__gte=scope.start))
        .select_related("tenant", "unit__property")
        .prefetch_related("rent_terms")
        .order_by("unit__property__name", "unit__number")
    )


def rent_roll(scope: Scope) -> dict:
    report = _envelope(
        scope,
        "rent-roll",
        "Rent roll",
        "Every tenancy in the period with its rent, what was billed and paid, and the balance.",
    )
    leases = list(_leases_in_period(scope))
    ids = [lease.pk for lease in leases]
    billed = defaultdict(lambda: ZERO)
    lines = _billed_lines(scope, scope.start, scope.end).filter(invoice__lease__in=ids)
    for r in lines.values("invoice__lease").annotate(s=Sum("amount")):
        billed[r["invoice__lease"]] += r["s"] or ZERO
    for credit in _credits(scope, scope.start, scope.end).filter(lease__in=ids):
        billed[credit.lease_id] += credit.amount  # negative
    paid = defaultdict(lambda: ZERO)
    for r in (
        Payment.objects.filter(
            lease__in=ids,
            status=Payment.Status.COMPLETED,
            received_on__range=(scope.start, scope.end),
        )
        .values("lease")
        .annotate(s=Sum("amount"))
    ):
        paid[r["lease"]] = r["s"] or ZERO
    balances = _ledger_balances(scope, scope.end)
    deposits = _deposit_totals(scope, None, scope.end, lease_ids=ids)

    rows, totals = [], defaultdict(lambda: ZERO)
    for lease in leases:
        on = min(scope.end, lease.ended_on) if lease.ended_on else scope.end
        terms = [t for t in lease.rent_terms.all() if t.effective_from <= on]
        rent = max(terms, key=lambda t: t.effective_from).monthly_rent if terms else ZERO
        values = {
            "rent": rent,
            "billed": billed[lease.pk],
            "paid": paid[lease.pk],
            "balance": balances.get(lease.pk, ZERO),
            "deposit": _held(deposits[lease.pk]),
        }
        for k, v in values.items():
            totals[k] += v
        rows.append(
            {
                "property": lease.unit.property.name,
                "unit": lease.unit.number,
                "tenant": lease.tenant.full_name,
                "lease": lease.reference,
                "status": "Ended" if lease.status == Lease.Status.ENDED else "Active",
                "start": str(lease.start_date),
                **{k: _money(v) for k, v in values.items()},
            }
        )
    report["summary"] = [
        {"label": "Tenancies", "value": str(len(rows)), "kind": "number"},
        {"label": "Monthly rent (current)", "value": _money(totals["rent"]), "kind": "money"},
        {"label": "Billed in period", "value": _money(totals["billed"]), "kind": "money"},
        {"label": "Paid in period", "value": _money(totals["paid"]), "kind": "money"},
        {"label": "Balance at end", "value": _money(totals["balance"]), "kind": "money"},
    ]
    report["sections"].append(
        {
            "title": "Tenancies",
            "note": "Billed is net of credits. A negative balance is credit held for the tenant.",
            "columns": [
                _col("property", "Property"),
                _col("unit", "Unit"),
                _col("tenant", "Tenant"),
                _col("lease", "Lease"),
                _col("status", "Status"),
                _col("start", "Start", "date"),
                _col("rent", "Rent", "money"),
                _col("billed", "Billed", "money"),
                _col("paid", "Paid", "money"),
                _col("balance", "Balance", "money"),
                _col("deposit", "Deposit held", "money"),
            ],
            "rows": rows,
            "totals": {
                "property": "Total",
                **{k: _money(totals[k]) for k in ("rent", "billed", "paid", "balance", "deposit")},
            },
        }
    )
    return report


BUCKETS = [
    ("current", "Not yet due", None, 0),
    ("d30", "1–30 days", 1, 30),
    ("d60", "31–60 days", 31, 60),
    ("d90", "61–90 days", 61, 90),
    ("d90plus", "Over 90 days", 91, None),
]


def arrears(scope: Scope) -> dict:
    """Aged amounts owed, as of today (unpaid invoices by how long they are past due)."""
    from apps.billing.views import with_amount_due

    today = organization_today(scope.organization)
    report = _envelope(
        scope,
        "arrears",
        "Arrears",
        f"Unpaid invoices by how long they are overdue, as of {today:%d %b %Y}.",
    )
    report["period"] = {"start": str(today), "end": str(today), "label": f"As of {today:%d %b %Y}"}
    invoices = (
        with_amount_due(
            Invoice.objects.filter(
                organization=scope.organization,
                status=Invoice.Status.ISSUED,
                unit__property__in=scope.property_ids,
            )
        )
        .filter(amount_due__gt=0)
        .select_related("lease", "tenant", "unit__property")
    )
    per_lease: dict = {}
    for inv in invoices:
        row = per_lease.setdefault(
            inv.lease_id,
            {
                "property": inv.unit.property.name,
                "unit": inv.unit.number,
                "tenant": inv.tenant.full_name,
                "phone": inv.tenant.phone,
                "lease": inv.lease.reference,
                "oldest_due": inv.due_date,
                **{b[0]: ZERO for b in BUCKETS},
            },
        )
        late = (today - inv.due_date).days
        for key, _, low, high in BUCKETS:
            if (low is None and late < 1) or (
                low is not None and late >= low and (high is None or late <= high)
            ):
                row[key] += inv.amount_due
                break
        row["oldest_due"] = min(row["oldest_due"], inv.due_date)
    rows = sorted(per_lease.values(), key=lambda r: r["oldest_due"])
    totals = {b[0]: sum((r[b[0]] for r in rows), ZERO) for b in BUCKETS}
    for r in rows:
        r["total"] = sum((r[b[0]] for b in BUCKETS), ZERO)
    grand = sum(totals.values(), ZERO)
    overdue = grand - totals["current"]
    out_rows = [
        {
            **{
                k: v
                for k, v in r.items()
                if k not in {b[0] for b in BUCKETS} | {"total", "oldest_due"}
            },
            "oldest_due": str(r["oldest_due"]),
            **{b[0]: _money(r[b[0]]) for b in BUCKETS},
            "total": _money(r["total"]),
        }
        for r in rows
    ]
    report["summary"] = [
        {"label": "Total owed", "value": _money(grand), "kind": "money"},
        {"label": "Overdue", "value": _money(overdue), "kind": "money"},
        {"label": "Over 90 days", "value": _money(totals["d90plus"]), "kind": "money"},
        {
            "label": "Tenancies in arrears",
            "value": str(sum(1 for r in rows if r["total"] - r["current"] > 0)),
            "kind": "number",
        },
    ]
    report["sections"].append(
        {
            "title": "Amounts owed by age",
            "note": "Each unpaid invoice is placed by how many days it is past its due date.",
            "columns": [
                _col("property", "Property"),
                _col("unit", "Unit"),
                _col("tenant", "Tenant"),
                _col("phone", "Phone"),
                _col("oldest_due", "Oldest due", "date"),
                *[_col(key, label, "money") for key, label, _, _ in BUCKETS],
                _col("total", "Total", "money"),
            ],
            "rows": out_rows,
            "totals": {
                "property": "Total",
                **{k: _money(v) for k, v in totals.items()},
                "total": _money(grand),
            },
        }
    )
    return report


OCCUPIED = {Unit.Status.OCCUPIED, Unit.Status.NOTICE_SUBMITTED}


def occupancy(scope: Scope) -> dict:
    report = _envelope(
        scope,
        "occupancy",
        "Occupancy",
        "Units by status today, and how much of the period units were let.",
    )
    days = (scope.end - scope.start).days + 1
    units = list(
        Unit.objects.filter(organization=scope.organization, property__in=scope.property_ids)
        .select_related("property", "unit_type")
        .order_by("property__name", "number")
    )
    leases = Lease.objects.filter(
        organization=scope.organization,
        unit__in=[u.pk for u in units],
        status__in=Lease.OCCUPYING_STATUSES,
        start_date__lte=scope.end,
    ).filter(Q(ended_on__isnull=True) | Q(ended_on__gte=scope.start))
    let_days = defaultdict(int)
    for lease in leases:
        a = max(lease.start_date, scope.start)
        b = min(lease.ended_on or scope.end, scope.end)
        let_days[lease.unit_id] += max((b - a).days + 1, 0)

    per_property: dict = {}
    for u in units:
        p = per_property.setdefault(
            u.property_id,
            {
                "property": u.property.name,
                "units": 0,
                "lettable": 0,
                "occupied": 0,
                "vacant": 0,
                "other": 0,
                "let_days": 0,
            },
        )
        p["units"] += 1
        if u.status == Unit.Status.UNAVAILABLE:
            continue
        p["lettable"] += 1
        p["let_days"] += min(let_days[u.pk], days)
        if u.status in OCCUPIED:
            p["occupied"] += 1
        elif u.status == Unit.Status.AVAILABLE:
            p["vacant"] += 1
        else:
            p["other"] += 1

    rows, t = [], defaultdict(int)
    for p in per_property.values():
        for k in ("units", "lettable", "occupied", "vacant", "other", "let_days"):
            t[k] += p[k]
        rows.append(
            {
                **{
                    k: p[k]
                    for k in ("property", "units", "lettable", "occupied", "vacant", "other")
                },
                "occupancy_now": _pct(Decimal(p["occupied"]), Decimal(p["lettable"])),
                "occupancy_period": _pct(Decimal(p["let_days"]), Decimal(p["lettable"] * days)),
            }
        )
    now = _pct(Decimal(t["occupied"]), Decimal(t["lettable"]))
    period = _pct(Decimal(t["let_days"]), Decimal(t["lettable"] * days))
    report["summary"] = [
        {"label": "Units", "value": str(t["units"]), "kind": "number"},
        {"label": "Occupied now", "value": str(t["occupied"]), "kind": "number"},
        {"label": "Vacant now", "value": str(t["vacant"]), "kind": "number"},
        {"label": "Occupancy now", "value": now, "kind": "percent"},
        {"label": "Occupancy over the period", "value": period, "kind": "percent"},
    ]
    report["sections"].append(
        {
            "title": "By property",
            "note": "Unavailable units are excluded from occupancy. Occupancy over the period is "
            "the share of days lettable units were under a lease. 'Other' is reserved, awaiting "
            "inspection or under maintenance.",
            "columns": [
                _col("property", "Property"),
                _col("units", "Units", "number"),
                _col("lettable", "Lettable", "number"),
                _col("occupied", "Occupied", "number"),
                _col("vacant", "Vacant", "number"),
                _col("other", "Other", "number"),
                _col("occupancy_now", "Occupancy now", "percent"),
                _col("occupancy_period", "Over the period", "percent"),
            ],
            "rows": rows,
            "totals": {
                "property": "Total",
                **{k: t[k] for k in ("units", "lettable", "occupied", "vacant", "other")},
                "occupancy_now": now,
                "occupancy_period": period,
            },
        }
    )
    vacant = [u for u in units if u.status == Unit.Status.AVAILABLE]
    last_ended = {
        r["unit"]: r["last"]
        for r in Lease.objects.filter(unit__in=[u.pk for u in vacant], ended_on__isnull=False)
        .values("unit")
        .annotate(last=Max("ended_on"))
    }
    today = organization_today(scope.organization)
    report["sections"].append(
        {
            "title": "Vacant units",
            "note": "Available to let today. 'Vacant since' is the day after the last lease ended.",
            "columns": [
                _col("property", "Property"),
                _col("unit", "Unit"),
                _col("type", "Type"),
                _col("rent", "Asking rent", "money"),
                _col("since", "Vacant since", "date"),
                _col("days", "Days vacant", "number"),
            ],
            "rows": [
                {
                    "property": u.property.name,
                    "unit": u.number,
                    "type": u.unit_type.name,
                    "rent": _money(u.market_rent),
                    "since": str(last_ended[u.pk] + timedelta(days=1))
                    if u.pk in last_ended
                    else None,
                    "days": (today - last_ended[u.pk]).days if u.pk in last_ended else None,
                }
                for u in vacant
            ],
            "totals": None,
        }
    )
    return report


def deposits(scope: Scope) -> dict:
    report = _envelope(
        scope,
        "deposits",
        "Deposits",
        "Deposits held for tenants at the end of the period. They are owed back, not income.",
    )
    leases = list(
        Lease.objects.filter(
            organization=scope.organization,
            unit__property__in=scope.property_ids,
            status__in=Lease.OCCUPYING_STATUSES,
            start_date__lte=scope.end,
        )
        .select_related("tenant", "unit__property")
        .order_by("unit__property__name", "unit__number")
    )
    totals_by_lease = _deposit_totals(
        scope, None, scope.end, lease_ids=[lease.pk for lease in leases]
    )
    rows, t = [], defaultdict(lambda: ZERO)
    for lease in leases:
        d = totals_by_lease[lease.pk]
        if not lease.deposit_amount and not any(d.values()):
            continue
        held = _held(d)
        outstanding = (
            max(lease.deposit_amount - d["received"], ZERO)
            if lease.status == Lease.Status.ACTIVE
            else ZERO
        )
        values = {"agreed": lease.deposit_amount, **d, "held": held, "outstanding": outstanding}
        for k, v in values.items():
            t[k] += v
        rows.append(
            {
                "property": lease.unit.property.name,
                "unit": lease.unit.number,
                "tenant": lease.tenant.full_name,
                "lease": lease.reference,
                "status": "Ended" if lease.status == Lease.Status.ENDED else "Active",
                "agreed": _money(values["agreed"]),
                "received": _money(values["received"]),
                "deducted": _money(values["deduction"]),
                "refunded": _money(values["refund"]),
                "held": _money(held),
                "outstanding": _money(outstanding),
            }
        )
    report["summary"] = [
        {"label": "Held for tenants", "value": _money(t["held"]), "kind": "money"},
        {"label": "Still to collect", "value": _money(t["outstanding"]), "kind": "money"},
        {"label": "Deducted to date", "value": _money(t["deduction"]), "kind": "money"},
        {"label": "Refunded to date", "value": _money(t["refund"]), "kind": "money"},
    ]
    report["sections"].append(
        {
            "title": "Deposits by tenancy",
            "note": "Totals to the end of the period.",
            "columns": [
                _col("property", "Property"),
                _col("unit", "Unit"),
                _col("tenant", "Tenant"),
                _col("lease", "Lease"),
                _col("status", "Status"),
                _col("agreed", "Agreed", "money"),
                _col("received", "Received", "money"),
                _col("deducted", "Deducted", "money"),
                _col("refunded", "Refunded", "money"),
                _col("held", "Held", "money"),
                _col("outstanding", "To collect", "money"),
            ],
            "rows": rows,
            "totals": {
                "property": "Total",
                "agreed": _money(t["agreed"]),
                "received": _money(t["received"]),
                "deducted": _money(t["deduction"]),
                "refunded": _money(t["refund"]),
                "held": _money(t["held"]),
                "outstanding": _money(t["outstanding"]),
            },
        }
    )
    return report


def maintenance_costs(scope: Scope) -> dict:
    report = _envelope(
        scope,
        "maintenance-costs",
        "Maintenance costs",
        "Money spent on repairs in the period, per repair.",
    )
    costs = list(_expenses(scope).order_by("incurred_on", "created_at"))
    total = sum((c.amount for c in costs), ZERO)
    per_property = defaultdict(lambda: ZERO)
    for c in costs:
        per_property[c.request.unit.property.name] += c.amount
    report["summary"] = [
        {"label": "Spent", "value": _money(total), "kind": "money"},
        {"label": "Costs recorded", "value": str(len(costs)), "kind": "number"},
        {"label": "Repairs", "value": str(len({c.request_id for c in costs})), "kind": "number"},
    ]
    report["sections"].append(
        {
            "title": "Costs",
            "note": "Costs recorded on repairs. Quotations aren't counted until the work is paid.",
            "columns": [
                _col("date", "Date", "date"),
                _col("property", "Property"),
                _col("unit", "Unit"),
                _col("request", "Repair"),
                _col("description", "Description"),
                _col("supplier", "Supplier"),
                _col("amount", "Amount", "money"),
            ],
            "rows": [
                {
                    "date": str(c.incurred_on or c.created_at.date()),
                    "property": c.request.unit.property.name,
                    "unit": c.request.unit.number,
                    "request": f"{c.request.reference} · {c.request.title}",
                    "description": c.description,
                    "supplier": c.supplier_name,
                    "amount": _money(c.amount),
                }
                for c in costs
            ],
            "totals": {"date": "Total", "amount": _money(total)},
        }
    )
    report["sections"].append(
        {
            "title": "By property",
            "note": "",
            "columns": [_col("property", "Property"), _col("amount", "Spent", "money")],
            "rows": [{"property": k, "amount": _money(v)} for k, v in sorted(per_property.items())],
            "totals": {"property": "Total", "amount": _money(total)},
        }
    )
    return report


REPORTS = {
    "financial-summary": financial_summary,
    "rent-roll": rent_roll,
    "arrears": arrears,
    "occupancy": occupancy,
    "deposits": deposits,
    "maintenance-costs": maintenance_costs,
}
# Reports that need more than reports.view.
EXTRA_CAPABILITY = {"maintenance-costs": "maintenance.costs"}
