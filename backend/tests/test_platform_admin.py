from datetime import date, timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.notifications.models import Notification
from apps.organizations.models import Organization
from apps.platform_admin.models import SupportGrant
from apps.subscriptions import services as subscriptions
from apps.subscriptions.models import SubscriptionInvoice

from .factories import PropertyFactory, UserFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def staff():
    user = UserFactory(is_platform_admin=True, full_name="Nexora Support")
    client = APIClient()
    client.force_authenticate(user)
    return user, client


def org_client(user, org):
    client = APIClient(headers={"X-Organization-ID": str(org.pk)})
    client.force_authenticate(user)
    return client


def test_platform_api_is_for_platform_admins_only(make_member, org_a):
    _, owner = make_member(org_a)
    assert owner.get("/api/v1/platform/organizations/").status_code == 403
    assert APIClient().get("/api/v1/platform/overview/").status_code in (401, 403)


def test_overview_list_and_detail(staff, make_member, org_a, org_b):
    _, client = staff
    owner, _ = make_member(org_a)
    PropertyFactory(organization=org_a)
    subscriptions.subscription_for(org_a)
    subscriptions.subscription_for(org_b)
    overview = client.get("/api/v1/platform/overview/").data
    assert overview["subscriptions"]["trialing"] >= 2
    rows = {r["name"]: r for r in client.get("/api/v1/platform/organizations/").data}
    assert rows["Alpha Properties"]["plan"] == "Growth" and rows["Alpha Properties"]["members"] == 1
    found = client.get("/api/v1/platform/organizations/", {"search": owner.user.email}).data
    assert [r["name"] for r in found] == ["Alpha Properties"]
    detail = client.get(f"/api/v1/platform/organizations/{org_a.pk}/").data
    assert detail["owners"][0]["email"] == owner.user.email


def test_staff_change_plan_extend_access_and_record_payment(staff, make_member, org_a):
    _, client = staff
    _, owner = make_member(org_a)
    sub = subscriptions.subscription_for(org_a)
    sub.trial_ends_on = date.today() - timedelta(days=30)
    sub.save()
    subscriptions.run_lifecycle(date.today())
    assert subscriptions.subscription_for(org_a).status == "lapsed"
    assert owner.post("/api/v1/properties/", {"name": "x"}).status_code == 403

    # Extending access lifts read-only immediately.
    url = f"/api/v1/platform/organizations/{org_a.pk}/subscription/"
    res = client.post(
        url,
        {
            "plan": "pro",
            "paid_until": str(date.today() + timedelta(days=30)),
            "notes": "Paid by cheque",
        },
        format="json",
    )
    assert (
        res.status_code == 200
        and res.data["plan"] == "Pro"
        and res.data["subscription_status"] == "active"
    )
    assert owner.post("/api/v1/properties/", {"name": "x"}).status_code == 201

    invoice = client.post(f"/api/v1/platform/organizations/{org_a.pk}/invoices/").data
    assert invoice["amount"] == "25000.00"
    paid = client.post(
        f"/api/v1/platform/invoices/{invoice['id']}/record-payment/",
        {"method": "bank", "reference": "FT998"},
        format="json",
    )
    assert paid.status_code == 200 and paid.data["status"] == "paid"
    assert SubscriptionInvoice.objects.get(pk=invoice["id"]).recorded_by.is_platform_admin
    logged = set(AuditLog.objects.filter(organization=org_a).values_list("action", flat=True))
    assert {"platform.subscription_updated", "subscription.paid"} <= logged


def test_suspend_locks_the_organization_and_reactivate_restores_it(staff, make_member, org_a):
    _, client = staff
    _, owner = make_member(org_a)
    assert (
        client.post(
            f"/api/v1/platform/organizations/{org_a.pk}/suspend/", {"reason": "Fraud check"}
        ).status_code
        == 200
    )
    assert owner.get("/api/v1/properties/").status_code == 403
    assert client.post(f"/api/v1/platform/organizations/{org_a.pk}/reactivate/").status_code == 200
    assert owner.get("/api/v1/properties/").status_code == 200


def test_plans_are_edited_by_staff(staff):
    _, client = staff
    plans = {p["code"]: p for p in client.get("/api/v1/platform/plans/").data}
    res = client.patch(
        f"/api/v1/platform/plans/{plans['starter']['id']}/",
        {"monthly_price": "2500"},
        format="json",
    )
    assert res.status_code == 200 and res.data["monthly_price"] == "2500.00"
    assert AuditLog.objects.filter(action="platform.plan_updated").exists()


def test_support_access_is_read_only_time_limited_audited_and_announced(staff, make_member, org_a):
    user, client = staff
    owner, _ = make_member(org_a)
    PropertyFactory(organization=org_a, name="Riverside")
    support = org_client(user, org_a)
    # No grant: no access.
    assert support.get("/api/v1/properties/").status_code == 403

    res = client.post(
        f"/api/v1/platform/organizations/{org_a.pk}/support/",
        {"reason": "Ticket #12: invoices look wrong", "minutes": 30},
        format="json",
    )
    assert res.status_code == 201
    assert Notification.objects.filter(kind="support", recipient_user=owner.user).exists()

    # Read-only view of the organization, every request audited.
    names = [p["name"] for p in support.get("/api/v1/properties/").data["results"]]
    assert names == ["Riverside"]
    blocked = support.post("/api/v1/properties/", {"name": "Nope"})
    assert blocked.status_code == 403 and blocked.data["error"]["code"] == "support_read_only"
    assert AuditLog.objects.filter(organization=org_a, action="support.request").exists()
    assert AuditLog.objects.filter(organization=org_a, action="support.started").exists()
    mine = client.get("/api/v1/organizations/")
    entry = next(o for o in mine.data if o["organization"]["id"] == str(org_a.pk))
    assert entry["support_until"] is not None and "properties.manage" not in entry["capabilities"]

    # Expiry ends it; so does ending it early.
    SupportGrant.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    assert support.get("/api/v1/properties/").status_code == 403
    grant = SupportGrant.objects.get()
    SupportGrant.objects.update(expires_at=timezone.now() + timedelta(minutes=10))
    assert client.post(f"/api/v1/platform/support/{grant.pk}/end/").status_code == 200
    assert support.get("/api/v1/properties/").status_code == 403


def test_support_needs_a_reason_and_a_sensible_duration(staff, org_a):
    _, client = staff
    url = f"/api/v1/platform/organizations/{org_a.pk}/support/"
    assert client.post(url, {"reason": "x", "minutes": 600}, format="json").status_code == 400
    assert client.post(url, {"reason": " ", "minutes": 30}, format="json").status_code in (400, 409)
    Organization.objects.filter(pk=org_a.pk).update(status="suspended")
    assert client.post(url, {"reason": "y", "minutes": 30}, format="json").status_code == 404
