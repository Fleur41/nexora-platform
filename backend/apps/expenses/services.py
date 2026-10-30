from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.core.models import next_reference
from apps.organizations.models import organization_today

from .models import Expense


def _check(*, membership, organization, property_, unit, incurred_on) -> None:
    if incurred_on > organization_today(organization):
        raise BusinessRuleViolation("Expenses cannot be dated in the future.")
    if property_ is None and not membership.has_organization_scope:
        raise BusinessRuleViolation(
            "Choose a property. Only members who cover the whole organization can record "
            "organization-wide expenses."
        )
    if unit is not None and (property_ is None or unit.property_id != property_.pk):
        raise BusinessRuleViolation("The unit belongs to a different property.")


@transaction.atomic
def create_expense(*, request, organization, **fields) -> Expense:
    _check(
        membership=request.membership,
        organization=organization,
        property_=fields.get("property"),
        unit=fields.get("unit"),
        incurred_on=fields["incurred_on"],
    )
    expense = Expense.objects.create(
        organization=organization,
        reference=next_reference(organization, "expense", "EXP"),
        created_by=request.user,
        **fields,
    )
    record_event(
        request,
        "expense.recorded",
        target=expense,
        metadata={
            "amount": str(expense.amount),
            "category": expense.category,
            "incurred_on": str(expense.incurred_on),
        },
    )
    return expense


@transaction.atomic
def update_expense(*, request, expense: Expense, **fields) -> Expense:
    expense = Expense.objects.select_for_update().get(pk=expense.pk)
    if expense.status == Expense.Status.VOIDED:
        raise BusinessRuleViolation("This expense is voided and can't be changed.")
    property_ = fields.get("property", expense.property)
    unit = fields.get("unit", expense.unit)
    moved = property_ is None or (unit is not None and unit.property_id != property_.pk)
    if "property" in fields and "unit" not in fields and unit is not None and moved:
        unit = fields["unit"] = None  # moving to another property drops the old unit
    _check(
        membership=request.membership,
        organization=expense.organization,
        property_=property_,
        unit=unit,
        incurred_on=fields.get("incurred_on", expense.incurred_on),
    )
    changes = {
        k: {"from": str(getattr(expense, k) or ""), "to": str(v or "")}
        for k, v in fields.items()
        if getattr(expense, k) != v
    }
    for k, v in fields.items():
        setattr(expense, k, v)
    expense.save()
    if changes:
        record_event(request, "expense.updated", target=expense, changes=changes)
    return expense


@transaction.atomic
def void_expense(*, request, expense: Expense, reason: str) -> Expense:
    if not reason.strip():
        raise BusinessRuleViolation("Give a reason for voiding the expense.")
    expense = Expense.objects.select_for_update().get(pk=expense.pk)
    if expense.status == Expense.Status.VOIDED:
        raise BusinessRuleViolation("This expense is already voided.")
    expense.status = Expense.Status.VOIDED
    expense.voided_at, expense.voided_by = timezone.now(), request.user
    expense.void_reason = reason.strip()
    expense.save()
    record_event(
        request,
        "expense.voided",
        target=expense,
        metadata={"amount": str(expense.amount), "reason": expense.void_reason},
    )
    return expense
