from django.apps import AppConfig


class BillingConfig(AppConfig):
    name = "apps.billing"
    label = "billing"

    def ready(self) -> None:
        from apps.core.modules import registry

        from .module import BILLING_MODULE

        registry.register(BILLING_MODULE)
