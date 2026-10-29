from django.apps import AppConfig


class ReportsConfig(AppConfig):
    name = "apps.reports"
    label = "reports"

    def ready(self) -> None:
        from apps.core.modules import registry

        from .module import REPORTS_MODULE

        registry.register(REPORTS_MODULE)
