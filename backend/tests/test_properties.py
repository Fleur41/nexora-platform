from decimal import Decimal

import pytest

from apps.audit.models import AuditLog
from apps.organizations.roles import Role
from apps.properties.models import Property, Unit, UnitType

from .factories import LeaseFactory, PropertyFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db


def _create_property(client, name="Kilimani Heights", **extra):
    return client.post("/api/v1/properties/", {"name": name, "town": "Nairobi", **extra})


def _create_unit_type(client, prop_id, name="Bedsitter", rent="9500.00", **extra):
    return client.post(
        "/api/v1/unit-types/",
        {"property": prop_id, "name": name, "category": "bedsitter", "default_rent": rent, **extra},
    )


def test_create_property_assigns_sequential_references_per_organization(make_member, org_a, org_b):
    _, client_a = make_member(org_a)
    _, client_b = make_member(org_b)
    first = _create_property(client_a)
    second = _create_property(client_a, name="Westlands Gardens")
    other_org = _create_property(client_b)
    assert first.status_code == 201, first.data
    assert (first.data["reference"], second.data["reference"]) == ("PRP-0001", "PRP-0002")
    assert other_org.data["reference"] == "PRP-0001"
    assert first.data["slug"] != other_org.data["slug"]
    assert first.data["unit_count"] == 0
    assert first.data["is_listed_publicly"] is False  # publishing is opt-in
    assert AuditLog.objects.filter(action="property.created", organization=org_a).count() == 2


def test_multiple_properties_with_their_own_configurable_unit_types(make_member, org_a):
    _, client = make_member(org_a)
    p1 = _create_property(client).data["id"]
    p2 = _create_property(client, name="Second").data["id"]
    for name, category in [
        ("Bedsitter", "bedsitter"),
        ("Studio", "studio"),
        ("Penthouse", "custom"),
    ]:
        assert _create_unit_type(client, p1, name=name, category=category).status_code == 201
    # The same name is allowed in another property but not twice in one property.
    assert _create_unit_type(client, p2, name="Bedsitter").status_code == 201
    assert _create_unit_type(client, p1, name="Bedsitter").status_code == 400
    listed = client.get("/api/v1/unit-types/", {"property": p1}).data
    assert listed["count"] == 3


def test_unit_inherits_unit_type_rent_and_validates_relationships(make_member, org_a):
    _, client = make_member(org_a)
    p1 = _create_property(client).data["id"]
    p2 = _create_property(client, name="Other").data["id"]
    ut1 = _create_unit_type(client, p1, rent="12000.00").data["id"]
    ut2 = _create_unit_type(client, p2).data["id"]

    res = client.post("/api/v1/units/", {"property": p1, "unit_type": ut1, "number": "B1"})
    assert res.status_code == 201, res.data
    assert res.data["market_rent"] == "12000.00"
    assert res.data["status"] == "available"

    mismatched = client.post("/api/v1/units/", {"property": p1, "unit_type": ut2, "number": "B2"})
    assert mismatched.status_code == 409
    duplicate = client.post("/api/v1/units/", {"property": p1, "unit_type": ut1, "number": "B1"})
    assert duplicate.status_code == 400
    negative = client.post(
        "/api/v1/units/", {"property": p1, "unit_type": ut1, "number": "B3", "market_rent": "-5"}
    )
    assert negative.status_code == 400


def test_bulk_create_units(make_member, org_a):
    _, client = make_member(org_a)
    prop = _create_property(client).data["id"]
    ut = _create_unit_type(client, prop).data["id"]
    res = client.post(
        "/api/v1/units/bulk/",
        {"property": prop, "unit_type": ut, "prefix": "A", "start": 1, "count": 12, "floor": "1"},
    )
    assert res.status_code == 201
    assert res.data["created"] == 12
    assert Unit.objects.filter(property_id=prop).count() == 12
    clash = client.post(
        "/api/v1/units/bulk/",
        {"property": prop, "unit_type": ut, "prefix": "A", "start": 10, "count": 5},
    )
    assert clash.status_code == 409
    assert Unit.objects.filter(property_id=prop).count() == 12


