from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register(
    "payment-configurations", views.PaymentConfigurationViewSet, basename="payment-configuration"
)
router.register("payments", views.PaymentViewSet, basename="payment")
router.register("payment-requests", views.PaymentRequestViewSet, basename="payment-request")
router.register("statement-imports", views.StatementImportViewSet, basename="statement-import")

callback = views.MpesaCallbackView.as_view()

urlpatterns = [
    path(
        "leases/<uuid:pk>/payment-instructions/",
        views.PaymentInstructionsView.as_view(),
        name="payment-instructions",
    ),
    path(
        "integrations/mpesa/<str:token>/c2b/confirmation/",
        callback,
        {"kind": "c2b_confirmation"},
        name="mpesa-c2b-confirmation",
    ),
    path(
        "integrations/mpesa/<str:token>/c2b/validation/",
        callback,
        {"kind": "c2b_validation"},
        name="mpesa-c2b-validation",
    ),
    path(
        "integrations/mpesa/<str:token>/stk/callback/",
        callback,
        {"kind": "stk_callback"},
        name="mpesa-stk-callback",
    ),
    *router.urls,
]
