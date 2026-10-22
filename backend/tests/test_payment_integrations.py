from datetime import date
from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import override_settings
from rest_framework.test import APIClient

from apps.billing import services as billing
from apps.billing.models import Invoice
from apps.organizations.roles import Role
from apps.payments.models import (
    IntegrationCredential,
    Payment,
    PaymentConfiguration,
    PaymentRequest,
    ProviderEvent,
)
from apps.payments.providers.mpesa import DarajaClient, DarajaError

from .factories import LeaseFactory, PropertyFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db


def make_lease(org, rent="20000"):
    unit_type = UnitTypeFactory(property=PropertyFactory(organization=org))
    return LeaseFactory(
        unit=UnitFactory(unit_type=unit_type, number="B7"),
        start_date=date(2026, 8, 1),
        rent=Decimal(rent),
        reference="LSE-0042",  # realistic format (statement matching looks for LSE-<digits>)
    )


def configure(client, **fields):
    payload = {
        "provider": "mpesa_paybill",
        "display_name": "Rent paybill",
        "shortcode": "600123",
        **fields,
    }
    res = client.post("/api/v1/payment-configurations/", payload)
    assert res.status_code == 201, res.data
    return res.data


class FakeDaraja:
    """Stands in for Safaricom: records calls and returns canned responses."""

    def __init__(self):
        self.calls = []
        self.fail_oauth = False
        self.stk_query_result = "0"

    def __call__(self, client, method, path, *, headers, body=None):
        self.calls.append((method, path, body))
        if path.startswith("/oauth"):
            if self.fail_oauth:
                raise DarajaError("M-Pesa rejected the request: Invalid credentials", status=400)
            return {"access_token": "tok", "expires_in": "3599"}
        if path.endswith("/processrequest"):
            return {"MerchantRequestID": "m-1", "CheckoutRequestID": "ws_CO_1", "ResponseCode": "0"}
        if path.endswith("/query"):
            return {"ResultCode": self.stk_query_result, "ResultDesc": "ok"}
        if path.endswith("/registerurl"):
            return {"ResponseCode": "0", "ResponseDescription": "success"}
        raise AssertionError(path)


@pytest.fixture
def daraja(monkeypatch):
    fake = FakeDaraja()
    monkeypatch.setattr(
        DarajaClient, "_request", lambda self, method, path, **kw: fake(self, method, path, **kw)
    )
    return fake


@pytest.fixture
def verified(make_member, org_a, daraja):
    """Owner client, a lease billed for August, and a verified M-Pesa paybill."""
    _, client = make_member(org_a)
    lease = make_lease(org_a)
    client.post("/api/v1/billing-runs/", {"period": "2026-08"})
    config = configure(client)
    client.post(
        f"/api/v1/payment-configurations/{config['id']}/credentials/",
        {"consumer_key": "ck", "consumer_secret": "cs", "passkey": "pk"},
    )
    tested = client.post(f"/api/v1/payment-configurations/{config['id']}/test/")
    assert tested.data["integration_status"] == "verified"
    return client, lease, PaymentConfiguration.objects.get(pk=config["id"])


def callback(config, kind, payload, **headers):
    token = config.callback_token
    path = {"c2b": "c2b/confirmation", "validation": "c2b/validation", "stk": "stk/callback"}[kind]
    return APIClient().post(
        f"/api/v1/integrations/mpesa/{token}/{path}/", payload, format="json", **headers
    )


def c2b(trans_id="QJK1ABC2DE", amount="20000", account="LSE-0042", shortcode="600123"):
    return {
        "TransactionType": "Pay Bill",
        "TransID": trans_id,
        "TransTime": "20260805101500",
        "TransAmount": amount,
        "BusinessShortCode": shortcode,
        "BillRefNumber": account,
        "MSISDN": "254712345678",
        "FirstName": "Achieng",
    }


# --- Configurations (requirements #7, #8) -------------------------------------------------


