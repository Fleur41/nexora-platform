from datetime import timedelta
from decimal import Decimal

import pytest

from apps.audit.models import AuditLog
from apps.leases.models import Lease
from apps.leases.tasks import sync_unit_occupancy
from apps.organizations.models import organization_today
from apps.organizations.roles import Role
from apps.properties.models import Unit

from .factories import LeaseFactory, PropertyFactory, TenantFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def unit(org_a):
    return UnitFactory(unit_type=UnitTypeFactory(property=PropertyFactory(organization=org_a)))


@pytest.fixture
def tenant(org_a):
    return TenantFactory(organization=org_a)


@pytest.fixture
def today(org_a):
    return organization_today(org_a)


def _lease(client, tenant, unit, start, rent="25000.00", **extra):
    return client.post(
        "/api/v1/leases/",
        {
            "tenant": str(tenant.pk),
            "unit": str(unit.pk),
            "start_date": str(start),
            "monthly_rent": rent,
            **extra,
        },
    )


def test_create_draft_then_activate_marks_unit_occupied(make_member, org_a, unit, tenant, today):
    _, client = make_member(org_a)
    res = _lease(client, tenant, unit, today - timedelta(days=10), deposit_amount="0")
    assert res.status_code == 201, res.data
    assert res.data["status"] == "draft"
    assert res.data["reference"] == "LSE-0001"
    assert res.data["deposit_amount"] == "0.00"  # zero deposit is allowed
    unit.refresh_from_db()
    assert unit.status == "available"  # drafts don't touch occupancy

    activated = client.post(f"/api/v1/leases/{res.data['id']}/activate/")
    assert activated.status_code == 200
    assert activated.data["status"] == "active"
    assert activated.data["current_rent"] == "25000.00"
    unit.refresh_from_db()
    assert unit.status == "occupied"
    actions = set(AuditLog.objects.filter(organization=org_a).values_list("action", flat=True))
    assert {"lease.created", "lease.activated", "unit.status_changed"} <= actions


def test_future_lease_reserves_unit_until_start(make_member, org_a, unit, tenant, today):
    _, client = make_member(org_a)
    res = _lease(client, tenant, unit, today + timedelta(days=5), activate=True)
    assert res.data["status"] == "active"
    unit.refresh_from_db()
    assert unit.status == "reserved"

    sync_unit_occupancy()
    unit.refresh_from_db()
    assert unit.status == "reserved"  # not started yet

    Lease.objects.filter(pk=res.data["id"]).update(start_date=today)
    assert sync_unit_occupancy() == 1
    assert sync_unit_occupancy() == 0  # idempotent
    unit.refresh_from_db()
    assert unit.status == "occupied"


def test_second_active_lease_on_same_unit_is_rejected(make_member, org_a, unit, tenant, today):
    _, client = make_member(org_a)
    _lease(client, tenant, unit, today - timedelta(days=30), activate=True)
    other = TenantFactory(organization=org_a)
    draft = _lease(client, other, unit, today)
    assert draft.status_code == 201  # drafts may be prepared in advance
    res = client.post(f"/api/v1/leases/{draft.data['id']}/activate/")
    assert res.status_code == 409
    assert Lease.objects.filter(unit=unit, status="active").count() == 1


def test_overlapping_tenancies_are_rejected_by_the_database(
    make_member, org_a, unit, tenant, today
):
    _, client = make_member(org_a)
    start = today - timedelta(days=200)
    first = _lease(client, tenant, unit, start, activate=True).data
    ended = client.post(
        f"/api/v1/leases/{first['id']}/end/",
        {"ended_on": str(start + timedelta(days=100)), "unit_status": "available"},
    )
    assert ended.status_code == 200, ended.data

    # A backdated lease that overlaps the earlier tenancy cannot be activated.
    overlap = _lease(
        client, TenantFactory(organization=org_a), unit, start + timedelta(days=50)
    ).data
    assert client.post(f"/api/v1/leases/{overlap['id']}/activate/").status_code == 409
    # One starting after the earlier tenancy ended is fine.
    after = _lease(
        client, TenantFactory(organization=org_a), unit, start + timedelta(days=101)
    ).data
    assert client.post(f"/api/v1/leases/{after['id']}/activate/").status_code == 200


def test_cannot_let_a_unit_under_maintenance(make_member, org_a, unit, tenant, today):
    _, client = make_member(org_a)
    Unit.objects.filter(pk=unit.pk).update(status=Unit.Status.UNDER_MAINTENANCE)
    draft = _lease(client, tenant, unit, today).data
    assert client.post(f"/api/v1/leases/{draft['id']}/activate/").status_code == 409


def test_rent_changes_are_effective_dated_and_preserve_history(
    make_member, org_a, unit, tenant, today
):
    _, client = make_member(org_a)
    lease = _lease(client, tenant, unit, today - timedelta(days=60), activate=True).data
    url = f"/api/v1/leases/{lease['id']}/rent-terms/"

    past = client.post(
        url, {"effective_from": str(today - timedelta(days=1)), "monthly_rent": "30000"}
    )
    assert past.status_code == 409  # can't rewrite rent for periods already in force
    future = client.post(
        url, {"effective_from": str(today + timedelta(days=30)), "monthly_rent": "27500"}
    )
    assert future.status_code == 201
    assert (
        client.post(
            url, {"effective_from": str(today + timedelta(days=30)), "monthly_rent": "1"}
        ).status_code
        == 409
    )

    detail = client.get(f"/api/v1/leases/{lease['id']}/").data
    assert detail["current_rent"] == "25000.00"
    assert [t["monthly_rent"] for t in detail["rent_terms"]] == ["25000.00", "27500.00"]

    initial_id = detail["rent_terms"][0]["id"]
    assert client.delete(f"{url}{initial_id}/").status_code == 409
    assert client.delete(f"{url}{future.data['id']}/").status_code == 204
    assert AuditLog.objects.filter(action="lease.rent_scheduled").exists()


