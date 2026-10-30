from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.views import HealthView

api_v1 = [
    path("health/", HealthView.as_view(), name="health"),
    path("auth/", include("apps.accounts.urls")),
    path("", include("apps.organizations.urls")),
    path("", include("apps.audit.urls")),
    path("", include("apps.documents.urls")),
    path("", include("apps.properties.urls")),
    path("", include("apps.tenants.urls")),
    path("", include("apps.leases.urls")),
    path("", include("apps.utilities.urls")),
    path("", include("apps.billing.urls")),
    path("", include("apps.deposits.urls")),
    path("", include("apps.payments.urls")),
    path("", include("apps.notifications.urls")),
    path("", include("apps.maintenance.urls")),
    path("", include("apps.expenses.urls")),
    path("", include("apps.inspections.urls")),
    path("", include("apps.portal.urls")),
    path("", include("apps.reports.urls")),
    path("", include("apps.listings.urls")),
    path("", include("apps.subscriptions.urls")),
    path("", include("apps.platform_admin.urls")),
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="api-docs"),
]

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/v1/", include(api_v1)),
]
