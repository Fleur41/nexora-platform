"""Billing period arithmetic and daily proration.

Rent and fixed charges are monthly rates. A part-month (move-in, move-out, or a rate
change mid-month) is charged for the days covered: rate × days / days-in-that-month.
Each calendar month is prorated on its own length.
"""

from __future__ import annotations

from calendar import monthrange
from collections.abc import Callable, Iterable
from datetime import date, timedelta
from decimal import Decimal

MONTHS_PER_PERIOD = {"monthly": 1, "quarterly": 3, "semi_annual": 6, "annual": 12}
ONE_DAY = timedelta(days=1)


def month_start(d: date) -> date:
    return d.replace(day=1)


def month_end(d: date) -> date:
    return d.replace(day=monthrange(d.year, d.month)[1])


def add_months(first_of_month: date, n: int) -> date:
    years, month_index = divmod(first_of_month.month - 1 + n, 12)
    return date(first_of_month.year + years, month_index + 1, 1)


def months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


def billing_period(start_date: date, frequency: str, month: date) -> tuple[date, date] | None:
    """The billing period starting in `month` for a lease, or None if `month` doesn't start one.

    Periods are anchored on the lease's first month: a quarterly lease starting in October
    bills October–December, January–March, and so on.
    """
    step = MONTHS_PER_PERIOD[frequency]
    offset = months_between(month_start(start_date), month)
    if offset < 0 or offset % step:
        return None
    return month, month_end(add_months(month, step - 1))


def clip(start: date, end: date, lower: date, upper: date | None) -> tuple[date, date] | None:
    a = max(start, lower)
    b = end if upper is None else min(end, upper)
    return (a, b) if a <= b else None


def prorate(
    rate_on: Callable[[date], Decimal | None],
    change_dates: Iterable[date],
    start: date,
    end: date,
) -> Decimal:
    """Sum a monthly rate over [start, end] (inclusive), unrounded.

    `rate_on(d)` returns the monthly rate in force on day d (None/0 = nothing to charge);
    `change_dates` are days on which the rate may change.
    """
    changes = sorted(set(change_dates))
    total = Decimal("0")
    cursor = month_start(start)
    while cursor <= end:
        a, b = max(start, cursor), min(end, month_end(cursor))
        days_in_month = monthrange(cursor.year, cursor.month)[1]
        cuts = [c for c in changes if a < c <= b]
        for seg_start, seg_end in zip([a, *cuts], [*(c - ONE_DAY for c in cuts), b], strict=True):
            rate = rate_on(seg_start)
            if rate:
                total += Decimal(rate) * ((seg_end - seg_start).days + 1) / days_in_month
        cursor = add_months(cursor, 1)
    return total


def describe_range(start: date, end: date) -> str:
    if start.year == end.year and start.month == end.month:
        if start.day == 1 and end == month_end(end):
            return f"{start:%b %Y}"
        return f"{start.day}–{end.day} {end:%b %Y}"
    return f"{start.day} {start:%b %Y} – {end.day} {end:%b %Y}"
