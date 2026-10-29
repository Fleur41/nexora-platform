from datetime import date
from decimal import Decimal

import pytest
from django.db import IntegrityError

from apps.audit.models import AuditLog
from apps.billing import services
from apps.billing.defaults import ensure_default_charge_types
from apps.billing.models import BillingRun, BillingSettings, Invoice, InvoiceLine, LedgerEntry
from apps.billing.periods import billing_period, describe_range, prorate
from apps.leases.models import Lease, LeaseRentTerm
from apps.organizations.roles import Role
from apps.properties.models import Unit

from .factories import LeaseFactory, PropertyFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db

AUG = date(2026, 8, 1)
SEP = date(2026, 9, 1)


@pytest.fixture
def property_(org_a):
    return PropertyFactory(organization=org_a)


@pytest.fixture
def unit_type(property_):
    return UnitTypeFactory(property=property_)


def lease_on(unit_type, start=AUG, rent="30000", **kwargs):
    return LeaseFactory(
        unit=UnitFactory(unit_type=unit_type), start_date=start, rent=Decimal(rent), **kwargs
    )


def charge(org, code):
    return next(ct for ct in ensure_default_charge_types(org) if ct.code == code)


def run(client, period):
    res = client.post("/api/v1/billing-runs/", {"period": period})
    assert res.status_code == 201, res.data
    return res.data


def invoices_for(lease):
    return Invoice.objects.filter(lease=lease, status="issued").order_by("created_at")


def add_rule(client, org, code, **fields):
    payload = {
        "charge_type": str(charge(org, code).pk),
        "scope": "organization",
        "method": "fixed_monthly",
        "amount": "1000",
        "effective_from": "2026-01-01",
        **{k: (str(v) if hasattr(v, "pk") else v) for k, v in fields.items()},
    }
    if "property" in fields:
        payload["property"] = str(fields["property"].pk)
    if "unit" in fields:
        payload["unit"] = str(fields["unit"].pk)
    if "unit_type" in fields:
        payload["unit_type"] = str(fields["unit_type"].pk)
    return client.post("/api/v1/charge-rules/", payload)


# --- Period arithmetic ------------------------------------------------------------


def test_proration_by_day_and_rate_changes():
    flat = lambda d: Decimal("31000")  # noqa: E731
    assert prorate(flat, [], date(2026, 10, 1), date(2026, 10, 31)) == Decimal("31000")
    assert prorate(flat, [], date(2026, 10, 21), date(2026, 10, 31)) == Decimal("11000")
    # February has its own length.
    feb = prorate(lambda d: Decimal("28000"), [], date(2026, 2, 15), date(2026, 2, 28))
    assert feb == Decimal("14000")

    def stepped(d):
        return Decimal("31000") if d < date(2026, 10, 16) else Decimal("62000")

    # 15 days at 31,000/31 + 16 days at 62,000/31
    assert prorate(stepped, [date(2026, 10, 16)], date(2026, 10, 1), date(2026, 10, 31)) == Decimal(
        "47000"
    )


def test_billing_periods_are_anchored_to_the_lease_start():
    assert billing_period(date(2026, 10, 15), "monthly", date(2026, 9, 1)) is None
    assert billing_period(date(2026, 10, 15), "monthly", date(2026, 11, 1)) == (
        date(2026, 11, 1),
        date(2026, 11, 30),
    )
    assert billing_period(date(2026, 10, 15), "quarterly", date(2026, 11, 1)) is None
    assert billing_period(date(2026, 10, 15), "quarterly", date(2027, 1, 1)) == (
        date(2027, 1, 1),
        date(2027, 3, 31),
    )
    assert describe_range(date(2026, 10, 1), date(2026, 10, 31)) == "Oct 2026"
    assert describe_range(date(2026, 10, 21), date(2026, 10, 31)) == "21–31 Oct 2026"


# --- Runs -----------------------------------------------------------------------