def test_each_landlord_has_their_own_payment_methods(make_member, org_a, org_b):
    _, owner_a = make_member(org_a)
    _, owner_b = make_member(org_b)
    configure(owner_a, display_name="A paybill", shortcode="111111")
    configure(owner_b, provider="mpesa_till", display_name="B till", shortcode="222222")
    configure(
        owner_b,
        provider="bank",
        display_name="B bank",
        bank_name="KCB",
        account_name="B Ltd",
        account_number="1234567890",
    )
    lease_a, lease_b = make_lease(org_a), make_lease(org_b)
    methods_a = owner_a.get(f"/api/v1/leases/{lease_a.pk}/payment-instructions/").data["methods"]
    methods_b = owner_b.get(f"/api/v1/leases/{lease_b.pk}/payment-instructions/").data["methods"]
    assert [m["shortcode"] for m in methods_a] == ["111111"]
    assert sorted(m["display_name"] for m in methods_b) == ["B bank", "B till"]
    assert owner_a.get("/api/v1/payment-configurations/").data[0]["display_name"] == "A paybill"
    assert owner_b.get(f"/api/v1/leases/{lease_a.pk}/payment-instructions/").status_code == 404


def test_property_methods_replace_organization_methods(make_member, org_a):
    _, owner = make_member(org_a)
    lease = make_lease(org_a)
    configure(owner, display_name="Head office paybill")
    configure(
        owner,
        display_name="Estate paybill",
        shortcode="777777",
        property=str(lease.unit.property_id),
    )
    configure(owner, display_name="Old paybill", shortcode="888888", is_enabled=False)
    methods = owner.get(f"/api/v1/leases/{lease.pk}/payment-instructions/").data["methods"]
    assert [m["display_name"] for m in methods] == ["Estate paybill"]
    assert methods[0]["account_number_to_use"] == lease.reference.replace("-", "")


def test_configuration_validation(make_member, org_a):
    _, owner = make_member(org_a)
    assert (
        owner.post(
            "/api/v1/payment-configurations/",
            {"provider": "mpesa_paybill", "display_name": "x", "shortcode": "12"},
        ).status_code
        == 400
    )
    bank = owner.post(
        "/api/v1/payment-configurations/", {"provider": "bank", "display_name": "Bank"}
    )
    assert set(bank.data["error"]["details"]) == {"bank_name", "account_number"}
    _, accountant = make_member(org_a, role=Role.ACCOUNTANT)
    assert (
        accountant.post(
            "/api/v1/payment-configurations/", {"provider": "cash", "display_name": "Cash"}
        ).status_code
        == 403
    )


def test_changing_settings_preserves_payment_history(make_member, org_a):
    _, owner = make_member(org_a)
    lease = make_lease(org_a)
    config = configure(owner, shortcode="400200")
    owner.post(
        "/api/v1/payments/",
        {
            "lease": str(lease.pk),
            "amount": "500",
            "received_on": "2026-08-05",
            "configuration": config["id"],
            "reference": "QAA1",
        },
    )
    assert (
        owner.patch(
            f"/api/v1/payment-configurations/{config['id']}/", {"shortcode": "999999"}
        ).status_code
        == 200
    )
    payment = Payment.objects.get()
    assert payment.configuration_snapshot["shortcode"] == "400200"
    detail = owner.get(f"/api/v1/payments/{payment.pk}/").data
    assert detail["configuration_snapshot"]["shortcode"] == "400200"


