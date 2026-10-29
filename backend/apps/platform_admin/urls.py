from django.urls import path

from . import views

urlpatterns = [
    path("platform/overview/", views.OverviewView.as_view()),
    path("platform/organizations/", views.OrganizationListView.as_view()),
    path("platform/organizations/<uuid:pk>/", views.OrganizationDetailView.as_view()),
    path(
        "platform/organizations/<uuid:pk>/subscription/",
        views.OrganizationSubscriptionView.as_view(),
    ),
    path("platform/organizations/<uuid:pk>/invoices/", views.IssueInvoiceView.as_view()),
    path("platform/organizations/<uuid:pk>/support/", views.SupportStartView.as_view()),
    path(
        "platform/organizations/<uuid:pk>/<str:action>/",
        views.OrganizationStatusView.as_view(),
    ),
    path("platform/invoices/", views.InvoiceListView.as_view()),
    path("platform/invoices/<uuid:pk>/<str:action>/", views.InvoiceActionView.as_view()),
    path("platform/plans/", views.PlanListView.as_view()),
    path("platform/plans/<uuid:pk>/", views.PlanDetailView.as_view()),
    path("platform/support/<uuid:pk>/end/", views.SupportEndView.as_view()),
]
