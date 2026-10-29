"""Creating and delivering notifications.

`notify()` is the single entry point. It fans out one logical message to in-app, email and SMS
rows according to the organization's settings and what contact details each recipient has.
A dedupe key makes each (channel, recipient, key) unique, so scheduled jobs and retries never
send the same reminder twice. External delivery happens after the surrounding transaction
commits (Celery; inline in development).
"""

from __future__ import annotations

from collections.abc import Iterable

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.organizations.models import Membership

from .models import Notification, NotificationSettings
from .providers import DeliveryError, send_email, sms_backend

Channel = Notification.Channel
SMS_MAX = 300


def settings_for(organization) -> NotificationSettings:
    return NotificationSettings.objects.get_or_create(organization=organization)[0]


def staff_with(organization, capability: str, property_id=None):
    """Users holding a capability (and, if given, access to a property) in an organization."""
    from apps.properties.access import can_access_property

    users = []
    for membership in Membership.objects.filter(
        organization=organization, status=Membership.Status.ACTIVE
    ).select_related("user", "organization"):
        if not membership.has_capability(capability):
            continue
        if property_id is not None and not can_access_property(membership, property_id):
            continue
        users.append(membership.user)
    return users


def _create(**fields) -> Notification | None:
    try:
        with transaction.atomic():
            return Notification.objects.create(**fields)
    except IntegrityError:
        return None  # already sent (dedupe)


def notify(
    *,
    organization,
    kind: str,
    title: str,
    body: str,
    link: str = "",
    tenant_link: str = "",
    dedupe_key: str = "",
    users: Iterable = (),
    tenants: Iterable = (),
    email: bool = True,
    sms: bool = False,
) -> list[Notification]:
    """Queue a message. Staff users get in-app (+ email); tenants get in-app if they have a
    portal account, plus email/SMS when enabled for the organization and the tenant has the
    contact details."""
    prefs = settings_for(organization) if organization else None
    created: list[Notification] = []
    common = {
        "organization": organization,
        "kind": kind,
        "title": title[:160],
        "dedupe_key": dedupe_key,
    }

    for user in {u.pk: u for u in users}.values():
        created.append(
            _create(
                recipient_user=user,
                recipient_key=f"user:{user.pk}",
                channel=Channel.IN_APP,
                body=body,
                link=link,
                status=Notification.Status.SENT,
                sent_at=timezone.now(),
                **common,
            )
        )
        if email and (prefs is None or prefs.email_enabled) and user.email:
            created.append(
                _create(
                    recipient_user=user,
                    recipient_key=f"user:{user.pk}",
                    channel=Channel.EMAIL,
                    to_address=user.email,
                    body=body,
                    link=link,
                    **common,
                )
            )

    for tenant in {t.pk: t for t in tenants}.values():
        key = f"tenant:{tenant.pk}"
        if tenant.user_id:
            created.append(
                _create(
                    recipient_user_id=tenant.user_id,
                    recipient_tenant=tenant,
                    recipient_key=key,
                    channel=Channel.IN_APP,
                    body=body,
                    link=tenant_link,
                    status=Notification.Status.SENT,
                    sent_at=timezone.now(),
                    **common,
                )
            )
        if email and prefs and prefs.email_enabled and tenant.email:
            created.append(
                _create(
                    recipient_tenant=tenant,
                    recipient_key=key,
                    channel=Channel.EMAIL,
                    to_address=tenant.email,
                    body=body,
                    link=tenant_link,
                    **common,
                )
            )
        if sms and prefs and prefs.sms_enabled and tenant.phone:
            created.append(
                _create(
                    recipient_tenant=tenant,
                    recipient_key=key,
                    channel=Channel.SMS,
                    to_address=tenant.phone,
                    body=f"{title}. {body}"[:SMS_MAX],
                    **common,
                )
            )

    queued = [n for n in created if n is not None]
    pending = [n.pk for n in queued if n.status == Notification.Status.PENDING]
    if pending:
        from .tasks import deliver_notification

        transaction.on_commit(lambda: [deliver_notification.delay(str(pk)) for pk in pending])
    return queued


def deliver(notification: Notification) -> Notification:
    """Send one pending email/SMS. Records the outcome; never raises for provider errors."""
    if notification.status != Notification.Status.PENDING:
        return notification
    notification.attempts += 1
    try:
        if notification.channel == Channel.EMAIL:
            org = notification.organization.name if notification.organization else "Nexora"
            send_email(notification.to_address, f"{notification.title} · {org}", notification.body)
        elif notification.channel == Channel.SMS:
            sms_backend().send(notification.to_address, notification.body)
        notification.status, notification.sent_at, notification.error = (
            Notification.Status.SENT,
            timezone.now(),
            "",
        )
    except DeliveryError as exc:
        notification.error = str(exc)[:255]
        if notification.attempts >= 3:
            notification.status = Notification.Status.FAILED
    notification.save(update_fields=["status", "sent_at", "error", "attempts", "updated_at"])
    return notification


def send_announcement(*, request, announcement, properties) -> list[Notification]:
    """Send a saved announcement to tenants with an active lease in its property (or in any of
    `properties`, the sender's accessible properties, when it isn't limited to one)."""
    from apps.audit.services import record_event
    from apps.leases.models import Lease
    from apps.tenants.models import Tenant

    leases = Lease.objects.filter(
        organization=announcement.organization, status=Lease.Status.ACTIVE
    )
    leases = (
        leases.filter(unit__property=announcement.property)
        if announcement.property_id
        else leases.filter(unit__property__in=properties.values("pk"))
    )
    tenants = Tenant.objects.filter(pk__in=leases.values("tenant_id"))
    sent = notify(
        organization=announcement.organization,
        kind="announcement",
        tenants=tenants,
        title=announcement.title,
        body=announcement.body,
        tenant_link="/portal",
        dedupe_key=f"announcement:{announcement.pk}",
        email=announcement.send_email,
        sms=announcement.send_sms,
    )
    announcement.recipients = tenants.count()
    announcement.save(update_fields=["recipients"])
    record_event(
        request,
        "announcement.sent",
        target=announcement,
        metadata={"recipients": announcement.recipients, "messages": len(sent)},
    )
    return sent