def test_credentials_are_write_only_and_encrypted(make_member, org_a, daraja):
    _, owner = make_member(org_a)
    config = configure(owner)
    res = owner.post(
        f"/api/v1/payment-configurations/{config['id']}/credentials/",
        {"consumer_key": "my-key", "consumer_secret": "super-secret", "passkey": "pass-key"},
    )
    assert res.status_code == 200
    body = str(res.data)
    assert "super-secret" not in body and "my-key" not in body
    assert res.data["has_credentials"] and res.data["has_passkey"]
    assert res.data["integration_status"] == "credentials_saved"
    with connection.cursor() as cursor:
        cursor.execute("SELECT consumer_secret FROM payments_integrationcredential")
        raw = cursor.fetchone()[0]
    assert raw and "super-secret" not in raw
    assert IntegrationCredential.objects.get().consumer_secret == "super-secret"
    # Only managers see callback URLs (they contain the secret token).
    _, accountant = make_member(org_a, role=Role.ACCOUNTANT)
    assert (
        accountant.get(f"/api/v1/payment-configurations/{config['id']}/").data["callback_urls"]
        is None
    )
    assert (
        owner.get(f"/api/v1/payment-configurations/{config['id']}/")
        .data["callback_urls"]["confirmation"]
        .startswith("https://")
    )


def test_connection_failures_are_reported_truthfully(make_member, org_a, daraja):
    _, owner = make_member(org_a)
    config = configure(owner)
    no_creds = owner.post(f"/api/v1/payment-configurations/{config['id']}/test/")
    assert no_creds.status_code == 409
    owner.post(
        f"/api/v1/payment-configurations/{config['id']}/credentials/",
        {"consumer_key": "a", "consumer_secret": "b"},
    )
    daraja.fail_oauth = True
    res = owner.post(f"/api/v1/payment-configurations/{config['id']}/test/")
    assert res.data["integration_status"] == "failed"
    assert "Invalid credentials" in res.data["integration_message"]
    # Can't register callbacks or request payments without a verified connection.
    assert (
        owner.post(f"/api/v1/payment-configurations/{config['id']}/register-c2b/").status_code
        == 409
    )


# --- C2B callbacks (requirement #5) ----------------------------------------------------------


def test_c2b_confirmation_is_idempotent(verified):
    client, lease, config = verified
    first = callback(config, "c2b", c2b(account=lease.reference))
    assert first.status_code == 200 and first.data["ResultCode"] == 0
    again = callback(config, "c2b", c2b(account=lease.reference))
    assert again.status_code == 200
    payment = Payment.objects.get()
    assert (payment.source, payment.reference, payment.lease_id) == (
        "mpesa_c2b",
        "QJK1ABC2DE",
        lease.pk,
    )
    assert billing.lease_balance(lease) == Decimal("0.00")
    statuses = list(ProviderEvent.objects.order_by("created_at").values_list("status", flat=True))
    assert statuses == ["processed", "duplicate"]
    assert "254712345678" not in str(ProviderEvent.objects.first().payload)  # phone masked


def test_c2b_matches_by_unit_number_or_goes_to_reconciliation(verified):
    client, lease, config = verified
    callback(config, "c2b", c2b(trans_id="T1", amount="500", account="b7"))
    assert Payment.objects.get(reference="T1").lease_id == lease.pk
    callback(config, "c2b", c2b(trans_id="T2", amount="700", account="NO SUCH UNIT"))
    unmatched = Payment.objects.get(reference="T2")
    assert unmatched.lease_id is None
    queue = client.get("/api/v1/payments/", {"matched": "false"}).data
    assert [p["reference"] for p in queue["results"]] == ["T2"]
    matched = client.post(f"/api/v1/payments/{unmatched.pk}/match/", {"lease": str(lease.pk)})
    assert matched.status_code == 200 and matched.data["is_matched"]
    assert billing.lease_balance(lease) == Decimal("18800.00")
    assert (
        client.post(f"/api/v1/payments/{unmatched.pk}/match/", {"lease": str(lease.pk)}).status_code
        == 409
    )


