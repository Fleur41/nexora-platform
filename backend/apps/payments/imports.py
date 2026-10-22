"""Bank statement import (CSV) for landlords without a bank API integration.

Bank account details alone don't reveal incoming payments; statements do. Each credit row
becomes a payment, matched to a lease when its reference/description contains exactly one
lease reference (e.g. "LSE-0007"), otherwise left unmatched for reconciliation. Every row
gets a fingerprint, so importing the same statement twice creates nothing new.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.leases.models import Lease
from apps.organizations.models import organization_today

from . import services
from .models import Payment, PaymentConfiguration, StatementImport

COLUMNS = {
    "date": ("date", "transaction date", "value date", "posting date", "trans date"),
    "amount": ("amount", "credit", "credit amount", "paid in", "deposit", "money in"),
    "reference": (
        "reference",
        "ref",
        "transaction reference",
        "receipt no",
        "receipt no.",
        "transaction id",
    ),
    "description": ("description", "narration", "details", "particulars", "remarks"),
    "payer": ("payer", "payer name", "name", "from"),
}
DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d", "%d %b %Y")
LEASE_REF = re.compile(r"\bLSE-?(\d{3,})\b", re.IGNORECASE)
MAX_BYTES = 2 * 1024 * 1024


def _columns(header: list[str]) -> dict[str, int]:
    normalized = [h.strip().lower() for h in header]
    found = {}
    for key, names in COLUMNS.items():
        for name in names:
            if name in normalized:
                found[key] = normalized.index(name)
                break
    missing = {"date", "amount"} - set(found)
    if missing:
        raise BusinessRuleViolation(
            f"The file needs {' and '.join(sorted(missing))} columns. Expected headers like: "
            "Date, Amount (or Credit), Reference, Description."
        )
    return found


def _parse_date(value: str) -> date | None:
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _parse_amount(value: str) -> Decimal | None:
    cleaned = re.sub(r"[^\d.\-]", "", value or "")
    if not cleaned:
        return None
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _match(organization, text: str):
    numbers = {m.group(1) for m in LEASE_REF.finditer(text or "")}
    if len(numbers) != 1:
        return None
    number = numbers.pop()
    return Lease.objects.filter(
        organization=organization,
        reference__iregex=rf"^LSE-0*{int(number)}$",
        status__in=Lease.OCCUPYING_STATUSES,
    ).first()


@transaction.atomic
def import_statement(*, request, config: PaymentConfiguration, upload) -> StatementImport:
    if config.provider != PaymentConfiguration.Provider.BANK:
        raise BusinessRuleViolation(
            "Statements can only be imported into a bank account payment method."
        )
    if upload.size > MAX_BYTES:
        raise BusinessRuleViolation("Statement files must be 2 MB or smaller.")
    raw = upload.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 2:
        raise BusinessRuleViolation("The file has no transactions.")
    if len(rows) - 1 > settings.STATEMENT_IMPORT_MAX_ROWS:
        raise BusinessRuleViolation(
            f"Import at most {settings.STATEMENT_IMPORT_MAX_ROWS} rows at a time."
        )
    cols = _columns(rows[0])
    organization = config.organization
    today = organization_today(organization)
    batch = StatementImport.objects.create(
        organization=organization,
        configuration=config,
        file_name=upload.name[:255],
        created_by=request.user,
    )

    def cell(row, key):
        index = cols.get(key)
        return row[index].strip() if index is not None and index < len(row) else ""

    for line_no, row in enumerate(rows[1:], start=2):
        if not any(c.strip() for c in row):
            continue
        batch.rows_total += 1
        when, amount = _parse_date(cell(row, "date")), _parse_amount(cell(row, "amount"))
        if when is None or amount is None:
            batch.errors.append(f"Row {line_no}: unreadable date or amount.")
            batch.rows_skipped += 1
            continue
        if amount <= 0 or when > today:
            batch.rows_skipped += 1  # debits, zero rows and future-dated rows are not payments
            continue
        reference, description = cell(row, "reference"), cell(row, "description")
        fingerprint = hashlib.sha256(
            f"{config.pk}|{when.isoformat()}|{amount:.2f}|{reference}|{description}".encode()
        ).hexdigest()
        if Payment.objects.filter(
            organization=organization, source=Payment.Source.BANK_IMPORT, external_id=fingerprint
        ).exists():
            batch.rows_duplicate += 1
            continue
        lease = _match(organization, f"{reference} {description}")
        try:
            with transaction.atomic():
                services.record_payment(
                    request=request,
                    organization=organization,
                    amount=amount,
                    received_on=when,
                    method=config.method,
                    lease=lease,
                    configuration=config,
                    reference=reference,
                    external_id=fingerprint,
                    payer_name=cell(row, "payer"),
                    account_reference=description[:64],
                    notes=description,
                    source=Payment.Source.BANK_IMPORT,
                    statement_import=batch,
                )
        except BusinessRuleViolation as exc:
            batch.errors.append(f"Row {line_no}: {exc.detail}")
            batch.rows_duplicate += 1
            continue
        batch.rows_created += 1
        batch.rows_matched += 1 if lease else 0
    batch.errors = batch.errors[:100]
    batch.save()
    record_event(
        request,
        "payment.statement_imported",
        target=batch,
        metadata={
            "created": batch.rows_created,
            "matched": batch.rows_matched,
            "duplicates": batch.rows_duplicate,
        },
    )
    return batch
