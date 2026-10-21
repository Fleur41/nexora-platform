import logging

from celery import shared_task

from apps.organizations.models import Organization

from .services import sync_reserved_units

logger = logging.getLogger(__name__)


@shared_task
def sync_unit_occupancy() -> int:
    """Hourly: mark reserved units occupied once their lease starts.

    Runs organization by organization so every query is explicitly scoped and one
    organization's failure cannot affect another.
    """
    total = 0
    for organization in Organization.objects.filter(status=Organization.Status.ACTIVE):
        try:
            total += sync_reserved_units(organization)
        except Exception:  # noqa: BLE001 - isolate failures per organization
            logger.exception("Occupancy sync failed for organization %s", organization.pk)
    return total