def test_run_bills_rent_once_and_is_idempotent(make_member, org_a, unit_type):
    _, client = make_member(org_a)
    lease = lease_on(unit_type)
    first = run(client, "2026-08")
    assert (first["invoices_created"], first["total_billed"]) == (1, "30000.00")
    invoice = invoices_for(lease).get()
    assert invoice.number == "INV-00001"
    assert invoice.kind == "regular"
    assert (invoice.period_start, invoice.period_end) == (AUG, date(2026, 8, 31))
    assert invoice.due_date == date(2026, 8, 1)
    assert services.lease_balance(lease) == Decimal("30000.00")

    again = run(client, "2026-08")  # scheduled jobs, double clicks, retries…
    assert again["invoices_created"] == 0
    assert invoices_for(lease).count() == 1
    assert LedgerEntry.objects.filter(lease=lease).count() == 1
    assert AuditLog.objects.filter(action="billing.run").count() == 2


def test_first_month_is_prorated_from_move_in(make_member, org_a, unit_type):
    _, client = make_member(org_a)
    lease = lease_on(unit_type, start=date(2026, 8, 21), rent="31000", rent_due_day=5)
    run(client, "2026-08")
    invoice = invoices_for(lease).get()
    assert invoice.total == Decimal("11000.00")  # 11 of 31 days
    assert invoice.lines.get().description == "Rent · 21–31 Aug 2026"
    assert invoice.due_date == date(2026, 8, 21)  # not before the tenancy starts


def test_first_month_in_full_charges_the_whole_first_month(make_member, org_a, unit_type):
    _, client = make_member(org_a)
    add_rule(client, org_a, "security", amount="1500", effective_from="2026-01-01")
    lease = lease_on(
        unit_type, start=date(2026, 8, 29), rent="13000", first_month_in_full=True, rent_due_day=5
    )
    run(client, "2026-08")
    run(client, "2026-09")
    first, second = invoices_for(lease)
    assert first.total == Decimal("14500.00")  # 13,000 rent + 1,500 security, not 3/31 of it
    assert sorted(line.description for line in first.lines.all()) == [
        "Rent · Aug 2026 (first month charged in full)",
        "Security · Aug 2026 (first month charged in full)",
    ]
    assert first.due_date == date(2026, 8, 29)  # still never due before the tenancy starts
    assert second.total == Decimal("14500.00")  # later months are unchanged


def test_first_period_in_full_for_a_quarterly_lease(make_member, org_a, unit_type):
    _, client = make_member(org_a)
    lease = lease_on(
        unit_type,
        start=date(2026, 8, 21),
        rent="20000",
        billing_frequency="quarterly",
        first_month_in_full=True,
    )
    run(client, "2026-08")
    assert invoices_for(lease).get().total == Decimal("60000.00")


def test_first_month_in_full_can_change_until_the_first_period_is_billed(
    make_member, org_a, unit_type
):
    _, client = make_member(org_a)
    lease = lease_on(unit_type, start=date(2026, 8, 29), rent="13000", rent_due_day=5)
    run(client, "2026-08")
    prorated = invoices_for(lease).get()
    assert prorated.total == Decimal("1258.06")  # 3 of 31 days

    url = f"/api/v1/leases/{lease.pk}/first-month/"
    res = client.post(url, {"first_month_in_full": True})
    assert res.status_code == 409  # already billed: void it first
    assert "Void that invoice first" in str(res.data)

    res = client.post(f"/api/v1/invoices/{prorated.pk}/void/", {"reason": "Bill the full month"})
    assert res.status_code == 200, res.data
    res = client.post(url, {"first_month_in_full": True})
    assert res.status_code == 200, res.data
    assert res.data["first_month_in_full"] is True
    run(client, "2026-08")
    assert invoices_for(lease).get().total == Decimal("13000.00")
    assert AuditLog.objects.filter(action="lease.updated", target_id=str(lease.pk)).exists()


def test_rent_change_mid_month_is_split_by_day(make_member, org_a, unit_type):
    _, client = make_member(org_a)
    lease = lease_on(unit_type, rent="31000")
    LeaseRentTerm.objects.create(
        lease=lease, effective_from=date(2026, 9, 16), monthly_rent=Decimal("62000")
    )
    run(client, "2026-09")
    # 15/30 × 31,000 + 15/30 × 62,000 = 15,500 + 31,000
    assert invoices_for(lease).get().total == Decimal("46500.00")


def test_ended_lease_gets_a_prorated_final_bill_and_nothing_after(make_member, org_a, unit_type):
    _, client = make_member(org_a)
    lease = lease_on(unit_type, rent="31000")
    Lease.objects.filter(pk=lease.pk).update(status="ended", ended_on=date(2026, 8, 10))
    run(client, "2026-08")
    run(client, "2026-09")
    assert [i.total for i in invoices_for(lease)] == [Decimal("10000.00")]


