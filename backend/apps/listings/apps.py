from django.apps import AppConfig


class ListingsConfig(AppConfig):
    name = "apps.listings"
    label = "listings"

    def ready(self) -> None:
        from apps.core.modules import registry

        from .module import LISTINGS_MODULE

        registry.register(LISTINGS_MODULE)
