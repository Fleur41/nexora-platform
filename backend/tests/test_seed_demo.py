from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from django.db.models import Sum

from apps.billing.models import ChargeRule, Invoice
from apps.billing.services import lease_balance
from apps.deposits.models import DepositTransaction
from apps.inspections.models import Inspection
from apps.leases.models import Lease, MoveOutNotice
from apps.maintenance.models import MaintenanceRequest
from apps.notifications.models import Announcement, Notification
from apps.notifications.services import settings_for
from apps.organizations.models import Organization
from apps.payments.models import Payment
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


def test_seed_demo_builds_consistent_sample_data_once():
    with pytest.raises(CommandError):
        call_command("seed_demo", stdout=StringIO())  # DEBUG is off in tests
    out = StringIO()
    call_command("seed_demo", "--force", stdout=out)
    org = Organization.objects.get(name__contains="sample data")
    assert Invoice.objects.filter(organization=org).exists()
    assert Payment.objects.filter(organization=org, lease__isnull=True).count() == 2
    for lease in Lease.objects.filter(organization=org, status__in=Lease.OCCUPYING_STATUSES):
        invoices = Invoice.objects.filter(lease=lease, status="issued")
        received = Payment.objects.filter(lease=lease, status="completed")
        billed = invoices.aggregate(s=Sum("total"))["s"] or 0
        paid = received.aggregate(s=Sum("amount"))["s"] or 0
        assert lease_balance(lease) == billed - paid
    assert "demo-owner@nexora.test" in out.getvalue()
    assert "demo-tenant@nexora.test" in out.getvalue()
    # The organization-wide security charge exists (it used to be skipped).
    assert ChargeRule.objects.filter(
        organization=org, scope="organization", charge_type__code="security"
    ).exists()

    # Phase 5: repairs in each state, inspections, move-outs, announcements, the tenant app.
    statuses = set(
        MaintenanceRequest.objects.filter(organization=org).values_list("status", flat=True)
    )
    assert {"submitted", "acknowledged", "on_hold", "resolved", "closed"} <= statuses
    assert MaintenanceRequest.objects.filter(organization=org, source="tenant").exists()
    assert Inspection.objects.filter(organization=org, status="completed", kind="move_in").exists()
    assert Inspection.objects.filter(organization=org, status="scheduled", kind="routine").exists()
    done = MoveOutNotice.objects.get(organization=org, status="completed")
    assert done.lease.status == Lease.Status.ENDED
    assert done.inspection.status == "completed"
    assert DepositTransaction.objects.filter(lease=done.lease, kind="deduction").exists()
    assert set(MoveOutNotice.objects.filter(organization=org).values_list("status", flat=True)) == {
        "completed",
        "submitted",
        "inspection_scheduled",
    }
    assert all(a.recipients > 0 for a in Announcement.objects.filter(organization=org))
    portal = Tenant.objects.get(organization=org, user__email="demo-tenant@nexora.test")
    assert lease_balance(portal.leases.get(status="active")) > 0
    inbox = Notification.objects.filter(recipient_user=portal.user, channel="in_app")
    assert inbox.filter(kind="announcement").exists()
    # Back-filling history doesn't email anyone; delivery is switched back on afterwards.
    assert not Notification.objects.filter(organization=org, channel="email").exists()
    assert settings_for(org).email_enabled

    again = StringIO()
    call_command("seed_demo", "--force", stdout=again)
    assert "already exists" in again.getvalue()
    assert Organization.objects.filter(name__contains="sample data").count() == 1
