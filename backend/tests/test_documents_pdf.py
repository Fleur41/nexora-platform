"""Invoice and receipt PDFs: downloads for staff and tenants, and email attachments."""

import io
from datetime import date
from decimal import Decimal

import pytest
from django.core import mail
from pypdf import PdfReader
from rest_framework.test import APIClient

from apps.notifications.models import Notification
from apps.organizations.roles import Role
from apps.payments.models import PaymentConfiguration
from apps.tenants.models import Tenant

from .factories import LeaseFactory, PropertyFactory, UnitFactory, UnitTypeFactory, UserFactory

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _run_on_commit(django_capture_on_commit_callbacks, monkeypatch):
    original = APIClient.generic

    def generic(self, *args, **kwargs):
        with django_capture_on_commit_callbacks(execute=True):
            return original(self, *args, **kwargs)

    monkeypatch.setattr(APIClient, "generic", generic)


def text(content: bytes) -> str:
    return " ".join(page.extract_text() for page in PdfReader(io.BytesIO(content)).pages)


@pytest.fixture
def books(make_member, org_a):
    owner, client = make_member(org_a)
    unit_type = UnitTypeFactory(property=PropertyFactory(organization=org_a, name="Kilimani Court"))
    lease = LeaseFactory(
        unit=UnitFactory(unit_type=unit_type, number="A1"),
        start_date=date(2026, 8, 1),
        rent=Decimal("20000"),
    )
    Tenant.objects.filter(pk=lease.tenant_id).update(
        email="wanjiku@example.com", full_name="Wanjiku <b>Kamau</b>"
    )
    PaymentConfiguration.objects.create(
        organization=org_a,
        provider=PaymentConfiguration.Provider.MPESA_PAYBILL,
        display_name="M-Pesa",
        shortcode="522533",
        is_enabled=True,
    )
    client.post("/api/v1/billing-runs/", {"period": "2026-08"})
    invoice = client.get("/api/v1/invoices/").data["results"][0]
    payment = client.post(
        "/api/v1/payments/",
        {"lease": str(lease.pk), "amount": "5000", "received_on": "2026-08-05", "method": "cash"},
    ).data
    return {"client": client, "lease": lease, "invoice": invoice, "payment": payment}


def test_invoice_and_receipt_emails_carry_the_pdf(books):
    invoice_mail = next(m for m in mail.outbox if "Invoice INV-00001" in m.subject)
    [(name, content, mimetype)] = invoice_mail.attachments
    assert (name, mimetype) == ("INV-00001.pdf", "application/pdf")
    assert "Attached: INV-00001.pdf" in invoice_mail.body
    body = text(content)
    assert "INVOICE" in body and "INV-00001" in body
    assert "Wanjiku <b>Kamau</b>" in body  # user text is escaped, not treated as markup
    assert "Kilimani Court · Unit A1" in body
    # Rendered at send time, before the payment: the full amount was due, with how to pay.
    assert "KES 20,000.00" in body and "M-Pesa paybill 522533" in body

    receipt_mail = next(m for m in mail.outbox if m.subject.startswith("Payment received"))
    [(name, content, _)] = receipt_mail.attachments
    assert name == "RCT-00001.pdf"
    body = text(content)
    assert "RECEIPT" in body and "Payment towards invoice INV-00001" in body
    assert "KES 5,000.00" in body and "Balance owed now: KES 15,000.00" in body


