from datetime import date
from decimal import Decimal

import pytest

from apps.audit.models import AuditLog
from apps.billing import services as billing
from apps.billing.models import Invoice, LedgerEntry
from apps.organizations.roles import Role
from apps.payments import services
from apps.payments.models import Payment

from .factories import LeaseFactory, PropertyFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db


def make_lease(org, rent="30000", start=date(2026, 8, 1)):
    unit_type = UnitTypeFactory(property=PropertyFactory(organization=org))
    return LeaseFactory(unit=UnitFactory(unit_type=unit_type), start_date=start, rent=Decimal(rent))


def bill(client, period):
    assert client.post("/api/v1/billing-runs/", {"period": period}).status_code == 201


def pay(client, lease, amount, reference="", method="cash", **extra):
    return client.post(
        "/api/v1/payments/",
        {
            "lease": str(lease.pk),
            "amount": amount,
            "received_on": "2026-08-05",
            "method": method,
            "reference": reference,
            **extra,
        },
        format="json",
    )


def due(invoice) -> Decimal:
    return billing.amount_due(Invoice.objects.get(pk=invoice.pk))


@pytest.fixture
def billed(make_member, org_a):
    _, client = make_member(org_a)
    lease = make_lease(org_a)
    bill(client, "2026-08")
    return client, lease, Invoice.objects.get(lease=lease)


def test_partial_payments_update_balances(billed):
    client, lease, invoice = billed
    first = pay(client, lease, "10000")
    assert first.status_code == 201, first.data
    assert first.data["receipt_number"] == "RCT-00001"
    assert [a["invoice_number"] for a in first.data["allocations"]] == [invoice.number]
    assert due(invoice) == Decimal("20000.00")
    assert billing.lease_balance(lease) == Decimal("20000.00")

    second = pay(client, lease, "25000")
    assert second.data["unallocated"] == "5000.00"  # overpayment held as credit
    assert due(invoice) == Decimal("0.00")
    assert billing.lease_balance(lease) == Decimal("-5000.00")
    assert services.lease_credit(lease) == Decimal("5000.00")

    # Next month's invoice is settled from the credit automatically.
    bill(client, "2026-09")
    september = Invoice.objects.filter(lease=lease).order_by("issue_date", "number").last()
    assert due(september) == Decimal("25000.00")
    assert services.lease_credit(lease) == Decimal("0.00")
    assert billing.lease_balance(lease) == Decimal("25000.00")


def test_payments_go_to_the_oldest_invoice_first(make_member, org_a):
    _, client = make_member(org_a)
    lease = make_lease(org_a)
    bill(client, "2026-08")
    bill(client, "2026-09")
    aug, sep = Invoice.objects.filter(lease=lease).order_by("period_start")
    pay(client, lease, "40000")
    assert (due(aug), due(sep)) == (Decimal("0.00"), Decimal("20000.00"))


def test_manual_allocation_rules(make_member, org_a, org_b, billed):
    client, lease, invoice = billed
    other_lease = make_lease(org_a)
    bill(client, "2026-08")
    other_invoice = Invoice.objects.get(lease=other_lease)
    alloc = lambda inv, amt: [{"invoice": str(inv.pk), "amount": amt}]  # noqa: E731
    assert (
        pay(client, lease, "5000", allocations=alloc(invoice, "6000")).status_code == 409
    )  # > payment
    assert (
        pay(client, lease, "40000", allocations=alloc(invoice, "35000")).status_code == 409
    )  # > due
    assert (
        pay(client, lease, "100", allocations=alloc(other_invoice, "100")).status_code == 409
    )  # other lease
    _, client_b = make_member(org_b)
    foreign = make_lease(org_b)
    bill(client_b, "2026-08")
    foreign_invoice = Invoice.objects.get(lease=foreign)
    # Another organization's invoice isn't even resolvable.
    assert pay(client, lease, "100", allocations=alloc(foreign_invoice, "100")).status_code == 400
    ok = pay(client, lease, "5000", allocations=alloc(invoice, "3000"))
    assert ok.status_code == 201
    assert ok.data["unallocated"] == "2000.00"
    assert due(invoice) == Decimal("27000.00")
    assert due(foreign_invoice) == Decimal("30000.00")


def test_duplicate_references_are_rejected_until_reversed(billed):
    client, lease, invoice = billed
    assert pay(client, lease, "1000", reference="qbc123xyz", method="mpesa").status_code == 201
    dup = pay(client, lease, "1000", reference="QBC123XYZ", method="mpesa")
    assert dup.status_code == 409
    assert Payment.objects.count() == 1
    assert pay(client, lease, "1000", method="mpesa").status_code == 400  # M-Pesa needs its code
    payment = Payment.objects.get()
    client.post(f"/api/v1/payments/{payment.pk}/reverse/", {"reason": "Wrong tenant"})
    assert pay(client, lease, "1000", reference="QBC123XYZ", method="mpesa").status_code == 201


