import logging

from celery import shared_task

from apps.organizations.models import Organization

from .models import BillingSettings
from .services import run_scheduled_billing

logger = logging.getLogger(__name__)


@shared_task
def run_scheduled_billing_for_all() -> int:
    """Daily: run billing for organizations that enabled it, once their billing day arrives.

    Each organization is processed separately with explicit scoping; a failure in one never
    affects another. Runs are idempotent, so retries and catch-ups cannot double-bill.
    """
    runs = 0
    org_ids = BillingSettings.objects.filter(auto_generate=True).values_list(
        "organization_id", flat=True
    )
    for organization in Organization.objects.filter(
        pk__in=org_ids, status=Organization.Status.ACTIVE
    ):
        try:
            if run_scheduled_billing(organization) is not None:
                runs += 1
        except Exception:  # noqa: BLE001 - isolate failures per organization
            logger.exception("Scheduled billing failed for organization %s", organization.pk)
    return runs