def test_quarterly_lease_bills_three_months_on_anchor_months_only(make_member, org_a, unit_type):
    _, client = make_member(org_a)
    lease = lease_on(unit_type, rent="20000", billing_frequency="quarterly")
    run(client, "2026-08")
    run(client, "2026-09")
    run(client, "2026-10")
    invoice = invoices_for(lease).get()
    assert invoice.total == Decimal("60000.00")
    assert (invoice.period_start, invoice.period_end) == (AUG, date(2026, 10, 31))


def test_preview_does_not_post_anything(make_member, org_a, unit_type):
    _, client = make_member(org_a)
    lease = lease_on(unit_type)
    res = client.post("/api/v1/billing-runs/preview/", {"period": "2026-08"})
    assert res.status_code == 200
    assert res.data["invoice_count"] == 1 and res.data["total"] == "30000.00"
    assert not Invoice.objects.filter(lease=lease).exists()


def test_invalid_period_rejected(make_member, org_a):
    _, client = make_member(org_a)
    assert client.post("/api/v1/billing-runs/", {"period": "2026-13"}).status_code == 400


# --- Optional charges (requirement #3) --------------------------------------------


def test_disabled_zero_and_included_charges_never_create_debts(
    make_member, org_a, unit_type, property_
):
    _, client = make_member(org_a)
    opted_out = lease_on(unit_type)
    charged = lease_on(unit_type)
    plain = lease_on(unit_type)

    assert (
        add_rule(
            client, org_a, "security", scope="property", property=property_, amount="1500"
        ).status_code
        == 201
    )
    # This unit opts out of security with a disabled unit-level rule.
    assert (
        add_rule(
            client, org_a, "security", scope="unit", unit=opted_out.unit, is_enabled=False
        ).status_code
        == 201
    )
    # A zero-value charge and a charge included in rent.
    assert add_rule(client, org_a, "garbage", amount="0").status_code == 201
    assert add_rule(client, org_a, "water", included_in_rent=True, amount="500").status_code == 201
    # Parking only for the charged unit; the others have no parking rule at all.
    assert (
        add_rule(
            client, org_a, "parking", scope="unit", unit=charged.unit, amount="2000"
        ).status_code
        == 201
    )

    run(client, "2026-08")
    lines = lambda lease: sorted(  # noqa: E731
        InvoiceLine.objects.filter(invoice__lease=lease).values_list("charge_type__code", "amount")
    )
    assert lines(opted_out) == [("rent", Decimal("30000.00"))]
    assert lines(charged) == [
        ("parking", Decimal("2000.00")),
        ("rent", Decimal("30000.00")),
        ("security", Decimal("1500.00")),
    ]
    assert lines(plain) == [("rent", Decimal("30000.00")), ("security", Decimal("1500.00"))]
    assert services.lease_balance(opted_out) == Decimal("30000.00")
    assert not InvoiceLine.objects.filter(charge_type__code__in=["garbage", "water"]).exists()

    resolved = client.get(
        "/api/v1/charge-rules/resolve/", {"unit": str(opted_out.unit_id), "date": "2026-08-15"}
    ).data
    security = next(c for c in resolved["charges"] if c["charge_type_name"] == "Security")
    assert security["scope"] == "unit" and security["billable"] is False


def test_rule_changes_are_effective_dated(make_member, org_a, unit_type):
    _, client = make_member(org_a)
    lease = lease_on(unit_type)
    rule = add_rule(client, org_a, "security", amount="3100", effective_from="2026-08-01").data
    run(client, "2026-08")

    # Billed rules keep their terms; changing them needs end + new rule.
    assert (
        client.patch(f"/api/v1/charge-rules/{rule['id']}/", {"amount": "9999"}).status_code == 409
    )
    assert (
        client.patch(f"/api/v1/charge-rules/{rule['id']}/", {"description": "Guards"}).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/v1/charge-rules/{rule['id']}/end/", {"effective_to": "2026-08-15"}
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/v1/charge-rules/{rule['id']}/end/", {"effective_to": "2026-09-15"}
        ).status_code
        == 200
    )
    overlap = add_rule(client, org_a, "security", amount="6000", effective_from="2026-09-10")
    assert overlap.status_code == 409
    assert (
        add_rule(client, org_a, "security", amount="6000", effective_from="2026-09-16").status_code
        == 201
    )
    assert client.delete(f"/api/v1/charge-rules/{rule['id']}/").status_code == 409  # billed: kept

    run(client, "2026-09")
    september = invoices_for(lease).last().lines.get(charge_type__code="security")
    # 15 days at 3,100 + 15 days at 6,000 over a 30-day month
    assert september.amount == Decimal("4550.00")