def test_reversal_restores_balances_and_is_audited(billed):
    client, lease, invoice = billed
    payment = pay(client, lease, "35000").data
    url = f"/api/v1/payments/{payment['id']}/reverse/"
    assert client.post(url, {"reason": ""}).status_code == 400
    res = client.post(url, {"reason": "Cheque bounced"})
    assert res.status_code == 200
    assert res.data["status"] == "reversed" and res.data["unallocated"] == "0.00"
    assert all(a["is_reversed"] for a in res.data["allocations"])
    assert due(invoice) == Decimal("30000.00")
    assert billing.lease_balance(lease) == Decimal("30000.00")
    assert client.post(url, {"reason": "again"}).status_code == 409
    assert AuditLog.objects.get(action="payment.reversed").metadata["reason"] == "Cheque bounced"


def test_paid_invoices_cannot_be_voided(billed):
    client, lease, invoice = billed
    pay(client, lease, "100")
    assert client.post(f"/api/v1/invoices/{invoice.pk}/void/", {"reason": "x"}).status_code == 409


def test_refund_of_credit(billed):
    client, lease, invoice = billed
    payment = pay(client, lease, "32000").data
    url = f"/api/v1/payments/{payment['id']}/refund/"
    body = {"amount": "2500", "refunded_on": "2026-08-06", "method": "mpesa", "reason": "Overpaid"}
    assert client.post(url, body).status_code == 409  # only 2,000 is credit
    assert client.post(url, {**body, "amount": "2000"}).status_code == 201
    assert services.lease_credit(lease) == Decimal("0.00")
    assert billing.lease_balance(lease) == Decimal("0.00")
    # A payment whose credit was refunded can no longer be reversed.
    assert (
        client.post(f"/api/v1/payments/{payment['id']}/reverse/", {"reason": "x"}).status_code
        == 409
    )


def test_ledger_and_statement_include_payments(billed):
    client, lease, invoice = billed
    pay(client, lease, "12000")
    account = client.get(f"/api/v1/leases/{lease.pk}/account/").data
    # Ordered by effective date: the payment (5 Aug) precedes the invoice issued today for August.
    assert sorted(e["entry_type"] for e in account["entries"]) == ["invoice", "payment"]
    assert account["balance"] == "18000.00"
    total = sum(LedgerEntry.objects.filter(lease=lease).values_list("amount", flat=True))
    assert total == Decimal("18000.00")


def test_payment_permissions(make_member, org_a, billed):
    _, lease, invoice = billed
    _, accountant = make_member(org_a, role=Role.ACCOUNTANT)
    payment = pay(accountant, lease, "100")
    assert payment.status_code == 201
    assert (
        accountant.post(
            f"/api/v1/payments/{payment.data['id']}/reverse/", {"reason": "x"}
        ).status_code
        == 403
    )
    _, manager = make_member(org_a, role=Role.PROPERTY_MANAGER, access_scope="organization")
    assert manager.get("/api/v1/payments/").data["count"] == 1
    assert pay(manager, lease, "100").status_code == 403
    _, caretaker = make_member(org_a, role=Role.CARETAKER, access_scope="organization")
    assert caretaker.get("/api/v1/payments/").status_code == 403


def test_payments_are_isolated_between_organizations(make_member, org_a, org_b, billed):
    client, lease, invoice = billed
    payment = pay(client, lease, "100").data
    _, outsider = make_member(org_b)
    assert outsider.get(f"/api/v1/payments/{payment['id']}/").status_code == 404
    assert (
        outsider.post(f"/api/v1/payments/{payment['id']}/reverse/", {"reason": "x"}).status_code
        == 404
    )
    assert pay(outsider, lease, "100").status_code == 400
    assert outsider.get("/api/v1/payments/summary/").data["collected_this_month"] == "0.00"


def test_payment_dates_and_amounts_are_validated(billed):
    client, lease, invoice = billed
    assert pay(client, lease, "0").status_code == 400
    future = client.post(
        "/api/v1/payments/",
        {"lease": str(lease.pk), "amount": "10", "received_on": "2099-01-01", "method": "cash"},
    )
    assert future.status_code == 409


# --- Moving a payment between invoices ---------------------------------------------------


