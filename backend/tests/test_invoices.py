from datetime import date
from decimal import Decimal

import pytest

from apps.audit.models import AuditLog
from apps.billing import services
from apps.billing.defaults import ensure_default_charge_types
from apps.billing.models import Invoice, LedgerEntry
from apps.organizations.roles import Role

from .factories import LeaseFactory, PropertyFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db


def make_lease(org, start=date(2026, 8, 1), rent="30000"):
    unit_type = UnitTypeFactory(property=PropertyFactory(organization=org))
    return LeaseFactory(unit=UnitFactory(unit_type=unit_type), start_date=start, rent=Decimal(rent))


@pytest.fixture
def billed(make_member, org_a):
    """An owner client and a lease with one posted August invoice of 30,000."""
    _, client = make_member(org_a)
    lease = make_lease(org_a)
    client.post("/api/v1/billing-runs/", {"period": "2026-08"})
    return client, lease, Invoice.objects.get(lease=lease)


def test_invoice_detail_shows_lines_ledger_and_amount_due(billed):
    client, lease, invoice = billed
    data = client.get(f"/api/v1/invoices/{invoice.pk}/").data
    assert data["amount_due"] == "30000.00"
    assert [line["charge_type_name"] for line in data["lines"]] == ["Rent"]
    assert [e["entry_type"] for e in data["ledger_entries"]] == ["invoice"]


def test_partial_credit_reduces_balance_and_is_audited(billed):
    client, lease, invoice = billed
    url = f"/api/v1/invoices/{invoice.pk}/credit/"
    assert client.post(url, {"amount": "5000", "reason": ""}).status_code == 400
    assert client.post(url, {"amount": "40000", "reason": "Too much"}).status_code == 409
    res = client.post(url, {"amount": "5000.50", "reason": "Water outage discount"})
    assert res.status_code == 200
    assert res.data["amount_due"] == "24999.50"
    assert services.lease_balance(lease) == Decimal("24999.50")
    credit = LedgerEntry.objects.get(entry_type="credit")
    assert credit.reference == "CRN-00001" and credit.amount == Decimal("-5000.50")
    log = AuditLog.objects.get(action="invoice.credited")
    assert log.metadata["reason"] == "Water outage discount"
    # Once credited, the invoice can no longer be voided; it must be credited down instead.
    assert client.post(f"/api/v1/invoices/{invoice.pk}/void/", {"reason": "x"}).status_code == 409


def test_void_reverses_the_invoice_in_the_ledger(billed):
    client, lease, invoice = billed
    res = client.post(f"/api/v1/invoices/{invoice.pk}/void/", {"reason": "Billed wrong lease"})
    assert res.status_code == 200
    assert res.data["status"] == "void" and res.data["amount_due"] == "0.00"
    assert services.lease_balance(lease) == Decimal("0.00")
    assert list(LedgerEntry.objects.filter(lease=lease).values_list("entry_type", "amount")) == [
        ("invoice", Decimal("30000.00")),
        ("void", Decimal("-30000.00")),
    ]
    assert (
        client.post(f"/api/v1/invoices/{invoice.pk}/void/", {"reason": "again"}).status_code == 409
    )
    assert (
        client.post(
            f"/api/v1/invoices/{invoice.pk}/credit/", {"amount": "1", "reason": "x"}
        ).status_code
        == 409
    )
    assert AuditLog.objects.filter(action="invoice.voided", target_id=str(invoice.pk)).exists()
    # The period can be billed again after a void.
    client.post("/api/v1/billing-runs/", {"period": "2026-08"})
    assert Invoice.objects.filter(lease=lease, status="issued").count() == 1


def test_posted_records_cannot_be_edited_or_deleted(billed):
    client, lease, invoice = billed
    assert client.patch(f"/api/v1/invoices/{invoice.pk}/", {"total": "1"}).status_code == 405
    assert client.delete(f"/api/v1/invoices/{invoice.pk}/").status_code == 405
    entry = LedgerEntry.objects.get()
    with pytest.raises(PermissionError):
        entry.delete()
    with pytest.raises(PermissionError):
        LedgerEntry.objects.filter(pk=entry.pk).update(amount=1)


