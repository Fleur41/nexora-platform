from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from .models import PaymentRequest


@shared_task
def expire_stale_payment_requests() -> int:
    """Mark STK requests with no callback after 30 minutes as expired (the tenant's prompt
    has long timed out). A late callback is still processed if it ever arrives."""
    cutoff = timezone.now() - timedelta(minutes=30)
    return PaymentRequest.objects.filter(
        status=PaymentRequest.Status.PENDING, created_at__lt=cutoff
    ).update(status=PaymentRequest.Status.EXPIRED, result_description="No response from M-Pesa")
