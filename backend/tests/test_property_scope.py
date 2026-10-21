"""Assigned-scope members (caretakers, property managers) only reach assigned properties."""

import pytest

from apps.organizations.roles import Role

from .factories import LeaseFactory, PropertyFactory, TenantFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def estate(org_a):
    """Two properties in org A, each with one leased unit."""
    leases = []
    for name in ("Assigned Court", "Other Court"):
        ut = UnitTypeFactory(property=PropertyFactory(organization=org_a, name=name))
        leases.append(LeaseFactory(unit=UnitFactory(unit_type=ut)))
    return leases


def _assign(owner_client, prop, membership):
    res = owner_client.post(
        "/api/v1/property-assignments/",
        {"property": str(prop.pk), "membership": str(membership.pk)},
    )
    assert res.status_code == 201, res.data
    return res


def test_caretaker_defaults_to_assigned_scope_and_sees_nothing_unassigned(
    make_member, org_a, estate
):
    caretaker, client = make_member(org_a, role=Role.CARETAKER)
    assert caretaker.access_scope == "assigned"
    assert client.get("/api/v1/properties/").data["count"] == 0
    assert client.get("/api/v1/units/").data["count"] == 0
    assert client.get(f"/api/v1/properties/{estate[0].unit.property_id}/").status_code == 404


def test_assignment_grants_access_to_that_property_only(make_member, org_a, estate):
    _, owner = make_member(org_a)
    caretaker, client = make_member(org_a, role=Role.CARETAKER)
    assigned, other = estate
    _assign(owner, assigned.unit.property, caretaker)

    props = client.get("/api/v1/properties/").data["results"]
    assert [p["id"] for p in props] == [str(assigned.unit.property_id)]
    units = client.get("/api/v1/units/").data["results"]
    assert [u["id"] for u in units] == [str(assigned.unit_id)]
    assert client.get(f"/api/v1/units/{other.unit_id}/").status_code == 404

    # Tenant contact details only for tenants on assigned properties, no identity fields.
    tenants = client.get("/api/v1/tenants/").data["results"]
    assert [t["id"] for t in tenants] == [str(assigned.tenant_id)]
    assert "id_number" not in tenants[0] and "phone" in tenants[0]
    assert client.get(f"/api/v1/tenants/{other.tenant_id}/").status_code == 404
    # Caretakers have no lease (rent) visibility at all.
    assert client.get("/api/v1/leases/").status_code == 403


def test_property_manager_scope_applies_to_leases_and_writes(make_member, org_a, estate):
    _, owner = make_member(org_a)
    manager, client = make_member(org_a, role=Role.PROPERTY_MANAGER)
    assigned, other = estate
    _assign(owner, assigned.unit.property, manager)

    leases = client.get("/api/v1/leases/").data["results"]
    assert [lease["id"] for lease in leases] == [str(assigned.pk)]
    assert client.post(f"/api/v1/leases/{other.pk}/end/", {}).status_code == 404
    # Cannot create units in, or reference units of, an unassigned property.
    res = client.post(
        "/api/v1/units/",
        {
            "property": str(other.unit.property_id),
            "unit_type": str(other.unit.unit_type_id),
            "number": "Z9",
        },
    )
    assert res.status_code == 400
    assert "property" in res.data["error"]["details"]
    tenant = TenantFactory(organization=org_a)
    res = client.post(
        "/api/v1/leases/",
        {
            "tenant": str(tenant.pk),
            "unit": str(other.unit_id),
            "start_date": "2026-01-01",
            "monthly_rent": "1",
        },
    )
    assert res.status_code == 400


def test_manager_creating_a_property_is_assigned_to_it(make_member, org_a):
    manager, client = make_member(org_a, role=Role.PROPERTY_MANAGER)
    res = client.post("/api/v1/properties/", {"name": "New Block"})
    assert res.status_code == 201
    assert client.get(f"/api/v1/properties/{res.data['id']}/").status_code == 200
    assert manager.property_assignments.filter(property_id=res.data["id"]).exists()


def test_assigned_scope_members_cannot_widen_access(make_member, org_a, estate):
    delegate, client = make_member(
        org_a, role=Role.PROPERTY_MANAGER, extra_permissions=["members.manage"]
    )
    target, _ = make_member(org_a, role=Role.CARETAKER)
    res = client.patch(f"/api/v1/members/{target.pk}/", {"access_scope": "organization"})
    assert res.status_code == 409
    # Nor assign a property they don't have themselves.
    res = client.post(
        "/api/v1/property-assignments/",
        {"property": str(estate[1].unit.property_id), "membership": str(target.pk)},
    )
    assert res.status_code == 400  # property not visible to them


def test_owner_can_switch_member_to_organization_scope(make_member, org_a, estate):
    _, owner = make_member(org_a)
    caretaker, client = make_member(org_a, role=Role.CARETAKER)
    res = owner.patch(f"/api/v1/members/{caretaker.pk}/", {"access_scope": "organization"})
    assert res.status_code == 200
    assert client.get("/api/v1/properties/").data["count"] == 2


def test_cannot_assign_members_of_another_organization(make_member, org_a, org_b, estate):
    _, owner = make_member(org_a)
    outsider, _ = make_member(org_b, role=Role.CARETAKER)
    res = owner.post(
        "/api/v1/property-assignments/",
        {"property": str(estate[0].unit.property_id), "membership": str(outsider.pk)},
    )
    assert res.status_code == 400


def test_unassigning_revokes_access(make_member, org_a, estate):
    _, owner = make_member(org_a)
    caretaker, client = make_member(org_a, role=Role.CARETAKER)
    assignment_id = _assign(owner, estate[0].unit.property, caretaker).data["id"]
    assert client.get("/api/v1/properties/").data["count"] == 1
    assert owner.delete(f"/api/v1/property-assignments/{assignment_id}/").status_code == 204
    assert client.get("/api/v1/properties/").data["count"] == 0
