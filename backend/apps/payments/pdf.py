"""A payment receipt as a PDF: downloaded by staff and tenants, attached to the receipt email."""

from __future__ import annotations

from zoneinfo import ZoneInfo

from django.db.models import Sum
from django.utils import timezone

from apps.billing.services import lease_balance
from apps.core.money import ZERO
from apps.core.pdf import Document, Party, money, render

from .models import Payment
from .services import unallocated


def receipt_pdf(payment: Payment) -> bytes:
    org, lease = payment.organization, payment.lease
    currency = org.currency
    reversed_ = payment.status == Payment.Status.REVERSED
    if reversed_:
        rows = [("Payment (reversed)", money(payment.amount, currency))]
    else:
        rows = [
            (f"Payment towards invoice {a.invoice.number}", money(a.amount, currency))
            for a in payment.allocations.filter(is_reversed=False).select_related("invoice")
        ]
        refunded = payment.refunds.aggregate(s=Sum("amount"))["s"] or ZERO
        if refunded:
            rows.append(("Credit refunded", money(refunded, currency)))
        credit = unallocated(payment)
        if credit:
            rows.append(("Credit carried forward", money(credit, currency)))

    sections = []
    if lease and not reversed_:
        balance = lease_balance(lease)
        sections.append(
            (
                "Your account",
                [
                    f"{money(-balance, currency)} in credit."
                    if balance < 0
                    else f"Balance owed now: {money(balance, currency)}."
                ],
            )
        )

    issued = timezone.localtime(payment.created_at, ZoneInfo(org.timezone))
    by = f" by {payment.created_by.full_name}" if payment.created_by else ""
    how = payment.get_method_display() + (f" · {payment.reference}" if payment.reference else "")
    return render(
        Document(
            organization=org,
            kind="RECEIPT",
            number=payment.receipt_number,
            left=Party(
                "Received from",
                [
                    payment.tenant.full_name,
                    f"{lease.unit.property.name} · Unit {lease.unit.number}",
                    f"Lease {lease.reference}",
                ],
            ),
            right=Party("Date received", [f"{payment.received_on:%-d %b %Y}", how]),
            rows=rows,
            totals=[("Total received", money(payment.amount, currency), True)],
            stamp="REVERSED" if reversed_ else "",
            stamp_note=f"This receipt is no longer valid: {payment.reversal_reason}"
            if reversed_
            else "",
            sections=sections,
            footer=f"Receipt {payment.receipt_number} · issued {issued:%-d %b %Y %H:%M}{by}",
        )
    )


def receipt_filename(payment: Payment) -> str:
    return f"{payment.receipt_number}.pdf"
