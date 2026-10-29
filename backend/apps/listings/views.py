from django.db.models import Q
from django.http import FileResponse, Http404
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, generics, mixins, status
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.properties.access import PropertyScopedViewSet, accessible_properties
from apps.properties.models import Unit

from . import services
from .models import Enquiry, Listing, ListingPhoto
from .serializers import (
    EnquiryInSerializer,
    EnquirySerializer,
    ListingSerializer,
    PublicListingSerializer,
)

# --- Staff ----------------------------------------------------------------------------------


class ListingViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    PropertyScopedViewSet,
):
    queryset = Listing.objects.select_related("unit__property").prefetch_related(
        "photo_links__document", "enquiries"
    )
    serializer_class = ListingSerializer
    property_path = "unit__property"
    required_capabilities = {
        "list": "listings.view",
        "retrieve": "listings.view",
        "create": "listings.manage",
        "partial_update": "listings.manage",
        "photo_options": "listings.manage",
    }
    filterset_fields = ["is_published", "unit"]
    search_fields = ["title", "unit__number", "unit__property__name"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def _save(self, serializer, unit):
        data = dict(serializer.validated_data)
        data.pop("unit", None)
        photo_ids = data.pop("photo_ids", None)
        listing = services.save_listing(
            request=self.request, unit=unit, photo_ids=photo_ids, **data
        )
        serializer.instance = self.get_queryset().get(pk=listing.pk)

    def perform_create(self, serializer):
        unit = serializer.validated_data["unit"]
        if Listing.objects.filter(unit=unit).exists():
            raise exceptions.ValidationError({"unit": ["This unit already has a listing."]})
        self._save(serializer, unit)

    def perform_update(self, serializer):
        self._save(serializer, serializer.instance.unit)

    @extend_schema(responses=dict)
    @action(detail=False, methods=["get"], url_path="photo-options")
    def photo_options(self, request):
        unit = Unit.objects.filter(
            pk=request.query_params.get("unit"),
            property__in=accessible_properties(request.membership),
        ).first()
        if unit is None:
            raise exceptions.NotFound("Choose one of your units.")
        return Response(
            [
                {"id": str(d.pk), "title": d.title, "of": "unit" if d.unit_id else "property"}
                for d in services.eligible_photos(unit).order_by("-created_at")
            ]
        )


class EnquiryViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    PropertyScopedViewSet,
):
    queryset = Enquiry.objects.select_related("listing__unit__property", "handled_by__user")
    serializer_class = EnquirySerializer
    property_path = "listing__unit__property"
    required_capabilities = {
        "list": "listings.view",
        "retrieve": "listings.view",
        "partial_update": "listings.manage",
    }
    filterset_fields = ["status", "kind", "listing"]
    search_fields = ["reference", "name", "phone", "email", "listing__title"]
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get("open") == "true":
            queryset = queryset.filter(status__in=Enquiry.OPEN_STATUSES)
        return queryset

    def perform_update(self, serializer):
        enquiry = services.update_enquiry(
            request=self.request, enquiry=serializer.instance, **serializer.validated_data
        )
        serializer.instance = self.get_queryset().get(pk=enquiry.pk)


# --- Public website -------------------------------------------------------------------------


class PublicListingList(generics.ListAPIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    serializer_class = PublicListingSerializer

    def get_queryset(self):
        qs = services.public_listings().prefetch_related("photo_links")
        p = self.request.query_params
        if p.get("q"):
            q = p["q"].strip()
            qs = qs.filter(
                Q(title__icontains=q)
                | Q(unit__property__name__icontains=q)
                | Q(unit__property__town__icontains=q)
                | Q(unit__property__county__icontains=q)
            )
        if p.get("town"):
            qs = qs.filter(unit__property__town__iexact=p["town"])
        if p.get("landlord"):
            qs = qs.filter(organization__slug=p["landlord"])
        if p.get("category"):
            qs = qs.filter(unit__unit_type__category=p["category"])
        for param, lookup in (
            ("min_rent", "unit__market_rent__gte"),
            ("max_rent", "unit__market_rent__lte"),
            ("bedrooms", "unit__unit_type__bedrooms__gte"),
        ):
            if p.get(param, "").isdigit():
                qs = qs.filter(**{lookup: int(p[param])})
        ordering = {"rent": "unit__market_rent", "-rent": "-unit__market_rent"}.get(
            p.get("ordering", ""), "-published_at"
        )
        return qs.order_by(ordering, "pk")


class PublicListingDetail(generics.RetrieveAPIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    serializer_class = PublicListingSerializer

    def get_queryset(self):
        return services.public_listings().prefetch_related("photo_links")


class PublicListingPhoto(APIView):
    """A listing photo. Only files chosen for a currently public listing are served."""

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(responses={(200, "image/*"): bytes})
    def get(self, request, pk, document_id):
        link = (
            ListingPhoto.objects.filter(
                listing__in=services.public_listings(),
                listing_id=pk,
                document_id=document_id,
                document__deleted_at__isnull=True,
            )
            .select_related("document")
            .first()
        )
        if link is None:
            raise Http404
        document = link.document
        response = FileResponse(document.file.open("rb"), content_type=document.content_type)
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; sandbox"
        response["Cache-Control"] = "public, max-age=300"
        return response


class PublicEnquiryCreate(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "enquiry"

    @extend_schema(request=EnquiryInSerializer, responses={201: dict})
    def post(self, request, pk):
        listing = services.public_listings().filter(pk=pk).first()
        if listing is None:
            raise exceptions.NotFound("This home is no longer available.")
        data = EnquiryInSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        values = dict(data.validated_data)
        if values.pop("website", ""):
            # Looks like a bot: answer as if it worked, store nothing.
            return Response({"reference": None}, status=status.HTTP_201_CREATED)
        enquiry = services.submit_enquiry(listing=listing, **values)
        return Response({"reference": enquiry.reference}, status=status.HTTP_201_CREATED)
