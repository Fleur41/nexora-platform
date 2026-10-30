from django.apps import AppConfig


class ExpensesConfig(AppConfig):
    name = "apps.expenses"
    label = "expenses"

    def ready(self) -> None:
        from apps.core.modules import registry

        from .module import EXPENSES_MODULE

        registry.register(EXPENSES_MODULE)
