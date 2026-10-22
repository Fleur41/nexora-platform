from datetime import date
from decimal import Decimal

import pytest

from apps.organizations.roles import Role

from .factories import LeaseFactory, PropertyFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def unit(org_a):
    return UnitFactory(unit_type=UnitTypeFactory(property=PropertyFactory(organization=org_a)))


def reading(client, meter, day, value):
    return client.post(
        "/api/v1/meter-readings/", {"meter": meter, "reading_date": day, "value": value}
    )


def test_meters_and_reading_rules(make_member, org_a, unit):
    _, client = make_member(org_a)
    meter = client.post(
        "/api/v1/meters/", {"unit": str(unit.pk), "utility": "water", "number": "W-1"}
    )
    assert meter.status_code == 201
    m = meter.data["id"]
    assert (
        client.post("/api/v1/meters/", {"unit": str(unit.pk), "utility": "water"}).status_code
        == 409
    )
    assert reading(client, m, "2026-08-01", "100").status_code == 201
    assert reading(client, m, "2026-08-01", "101").status_code == 409  # same day
    assert reading(client, m, "2026-08-15", "90").status_code == 409  # lower than before
    assert reading(client, m, "2099-01-01", "200").status_code == 409  # future
    assert reading(client, m, "2026-08-31", "130").status_code == 201
    assert reading(client, m, "2026-08-20", "140").status_code == 409  # higher than the next
    detail = client.get(f"/api/v1/meters/{m}/").data
    assert (detail["last_reading_date"], detail["last_reading_value"]) == ("2026-08-31", "130.000")


def test_billed_readings_are_locked(make_member, org_a, unit):
    _, client = make_member(org_a)
    LeaseFactory(unit=unit, start_date=date(2026, 8, 1))
    water = next(ct for ct in client.get("/api/v1/charge-types/").data if ct["code"] == "water")
    client.post(
        "/api/v1/charge-rules/",
        {
            "charge_type": water["id"],
            "scope": "organization",
            "method": "metered",
            "amount": "100",
            "effective_from": "2026-01-01",
        },
    )
    m = client.post("/api/v1/meters/", {"unit": str(unit.pk), "utility": "water"}).data["id"]
    first = reading(client, m, "2026-08-01", "10").data
    second = reading(client, m, "2026-08-31", "20").data
    client.post("/api/v1/billing-runs/", {"period": "2026-08"})
    assert (
        client.patch(f"/api/v1/meter-readings/{second['id']}/", {"value": "25"}).status_code == 409
    )
    assert client.delete(f"/api/v1/meter-readings/{first['id']}/").status_code == 409
    assert reading(client, m, "2026-08-15", "15").status_code == 409  # would split billed usage


def test_bulk_readings_are_all_or_nothing(make_member, org_a, unit):
    _, client = make_member(org_a)
    other = UnitFactory(unit_type=unit.unit_type)
    m1 = client.post("/api/v1/meters/", {"unit": str(unit.pk), "utility": "water"}).data["id"]
    m2 = client.post("/api/v1/meters/", {"unit": str(other.pk), "utility": "water"}).data["id"]
    reading(client, m2, "2026-08-01", "500")
    bad = client.post(
        "/api/v1/meter-readings/bulk/",
        {
            "reading_date": "2026-09-01",
            "readings": [{"meter": m1, "value": "10"}, {"meter": m2, "value": "400"}],
        },
        format="json",
    )
    assert bad.status_code == 400
    assert "1" in bad.data["error"]["details"]["readings"]
    assert client.get("/api/v1/meter-readings/", {"meter": m1}).data["count"] == 0
    good = client.post(
        "/api/v1/meter-readings/bulk/",
        {
            "reading_date": "2026-09-01",
            "readings": [{"meter": m1, "value": "10"}, {"meter": m2, "value": "510"}],
        },
        format="json",
    )
    assert good.status_code == 201 and len(good.data) == 2


def test_caretakers_record_readings_only_on_assigned_properties(make_member, org_a, unit):
    _, owner = make_member(org_a)
    caretaker, client = make_member(org_a, role=Role.CARETAKER)
    m = owner.post("/api/v1/meters/", {"unit": str(unit.pk), "utility": "electricity"}).data["id"]
    assert reading(client, m, "2026-08-01", "1").status_code == 400  # meter not visible
    owner.post(
        "/api/v1/property-assignments/",
        {"property": str(unit.property_id), "membership": str(caretaker.pk)},
    )
    assert reading(client, m, "2026-08-01", "1").status_code == 201
    assert client.get("/api/v1/invoices/").status_code == 403


def test_meter_readings_isolated_between_organizations(make_member, org_a, org_b, unit):
    _, owner = make_member(org_a)
    m = owner.post("/api/v1/meters/", {"unit": str(unit.pk), "utility": "water"}).data["id"]
    _, outsider = make_member(org_b)
    assert outsider.get(f"/api/v1/meters/{m}/").status_code == 404
    assert reading(outsider, m, "2026-08-01", Decimal("1")).status_code == 400
    assert (
        outsider.post("/api/v1/meters/", {"unit": str(unit.pk), "utility": "gas"}).status_code
        == 400
    )
