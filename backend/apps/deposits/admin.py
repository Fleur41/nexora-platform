from django.contrib import admin

from .models import DepositTransaction


@admin.register(DepositTransaction)
class DepositTransactionAdmin(admin.ModelAdmin):
    list_display = ["transaction_date", "kind", "amount", "lease", "reference"]
    list_filter = ["kind"]

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
