from django.apps import AppConfig


class PaymentsConfig(AppConfig):
    name = "apps.payments"
    label = "payments"

    def ready(self) -> None:
        from apps.core.modules import registry

        from .module import PAYMENTS_MODULE

        registry.register(PAYMENTS_MODULE)
