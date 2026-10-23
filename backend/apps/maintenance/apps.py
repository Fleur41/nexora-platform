from django.apps import AppConfig


class MaintenanceConfig(AppConfig):
    name = "apps.maintenance"
    label = "maintenance"

    def ready(self) -> None:
        from apps.core.modules import registry

        from .module import OPERATIONS_MODULE

        registry.register(OPERATIONS_MODULE)
