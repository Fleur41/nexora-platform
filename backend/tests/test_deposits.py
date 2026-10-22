from datetime import date
from decimal import Decimal

import pytest

from apps.audit.models import AuditLog
from apps.billing import services as billing
from apps.billing.models import InvoiceLine
from apps.deposits.models import DepositTransaction
from apps.organizations.roles import Role

from .factories import LeaseFactory, PropertyFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def lease(org_a):
    unit_type = UnitTypeFactory(property=PropertyFactory(organization=org_a))
    return LeaseFactory(
        unit=UnitFactory(unit_type=unit_type),
        start_date=date(2026, 8, 1),
        deposit_amount=Decimal("30000"),
    )


def record(client, lease, kind, amount, **extra):
    return client.post(
        f"/api/v1/deposits/{lease.pk}/transactions/",
        {"kind": kind, "amount": amount, "transaction_date": "2026-08-01", **extra},
    )


def test_deposit_lifecycle(make_member, org_a, lease):
    _, client = make_member(org_a)
    assert (
        record(client, lease, "received", "20000", method="mpesa", reference="QAB12CD").status_code
        == 201
    )
    summary = client.get(f"/api/v1/deposits/{lease.pk}/").data
    assert (summary["held"], summary["outstanding"]) == ("20000.00", "10000.00")

    assert record(client, lease, "deduction", "5000").status_code == 409  # needs a reason
    assert record(client, lease, "deduction", "25000", reason="Damage").status_code == 409  # > held
    assert record(client, lease, "deduction", "4500", reason="Broken window").status_code == 201
    assert (
        record(
            client, lease, "refund", "15500", reason="Move-out refund", method="mpesa"
        ).status_code
        == 201
    )
    summary = client.get(f"/api/v1/deposits/{lease.pk}/").data
    assert (summary["received"], summary["deducted"], summary["refunded"], summary["held"]) == (
        "20000.00",
        "4500.00",
        "15500.00",
        "0.00",
    )
    assert {"deposit.received", "deposit.deduction", "deposit.refund"} <= set(
        AuditLog.objects.values_list("action", flat=True)
    )


def test_reversals(make_member, org_a, lease):
    _, client = make_member(org_a)
    received = record(client, lease, "received", "30000").data
    deduction = record(client, lease, "deduction", "1000", reason="Cleaning").data
    url = lambda tx: f"/api/v1/deposits/{lease.pk}/transactions/{tx}/reverse/"  # noqa: E731
    # Can't reverse the receipt while money has been deducted from it.
    assert client.post(url(received["id"]), {"reason": "Bounced"}).status_code == 409
    assert client.post(url(deduction["id"]), {"reason": "Charged in error"}).status_code == 201
    assert client.post(url(deduction["id"]), {"reason": "again"}).status_code == 409
    assert client.get(f"/api/v1/deposits/{lease.pk}/").data["held"] == "30000.00"
    assert client.post(url(received["id"]), {"reason": "Cheque bounced"}).status_code == 201
    assert client.get(f"/api/v1/deposits/{lease.pk}/").data["held"] == "0.00"


def test_deposits_are_kept_out_of_rent_and_income(make_member, org_a, lease):
    _, client = make_member(org_a)
    record(client, lease, "received", "30000")
    client.post("/api/v1/billing-runs/", {"period": "2026-08"})
    assert billing.lease_balance(lease) == Decimal("25000.00")  # rent only
    assert not InvoiceLine.objects.exclude(income_category="rental_income").exists()
    totals = client.get("/api/v1/deposits/summary/").data
    assert totals["held"] == "30000.00"


def test_zero_deposit_is_valid(make_member, org_a):
    _, client = make_member(org_a)
    unit_type = UnitTypeFactory(property=PropertyFactory(organization=org_a))
    lease = LeaseFactory(unit=UnitFactory(unit_type=unit_type), start_date=date(2026, 8, 1))
    summary = client.get(f"/api/v1/deposits/{lease.pk}/").data
    assert (summary["agreed"], summary["outstanding"], summary["held"]) == ("0.00", "0.00", "0.00")
    assert client.get("/api/v1/deposits/").data["count"] == 0


def test_deposit_permissions(make_member, org_a, lease):
    _, accountant = make_member(org_a, role=Role.ACCOUNTANT)
    assert record(accountant, lease, "received", "1000").status_code == 201
    assert record(accountant, lease, "deduction", "100", reason="x").status_code == 403
    _, manager = make_member(org_a, role=Role.PROPERTY_MANAGER, access_scope="organization")
    assert manager.get(f"/api/v1/deposits/{lease.pk}/").status_code == 200
    assert record(manager, lease, "received", "1000").status_code == 403
    _, caretaker = make_member(org_a, role=Role.CARETAKER)
    assert caretaker.get("/api/v1/deposits/").status_code == 403


def test_deposit_transactions_are_immutable_and_isolated(make_member, org_a, org_b, lease):
    _, client = make_member(org_a)
    tx = DepositTransaction.objects.get(pk=record(client, lease, "received", "500").data["id"])
    with pytest.raises(PermissionError):
        tx.delete()
    tx.amount = 1
    with pytest.raises(PermissionError):
        tx.save()
    _, outsider = make_member(org_b)
    assert outsider.get(f"/api/v1/deposits/{lease.pk}/").status_code == 404
    assert record(outsider, lease, "received", "1").status_code == 404
