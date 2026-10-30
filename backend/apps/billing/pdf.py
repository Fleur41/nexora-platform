"""An invoice as a PDF: downloaded by staff and tenants, and attached to the invoice email."""

from __future__ import annotations

from django.db.models import Sum

from apps.core.money import ZERO
from apps.core.pdf import Document, Party, money, render

from .models import Invoice, LedgerEntry
from .services import amount_due

Entry = LedgerEntry.EntryType
PAID = (Entry.PAYMENT, Entry.ALLOCATION, Entry.PAYMENT_REVERSAL)


def _day(d) -> str:
    return f"{d:%-d %b %Y}"


def how_to_pay(lease) -> list[str]:
    """The tenant's payment methods, as printed under "How to pay"."""
    from apps.payments.models import PaymentConfiguration
    from apps.payments.services import applicable_configurations

    Provider = PaymentConfiguration.Provider
    account = lease.reference.replace("-", "")
    out = []
    for c in applicable_configurations(lease):
        if c.provider == Provider.MPESA_PAYBILL:
            text = f"M-Pesa paybill {c.shortcode}, account number {account}"
        elif c.provider == Provider.MPESA_TILL:
            text = f"M-Pesa till (Buy Goods) {c.shortcode}"
        elif c.provider == Provider.BANK:
            bank = ", ".join(x for x in (c.bank_name, c.bank_branch) if x)
            text = f"Bank: {bank}. Account {c.account_name} {c.account_number}, reference {account}"
        else:
            text = c.display_name
        if c.instructions:
            text += f". {c.instructions}"
        out.append(text)
    return out


def invoice_pdf(invoice: Invoice) -> bytes:
    lease, currency = invoice.lease, invoice.currency
    void = invoice.status == Invoice.Status.VOID
    lines = invoice.lines.all() if void else invoice.lines.filter(is_void=False)
    entries = invoice.ledger_entries.values("entry_type").annotate(s=Sum("amount"))
    by_type = {r["entry_type"]: r["s"] for r in entries}
    credits = -(by_type.get(Entry.CREDIT) or ZERO)
    paid = -sum((by_type.get(t) or ZERO for t in PAID), ZERO)
    due = amount_due(invoice)

    details = [f"Issued {_day(invoice.issue_date)}", f"Due {_day(invoice.due_date)}"]
    if invoice.period_start and invoice.period_end:
        details.append(f"For {_day(invoice.period_start)} to {_day(invoice.period_end)}")
    totals = [("Total", money(invoice.total, currency), not (credits or paid) and not void)]
    if not void:
        if credits:
            totals.append(("Less credits", money(credits, currency), False))
        if paid:
            totals.append(("Less payments", money(paid, currency), False))
        if credits or paid:
            totals.append(("Amount due", money(due, currency), True))

    sections = []
    if not void and due > 0:
        methods = how_to_pay(lease)
        if methods:
            sections.append(("How to pay", methods))
    if invoice.notes:
        sections.append(("Notes", [invoice.notes]))

    return render(
        Document(
            organization=invoice.organization,
            kind="INVOICE",
            number=invoice.number,
            left=Party(
                "Bill to",
                [
                    invoice.tenant.full_name,
                    f"{invoice.unit.property.name} · Unit {invoice.unit.number}",
                    f"Lease {lease.reference}",
                ],
            ),
            right=Party("Dates", details),
            rows=[(line.description, money(line.amount, currency)) for line in lines],
            totals=totals,
            stamp="VOID" if void else ("PAID" if due <= 0 and invoice.total > 0 else ""),
            stamp_note=f"This invoice was cancelled: {invoice.void_reason}" if void else "",
            sections=sections,
            footer=f"Invoice {invoice.number} · {invoice.tenant.full_name}",
        )
    )


def invoice_filename(invoice: Invoice) -> str:
    return f"{invoice.number}.pdf"
