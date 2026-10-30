"""Subscription lifecycle: trials, Nexora's invoices, payments, plan limits and read-only mode.

Timeline for one organization:

    trial (30 days) ──> invoice a week before access ends ──> paid: access extended a month
                                                          └─> unpaid at the end: past due
                                                              (full access, warnings)
                                                          └─> unpaid 14 days later: lapsed
                                                              (read-only until paid)

Complimentary subscriptions are never invoiced and never lapse. A plan priced 0 is billed by
agreement: it is never invoiced automatically (platform staff extend its paid-until date).
"""

from __future__ import annotations

import calendar
import hashlib
import hmac
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.core.models import next_reference
from apps.organizations.models import Membership, Organization, organization_today

from .models import Plan, Subscription, SubscriptionInvoice, SubscriptionPaymentRequest

INVOICE_LEAD_DAYS = 7  # invoice this long before paid-up access ends
GRACE_DAYS = 14  # past due for this long, then read-only


def add_month(d: date) -> date:
    """Same day next month (clamped to the month's last day)."""
    year, month = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return d.replace(year=year, month=month, day=min(d.day, calendar.monthrange(year, month)[1]))


# --- start and look-up -------------------------------------------------------------------


def trial_plan() -> Plan:
    plan = Plan.objects.filter(code=settings.NEXORA_TRIAL_PLAN).first()
    return plan or Plan.objects.filter(is_active=True).order_by("sort_order").first()


def start_trial(organization: Organization) -> Subscription:
    """Every new organization starts with a free trial (idempotent)."""
    existing = Subscription.objects.filter(organization=organization).first()
    if existing:
        return existing
    today = organization_today(organization)
    return Subscription.objects.create(
        organization=organization,
        plan=trial_plan(),
        status=Subscription.Status.TRIALING,
        trial_ends_on=today + timedelta(days=settings.NEXORA_TRIAL_DAYS),
    )


def subscription_for(organization: Organization) -> Subscription:
    return Subscription.objects.select_related("plan").filter(
        organization=organization
    ).first() or start_trial(organization)


def is_read_only(organization: Organization) -> bool:
    status = (
        Subscription.objects.filter(organization=organization)
        .values_list("status", flat=True)
        .first()
    )
    return status in (Subscription.Status.LAPSED, Subscription.Status.CANCELLED)


def units_used(organization: Organization) -> int:
    from apps.properties.models import Unit

    return Unit.objects.filter(organization=organization).count()


def check_unit_capacity(organization: Organization, adding: int = 1) -> None:
    """Refuse new units beyond the plan's limit."""
    sub = subscription_for(organization)
    limit = sub.plan.max_units
    if limit is None:
        return
    used = units_used(organization)
    if used + adding > limit:
        room = max(limit - used, 0)
        raise BusinessRuleViolation(
            f"Your {sub.plan.name} plan allows {limit} units and you have {used}"
            + (f"; you can add {room} more." if room else ".")
            + " Upgrade your plan under Organization → Subscription to add more."
        )


# --- the daily job ------------------------------------------------------------------------


@dataclass
class LifecycleResult:
    invoiced: int = 0
    past_due: int = 0
    lapsed: int = 0


def _owners(organization):
    return [
        m.user
        for m in Membership.objects.filter(
            organization=organization, role="owner", status=Membership.Status.ACTIVE
        ).select_related("user")
    ]


def _notify_owners(organization, title: str, body: str, key: str) -> None:
    from apps.notifications.services import notify

    notify(
        organization=organization,
        kind="subscription",
        users=_owners(organization),
        title=title,
        body=body,
        link="/dashboard/settings/subscription",
        dedupe_key=key,
    )


@transaction.atomic
def issue_invoice(
    sub: Subscription, period_start: date, *, actor=None
) -> SubscriptionInvoice | None:
    """Invoice one month of service from `period_start` (no-op if already invoiced)."""
    if sub.complimentary or sub.plan.monthly_price <= 0:
        return None
    if (
        SubscriptionInvoice.objects.filter(organization=sub.organization, period_start=period_start)
        .exclude(status=SubscriptionInvoice.Status.VOID)
        .exists()
    ):
        return None
    try:
        with transaction.atomic():
            invoice = SubscriptionInvoice.objects.create(
                organization=sub.organization,
                number=next_reference(sub.organization, "nexora-invoice", "NXI"),
                plan=sub.plan,
                plan_name=sub.plan.name,
                period_start=period_start,
                period_end=add_month(period_start) - timedelta(days=1),
                amount=sub.plan.monthly_price,
                currency=sub.plan.currency,
                due_date=max(
                    period_start - timedelta(days=1), organization_today(sub.organization)
                ),
            )
    except IntegrityError:
        return None  # a concurrent run issued it
    record_event(
        None,
        "subscription.invoiced",
        target=invoice,
        organization=sub.organization,
        actor=actor,
        metadata={"amount": str(invoice.amount), "period_start": str(period_start)},
    )
    _notify_owners(
        sub.organization,
        f"Nexora invoice {invoice.number}: {invoice.currency} {invoice.amount:,.0f}",
        f"Your {invoice.plan_name} plan from {invoice.period_start:%d %b} to "
        f"{invoice.period_end:%d %b %Y}. Due {invoice.due_date:%d %b %Y}.",
        f"nexora-invoice:{invoice.pk}",
    )
    return invoice


