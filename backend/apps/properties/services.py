from __future__ import annotations

from django.db import IntegrityError, transaction
from django.utils.crypto import get_random_string
from django.utils.text import slugify

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.core.models import next_reference
from apps.organizations.models import Membership

from .models import Property, PropertyAssignment, Unit, UnitType

MAX_BULK_UNITS = 200


def _unique_slug(name: str) -> str:
    base = slugify(name)[:100] or "property"
    slug = base
    while Property.objects.filter(slug=slug).exists():
        slug = f"{base}-{get_random_string(5).lower()}"
    return slug


def _changes(instance, fields: dict) -> dict:
    return {
        key: {"from": _jsonable(getattr(instance, key)), "to": _jsonable(value)}
        for key, value in fields.items()
        if getattr(instance, key) != value
    }


def _jsonable(value):
    if isinstance(value, Property | UnitType | Unit):
        return str(value.pk)
    if value is None or isinstance(value, bool | int | str | list | dict):
        return value
    return str(value)


@transaction.atomic
def create_property(*, request, organization, **fields) -> Property:
    prop = Property.objects.create(
        organization=organization,
        reference=next_reference(organization, "property", "PRP"),
        slug=_unique_slug(fields["name"]),
        created_by=request.user,
        **fields,
    )
    record_event(request, "property.created", target=prop)
    # An assigned-scope creator (e.g. a property manager) should see what they just created.
    membership = getattr(request, "membership", None)
    if membership is not None and not membership.has_organization_scope:
        PropertyAssignment.objects.create(
            organization=organization,
            property=prop,
            membership=membership,
            assigned_by=request.user,
        )
    return prop


@transaction.atomic
def update_instance(*, request, instance, action: str, **fields):
    changes = _changes(instance, fields)
    for key, value in fields.items():
        setattr(instance, key, value)
    instance.save()
    if changes:
        record_event(request, action, target=instance, changes=changes)
    return instance


def _validate_unit_type(property_: Property, unit_type: UnitType) -> None:
    if unit_type.property_id != property_.pk:
        raise BusinessRuleViolation("The unit type belongs to a different property.")


@transaction.atomic
def create_unit_type(*, request, organization, **fields) -> UnitType:
    try:
        with transaction.atomic():
            unit_type = UnitType.objects.create(organization=organization, **fields)
    except IntegrityError as exc:
        raise BusinessRuleViolation(
            "This property already has a unit type with that name."
        ) from exc
    record_event(request, "unit_type.created", target=unit_type)
    return unit_type


@transaction.atomic
def create_unit(*, request, organization, **fields) -> Unit:
    from apps.subscriptions.services import check_unit_capacity

    check_unit_capacity(organization, 1)
    _validate_unit_type(fields["property"], fields["unit_type"])
    if fields.get("market_rent") is None:
        fields["market_rent"] = fields["unit_type"].default_rent
    status = fields.get("status", Unit.Status.AVAILABLE)
    if status not in Unit.MANUAL_STATUSES:
        raise BusinessRuleViolation(
            "New units must be available, unavailable or under maintenance."
        )
    try:
        with transaction.atomic():
            unit = Unit.objects.create(organization=organization, **fields)
    except IntegrityError as exc:
        raise BusinessRuleViolation(
            "A unit with this number already exists in the property."
        ) from exc
    record_event(request, "unit.created", target=unit)
    return unit


@transaction.atomic
def bulk_create_units(
    *,
    request,
    organization,
    property: Property,
    unit_type: UnitType,
    prefix: str,
    start: int,
    count: int,
    floor: str = "",
) -> list[Unit]:
    _validate_unit_type(property, unit_type)
    if not 1 <= count <= MAX_BULK_UNITS:
        raise BusinessRuleViolation(f"You can create between 1 and {MAX_BULK_UNITS} units at once.")
    from apps.subscriptions.services import check_unit_capacity

    check_unit_capacity(organization, count)
    numbers = [f"{prefix}{n}" for n in range(start, start + count)]
    taken = set(
        Unit.objects.filter(property=property, number__in=numbers).values_list("number", flat=True)
    )
    if taken:
        raise BusinessRuleViolation(
            f"These unit numbers already exist: {', '.join(sorted(taken)[:10])}"
        )
    units = Unit.objects.bulk_create(
        [
            Unit(
                organization=organization,
                property=property,
                unit_type=unit_type,
                number=number,
                floor=floor,
                market_rent=unit_type.default_rent,
            )
            for number in numbers
        ]
    )
    record_event(
        request,
        "unit.bulk_created",
        target=property,
        metadata={"count": len(units), "unit_type": str(unit_type.pk), "numbers": numbers},
    )
    return units


@transaction.atomic
def update_unit(*, request, unit: Unit, **fields) -> Unit:
    if "status" in fields:
        raise BusinessRuleViolation("Use the status action to change a unit's status.")
    unit_type = fields.get("unit_type")
    if unit_type is not None:
        _validate_unit_type(unit.property, unit_type)
    if "property" in fields and fields["property"].pk != unit.property_id:
        raise BusinessRuleViolation("A unit cannot be moved to another property.")
    return update_instance(request=request, instance=unit, action="unit.updated", **fields)


@transaction.atomic
def set_unit_status(*, request, unit: Unit, status: str, reason: str = "") -> Unit:
    """Manual status changes. Lease-driven statuses can only be set by lease workflows."""
    unit = Unit.objects.select_for_update().get(pk=unit.pk)
    if status not in Unit.MANUAL_STATUSES:
        raise BusinessRuleViolation(
            "This status is set automatically by lease and move-out workflows."
        )
    if unit.status not in Unit.MANUAL_STATUSES | {Unit.Status.AWAITING_INSPECTION}:
        raise BusinessRuleViolation(
            f"The unit is {unit.get_status_display().lower()}; end or change its lease first."
        )
    if unit.status == status:
        return unit
    previous = unit.status
    unit.status = status
    unit.save(update_fields=["status", "updated_at"])
    record_event(
        request,
        "unit.status_changed",
        target=unit,
        changes={"status": {"from": previous, "to": status}},
        metadata={"reason": reason} if reason else None,
    )
    return unit


# --- Assignments --------------------------------------------------------------


@transaction.atomic
def assign_property(*, request, property: Property, membership: Membership) -> PropertyAssignment:
    if membership.organization_id != property.organization_id:
        raise BusinessRuleViolation("The member belongs to a different organization.")
    if membership.status != Membership.Status.ACTIVE:
        raise BusinessRuleViolation("Only active members can be assigned to properties.")
    actor = request.membership
    if not actor.is_owner and membership.is_owner:
        raise BusinessRuleViolation("Only an owner can change another owner.")
    if (
        not actor.has_organization_scope
        and not actor.property_assignments.filter(property=property).exists()
    ):
        raise BusinessRuleViolation("You can only assign properties you have access to.")
    assignment, created = PropertyAssignment.objects.get_or_create(
        organization=property.organization,
        property=property,
        membership=membership,
        defaults={"assigned_by": request.user},
    )
    if created:
        record_event(
            request,
            "property.assigned",
            target=property,
            metadata={"membership": str(membership.pk), "user": membership.user.email},
        )
    return assignment


@transaction.atomic
def unassign_property(*, request, assignment: PropertyAssignment) -> None:
    actor = request.membership
    if not actor.is_owner and assignment.membership.is_owner:
        raise BusinessRuleViolation("Only an owner can change another owner.")
    record_event(
        request,
        "property.unassigned",
        target=assignment.property,
        metadata={
            "membership": str(assignment.membership_id),
            "user": assignment.membership.user.email,
        },
    )
    assignment.delete()
