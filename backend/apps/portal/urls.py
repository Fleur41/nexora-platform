from django.urls import path

from . import views

t = "portal/tenancies/<uuid:tenant_id>"

urlpatterns = [
    path("portal/tenancies/", views.TenanciesView.as_view(), name="portal-tenancies"),
    path(f"{t}/", views.SummaryView.as_view(), name="portal-summary"),
    path(f"{t}/invoices/", views.InvoicesView.as_view(), name="portal-invoices"),
    path(
        f"{t}/invoices/<uuid:invoice_id>/", views.InvoiceDetailView.as_view(), name="portal-invoice"
    ),
    path(
        f"{t}/invoices/<uuid:invoice_id>/pdf/",
        views.InvoicePdfView.as_view(),
        name="portal-invoice-pdf",
    ),
    path(f"{t}/payments/", views.PaymentsView.as_view(), name="portal-payments"),
    path(f"{t}/payments/<uuid:payment_id>/", views.ReceiptView.as_view(), name="portal-receipt"),
    path(
        f"{t}/payments/<uuid:payment_id>/pdf/",
        views.ReceiptPdfView.as_view(),
        name="portal-receipt-pdf",
    ),
    path(
        f"{t}/leases/<uuid:lease_id>/statement/",
        views.StatementView.as_view(),
        name="portal-statement",
    ),
    path(f"{t}/pay/", views.PayView.as_view(), name="portal-pay"),
    path(f"{t}/maintenance/", views.MaintenanceListView.as_view(), name="portal-maintenance"),
    path(
        f"{t}/maintenance/<uuid:request_id>/",
        views.MaintenanceDetailView.as_view(),
        name="portal-maintenance-detail",
    ),
    path(
        f"{t}/maintenance/<uuid:request_id>/photos/<uuid:document_id>/",
        views.MaintenancePhotoView.as_view(),
        name="portal-maintenance-photo",
    ),
    path(f"{t}/move-out/", views.MoveOutView.as_view(), name="portal-move-out"),
    path(
        f"{t}/move-out/<uuid:notice_id>/withdraw/",
        views.MoveOutWithdrawView.as_view(),
        name="portal-move-out-withdraw",
    ),
    path(
        "portal/invitations/preview/",
        views.InvitationPreviewView.as_view(),
        name="portal-invitation-preview",
    ),
    path(
        "portal/invitations/accept/",
        views.InvitationAcceptView.as_view(),
        name="portal-invitation-accept",
    ),
]
