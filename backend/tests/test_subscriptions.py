from datetime import date, timedelta
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.notifications.models import Notification
from apps.organizations.models import Organization
from apps.organizations.roles import Role
from apps.subscriptions import services
from apps.subscriptions.models import Plan, Subscription, SubscriptionInvoice

from .factories import PropertyFactory, UnitFactory, UnitTypeFactory, UserFactory

pytestmark = pytest.mark.django_db
TODAY = date(2026, 11, 1)


def plan(code):
    return Plan.objects.get(code=code)


def sub_of(org):
    return services.subscription_for(org)


@pytest.fixture
def owner(make_member, org_a):
    membership, client = make_member(org_a)
    return membership, client


def test_new_organizations_start_a_trial(django_capture_on_commit_callbacks):
    user = UserFactory()
    client = APIClient()
    client.force_authenticate(user)
    with django_capture_on_commit_callbacks(execute=True):
        res = client.post("/api/v1/organizations/", {"name": "Trial Homes"})
    assert res.status_code == 201
    sub = Subscription.objects.get(organization__name="Trial Homes")
    assert (sub.status, sub.plan.code) == ("trialing", "growth")
    assert (sub.trial_ends_on - date.today()).days == 30
    assert sub.account_code.startswith("NX") and len(sub.account_code) == 8


def test_unit_limit_blocks_units_beyond_the_plan(owner, org_a):
    _, client = owner
    sub = sub_of(org_a)
    sub.plan = plan("starter")  # 20 units
    sub.save()
    prop = PropertyFactory(organization=org_a)
    unit_type = UnitTypeFactory(property=prop)
    res = client.post(
        "/api/v1/units/bulk/",
        {
            "property": str(prop.pk),
            "unit_type": str(unit_type.pk),
            "prefix": "A",
            "start": 1,
            "count": 21,
        },
    )
    assert res.status_code == 409
    assert "Starter plan allows 20 units" in str(res.data)
    ok = client.post(
        "/api/v1/units/bulk/",
        {
            "property": str(prop.pk),
            "unit_type": str(unit_type.pk),
            "prefix": "A",
            "start": 1,
            "count": 20,
        },
    )
    assert ok.status_code == 201
    one_more = client.post(
        "/api/v1/units/",
        {"property": str(prop.pk), "unit_type": str(unit_type.pk), "number": "X1"},
    )
    assert one_more.status_code == 409
    # Downgrading below current usage is refused; upgrading makes room.
    assert client.post("/api/v1/subscription/change-plan/", {"plan": "starter"}).status_code == 200
    res = client.post("/api/v1/subscription/change-plan/", {"plan": "growth"})
    assert res.status_code == 200 and res.data["plan"]["code"] == "growth"
    UnitFactory.create_batch(1, unit_type=unit_type)
    assert client.post("/api/v1/subscription/change-plan/", {"plan": "starter"}).status_code == 409


def test_lifecycle_invoices_then_past_due_then_read_only_until_paid(owner, org_a):
    membership, client = owner
    sub = sub_of(org_a)
    sub.trial_ends_on = TODAY + timedelta(days=5)
    sub.save()

    # A week before the trial ends: invoice the first paid month, once.
    assert services.run_lifecycle(TODAY).invoiced == 1
    assert services.run_lifecycle(TODAY).invoiced == 0
    invoice = SubscriptionInvoice.objects.get(organization=org_a)
    assert (invoice.number, invoice.amount, invoice.period_start) == (
        "NXI-0001",
        Decimal("7500.00"),
        TODAY + timedelta(days=6),
    )
    assert Notification.objects.filter(kind="subscription", recipient_user=membership.user).exists()

    # Unpaid after the trial: past due (still full access).
    services.run_lifecycle(TODAY + timedelta(days=6))
    assert sub_of(org_a).status == "past_due"
    assert client.post("/api/v1/properties/", {"name": "Still allowed"}).status_code == 201

    # Two weeks later: read-only. Viewing works; changes don't; paying and plan changes do.
    services.run_lifecycle(TODAY + timedelta(days=5 + 15))
    assert sub_of(org_a).status == "lapsed"
    res = client.post("/api/v1/properties/", {"name": "Blocked"})
    assert res.status_code == 403 and res.data["error"]["code"] == "subscription_lapsed"
    assert client.get("/api/v1/properties/").status_code == 200
    summary = client.get("/api/v1/subscription/").data
    assert summary["read_only"] is True and summary["open_invoice"]["number"] == "NXI-0001"
    assert client.post("/api/v1/subscription/change-plan/", {"plan": "pro"}).status_code == 200
    invoice.refresh_from_db()
    assert invoice.amount == Decimal("25000.00")  # re-priced to the new plan

    services.mark_paid(invoice=invoice, method="bank", reference="FT123")
    sub = sub_of(org_a)
    assert (sub.status, sub.paid_until) == ("active", invoice.period_end)
    assert client.post("/api/v1/properties/", {"name": "Allowed again"}).status_code == 201
    assert AuditLog.objects.filter(action="subscription.paid").exists()