def test_only_draft_leases_can_be_edited(make_member, org_a, unit, tenant, today):
    _, client = make_member(org_a)
    lease = _lease(client, tenant, unit, today).data
    edited = client.patch(
        f"/api/v1/leases/{lease['id']}/", {"monthly_rent": "26000", "rent_due_day": 5}
    )
    assert edited.status_code == 200
    assert edited.data["current_rent"] == "26000.00"
    client.post(f"/api/v1/leases/{lease['id']}/activate/")
    locked = client.patch(f"/api/v1/leases/{lease['id']}/", {"monthly_rent": "1"})
    assert locked.status_code == 409


def test_end_lease_releases_unit_to_chosen_status_and_keeps_history(
    make_member, org_a, unit, tenant, today
):
    _, client = make_member(org_a)
    lease = _lease(client, tenant, unit, today - timedelta(days=90), activate=True).data
    end_url = f"/api/v1/leases/{lease['id']}/end/"
    future = client.post(
        end_url, {"ended_on": str(today + timedelta(days=3)), "unit_status": "available"}
    )
    assert future.status_code == 409
    bad_status = client.post(end_url, {"ended_on": str(today), "unit_status": "occupied"})
    assert bad_status.status_code == 400

    res = client.post(
        end_url,
        {"ended_on": str(today), "unit_status": "awaiting_inspection", "reason": "Relocating"},
    )
    assert res.status_code == 200
    assert res.data["status"] == "ended"
    unit.refresh_from_db()
    assert unit.status == "awaiting_inspection"

    history = client.get("/api/v1/leases/", {"tenant": str(tenant.pk)}).data["results"]
    assert [h["id"] for h in history] == [lease["id"]]
    assert (
        client.post(end_url, {"ended_on": str(today), "unit_status": "available"}).status_code
        == 409
    )


def test_cancel_draft(make_member, org_a, unit, tenant, today):
    _, client = make_member(org_a)
    lease = _lease(client, tenant, unit, today).data
    assert (
        client.post(f"/api/v1/leases/{lease['id']}/cancel/", {"reason": "Changed mind"}).status_code
        == 200
    )
    assert client.post(f"/api/v1/leases/{lease['id']}/activate/").status_code == 409


def test_lease_validation(make_member, org_a, unit, tenant, today):
    _, client = make_member(org_a)
    no_rent = client.post(
        "/api/v1/leases/",
        {"tenant": str(tenant.pk), "unit": str(unit.pk), "start_date": str(today)},
    )
    assert "monthly_rent" in no_rent.data["error"]["details"]
    backwards = _lease(client, tenant, unit, today, end_date=str(today - timedelta(days=1)))
    assert "end_date" in backwards.data["error"]["details"]
    bad_day = _lease(client, tenant, unit, today, rent_due_day=31)
    assert "rent_due_day" in bad_day.data["error"]["details"]


def test_expiring_filter(make_member, org_a, today):
    _, client = make_member(org_a)
    soon = LeaseFactory(
        unit=UnitFactory(unit_type=UnitTypeFactory(property=PropertyFactory(organization=org_a))),
        end_date=today + timedelta(days=20),
    )
    LeaseFactory(
        unit=UnitFactory(unit_type=soon.unit.unit_type), end_date=today + timedelta(days=200)
    )
    LeaseFactory(unit=UnitFactory(unit_type=soon.unit.unit_type), end_date=None)
    res = client.get("/api/v1/leases/", {"expiring_within_days": 60}).data["results"]
    assert [r["id"] for r in res] == [str(soon.pk)]


def test_accountant_reads_leases_but_cannot_modify(make_member, org_a, unit, tenant, today):
    _, owner = make_member(org_a)
    lease = _lease(owner, tenant, unit, today - timedelta(days=5), activate=True).data
    _, accountant = make_member(org_a, role=Role.ACCOUNTANT)
    assert accountant.get(f"/api/v1/leases/{lease['id']}/").status_code == 200
    assert accountant.post(f"/api/v1/leases/{lease['id']}/end/", {}).status_code == 403
    assert _lease(accountant, tenant, unit, today).status_code == 403
    rent_url = f"/api/v1/leases/{lease['id']}/rent-terms/"
    assert (
        accountant.post(rent_url, {"effective_from": str(today), "monthly_rent": "1"}).status_code
        == 403
    )


def test_monthly_rent_is_stored_as_exact_decimal(make_member, org_a, unit, tenant, today):
    _, client = make_member(org_a)
    lease = _lease(client, tenant, unit, today, rent="18999.99").data
    assert Lease.objects.get(pk=lease["id"]).rent_terms.get().monthly_rent == Decimal("18999.99")
