from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.billing.models import Invoice
from apps.notifications import reminders, services
from apps.notifications.models import Notification, NotificationSettings
from apps.notifications.providers import DeliveryError
from apps.organizations.models import organization_today
from apps.organizations.roles import Role
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


def make_lease(org, start=date(2026, 8, 1), email="wanjiku@example.com"):
    unit_type = UnitTypeFactory(property=PropertyFactory(organization=org))
    lease = LeaseFactory(
        unit=UnitFactory(unit_type=unit_type), start_date=start, rent=Decimal("20000")
    )
    Tenant.objects.filter(pk=lease.tenant_id).update(email=email)
    lease.tenant.refresh_from_db()
    return lease


def test_invoice_and_receipt_notifications_respect_settings(make_member, org_a):
    _, owner = make_member(org_a)
    lease = make_lease(org_a)
    owner.post("/api/v1/billing-runs/", {"period": "2026-08"})
    assert any("Invoice INV-00001" in m.subject for m in mail.outbox)
    assert not Notification.objects.filter(channel="sms").exists()  # SMS is off by default
    NotificationSettings.objects.filter(organization=org_a).update(
        sms_enabled=True, receipt_notifications=True
    )
    owner.post(
        "/api/v1/payments/",
        {"lease": str(lease.pk), "amount": "5000", "received_on": "2026-08-05", "method": "cash"},
    )
    sms = Notification.objects.get(channel="sms", kind="receipt")
    assert sms.status == "sent" and "RCT-00001" in sms.body
    NotificationSettings.objects.filter(organization=org_a).update(invoice_notifications=False)
    sent = len(mail.outbox)
    owner.post("/api/v1/billing-runs/", {"period": "2026-09"})
    assert len(mail.outbox) == sent


def test_reminders_are_never_duplicated(make_member, org_a):
    _, owner = make_member(org_a)
    today = organization_today(org_a)
    lease = make_lease(org_a, start=today.replace(day=1) - timedelta(days=62))
    owner.post("/api/v1/billing-runs/", {"period": lease.start_date.strftime("%Y-%m")})
    Invoice.objects.filter(lease=lease).update(due_date=today - timedelta(days=10))
    first = reminders.reminders_for(org_a)
    assert first >= 1
    assert reminders.reminders_for(org_a) == 0  # same day, same week: nothing new
    assert Notification.objects.filter(kind="arrears", channel="email").count() == 1

    due = make_lease(org_a, start=today.replace(day=1), email="due@example.com")
    owner.post("/api/v1/billing-runs/", {"period": today.strftime("%Y-%m")})
    Invoice.objects.filter(lease=due).update(due_date=today + timedelta(days=3))
    reminders.reminders_for(org_a)
    reminders.reminders_for(org_a)
    assert (
        Notification.objects.filter(
            kind="rent_due", recipient_tenant=due.tenant, channel="email"
        ).count()
        == 1
    )


def test_delivery_failures_are_recorded_and_retried(org_a, monkeypatch):
    lease = make_lease(org_a)

    def broken(*args, **kwargs):
        raise DeliveryError("Email could not be sent: ConnectionRefusedError")

    monkeypatch.setattr("apps.notifications.services.send_email", broken)
    [note] = services.notify(
        organization=org_a,
        kind="announcement",
        title="Water off",
        body="Tomorrow 9–12",
        tenants=[lease.tenant],
        dedupe_key="x",
    )
    for _ in range(3):
        services.deliver(Notification.objects.get(pk=note.pk))
    note.refresh_from_db()
    assert (note.status, note.attempts) == ("failed", 3) and "ConnectionRefused" in note.error


def test_in_app_inbox_and_announcements(make_member, org_a, org_b):
    _, owner = make_member(org_a)
    lease = make_lease(org_a)
    user = UserFactory()
    Tenant.objects.filter(pk=lease.tenant_id).update(user=user)
    res = owner.post(
        "/api/v1/announcements/", {"title": "Water off Saturday", "body": "From 9am to noon."}
    )
    assert res.status_code == 201 and res.data["recipients"] == 1
    tenant_client = APIClient()
    tenant_client.force_authenticate(user)
    inbox = tenant_client.get("/api/v1/notifications/").data["results"]
    assert [n["title"] for n in inbox] == ["Water off Saturday"]
    assert tenant_client.get("/api/v1/notifications/unread-count/").data["count"] == 1
    tenant_client.post("/api/v1/notifications/read-all/")
    assert tenant_client.get("/api/v1/notifications/unread-count/").data["count"] == 0
    # Another organization's staff can't see or send to these tenants.
    _, outsider = make_member(org_b)
    assert outsider.get("/api/v1/announcements/").data["count"] == 0
    _, caretaker = make_member(org_a, role=Role.CARETAKER)
    assert caretaker.post("/api/v1/announcements/", {"title": "x", "body": "y"}).status_code == 403


def test_move_out_notice_alerts_staff_only(make_member, org_a):
    owner_membership, owner = make_member(org_a)
    caretaker, _ = make_member(org_a, role=Role.CARETAKER, access_scope="organization")
    lease = make_lease(org_a)
    other_tenant_user = UserFactory()
    other = make_lease(org_a, email="other@example.com")
    Tenant.objects.filter(pk=other.tenant_id).update(user=other_tenant_user)
    _, manager_client = make_member(org_a, role=Role.PROPERTY_MANAGER, access_scope="organization")
    manager_client.post(
        "/api/v1/move-outs/",
        {
            "lease": str(lease.pk),
            "intended_date": str(organization_today(org_a) + timedelta(days=30)),
        },
    )
    recipients = set(
        Notification.objects.filter(kind="move_out", channel="in_app").values_list(
            "recipient_user", flat=True
        )
    )
    assert owner_membership.user.pk in recipients
    assert caretaker.user.pk not in recipients and other_tenant_user.pk not in recipients