def run_lifecycle(today: date | None = None) -> LifecycleResult:
    """Invoice upcoming periods and move overdue subscriptions along. Safe to run repeatedly."""
    result = LifecycleResult()
    subs = (
        Subscription.objects.select_related("plan", "organization")
        .exclude(status=Subscription.Status.CANCELLED)
        .filter(complimentary=False, organization__status=Organization.Status.ACTIVE)
    )
    for sub in subs:
        day = today or organization_today(sub.organization)
        ends = sub.access_ends_on
        if ends is None:
            continue
        if day >= ends - timedelta(days=INVOICE_LEAD_DAYS) and issue_invoice(
            sub, ends + timedelta(days=1)
        ):
            result.invoiced += 1
        if day <= ends:
            continue
        new = (
            Subscription.Status.PAST_DUE
            if day <= ends + timedelta(days=GRACE_DAYS)
            else Subscription.Status.LAPSED
        )
        if sub.status != new:
            sub.status = new
            sub.save(update_fields=["status", "updated_at"])
            record_event(None, f"subscription.{new}", target=sub, organization=sub.organization)
            if new == Subscription.Status.PAST_DUE:
                result.past_due += 1
                _notify_owners(
                    sub.organization,
                    "Your Nexora payment is overdue",
                    f"Pay by {ends + timedelta(days=GRACE_DAYS):%d %b %Y} to keep making changes.",
                    f"nexora-past-due:{ends}",
                )
            else:
                result.lapsed += 1
                _notify_owners(
                    sub.organization,
                    "Nexora is now read-only",
                    "You can still view everything. Pay the open invoice to make changes again.",
                    f"nexora-lapsed:{ends}",
                )
    return result


# --- payments and changes -------------------------------------------------------------------


@transaction.atomic
def mark_paid(
    *, invoice: SubscriptionInvoice, method: str, reference: str = "", actor=None, request=None
) -> SubscriptionInvoice:
    invoice = SubscriptionInvoice.objects.select_for_update().get(pk=invoice.pk)
    if invoice.status != SubscriptionInvoice.Status.OPEN:
        raise BusinessRuleViolation(
            f"Invoice {invoice.number} is already {invoice.get_status_display().lower()}."
        )
    invoice.status = SubscriptionInvoice.Status.PAID
    invoice.paid_at = timezone.now()
    invoice.payment_method = method
    invoice.payment_reference = reference.strip()[:64]
    invoice.recorded_by = actor
    invoice.save()
    sub = Subscription.objects.select_for_update().get(organization=invoice.organization)
    sub.paid_until = max(d for d in (sub.paid_until, invoice.period_end) if d)
    sub.status = Subscription.Status.ACTIVE
    sub.save(update_fields=["paid_until", "status", "updated_at"])
    record_event(
        request,
        "subscription.paid",
        target=invoice,
        organization=invoice.organization,
        actor=actor,
        metadata={
            "method": method,
            "reference": invoice.payment_reference,
            "amount": str(invoice.amount),
        },
    )
    _notify_owners(
        invoice.organization,
        f"Payment received for {invoice.number}",
        f"Thank you. Your Nexora service is paid through {sub.paid_until:%d %b %Y}.",
        f"nexora-paid:{invoice.pk}",
    )
    return invoice


@transaction.atomic
def change_plan(*, request, organization: Organization, plan: Plan) -> Subscription:
    """Switch plans. Takes effect now; unpaid invoices are re-priced to the new plan."""
    sub = Subscription.objects.select_for_update().get(organization=organization)
    if not plan.is_active and not getattr(request.user, "is_platform_admin", False):
        raise BusinessRuleViolation("That plan isn't available.")
    used = units_used(organization)
    if plan.max_units is not None and used > plan.max_units:
        raise BusinessRuleViolation(
            f"You have {used} units; the {plan.name} plan allows {plan.max_units}."
        )
    previous = sub.plan
    sub.plan = plan
    sub.save(update_fields=["plan", "updated_at"])
    for invoice in SubscriptionInvoice.objects.filter(
        organization=organization, status=SubscriptionInvoice.Status.OPEN
    ):
        if plan.monthly_price <= 0:
            invoice.status = SubscriptionInvoice.Status.VOID
        else:
            invoice.plan, invoice.plan_name, invoice.amount = plan, plan.name, plan.monthly_price
        invoice.save()
    record_event(
        request,
        "subscription.plan_changed",
        target=sub,
        organization=organization,
        changes={"plan": {"from": previous.name, "to": plan.name}},
    )
    return sub


