from django.contrib import admin

from .models import Plan, Subscription, SubscriptionInvoice


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "max_units", "monthly_price", "is_active", "sort_order"]


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = [
        "organization",
        "plan",
        "status",
        "trial_ends_on",
        "paid_until",
        "complimentary",
    ]
    list_filter = ["status", "plan"]


@admin.register(SubscriptionInvoice)
class SubscriptionInvoiceAdmin(admin.ModelAdmin):
    list_display = ["number", "organization", "amount", "status", "due_date", "paid_at"]
    list_filter = ["status"]