def test_rule_validation(make_member, org_a, property_):
    _, client = make_member(org_a)
    assert add_rule(client, org_a, "rent").status_code == 409  # rent comes from leases
    assert (
        add_rule(client, org_a, "security", method="metered").status_code == 409
    )  # not a meter type
    assert (
        add_rule(client, org_a, "security", scope="property").status_code == 409
    )  # missing target
    res = add_rule(client, org_a, "security", amount="-1")
    assert res.status_code == 400


# --- Metered, one-time and shared charges ----------------------------------------------


def test_metered_usage_is_billed_once_and_rebilled_after_void(make_member, org_a, unit_type):
    _, client = make_member(org_a)
    lease = lease_on(unit_type)
    add_rule(client, org_a, "water", method="metered", amount="150", usage_unit="m³")
    meter = client.post("/api/v1/meters/", {"unit": str(lease.unit_id), "utility": "water"}).data
    for day, value in [("2026-08-01", "100"), ("2026-08-31", "112.5")]:
        assert (
            client.post(
                "/api/v1/meter-readings/",
                {"meter": meter["id"], "reading_date": day, "value": value},
            ).status_code
            == 201
        )

    run(client, "2026-08")
    water = InvoiceLine.objects.get(charge_type__code="water")
    assert (water.quantity, water.amount) == (Decimal("12.500"), Decimal("1875.00"))
    assert "12.5 m³" in water.description

    run(client, "2026-08")
    assert InvoiceLine.objects.filter(charge_type__code="water", is_void=False).count() == 1

    # September's usage rides on September's regular invoice.
    client.post(
        "/api/v1/meter-readings/",
        {"meter": meter["id"], "reading_date": "2026-09-15", "value": "120.5"},
    )
    run(client, "2026-09")
    september = invoices_for(lease).last()
    assert september.kind == "regular"
    assert september.lines.get(charge_type__code="water").amount == Decimal("1200.00")

    # A reading recorded after September was billed goes on a supplementary invoice, alone.
    client.post(
        "/api/v1/meter-readings/",
        {"meter": meter["id"], "reading_date": "2026-09-30", "value": "122.5"},
    )
    run(client, "2026-09")
    extra = invoices_for(lease).last()
    assert extra.kind == "supplementary"
    assert [line.charge_type.code for line in extra.lines.all()] == ["water"]
    assert extra.total == Decimal("300.00")
    assert InvoiceLine.objects.filter(charge_type__code="water", is_void=False).count() == 3

    # Voiding frees the readings so they can be billed again.
    august = invoices_for(lease).first()
    assert (
        client.post(f"/api/v1/invoices/{august.pk}/void/", {"reason": "Wrong rate"}).status_code
        == 200
    )
    run(client, "2026-08")
    assert InvoiceLine.objects.filter(charge_type__code="water", is_void=False).count() == 3


def test_one_time_charge_is_billed_once_per_lease(make_member, org_a, unit_type):
    _, client = make_member(org_a)
    lease = lease_on(unit_type)
    add_rule(client, org_a, "other", method="one_time", amount="2500")
    run(client, "2026-08")
    run(client, "2026-09")
    assert InvoiceLine.objects.filter(invoice__lease=lease, charge_type__code="other").count() == 1


