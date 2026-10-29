import logging
from datetime import timedelta

from celery import shared_task

from apps.organizations.models import Organization

from .models import Notification

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=120)
def deliver_notification(self, notification_id: str) -> str:
    from .services import deliver

    notification = (
        Notification.objects.select_related("organization").filter(pk=notification_id).first()
    )
    if notification is None:
        return "missing"
    notification = deliver(notification)
    if notification.status == Notification.Status.PENDING:  # transient failure: try again later
        raise self.retry()
    return notification.status


@shared_task
def send_scheduled_reminders() -> int:
    """Daily: rent-due, arrears and lease-expiry reminders, organization by organization.
    Dedupe keys make re-runs (and overlapping schedules) send nothing twice."""
    from .reminders import reminders_for

    sent = 0
    for organization in Organization.objects.filter(status=Organization.Status.ACTIVE):
        try:
            sent += reminders_for(organization)
        except Exception:  # noqa: BLE001 - isolate failures per organization
            logger.exception("Reminders failed for organization %s", organization.pk)
    return sent


@shared_task
def retry_stuck_notifications() -> int:
    """Re-queue email/SMS still pending after 15 minutes (e.g. the worker was down)."""
    from django.utils import timezone

    cutoff = timezone.now() - timedelta(minutes=15)
    ids = list(
        Notification.objects.filter(
            status=Notification.Status.PENDING, created_at__lt=cutoff, attempts__lt=3
        ).values_list("pk", flat=True)[:500]
    )
    for pk in ids:
        deliver_notification.delay(str(pk))
    return len(ids)