def test_complimentary_and_agreement_priced_plans_are_never_invoiced(org_a, org_b):
    for org, change in ((org_a, {"complimentary": True}), (org_b, {"plan": plan("enterprise")})):
        sub = sub_of(org)
        for k, v in change.items():
            setattr(sub, k, v)
        sub.trial_ends_on = TODAY
        sub.save()
    services.run_lifecycle(TODAY + timedelta(days=60))
    assert not SubscriptionInvoice.objects.exists()
    assert sub_of(org_a).status == "trialing"  # complimentary never lapses
    assert sub_of(org_b).status == "lapsed"  # agreement-priced: staff extend paid-until by hand


def test_mpesa_prompt_and_callback(owner, org_a, settings, monkeypatch):
    _, client = owner
    settings.NEXORA_PAYBILL = "600100"
    settings.NEXORA_MPESA_CONSUMER_KEY = "key"
    settings.NEXORA_MPESA_CONSUMER_SECRET = "secret"
    settings.NEXORA_MPESA_PASSKEY = "pass"
    settings.NEXORA_PUBLIC_API_URL = "https://api.nexora.example"
    sent = {}

    def fake_push(self, **kwargs):
        sent.update(kwargs)
        return {"CheckoutRequestID": "ws_CO_123", "MerchantRequestID": "m1", "ResponseCode": "0"}

    monkeypatch.setattr("apps.payments.providers.mpesa.DarajaClient.stk_push", fake_push)
    sub = sub_of(org_a)
    invoice = services.issue_invoice(sub, TODAY)
    res = client.post(f"/api/v1/subscription/invoices/{invoice.pk}/pay/", {"phone": "0712 345 678"})
    assert res.status_code == 201
    assert sent["account_reference"] == sub.account_code and sent["amount"] == 7500
    assert sent["callback_url"] == "https://api.nexora.example/api/v1/subscription/mpesa/callback/"

    callback = {
        "Body": {
            "stkCallback": {
                "CheckoutRequestID": "ws_CO_123",
                "ResultCode": 0,
                "CallbackMetadata": {
                    "Item": [{"Name": "MpesaReceiptNumber", "Value": "TKX123ABC"}]
                },
            }
        }
    }
    for _ in range(2):  # repeated callbacks are harmless
        assert (
            APIClient()
            .post("/api/v1/subscription/mpesa/callback/", callback, format="json")
            .status_code
            == 200
        )
    invoice.refresh_from_db()
    assert (invoice.status, invoice.payment_method, invoice.payment_reference) == (
        "paid",
        "mpesa",
        "TKX123ABC",
    )
    assert sub_of(org_a).status == "active"


def test_mpesa_prompt_without_setup_explains_how_to_pay(owner, org_a, settings):
    _, client = owner
    settings.NEXORA_PAYBILL = "600100"
    invoice = services.issue_invoice(sub_of(org_a), TODAY)
    res = client.post(f"/api/v1/subscription/invoices/{invoice.pk}/pay/", {"phone": "0712345678"})
    assert res.status_code == 409 and "paybill 600100" in str(res.data)


def test_only_owners_see_invoices_and_change_plans(make_member, org_a):
    _, manager = make_member(org_a, role=Role.PROPERTY_MANAGER)
    summary = manager.get("/api/v1/subscription/").data
    assert summary["status"] == "trialing" and summary["can_manage"] is False
    assert "open_invoice" not in summary and "payment" not in summary
    assert manager.get("/api/v1/subscription/invoices/").status_code == 403
    assert manager.post("/api/v1/subscription/change-plan/", {"plan": "pro"}).status_code == 403
    assert Organization.objects.count() >= 1