@pytest.fixture
def two_months(billed):
    client, lease, august = billed
    bill(client, "2026-09")
    september = Invoice.objects.filter(lease=lease).exclude(pk=august.pk).get()
    payment = pay(client, lease, "30000").data  # settles August in full
    return client, lease, august, september, payment


def move(client, payment, from_invoice, amount, to_invoice=None, reason="Paid for September"):
    return client.post(
        f"/api/v1/payments/{payment['id']}/move-allocation/",
        {
            "from_invoice": str(from_invoice.pk),
            "to_invoice": str(to_invoice.pk) if to_invoice else None,
            "amount": amount,
            "reason": reason,
        },
        format="json",
    )


def test_move_part_of_a_payment_to_another_invoice(two_months):
    client, lease, august, september, payment = two_months
    res = move(client, payment, august, "10000", september)
    assert res.status_code == 200, res.data
    assert (due(august), due(september)) == (Decimal("10000.00"), Decimal("20000.00"))
    assert billing.lease_balance(lease) == Decimal("30000.00")  # the total owed is unchanged
    active = {
        (a["invoice_number"], a["amount"]) for a in res.data["allocations"] if not a["is_reversed"]
    }
    assert active == {(august.number, "20000.00"), (september.number, "10000.00")}
    # The original allocation stays as history.
    assert any(a["is_reversed"] and a["amount"] == "30000.00" for a in res.data["allocations"])
    log = AuditLog.objects.get(action="payment.allocation_moved")
    assert log.metadata["from"] == august.number and log.metadata["to"] == september.number
    assert log.metadata["reason"] == "Paid for September"
    moved = LedgerEntry.objects.filter(payment_id=payment["id"], invoice=august, amount=10000)
    assert moved.get().reason == "Paid for September"


def test_move_a_payment_back_to_credit_then_refund_it(two_months):
    client, lease, august, _, payment = two_months
    res = move(client, payment, august, "5000", reason="Tenant asked for a refund")
    assert res.status_code == 200, res.data
    assert res.data["unallocated"] == "5000.00"
    assert due(august) == Decimal("5000.00")
    assert services.lease_credit(lease) == Decimal("5000.00")
    refund = client.post(
        f"/api/v1/payments/{payment['id']}/refund/",
        {
            "amount": "5000",
            "refunded_on": "2026-08-06",
            "method": "mpesa",
            "reference": "R1",
            "reason": "Overpaid",
        },
    )
    assert refund.status_code == 201, refund.data
    assert services.lease_credit(lease) == Decimal("0.00")


def test_moving_off_an_invoice_allows_voiding_it(two_months):
    client, _, august, september, payment = two_months
    void = lambda: client.post(f"/api/v1/invoices/{august.pk}/void/", {"reason": "Billed twice"})  # noqa: E731
    assert void().status_code == 409
    assert move(client, payment, august, "30000", september).status_code == 200
    assert void().status_code == 200
    assert due(august) == Decimal("0.00")


def test_reversing_a_moved_payment_undoes_everything(two_months):
    client, lease, august, september, payment = two_months
    move(client, payment, august, "10000", september)
    res = client.post(f"/api/v1/payments/{payment['id']}/reverse/", {"reason": "Bounced"})
    assert res.status_code == 200, res.data
    assert (due(august), due(september)) == (Decimal("30000.00"), Decimal("30000.00"))
    assert billing.lease_balance(lease) == Decimal("60000.00")
    assert all(a["is_reversed"] for a in res.data["allocations"])


def test_moves_are_validated(two_months, make_member, org_a):
    client, lease, august, september, payment = two_months
    assert move(client, payment, august, "30000.01").status_code == 409
    assert move(client, payment, september, "1").status_code == 409  # nothing applied there
    assert move(client, payment, august, "1", august).status_code == 409
    assert move(client, payment, august, "1", reason="").status_code == 400
    paid = pay(
        client, lease, "25000", allocations=[{"invoice": str(september.pk), "amount": "25000"}]
    )
    assert paid.status_code == 201, paid.data
    too_much = move(client, payment, august, "5000.01", september)
    assert too_much.status_code == 409
    assert "only has 5000.00 due" in str(too_much.data)
    other = make_lease(org_a)
    bill(client, "2026-08")
    elsewhere = Invoice.objects.filter(lease=other).first()
    res = move(client, payment, august, "1", elsewhere)
    assert res.status_code == 409
    assert "different lease" in str(res.data)
    # A correction, so it needs payments.reverse (owner-only by default).
    _, accountant = make_member(org_a, role=Role.ACCOUNTANT)
    assert move(accountant, payment, august, "1").status_code == 403