def test_manual_unit_status_rules(make_member, org_a):
    _, client = make_member(org_a)
    unit = UnitFactory(
        organization=org_a, unit_type=UnitTypeFactory(property=PropertyFactory(organization=org_a))
    )
    ok = client.post(
        f"/api/v1/units/{unit.pk}/status/", {"status": "under_maintenance", "reason": "Repainting"}
    )
    assert ok.status_code == 200
    assert ok.data["status"] == "under_maintenance"
    # Occupancy statuses are only set by lease workflows.
    assert (
        client.post(f"/api/v1/units/{unit.pk}/status/", {"status": "occupied"}).status_code == 400
    )
    # The status field cannot be patched directly either.
    client.patch(f"/api/v1/units/{unit.pk}/", {"status": "occupied"})
    unit.refresh_from_db()
    assert unit.status == "under_maintenance"

    leased = LeaseFactory(unit=UnitFactory(organization=org_a, unit_type=unit.unit_type))
    res = client.post(f"/api/v1/units/{leased.unit_id}/status/", {"status": "available"})
    assert res.status_code == 409
    assert AuditLog.objects.filter(action="unit.status_changed", target_id=str(unit.pk)).exists()


def test_property_summary_and_occupancy(make_member, org_a):
    _, client = make_member(org_a)
    ut = UnitTypeFactory(property=PropertyFactory(organization=org_a))
    units = [UnitFactory(unit_type=ut) for _ in range(4)]
    LeaseFactory(unit=units[0])
    LeaseFactory(unit=units[1])
    Unit.objects.filter(pk=units[3].pk).update(status=Unit.Status.UNAVAILABLE)

    summary = client.get(f"/api/v1/properties/{ut.property_id}/summary/").data["units"]
    assert summary["total"] == 4
    assert summary["occupied"] == 2
    assert summary["vacant"] == 1
    assert summary["occupancy_rate"] == pytest.approx(66.7)  # unavailable units are not lettable
    listed = client.get("/api/v1/properties/").data["results"][0]
    assert (listed["unit_count"], listed["occupied_count"], listed["available_count"]) == (4, 2, 1)
    overall = client.get("/api/v1/units/summary/").data
    assert overall["total"] == 4


def test_unit_type_and_unit_deletion_is_blocked_once_in_use(make_member, org_a):
    _, client = make_member(org_a)
    ut = UnitTypeFactory(property=PropertyFactory(organization=org_a))
    unit = UnitFactory(unit_type=ut)
    assert client.delete(f"/api/v1/unit-types/{ut.pk}/").status_code == 409
    LeaseFactory(unit=unit)
    assert client.delete(f"/api/v1/units/{unit.pk}/").status_code == 409
    assert Unit.objects.filter(pk=unit.pk).exists() and UnitType.objects.filter(pk=ut.pk).exists()

    spare = UnitFactory(unit_type=UnitTypeFactory(property=ut.property))
    assert client.delete(f"/api/v1/units/{spare.pk}/").status_code == 204


def test_changing_unit_rent_does_not_change_existing_leases(make_member, org_a):
    _, client = make_member(org_a)
    lease = LeaseFactory(
        unit=UnitFactory(unit_type=UnitTypeFactory(property=PropertyFactory(organization=org_a)))
    )
    client.patch(f"/api/v1/units/{lease.unit_id}/", {"market_rent": "40000.00"})
    assert lease.rent_terms.get().monthly_rent == Decimal("25000.00")
    assert client.get(f"/api/v1/leases/{lease.pk}/").data["current_rent"] == "25000.00"


@pytest.mark.parametrize("role", [Role.CARETAKER, Role.ACCOUNTANT])
def test_read_only_roles_cannot_change_properties(make_member, org_a, role):
    _, client = make_member(org_a, role=role, access_scope="organization")
    prop = PropertyFactory(organization=org_a)
    assert client.get("/api/v1/properties/").status_code == 200
    assert _create_property(client).status_code == 403
    assert client.patch(f"/api/v1/properties/{prop.pk}/", {"name": "x"}).status_code == 403
    assert client.post("/api/v1/units/bulk/", {}).status_code == 403
    assert Property.objects.get(pk=prop.pk).name != "x"
