from django.apps import AppConfig


class OrganizationsConfig(AppConfig):
    name = "apps.organizations"
    label = "organizations"

    def ready(self) -> None:
        from apps.core.modules import registry

        from .roles import PLATFORM_MODULE

        registry.register(PLATFORM_MODULE)