def payment_instructions(sub: Subscription) -> dict:
    return {
        "paybill": settings.NEXORA_PAYBILL,
        "account": sub.account_code,
        "bank_name": settings.NEXORA_BANK_NAME,
        "bank_account": settings.NEXORA_BANK_ACCOUNT,
        "stk_available": stk_available(),
    }


# --- M-Pesa prompts through Nexora's own paybill ---------------------------------------------


def stk_available() -> bool:
    return bool(
        settings.NEXORA_MPESA_CONSUMER_KEY
        and settings.NEXORA_MPESA_PASSKEY
        and settings.NEXORA_PAYBILL
        and settings.NEXORA_PUBLIC_API_URL.startswith("https://")
    )


def _client():
    from apps.payments.providers.mpesa import DarajaClient

    return DarajaClient(
        environment=settings.NEXORA_MPESA_ENVIRONMENT,
        consumer_key=settings.NEXORA_MPESA_CONSUMER_KEY,
        consumer_secret=settings.NEXORA_MPESA_CONSUMER_SECRET,
        shortcode=settings.NEXORA_PAYBILL,
        passkey=settings.NEXORA_MPESA_PASSKEY,
    )


def request_payment(
    *, request, invoice: SubscriptionInvoice, phone: str
) -> SubscriptionPaymentRequest:
    from apps.payments.mpesa import normalize_msisdn
    from apps.payments.providers.mpesa import DarajaError

    if invoice.status != SubscriptionInvoice.Status.OPEN:
        raise BusinessRuleViolation("This invoice is already settled.")
    if not stk_available():
        raise BusinessRuleViolation(
            f"M-Pesa prompts aren't set up yet. Pay to paybill {settings.NEXORA_PAYBILL or '—'} "
            f"with account {invoice.organization.subscription.account_code}, or by bank transfer."
        )
    msisdn = normalize_msisdn(phone)
    amount = int(Decimal(invoice.amount).to_integral_value())
    try:
        response = _client().stk_push(
            phone=msisdn,
            amount=amount,
            account_reference=invoice.organization.subscription.account_code,
            description="Nexora",
            callback_url=f"{settings.NEXORA_PUBLIC_API_URL}/api/v1/subscription/mpesa/"
            f"{callback_token()}/callback/",
            till=False,
        )
    except DarajaError as exc:
        raise BusinessRuleViolation(exc.message) from exc
    payment = SubscriptionPaymentRequest.objects.create(
        invoice=invoice,
        phone=msisdn,
        amount=amount,
        checkout_request_id=response["CheckoutRequestID"],
        created_by=request.user,
    )
    record_event(
        request, "subscription.stk_requested", target=invoice, metadata={"phone": msisdn[-3:]}
    )
    return payment


def callback_token() -> str:
    """Secret path segment for Nexora's own M-Pesa callback, derived from SECRET_KEY.

    Daraja can't sign callbacks, so the URL is the credential (as for landlords' paybills).
    """
    return hmac.new(
        settings.SECRET_KEY.encode(), b"nexora-subscription-mpesa-callback", hashlib.sha256
    ).hexdigest()[:40]


def valid_callback_token(token: str) -> bool:
    return hmac.compare_digest(token, callback_token())


@transaction.atomic
def handle_stk_callback(body: dict) -> None:
    """Daraja's STK result for one of Nexora's prompts. Idempotent."""
    callback = (body.get("Body") or {}).get("stkCallback") or {}
    checkout = callback.get("CheckoutRequestID", "")
    payment = (
        SubscriptionPaymentRequest.objects.select_for_update()
        .select_related("invoice")
        .filter(checkout_request_id=checkout)
        .first()
    )
    if payment is None or payment.status != SubscriptionPaymentRequest.Status.PENDING:
        return
    if str(callback.get("ResultCode")) != "0":
        payment.status = SubscriptionPaymentRequest.Status.FAILED
        payment.result = str(callback.get("ResultDesc", ""))[:255]
        payment.save(update_fields=["status", "result", "updated_at"])
        return
    items = {
        i.get("Name"): i.get("Value")
        for i in (callback.get("CallbackMetadata") or {}).get("Item", [])
    }
    paid = Decimal(str(items.get("Amount", payment.amount)))
    if paid < payment.amount:
        payment.status = SubscriptionPaymentRequest.Status.FAILED
        payment.result = f"Paid {paid}, expected {payment.amount}; record it by hand."
        payment.save(update_fields=["status", "result", "updated_at"])
        return
    payment.status = SubscriptionPaymentRequest.Status.SUCCEEDED
    payment.receipt = str(items.get("MpesaReceiptNumber", ""))[:32]
    payment.save(update_fields=["status", "receipt", "updated_at"])
    if payment.invoice.status == SubscriptionInvoice.Status.OPEN:
        mark_paid(
            invoice=payment.invoice,
            method=SubscriptionInvoice.Method.MPESA,
            reference=payment.receipt,
        )
