from django.db.models import Prefetch
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.organizations.access import RefetchOnWriteMixin
from apps.properties.access import PropertyScopedViewSet

from . import services
from .filters import LeaseFilter
from .models import Lease, LeaseRentTerm
from .serializers import (
    CancelLeaseSerializer,
    EndLeaseSerializer,
    FirstMonthSerializer,
    LeaseSerializer,
    RentChangeSerializer,
    RentTermSerializer,
)


class LeaseViewSet(
    RefetchOnWriteMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    PropertyScopedViewSet,
):
    queryset = Lease.objects.select_related(
        "tenant", "unit__property", "organization"
    ).prefetch_related(
        Prefetch("rent_terms", queryset=LeaseRentTerm.objects.order_by("effective_from"))
    )
    serializer_class = LeaseSerializer
    property_path = "unit__property"
    required_capabilities = {
        "list": "leases.view",
        "retrieve": "leases.view",
        "create": "leases.manage",
        "partial_update": "leases.manage",
        "activate": "leases.manage",
        "cancel": "leases.manage",
        "end": "leases.manage",
        "rent_terms": "leases.manage",
        "remove_rent_term": "leases.manage",
        "first_month": "leases.manage",
    }
    filterset_class = LeaseFilter
    search_fields = ["reference", "tenant__full_name", "tenant__phone", "unit__number"]
    ordering_fields = ["start_date", "end_date", "reference", "created_at"]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def perform_create(self, serializer):
        data = dict(serializer.validated_data)
        serializer.instance = services.create_lease(
            request=self.request, organization=self.request.organization, **data
        )

    def perform_update(self, serializer):
        data = dict(serializer.validated_data)
        data.pop("activate", None)
        serializer.instance = services.update_draft(
            request=self.request, lease=serializer.instance, **data
        )

    def _respond(self, lease, code=status.HTTP_200_OK):
        return Response(self.get_serializer(self.get_queryset().get(pk=lease.pk)).data, status=code)

    @extend_schema(request=None, responses=LeaseSerializer)
    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        return self._respond(services.activate_lease(request=request, lease=self.get_object()))

    @extend_schema(request=CancelLeaseSerializer, responses=LeaseSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        lease = self.get_object()
        serializer = CancelLeaseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lease = services.cancel_draft(request=request, lease=lease, **serializer.validated_data)
        return self._respond(lease)

    @extend_schema(request=EndLeaseSerializer, responses=LeaseSerializer)
    @action(detail=True, methods=["post"])
    def end(self, request, pk=None):
        lease = self.get_object()
        serializer = EndLeaseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lease = services.end_lease(request=request, lease=lease, **serializer.validated_data)
        return self._respond(lease)

    @extend_schema(request=FirstMonthSerializer, responses=LeaseSerializer)
    @action(detail=True, methods=["post"], url_path="first-month")
    def first_month(self, request, pk=None):
        serializer = FirstMonthSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lease = services.set_first_month_in_full(
            request=request,
            lease=self.get_object(),
            enabled=serializer.validated_data["first_month_in_full"],
        )
        return self._respond(lease)

    @extend_schema(request=RentChangeSerializer, responses={201: RentTermSerializer})
    @action(detail=True, methods=["post"], url_path="rent-terms")
    def rent_terms(self, request, pk=None):
        lease = self.get_object()
        serializer = RentChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        term = services.add_rent_term(request=request, lease=lease, **serializer.validated_data)
        return Response(RentTermSerializer(term).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses={204: None})
    @action(detail=True, methods=["delete"], url_path=r"rent-terms/(?P<term_id>[0-9a-f-]{36})")
    def remove_rent_term(self, request, pk=None, term_id=None):
        lease = self.get_object()
        term = lease.rent_terms.filter(pk=term_id).first()
        if term is None:
            from rest_framework.exceptions import NotFound

            raise NotFound()
        services.remove_rent_term(request=request, term=term)
        return Response(status=status.HTTP_204_NO_CONTENT)
