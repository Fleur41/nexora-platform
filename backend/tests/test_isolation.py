"""Cross-organization isolation. These must never regress."""

import pytest
from rest_framework.test import APIClient

from apps.audit.services import record_event
from apps.organizations.models import Invitation
from apps.organizations.roles import Role

from .factories import UserFactory

pytestmark = pytest.mark.django_db


def test_header_for_foreign_organization_is_denied(make_member, org_a, org_b):
    _, client = make_member(org_a)
    make_member(org_b)
    for path in ["/api/v1/organizations/current/", "/api/v1/members/", "/api/v1/audit-logs/"]:
        res = client.get(path, HTTP_X_ORGANIZATION_ID=str(org_b.pk))
        assert res.status_code == 403, path
        assert res.data["error"]["code"] == "not_a_member"
        assert res.data["error"]["message"] == "You do not have access to this organization."


@pytest.mark.parametrize(
    "value", ["not-a-uuid", "00000000-0000-0000-0000-000000000000", "' OR 1=1"]
)
def test_malformed_or_unknown_organization_header_is_denied(make_member, org_a, value):
    _, client = make_member(org_a)
    res = client.get("/api/v1/members/", HTTP_X_ORGANIZATION_ID=value)
    assert res.status_code == 403


def test_foreign_object_ids_resolve_to_404_within_my_organization(make_member, org_a, org_b):
    _, client = make_member(org_a)
    foreign_member, _ = make_member(org_b, role=Role.ACCOUNTANT)
    foreign_invite = Invitation(
        organization=org_b,
        email="x@example.com",
        role=Role.CARETAKER,
        expires_at="2099-01-01T00:00Z",
    )
    foreign_invite.issue_token()
    foreign_invite.save()

    assert client.get(f"/api/v1/members/{foreign_member.pk}/").status_code == 404
    assert (
        client.patch(f"/api/v1/members/{foreign_member.pk}/", {"role": "owner"}).status_code == 404
    )
    assert client.delete(f"/api/v1/members/{foreign_member.pk}/").status_code == 404
    assert client.post(f"/api/v1/invitations/{foreign_invite.pk}/revoke/").status_code == 404
    foreign_member.refresh_from_db()
    foreign_invite.refresh_from_db()
    assert foreign_member.role == Role.ACCOUNTANT
    assert foreign_invite.status == Invitation.Status.PENDING


def test_lists_and_searches_only_return_own_organization_records(make_member, org_a, org_b):
    _, client = make_member(org_a)
    other, _ = make_member(org_b)
    record_event(None, "secret.event", organization=org_b, target=other)

    members = client.get("/api/v1/members/", {"search": other.user.email}).data
    assert members["count"] == 0
    logs = client.get("/api/v1/audit-logs/", {"search": "secret"}).data
    assert logs["count"] == 0
    all_members = client.get("/api/v1/members/").data["results"]
    assert {m["id"] for m in all_members} == {str(m.pk) for m in org_a.memberships.all()}


def test_platform_admin_has_no_implicit_access_to_organization_data(org_a, make_member):
    make_member(org_a)
    admin = UserFactory(is_platform_admin=True, is_staff=True, is_superuser=True)
    client = APIClient(headers={"X-Organization-ID": str(org_a.pk)})
    client.force_authenticate(admin)
    assert client.get("/api/v1/members/").status_code == 403
    assert client.get("/api/v1/audit-logs/").status_code == 403
    assert client.get("/api/v1/organizations/").data == []


def test_unauthenticated_requests_are_rejected(org_a):
    client = APIClient(headers={"X-Organization-ID": str(org_a.pk)})
    for path in ["/api/v1/members/", "/api/v1/organizations/current/", "/api/v1/audit-logs/"]:
        assert client.get(path).status_code in (401, 403)


def test_property_module_records_are_isolated(make_member, org_a, org_b):
    from .factories import (
        LeaseFactory,
        PropertyFactory,
        TenantFactory,
        UnitFactory,
        UnitTypeFactory,
    )

    _, client = make_member(org_a)
    foreign = LeaseFactory(
        unit=UnitFactory(unit_type=UnitTypeFactory(property=PropertyFactory(organization=org_b)))
    )
    for path in [
        f"/api/v1/properties/{foreign.unit.property_id}/",
        f"/api/v1/unit-types/{foreign.unit.unit_type_id}/",
        f"/api/v1/units/{foreign.unit_id}/",
        f"/api/v1/tenants/{foreign.tenant_id}/",
        f"/api/v1/leases/{foreign.pk}/",
    ]:
        assert client.get(path).status_code == 404, path
    for path in ["/api/v1/properties/", "/api/v1/units/", "/api/v1/tenants/", "/api/v1/leases/"]:
        assert client.get(path).data["count"] == 0, path
    assert client.get("/api/v1/units/summary/").data["total"] == 0

    # Cannot link own records to another organization's tenant, unit or unit type.
    own_unit = UnitFactory(unit_type=UnitTypeFactory(property=PropertyFactory(organization=org_a)))
    own_tenant = TenantFactory(organization=org_a)
    lease_payload = {"start_date": "2026-01-01", "monthly_rent": "100"}
    res = client.post(
        "/api/v1/leases/",
        {**lease_payload, "tenant": str(foreign.tenant_id), "unit": str(own_unit.pk)},
    )
    assert res.status_code == 400 and "tenant" in res.data["error"]["details"]
    res = client.post(
        "/api/v1/leases/",
        {**lease_payload, "tenant": str(own_tenant.pk), "unit": str(foreign.unit_id)},
    )
    assert res.status_code == 400 and "unit" in res.data["error"]["details"]
    res = client.post(
        "/api/v1/units/",
        {
            "property": str(own_unit.property_id),
            "unit_type": str(foreign.unit.unit_type_id),
            "number": "X",
        },
    )
    assert res.status_code == 400
    # Mutating actions on foreign ids are 404, and nothing changes.
    assert client.post(f"/api/v1/leases/{foreign.pk}/end/", {}).status_code == 404
    assert (
        client.post(
            f"/api/v1/units/{foreign.unit_id}/status/", {"status": "unavailable"}
        ).status_code
        == 404
    )
    foreign.unit.refresh_from_db()
    assert foreign.unit.status == "occupied"
