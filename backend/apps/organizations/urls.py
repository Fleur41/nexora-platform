from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("members", views.MembershipViewSet, basename="member")
router.register("invitations", views.InvitationViewSet, basename="invitation")

urlpatterns = [
    path("organizations/", views.OrganizationListCreateView.as_view(), name="organization-list"),
    path(
        "organizations/current/",
        views.CurrentOrganizationView.as_view(),
        name="organization-current",
    ),
    path("invitations/preview/", views.InvitationPreviewView.as_view(), name="invitation-preview"),
    path("invitations/accept/", views.InvitationAcceptView.as_view(), name="invitation-accept"),
    path("permissions/catalog/", views.CapabilityCatalogView.as_view(), name="capability-catalog"),
    *router.urls,
]
