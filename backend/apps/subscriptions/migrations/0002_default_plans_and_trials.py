"""Default plans, and a free trial for every organization that already exists.

Prices are starting points; platform admins change them in the platform console.
"""

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import migrations
from django.utils import timezone

PLANS = [
    ("starter", "Starter", "Up to 20 units", 20, "2000", 10),
    ("growth", "Growth", "Up to 100 units", 100, "7500", 20),
    ("pro", "Pro", "Up to 500 units", 500, "25000", 30),
    ("enterprise", "Enterprise", "Unlimited units, priced by agreement", None, "0", 40),
]


def forwards(apps, schema_editor):
    Plan = apps.get_model("subscriptions", "Plan")
    Subscription = apps.get_model("subscriptions", "Subscription")
    Organization = apps.get_model("organizations", "Organization")
    plans = {}
    for code, name, description, max_units, price, order in PLANS:
        plans[code], _ = Plan.objects.get_or_create(
            code=code,
            defaults={
                "name": name,
                "description": description,
                "max_units": max_units,
                "monthly_price": Decimal(price),
                "sort_order": order,
            },
        )
    trial = plans.get(settings.NEXORA_TRIAL_PLAN, plans["growth"])
    ends = timezone.localdate() + timedelta(days=settings.NEXORA_TRIAL_DAYS)
    for org in Organization.objects.filter(subscription__isnull=True):
        Subscription.objects.create(organization=org, plan=trial, status="trialing", trial_ends_on=ends)


class Migration(migrations.Migration):
    dependencies = [
        ("subscriptions", "0001_initial"),
        ("organizations", "0001_initial"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
