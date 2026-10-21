from django.contrib import admin

from .models import Lease, LeaseRentTerm


class RentTermInline(admin.TabularInline):
    model = LeaseRentTerm
    extra = 0
    readonly_fields = ["effective_from", "monthly_rent", "note", "created_by"]
    can_delete = False


@admin.register(Lease)
class LeaseAdmin(admin.ModelAdmin):
    list_display = ["reference", "tenant", "unit", "status", "start_date", "end_date"]
    list_filter = ["status", "billing_frequency"]
    search_fields = ["reference", "tenant__full_name", "unit__number"]
    inlines = [RentTermInline]
    readonly_fields = ["status", "activated_at", "closed_at"]
