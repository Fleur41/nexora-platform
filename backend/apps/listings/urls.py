from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("listings", views.ListingViewSet, basename="listing")
router.register("enquiries", views.EnquiryViewSet, basename="enquiry")

urlpatterns = [
    path("public/listings/", views.PublicListingList.as_view(), name="public-listings"),
    path("public/listings/<uuid:pk>/", views.PublicListingDetail.as_view(), name="public-listing"),
    path(
        "public/listings/<uuid:pk>/photos/<uuid:document_id>/",
        views.PublicListingPhoto.as_view(),
        name="public-listing-photo",
    ),
    path(
        "public/listings/<uuid:pk>/enquiries/",
        views.PublicEnquiryCreate.as_view(),
        name="public-listing-enquiry",
    ),
    *router.urls,
]
