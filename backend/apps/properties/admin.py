from django.contrib import admin

from .models import Property, PropertyAssignment, Unit, UnitType


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = ["name", "reference", "organization", "town", "is_active"]
    list_filter = ["is_active", "property_type"]
    search_fields = ["name", "reference", "organization__name"]


@admin.register(UnitType)
class UnitTypeAdmin(admin.ModelAdmin):
    list_display = ["name", "property", "category", "default_rent"]
    search_fields = ["name", "property__name"]


@admin.register(Unit)
class UnitAdmin(admin.ModelAdmin):
    list_display = ["number", "property", "unit_type", "status", "market_rent"]
    list_filter = ["status"]
    search_fields = ["number", "property__name"]


admin.site.register(PropertyAssignment)
