import pytest

from apps.organizations.roles import Role
from apps.tenants.models import Tenant

from .factories import LeaseFactory, PropertyFactory, TenantFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db


def _tenant_payload(**extra):
    return {
        "full_name": "Wanjiru Kamau",
        "phone": "0712 345 678",
        "id_type": "national_id",
        "id_number": "12345678",
        "emergency_contact_phone": "254722000111",
        **extra,
    }


def test_register_tenant_normalizes_kenyan_phone_numbers(make_member, org_a):
    _, client = make_member(org_a)
    res = client.post("/api/v1/tenants/", _tenant_payload())
    assert res.status_code == 201, res.data
    assert res.data["phone"] == "+254712345678"
    assert res.data["emergency_contact_phone"] == "+254722000111"
    assert res.data["id_number"] == "12345678"


def test_duplicate_identity_rejected_within_organization_only(make_member, org_a, org_b):
    _, client_a = make_member(org_a)
    _, client_b = make_member(org_b)
    assert client_a.post("/api/v1/tenants/", _tenant_payload()).status_code == 201
    dup = client_a.post("/api/v1/tenants/", _tenant_payload(full_name="Someone Else"))
    assert dup.status_code == 400
    assert "id_number" in dup.data["error"]["details"]
    assert client_b.post("/api/v1/tenants/", _tenant_payload()).status_code == 201


def test_invalid_phone_rejected(make_member, org_a):
    _, client = make_member(org_a)
    res = client.post("/api/v1/tenants/", _tenant_payload(phone="12"))
    assert res.status_code == 400
    assert "phone" in res.data["error"]["details"]


def test_sensitive_fields_hidden_without_manage_permission(make_member, org_a):
    tenant = TenantFactory(organization=org_a, notes="Pays late")
    _, accountant = make_member(org_a, role=Role.ACCOUNTANT)
    data = accountant.get(f"/api/v1/tenants/{tenant.pk}/").data
    assert data["phone"] == tenant.phone
    assert "id_number" not in data and "notes" not in data
    assert accountant.post("/api/v1/tenants/", _tenant_payload()).status_code == 403


def test_archive_requires_no_active_lease_and_history_is_kept(make_member, org_a):
    _, client = make_member(org_a)
    lease = LeaseFactory(
        unit=UnitFactory(unit_type=UnitTypeFactory(property=PropertyFactory(organization=org_a)))
    )
    assert client.post(f"/api/v1/tenants/{lease.tenant_id}/archive/").status_code == 409

    idle = TenantFactory(organization=org_a)
    assert client.post(f"/api/v1/tenants/{idle.pk}/archive/").status_code == 200
    listed = {t["id"] for t in client.get("/api/v1/tenants/").data["results"]}
    assert str(idle.pk) not in listed
    archived = client.get("/api/v1/tenants/", {"status": "archived"}).data["results"]
    assert [t["id"] for t in archived] == [str(idle.pk)]
    assert client.get(f"/api/v1/tenants/{idle.pk}/").status_code == 200  # still retrievable
    assert Tenant.objects.filter(pk=idle.pk).exists()


def test_tenants_cannot_be_deleted(make_member, org_a):
    _, client = make_member(org_a)
    tenant = TenantFactory(organization=org_a)
    assert client.delete(f"/api/v1/tenants/{tenant.pk}/").status_code == 405
