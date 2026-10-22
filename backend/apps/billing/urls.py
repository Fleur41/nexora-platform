from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("charge-types", views.ChargeTypeViewSet, basename="charge-type")
router.register("charge-rules", views.ChargeRuleViewSet, basename="charge-rule")
router.register("shared-costs", views.SharedCostViewSet, basename="shared-cost")
router.register("billing-runs", views.BillingRunViewSet, basename="billing-run")
router.register("invoices", views.InvoiceViewSet, basename="invoice")

urlpatterns = [
    path("billing/settings/", views.BillingSettingsView.as_view(), name="billing-settings"),
    path("billing/summary/", views.BillingSummaryView.as_view(), name="billing-summary"),
    path("leases/<uuid:pk>/account/", views.LeaseAccountView.as_view(), name="lease-account"),
    path("tenants/<uuid:pk>/account/", views.TenantAccountView.as_view(), name="tenant-account"),
    *router.urls,
]