def test_staff_download_reflects_current_state(books):
    client, invoice, payment = books["client"], books["invoice"], books["payment"]
    res = client.get(f"/api/v1/invoices/{invoice['id']}/pdf/")
    assert res.status_code == 200 and res["Content-Type"] == "application/pdf"
    assert res["Content-Disposition"] == 'attachment; filename="INV-00001.pdf"'
    assert res["Cache-Control"] == "private, no-store"
    body = text(res.content)
    assert "Less payments" in body and "Amount due" in body and "KES 15,000.00" in body

    client.post(f"/api/v1/payments/{payment['id']}/reverse/", {"reason": "Bounced"})
    receipt = text(client.get(f"/api/v1/payments/{payment['id']}/pdf/").content)
    assert "REVERSED" in receipt and "Bounced" in receipt
    # Invoices with payments can't be voided; a fresh one can.
    client.post("/api/v1/billing-runs/", {"period": "2026-09"})
    september = client.get("/api/v1/invoices/", {"period": "2026-09"}).data["results"][0]
    res = client.post(f"/api/v1/invoices/{september['id']}/void/", {"reason": "Wrong tenant"})
    assert res.status_code == 200
    voided = text(client.get(f"/api/v1/invoices/{september['id']}/pdf/").content)
    assert "VOID" in voided and "Wrong tenant" in voided and "How to pay" not in voided


def test_unmatched_payment_has_no_receipt(books, org_a):
    from apps.payments.services import record_payment

    payment = record_payment(
        request=None,
        organization=org_a,
        amount=Decimal("100"),
        received_on=date(2026, 8, 6),
        method="mpesa",
        reference="TJX1",
        account_reference="TYPO",
        source="mpesa_c2b",
    )
    assert books["client"].get(f"/api/v1/payments/{payment.pk}/pdf/").status_code == 409


def test_download_permissions_and_isolation(books, make_member, org_a, org_b):
    invoice, payment = books["invoice"], books["payment"]
    _, caretaker = make_member(org_a, role=Role.CARETAKER)
    assert caretaker.get(f"/api/v1/invoices/{invoice['id']}/pdf/").status_code == 403
    assert caretaker.get(f"/api/v1/payments/{payment['id']}/pdf/").status_code == 403
    _, accountant = make_member(org_a, role=Role.ACCOUNTANT)
    assert accountant.get(f"/api/v1/invoices/{invoice['id']}/pdf/").status_code == 200
    _, outsider = make_member(org_b)
    assert outsider.get(f"/api/v1/invoices/{invoice['id']}/pdf/").status_code == 404
    assert outsider.get(f"/api/v1/payments/{payment['id']}/pdf/").status_code == 404


def test_tenants_download_only_their_own(books, org_a):
    lease, invoice, payment = books["lease"], books["invoice"], books["payment"]
    tenant_user = UserFactory()
    Tenant.objects.filter(pk=lease.tenant_id).update(user=tenant_user)
    client = APIClient()
    client.force_authenticate(tenant_user)
    base = f"/api/v1/portal/tenancies/{lease.tenant_id}"
    res = client.get(f"{base}/invoices/{invoice['id']}/pdf/")
    assert res.status_code == 200 and "INV-00001" in text(res.content)
    res = client.get(f"{base}/payments/{payment['id']}/pdf/")
    assert res.status_code == 200 and "RCT-00001" in text(res.content)

    other = LeaseFactory(
        unit=UnitFactory(unit_type=lease.unit.unit_type, number="A2"), start_date=date(2026, 8, 1)
    )
    stranger = UserFactory()
    Tenant.objects.filter(pk=other.tenant_id).update(user=stranger)
    client.force_authenticate(stranger)
    mine = f"/api/v1/portal/tenancies/{other.tenant_id}"
    assert client.get(f"{mine}/invoices/{invoice['id']}/pdf/").status_code == 404
    assert client.get(f"{base}/invoices/{invoice['id']}/pdf/").status_code == 404


def test_email_goes_out_without_the_pdf_if_rendering_fails(books, monkeypatch):
    def broken(_):
        raise RuntimeError("font missing")

    monkeypatch.setattr("apps.notifications.attachments.render_attachment", broken)
    books["client"].post("/api/v1/billing-runs/", {"period": "2026-09"})
    sent = next(m for m in mail.outbox if "INV-00002" in m.subject)
    assert sent.attachments == [] and "Attached" not in sent.body
    note = Notification.objects.get(
        channel="email", dedupe_key__startswith="invoice:", title__contains="INV-00002"
    )
    assert note.status == "sent" and note.attachment.startswith("invoice:")