def test_callbacks_reject_bad_requests(verified, settings):
    client, lease, config = verified
    assert (
        APIClient()
        .post("/api/v1/integrations/mpesa/wrong-token/c2b/confirmation/", c2b(), format="json")
        .status_code
        == 404
    )
    callback(config, "c2b", c2b(trans_id="T9", shortcode="999999"))
    callback(config, "c2b", c2b(trans_id="", amount="0"))
    assert not Payment.objects.exists()
    assert set(ProviderEvent.objects.values_list("status", flat=True)) == {"rejected"}
    settings.MPESA_CALLBACK_ALLOWED_IPS = ["196.201.214.200"]
    assert callback(config, "c2b", c2b(trans_id="T10")).status_code == 403
    assert callback(config, "validation", c2b()).status_code == 403


def test_c2b_validation_rejects_disabled_methods(verified):
    client, lease, config = verified
    assert callback(config, "validation", c2b()).data["ResultCode"] == 0
    PaymentConfiguration.objects.filter(pk=config.pk).update(is_enabled=False)
    assert callback(config, "validation", c2b()).data["ResultCode"] == "C2B00016"


# --- STK push (requirement #19: provider failures are handled safely) --------------------------


def stk_payload(result_code=0, amount=20000, receipt="QKR7XY12AB", checkout="ws_CO_1"):
    body = {
        "MerchantRequestID": "m-1",
        "CheckoutRequestID": checkout,
        "ResultCode": result_code,
        "ResultDesc": "done",
    }
    if result_code == 0:
        body["CallbackMetadata"] = {
            "Item": [
                {"Name": "Amount", "Value": amount},
                {"Name": "MpesaReceiptNumber", "Value": receipt},
                {"Name": "TransactionDate", "Value": 20260805101500},
                {"Name": "PhoneNumber", "Value": 254712345678},
            ]
        }
    return {"Body": {"stkCallback": body}}


def request_stk(client, lease, amount="20000", phone="0712 345 678"):
    return client.post(
        "/api/v1/payment-requests/", {"lease": str(lease.pk), "amount": amount, "phone": phone}
    )


def test_stk_payment_is_verified_before_recording(verified, daraja):
    client, lease, config = verified
    res = request_stk(client, lease)
    assert res.status_code == 201, res.data
    assert res.data["status"] == "pending" and res.data["phone"].endswith("678")
    push = next(body for _, path, body in daraja.calls if path.endswith("processrequest"))
    assert push["PhoneNumber"] == "254712345678" and push["Amount"] == 20000
    assert push["CallBackURL"].endswith("/stk/callback/")

    assert callback(config, "stk", stk_payload()).status_code == 200
    assert any(path.endswith("/query") for _, path, _ in daraja.calls)  # server-side verification
    payment = Payment.objects.get()
    assert (payment.source, payment.reference, payment.amount) == (
        "mpesa_stk",
        "QKR7XY12AB",
        Decimal("20000.00"),
    )
    assert PaymentRequest.objects.get().status == "completed"
    assert billing.lease_balance(lease) == Decimal("0.00")
    callback(config, "stk", stk_payload())  # Safaricom retries
    assert Payment.objects.count() == 1


def test_cancelled_or_unverified_stk_payments_record_nothing(verified, daraja):
    client, lease, config = verified
    request_stk(client, lease)
    callback(config, "stk", stk_payload(result_code=1032))  # cancelled by the tenant
    assert PaymentRequest.objects.get().status == "failed"
    assert not Payment.objects.exists()

    PaymentRequest.objects.update(status="pending", checkout_request_id="ws_CO_2")
    callback(config, "stk", stk_payload(checkout="ws_CO_2", amount=1))  # amount mismatch
    assert PaymentRequest.objects.get().status == "needs_review"

    PaymentRequest.objects.update(status="pending")
    daraja.stk_query_result = "1"
    callback(config, "stk", stk_payload(checkout="ws_CO_2"))  # Safaricom doesn't confirm it
    assert PaymentRequest.objects.get().status == "needs_review"
    assert not Payment.objects.exists()
    failed = ProviderEvent.objects.filter(status="failed").values_list("message", flat=True)
    assert any("did not confirm" in m for m in failed)


