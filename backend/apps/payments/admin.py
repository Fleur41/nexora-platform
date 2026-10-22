from django.contrib import admin

from .models import Payment, PaymentConfiguration, PaymentRequest, ProviderEvent, StatementImport


@admin.register(PaymentConfiguration)
class PaymentConfigurationAdmin(admin.ModelAdmin):
    list_display = ["display_name", "organization", "provider", "is_enabled", "integration_status"]
    exclude = ["callback_token", "callback_token_hash"]


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ["receipt_number", "organization", "amount", "method", "status", "received_on"]
    list_filter = ["status", "method", "source"]
    search_fields = ["receipt_number", "reference"]

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


admin.site.register(PaymentRequest)
admin.site.register(StatementImport)
admin.site.register(ProviderEvent)