def test_one_off_invoice(make_member, org_a):
    _, client = make_member(org_a)
    lease = make_lease(org_a)
    other = next(ct for ct in ensure_default_charge_types(org_a) if ct.code == "other")
    res = client.post(
        "/api/v1/invoices/",
        {
            "lease": str(lease.pk),
            "due_date": "2026-10-31",
            "lines": [
                {
                    "charge_type": str(other.pk),
                    "description": "Replacement gate key",
                    "amount": "800",
                },
                {
                    "charge_type": str(other.pk),
                    "description": "Opening balance (arrears)",
                    "amount": "12000.50",
                },
            ],
        },
        format="json",
    )
    assert res.status_code == 201, res.data
    assert res.data["kind"] == "one_off" and res.data["total"] == "12800.50"
    assert services.lease_balance(lease) == Decimal("12800.50")
    empty = client.post("/api/v1/invoices/", {"lease": str(lease.pk), "lines": []}, format="json")
    assert empty.status_code == 400


def test_statement_has_opening_running_and_closing_balances(billed):
    client, lease, invoice = billed
    client.post(f"/api/v1/invoices/{invoice.pk}/credit/", {"amount": "1000", "reason": "Goodwill"})
    full = client.get(f"/api/v1/leases/{lease.pk}/account/").data
    assert full["balance"] == "29000.00"
    assert [e["balance"] for e in full["entries"]] == ["30000.00", "29000.00"]
    assert full["opening_balance"] == "0.00" and full["closing_balance"] == "29000.00"
    tenant = client.get(f"/api/v1/tenants/{lease.tenant_id}/account/").data
    assert tenant["balance"] == "29000.00"


def test_accountant_can_bill_but_not_correct(make_member, org_a, billed):
    _, lease, invoice = billed
    _, accountant = make_member(org_a, role=Role.ACCOUNTANT)
    assert accountant.get("/api/v1/invoices/").data["count"] == 1
    assert accountant.post("/api/v1/billing-runs/", {"period": "2026-09"}).status_code == 201
    assert (
        accountant.post(f"/api/v1/invoices/{invoice.pk}/void/", {"reason": "x"}).status_code == 403
    )
    assert (
        accountant.post(
            f"/api/v1/invoices/{invoice.pk}/credit/", {"amount": "1", "reason": "x"}
        ).status_code
        == 403
    )
    _, delegated = make_member(org_a, role=Role.ACCOUNTANT, extra_permissions=["billing.adjust"])
    assert (
        delegated.post(
            f"/api/v1/invoices/{invoice.pk}/credit/", {"amount": "1", "reason": "x"}
        ).status_code
        == 200
    )


def test_assigned_manager_sees_only_their_properties_invoices(make_member, org_a):
    _, owner = make_member(org_a)
    mine, theirs = make_lease(org_a), make_lease(org_a)
    owner.post("/api/v1/billing-runs/", {"period": "2026-08"})
    manager, client = make_member(org_a, role=Role.PROPERTY_MANAGER)
    owner.post(
        "/api/v1/property-assignments/",
        {"property": str(mine.unit.property_id), "membership": str(manager.pk)},
    )
    listed = client.get("/api/v1/invoices/").data["results"]
    assert [str(i["lease"]) for i in listed] == [str(mine.pk)]
    other = Invoice.objects.get(lease=theirs)
    assert client.get(f"/api/v1/invoices/{other.pk}/").status_code == 404
    assert client.get(f"/api/v1/leases/{theirs.pk}/account/").status_code == 404
    summary = client.get("/api/v1/billing/summary/").data
    assert summary["outstanding"] == "30000.00"  # only their property


def test_billing_is_isolated_between_organizations(make_member, org_a, org_b, billed):
    _, lease, invoice = billed
    _, outsider = make_member(org_b)
    assert outsider.get(f"/api/v1/invoices/{invoice.pk}/").status_code == 404
    assert outsider.post(f"/api/v1/invoices/{invoice.pk}/void/", {"reason": "x"}).status_code == 404
    assert outsider.get(f"/api/v1/leases/{lease.pk}/account/").status_code == 404
    assert outsider.get("/api/v1/invoices/").data["count"] == 0
    other_ct = next(ct for ct in ensure_default_charge_types(org_b) if ct.code == "other")
    res = outsider.post(
        "/api/v1/invoices/",
        {
            "lease": str(lease.pk),
            "lines": [{"charge_type": str(other_ct.pk), "description": "x", "amount": "1"}],
        },
        format="json",
    )
    assert res.status_code == 400
    # Billing org B never touches org A's leases.
    assert (
        outsider.post("/api/v1/billing-runs/", {"period": "2026-08"}).data["invoices_created"] == 0
    )
    assert outsider.get("/api/v1/billing/summary/").data["outstanding"] == "0.00"