def test_stk_provider_errors_and_validation(verified, daraja, monkeypatch):
    client, lease, config = verified
    assert request_stk(client, lease, amount="100.50").status_code == 409  # whole shillings only
    assert request_stk(client, lease, phone="0800 000 000").status_code == 409
    monkeypatch.setattr(
        DarajaClient,
        "_request",
        lambda self, *a, **k: (_ for _ in ()).throw(
            DarajaError("Could not reach M-Pesa. Try again shortly.")
        ),
    )
    res = request_stk(client, lease)
    assert res.status_code == 502
    assert res.data["error"]["message"] == "Could not reach M-Pesa. Try again shortly."
    assert not PaymentRequest.objects.exists()


@override_settings(NEXORA_PUBLIC_API_URL="")
def test_stk_needs_a_public_callback_url(verified):
    client, lease, config = verified
    assert request_stk(client, lease).status_code == 409


def test_register_c2b_urls(verified, daraja):
    client, lease, config = verified
    res = client.post(f"/api/v1/payment-configurations/{config.pk}/register-c2b/")
    assert res.status_code == 200 and res.data["c2b_registered_at"]
    body = next(b for _, path, b in daraja.calls if path.endswith("registerurl"))
    assert body["ShortCode"] == "600123" and body["ConfirmationURL"].startswith(
        "https://api.nexora.test/"
    )


# --- Bank statement import ------------------------------------------------------------------------


def statement(rows: str):
    return SimpleUploadedFile("statement.csv", rows.encode(), content_type="text/csv")


def test_statement_import_matches_and_deduplicates(make_member, org_a):
    _, owner = make_member(org_a)
    lease = make_lease(org_a)
    owner.post("/api/v1/billing-runs/", {"period": "2026-08"})
    bank = owner.post(
        "/api/v1/payment-configurations/",
        {
            "provider": "bank",
            "display_name": "Equity",
            "bank_name": "Equity",
            "account_number": "0100",
        },
    ).data
    csv_rows = (
        "Transaction Date,Narration,Reference,Credit\n"
        f"05/08/2026,RENT {lease.reference} AUG,FT001,15000\n"
        '06/08/2026,Unknown deposit,FT002,"2,500.00"\n'
        "07/08/2026,Bank charges,FT003,-150\n"
        "bad,row,FT004,abc\n"
    )
    res = owner.post(
        "/api/v1/statement-imports/",
        {"configuration": bank["id"], "file": statement(csv_rows)},
        format="multipart",
    )
    assert res.status_code == 201, res.data
    assert (res.data["rows_created"], res.data["rows_matched"], res.data["rows_skipped"]) == (
        2,
        1,
        2,
    )
    assert billing.amount_due(Invoice.objects.get(lease=lease)) == Decimal("5000.00")
    assert Payment.objects.filter(lease__isnull=True).get().amount == Decimal("2500.00")

    again = owner.post(
        "/api/v1/statement-imports/",
        {"configuration": bank["id"], "file": statement(csv_rows)},
        format="multipart",
    )
    assert (again.data["rows_created"], again.data["rows_duplicate"]) == (0, 2)
    assert Payment.objects.count() == 2


def test_statement_import_rejects_unusable_files(make_member, org_a):
    _, owner = make_member(org_a)
    bank = owner.post(
        "/api/v1/payment-configurations/",
        {"provider": "bank", "display_name": "KCB", "bank_name": "KCB", "account_number": "1"},
    ).data
    paybill = configure(owner)
    no_cols = owner.post(
        "/api/v1/statement-imports/",
        {"configuration": bank["id"], "file": statement("foo,bar\n1,2\n")},
        format="multipart",
    )
    assert no_cols.status_code == 409
    wrong = owner.post(
        "/api/v1/statement-imports/",
        {"configuration": paybill["id"], "file": statement("Date,Amount\n2026-08-01,1\n")},
        format="multipart",
    )
    assert wrong.status_code == 409
