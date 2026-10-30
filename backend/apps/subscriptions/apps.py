from django.apps import AppConfig


class SubscriptionsConfig(AppConfig):
    name = "apps.subscriptions"
    label = "subscriptions"

    def ready(self) -> None:
        from apps.core.modules import ModuleDefinition, registry

        from . import signals  # noqa: F401  (starts a trial for every new organization)

        registry.register(
            ModuleDefinition(
                key="subscriptions",
                name="Nexora Subscription",
                capabilities={
                    "subscription.manage": "See and pay Nexora invoices and change the plan",
                },
                # Owners hold every capability; nobody else by default.
                role_defaults={},
            )
        )
