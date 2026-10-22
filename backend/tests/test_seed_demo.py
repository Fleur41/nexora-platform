from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from django.db.models import Sum

from apps.billing.models import Invoice
from apps.billing.services import lease_balance
from apps.leases.models import Lease
from apps.organizations.models import Organization
from apps.payments.models import Payment

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

    again = StringIO()
    call_command("seed_demo", "--force", stdout=again)
    assert "already exists" in again.getvalue()
    assert Organization.objects.filter(name__contains="sample data").count() == 1
