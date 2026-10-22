from django.contrib import admin

from .models import BillingRun, ChargeRule, ChargeType, Invoice, LedgerEntry, SharedCost


@admin.register(ChargeType)
class ChargeTypeAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "organization", "income_category", "is_system"]


@admin.register(ChargeRule)
class ChargeRuleAdmin(admin.ModelAdmin):
    list_display = [
        "charge_type",
        "scope_key",
        "method",
        "amount",
        "is_enabled",
        "effective_from",
        "effective_to",
    ]
    list_filter = ["method", "is_enabled"]


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ["number", "organization", "tenant", "kind", "status", "total", "issue_date"]
    list_filter = ["status", "kind"]
    search_fields = ["number", "tenant__full_name"]

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(LedgerEntry)
class LedgerEntryAdmin(admin.ModelAdmin):
    list_display = ["effective_date", "entry_type", "amount", "lease", "reference"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


admin.site.register(BillingRun)
admin.site.register(SharedCost)
