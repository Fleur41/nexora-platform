from django.apps import AppConfig


class PropertiesConfig(AppConfig):
    name = "apps.properties"
    label = "properties"

    def ready(self) -> None:
        from apps.core.modules import registry

        from .module import PROPERTY_MODULE

        registry.register(PROPERTY_MODULE)
