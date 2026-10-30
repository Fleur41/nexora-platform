"""Documents attached to notification emails, rendered at send time so they're current."""

from __future__ import annotations


def render_attachment(ref: str) -> tuple[str, bytes, str] | None:
    """(filename, content, MIME type) for a reference like "invoice:<id>", or None if the
    document no longer exists."""
    kind, _, pk = ref.partition(":")
    if kind == "invoice":
        from apps.billing.models import Invoice
        from apps.billing.pdf import invoice_filename, invoice_pdf

        invoice = (
            Invoice.objects.select_related("organization", "lease", "tenant", "unit__property")
            .filter(pk=pk)
            .first()
        )
        if invoice is None:
            return None
        return invoice_filename(invoice), invoice_pdf(invoice), "application/pdf"
    if kind == "receipt":
        from apps.payments.models import Payment
        from apps.payments.pdf import receipt_filename, receipt_pdf

        payment = (
            Payment.objects.select_related("organization", "tenant", "lease__unit__property")
            .filter(pk=pk, lease__isnull=False)
            .first()
        )
        if payment is None:
            return None
        return receipt_filename(payment), receipt_pdf(payment), "application/pdf"
    raise ValueError(f"Unknown attachment: {ref}")
