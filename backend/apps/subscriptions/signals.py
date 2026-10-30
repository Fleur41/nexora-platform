from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.organizations.models import Organization


@receiver(post_save, sender=Organization)
def start_trial_for_new_organizations(sender, instance, created, **kwargs):
    if created:
        from .services import start_trial

        transaction.on_commit(lambda: start_trial(instance))
