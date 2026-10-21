from django.contrib import admin

from .models import Tenant


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ["full_name", "phone", "organization", "status"]
    list_filter = ["status"]
    search_fields = ["full_name", "phone", "email", "id_number"]
