from django.urls import path

from . import views

urlpatterns = [
    path("subscription/", views.SubscriptionView.as_view(), name="subscription"),
    path(
        "subscription/invoices/",
        views.SubscriptionInvoicesView.as_view(),
        name="subscription-invoices",
    ),
    path(
        "subscription/change-plan/", views.ChangePlanView.as_view(), name="subscription-change-plan"
    ),
    path(
        "subscription/invoices/<uuid:pk>/pay/",
        views.PayInvoiceView.as_view(),
        name="subscription-invoice-pay",
    ),
    path(
        "subscription/mpesa/<str:token>/callback/",
        views.MpesaCallbackView.as_view(),
        name="subscription-mpesa-callback",
    ),
]