def test_shared_costs_split_exactly_between_units_set_up_to_share(
    make_member, org_a, unit_type, property_
):
    _, client = make_member(org_a)
    leases = [lease_on(unit_type) for _ in range(4)]
    add_rule(
        client,
        org_a,
        "shared_electricity",
        scope="property",
        property=property_,
        method="shared",
        amount="0",
    )
    add_rule(
        client,
        org_a,
        "shared_electricity",
        scope="unit",
        unit=leases[3].unit,
        method="shared",
        is_enabled=False,
    )
    cost = client.post(
        "/api/v1/shared-costs/",
        {
            "property": str(property_.pk),
            "charge_type": str(charge(org_a, "shared_electricity").pk),
            "period": "2026-08-01",
            "total_amount": "1000.00",
        },
    )
    assert cost.status_code == 201, cost.data
    run(client, "2026-08")
    shares = sorted(
        InvoiceLine.objects.filter(shared_cost_id=cost.data["id"]).values_list("amount", flat=True)
    )
    assert shares == [Decimal("333.33"), Decimal("333.33"), Decimal("333.34")]
    assert sum(shares) == Decimal("1000.00")
    assert not InvoiceLine.objects.filter(
        invoice__lease=leases[3], shared_cost__isnull=False
    ).exists()
    detail = client.get(f"/api/v1/shared-costs/{cost.data['id']}/").data
    assert (detail["allocated_amount"], detail["allocated_units"]) == ("1000.00", 3)
    assert client.delete(f"/api/v1/shared-costs/{cost.data['id']}/").status_code == 409


def test_shared_cost_without_sharing_units_is_reported_not_billed(
    make_member, org_a, unit_type, property_
):
    _, client = make_member(org_a)
    lease_on(unit_type)
    client.post(
        "/api/v1/shared-costs/",
        {
            "property": str(property_.pk),
            "charge_type": str(charge(org_a, "shared_electricity").pk),
            "period": "2026-08-01",
            "total_amount": "900",
        },
    )
    result = run(client, "2026-08")
    assert any("not allocated" in note for note in result["skipped"])
    assert not InvoiceLine.objects.filter(shared_cost__isnull=False).exists()


# --- Scheduling and safety nets -------------------------------------------------------


def test_scheduled_billing_runs_once_per_month(org_a, unit_type, monkeypatch):
    lease = lease_on(unit_type)
    monkeypatch.setattr(services, "organization_today", lambda org: date(2026, 8, 3))
    assert services.run_scheduled_billing(org_a) is None  # not enabled
    BillingSettings.objects.create(organization=org_a, auto_generate=True, generate_day=5)
    assert services.run_scheduled_billing(org_a) is None  # before the billing day
    monkeypatch.setattr(services, "organization_today", lambda org: date(2026, 8, 5))
    assert services.run_scheduled_billing(org_a) is not None
    assert services.run_scheduled_billing(org_a) is None
    monkeypatch.setattr(services, "organization_today", lambda org: date(2026, 8, 20))
    assert services.run_scheduled_billing(org_a) is None
    assert invoices_for(lease).count() == 1
    assert BillingRun.objects.filter(trigger="scheduled").count() == 1


def test_database_rejects_duplicate_billing_even_without_the_engine(org_a, unit_type, make_member):
    _, client = make_member(org_a)
    lease_on(unit_type)
    run(client, "2026-08")
    line = InvoiceLine.objects.get()
    with pytest.raises(IntegrityError):
        InvoiceLine.objects.create(
            organization=org_a,
            invoice=line.invoice,
            charge_type=line.charge_type,
            description="dup",
            unit_price=1,
            amount=1,
            income_category=line.income_category,
            dedupe_key=line.dedupe_key,
        )


def test_billing_run_needs_whole_organization_access(make_member, org_a):
    _, accountant = make_member(org_a, role=Role.ACCOUNTANT)
    assert (
        accountant.post("/api/v1/billing-runs/preview/", {"period": "2026-08"}).status_code == 200
    )
    _, manager = make_member(
        org_a, role=Role.PROPERTY_MANAGER, extra_permissions=["billing.generate"]
    )
    assert manager.post("/api/v1/billing-runs/", {"period": "2026-08"}).status_code == 403
    _, caretaker = make_member(org_a, role=Role.CARETAKER)
    assert caretaker.get("/api/v1/invoices/").status_code == 403


def test_units_with_no_lease_are_never_billed(make_member, org_a, unit_type):
    _, client = make_member(org_a)
    UnitFactory(unit_type=unit_type)
    Unit.objects.update(status="available")
    add_rule(client, org_a, "security")
    assert run(client, "2026-08")["invoices_created"] == 0
