from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import IntegrityError, transaction

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.organizations.models import organization_today

from .models import Meter, MeterReading


@transaction.atomic
def create_meter(*, request, organization, unit, utility: str, number: str = "") -> Meter:
    try:
        with transaction.atomic():
            meter = Meter.objects.create(
                organization=organization, unit=unit, utility=utility, number=number
            )
    except IntegrityError as exc:
        raise BusinessRuleViolation(
            "This unit already has an active meter for that utility. Deactivate it first."
        ) from exc
    record_event(request, "meter.created", target=meter)
    return meter


def _check_reading(meter: Meter, reading_date: date, value: Decimal, exclude_pk=None) -> None:
    if reading_date > organization_today(meter.organization):
        raise BusinessRuleViolation("Readings cannot be dated in the future.")
    others = MeterReading.objects.filter(meter=meter)
    if exclude_pk is not None:
        others = others.exclude(pk=exclude_pk)
    if others.filter(reading_date=reading_date).exists():
        raise BusinessRuleViolation(f"This meter already has a reading on {reading_date:%d %b %Y}.")
    before = others.filter(reading_date__lt=reading_date).order_by("-reading_date").first()
    after = others.filter(reading_date__gt=reading_date).order_by("reading_date").first()
    if before is not None and value < before.value:
        raise BusinessRuleViolation(
            f"The reading is lower than the previous one "
            f"({before.value} on {before.reading_date:%d %b %Y})."
        )
    if after is not None and value > after.value:
        raise BusinessRuleViolation(
            f"The reading is higher than the next one "
            f"({after.value} on {after.reading_date:%d %b %Y})."
        )
    if after is not None and after.invoice_line_id:
        raise BusinessRuleViolation(
            "Usage after this date has already been billed, so earlier readings can't be "
            "added or changed."
        )


@transaction.atomic
def record_reading(
    *, request, meter: Meter, reading_date: date, value: Decimal, note: str = "", is_estimate=False
) -> MeterReading:
    meter = Meter.objects.select_for_update().get(pk=meter.pk)
    if not meter.is_active:
        raise BusinessRuleViolation("This meter is inactive.")
    _check_reading(meter, reading_date, value)
    reading = MeterReading.objects.create(
        organization=meter.organization,
        meter=meter,
        reading_date=reading_date,
        value=value,
        note=note,
        is_estimate=is_estimate,
        recorded_by=request.user,
    )
    record_event(
        request,
        "meter.reading_recorded",
        target=meter,
        metadata={"date": str(reading_date), "value": str(value), "estimate": is_estimate},
    )
    return reading


@transaction.atomic
def update_reading(*, request, reading: MeterReading, **fields) -> MeterReading:
    reading = MeterReading.objects.select_for_update().get(pk=reading.pk)
    if reading.invoice_line_id:
        raise BusinessRuleViolation("This reading has been billed and can't be changed.")
    new_date = fields.get("reading_date", reading.reading_date)
    new_value = fields.get("value", reading.value)
    _check_reading(reading.meter, new_date, new_value, exclude_pk=reading.pk)
    changes = {
        k: {"from": str(getattr(reading, k)), "to": str(v)}
        for k, v in fields.items()
        if getattr(reading, k) != v
    }
    for k, v in fields.items():
        setattr(reading, k, v)
    reading.save()
    if changes:
        record_event(request, "meter.reading_updated", target=reading.meter, changes=changes)
    return reading


@transaction.atomic
def delete_reading(*, request, reading: MeterReading) -> None:
    if reading.invoice_line_id:
        raise BusinessRuleViolation("This reading has been billed and can't be deleted.")
    after = (
        MeterReading.objects.filter(meter=reading.meter, reading_date__gt=reading.reading_date)
        .order_by("reading_date")
        .first()
    )
    if after is not None and after.invoice_line_id:
        raise BusinessRuleViolation(
            "The next reading has been billed using this one, so it can't be deleted."
        )
    record_event(
        request,
        "meter.reading_deleted",
        target=reading.meter,
        metadata={"date": str(reading.reading_date), "value": str(reading.value)},
    )
    reading.delete()
