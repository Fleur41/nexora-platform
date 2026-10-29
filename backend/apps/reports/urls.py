from django.urls import path

from . import views

urlpatterns = [
    path("reports/", views.ReportListView.as_view(), name="reports"),
    path("reports/<slug:key>/", views.ReportView.as_view(), name="report"),
]
