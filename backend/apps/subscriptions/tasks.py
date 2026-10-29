from celery import shared_task

from . import services


@shared_task
def run_subscription_lifecycle() -> dict:
    """Daily: invoice upcoming periods, mark overdue subscriptions past due or lapsed."""
    result = services.run_lifecycle()
    return {"invoiced": result.invoiced, "past_due": result.past_due, "lapsed": result.lapsed}
