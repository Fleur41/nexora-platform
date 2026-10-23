"""Scheduled reminders (rent due, arrears, lease expiry) for one organization."""

from __future__ import annotations

from datetime import timedelta

from apps.billing.models import Invoice
from apps.billing.services import amount_due
from apps.leases.models import Lease
from apps.organizations.models import organization_today

from .services import notify, settings_for, staff_with


def _money(org, value) -> str:
    return f"{org.currency} {value:,.2f}"


def reminders_for(organization) -> int:
    prefs = settings_for(organization)
    today = organization_today(organization)
    count = 0
    open_invoices = Invoice.objects.filter(
        organization=organization, status=Invoice.Status.ISSUED
    ).select_related("tenant", "lease")

    if prefs.rent_due_reminder_days:
        target = today + timedelta(days=prefs.rent_due_reminder_days)
        for invoice in open_invoices.filter(due_date=target):
            due = amount_due(invoice)
            if due <= 0:
                continue
            count += len(
                notify(
                    organization=organization,
                    kind="rent_due",
                    tenants=[invoice.tenant],
                    sms=True,
                    title=f"Rent due {invoice.due_date:%d %b}",
                    body=f"Hello {invoice.tenant.full_name.split()[0]}, "
                    f"{_money(organization, due)} on invoice "
                    f"{invoice.number} is due on {invoice.due_date:%d %b %Y}.",
                    tenant_link=f"/portal/invoices/{invoice.pk}",
                    dedupe_key=f"due:{invoice.pk}",
                )
            )

    if prefs.arrears_reminders:
        # At most one arrears reminder per lease per week, starting a week after the due date.
        week = today.isocalendar()
        leases = {}
        for invoice in open_invoices.filter(due_date__lte=today - timedelta(days=7)):
            due = amount_due(invoice)
            if due > 0:
                leases.setdefault(invoice.lease, []).append(due)
        for lease, dues in leases.items():
            count += len(
                notify(
                    organization=organization,
                    kind="arrears",
                    tenants=[lease.tenant],
                    sms=True,
                    title="Overdue rent",
                    body=f"Hello {lease.tenant.full_name.split()[0]}, "
                    f"{_money(organization, sum(dues))} is overdue on "
                    f"lease {lease.reference}. Please pay or contact your landlord.",
                    tenant_link="/portal",
                    dedupe_key=f"arrears:{lease.pk}:{week.year}-W{week.week}",
                )
            )

    if prefs.lease_expiry_days:
        horizon = today + timedelta(days=prefs.lease_expiry_days)
        for lease in Lease.objects.filter(
            organization=organization,
            status=Lease.Status.ACTIVE,
            end_date__gte=today,
            end_date__lte=horizon,
        ).select_related("tenant", "unit__property"):
            title = f"Lease {lease.reference} ends {lease.end_date:%d %b %Y}"
            count += len(
                notify(
                    organization=organization,
                    kind="lease_expiring",
                    users=staff_with(organization, "leases.manage", lease.unit.property_id),
                    title=title,
                    body=(
                        f"{lease.tenant.full_name}, {lease.unit.property.name} "
                        f"unit {lease.unit.number}."
                    ),
                    link=f"/dashboard/leases/{lease.pk}",
                    dedupe_key=f"expiring:{lease.pk}:{lease.end_date}",
                )
            )
            count += len(
                notify(
                    organization=organization,
                    kind="lease_expiring",
                    tenants=[lease.tenant],
                    title=title,
                    body="Please contact your landlord about renewing or moving out.",
                    tenant_link="/portal",
                    dedupe_key=f"expiring:{lease.pk}:{lease.end_date}",
                )
            )
    return count
