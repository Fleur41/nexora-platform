from django.db.models import Count, Prefetch
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.organizations.access import RefetchOnWriteMixin

from . import services
from .access import PropertyScopedViewSet
from .models import Property, PropertyAssignment, Unit, UnitType
from .serializers import (
    BulkUnitSerializer,
    PropertyAssignmentSerializer,
    PropertySerializer,
    UnitSerializer,
    UnitStatusSerializer,
    UnitTypeSerializer,
    annotate_property_counts,
    unit_status_counts,
)

VIEW_MANAGE = {
    "list": "properties.view",
    "retrieve": "properties.view",
    "create": "properties.manage",
    "partial_update": "properties.manage",
}


class PropertyViewSet(
    RefetchOnWriteMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    PropertyScopedViewSet,
):
    queryset = Property.objects.all()
    serializer_class = PropertySerializer
    property_path = ""
    required_capabilities = {**VIEW_MANAGE, "summary": "properties.view"}
    filterset_fields = ["is_active", "property_type", "county", "is_listed_publicly"]
    search_fields = ["name", "reference", "town", "county", "address_line"]
    ordering_fields = ["name", "created_at", "reference"]
    ordering = ["name"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return annotate_property_counts(super().get_queryset())

    def perform_create(self, serializer):
        serializer.instance = services.create_property(
            request=self.request,
            organization=self.request.organization,
            **serializer.validated_data,
        )

    def perform_update(self, serializer):
        services.update_instance(
            request=self.request,
            instance=serializer.instance,
            action="property.updated",
            **serializer.validated_data,
        )

    @extend_schema(responses=dict)
    @action(detail=True, methods=["get"])
    def summary(self, request, pk=None):
        prop = self.get_object()
        unit_types = (
            UnitType.objects.filter(property=prop)
            .annotate(unit_count=Count("units"))
            .values("id", "name", "unit_count")
        )
        return Response(
            {
                "units": unit_status_counts(Unit.objects.filter(property=prop)),
                "unit_types": list(unit_types),
            }
        )


class UnitTypeViewSet(
    RefetchOnWriteMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    PropertyScopedViewSet,
):
    queryset = UnitType.objects.select_related("property")
    serializer_class = UnitTypeSerializer
    required_capabilities = {**VIEW_MANAGE, "destroy": "properties.manage"}
    filterset_fields = ["property", "category", "is_active"]
    search_fields = ["name"]
    ordering_fields = ["name", "default_rent", "bedrooms"]
    ordering = ["property__name", "bedrooms", "name"]  # Meta.ordering is dropped by annotate()
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().annotate(unit_count=Count("units"))

    def perform_create(self, serializer):
        serializer.instance = services.create_unit_type(
            request=self.request,
            organization=self.request.organization,
            **serializer.validated_data,
        )

    def perform_update(self, serializer):
        services.update_instance(
            request=self.request,
            instance=serializer.instance,
            action="unit_type.updated",
            **serializer.validated_data,
        )

    def perform_destroy(self, instance):
        from apps.audit.services import record_event

        instance.delete()  # PROTECT on Unit.unit_type -> 409 if units use it
        record_event(self.request, "unit_type.deleted", metadata={"name": instance.name})


class UnitViewSet(
    RefetchOnWriteMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    PropertyScopedViewSet,
):
    queryset = Unit.objects.select_related("property", "unit_type")
    serializer_class = UnitSerializer
    required_capabilities = {
        **VIEW_MANAGE,
        "destroy": "properties.manage",
        "set_status": "properties.manage",
        "bulk_create": "properties.manage",
        "summary": "properties.view",
    }
    filterset_fields = ["property", "unit_type", "status"]
    search_fields = ["number", "property__name", "floor"]
    ordering_fields = ["number", "market_rent", "status", "property__name"]
    ordering = ["property__name", "number"]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        from apps.leases.models import Lease

        return (
            super()
            .get_queryset()
            .prefetch_related(
                Prefetch(
                    "leases",
                    queryset=Lease.objects.filter(status=Lease.Status.ACTIVE).select_related(
                        "tenant"
                    ),
                    to_attr="active_leases",
                )
            )
        )

    def perform_create(self, serializer):
        serializer.instance = services.create_unit(
            request=self.request,
            organization=self.request.organization,
            **serializer.validated_data,
        )

    def perform_update(self, serializer):
        services.update_unit(
            request=self.request, unit=serializer.instance, **serializer.validated_data
        )

    def perform_destroy(self, instance):
        from apps.audit.services import record_event

        label = str(instance)
        instance.delete()  # PROTECT on Lease.unit -> 409 once a unit has lease history
        record_event(self.request, "unit.deleted", metadata={"unit": label})

    @extend_schema(request=UnitStatusSerializer, responses=UnitSerializer)
    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        unit = self.get_object()
        serializer = UnitStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        unit = services.set_unit_status(request=request, unit=unit, **serializer.validated_data)
        return Response(self.get_serializer(self.get_queryset().get(pk=unit.pk)).data)

    @extend_schema(request=BulkUnitSerializer, responses=UnitSerializer(many=True))
    @action(detail=False, methods=["post"], url_path="bulk")
    def bulk_create(self, request):
        serializer = BulkUnitSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        units = services.bulk_create_units(
            request=request, organization=request.organization, **serializer.validated_data
        )
        return Response(
            {"created": len(units), "numbers": [u.number for u in units]},
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(responses=dict)
    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Unit counts by status across every property the member can access."""
        return Response(unit_status_counts(self.filter_queryset(self.get_queryset())))


class PropertyAssignmentViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    PropertyScopedViewSet,
):
    queryset = PropertyAssignment.objects.select_related("property", "membership__user")
    serializer_class = PropertyAssignmentSerializer
    required_capabilities = {
        "list": "members.view",
        "create": "members.manage",
        "destroy": "members.manage",
    }
    filterset_fields = ["property", "membership"]
    pagination_class = None

    def perform_create(self, serializer):
        serializer.instance = services.assign_property(
            request=self.request,
            property=serializer.validated_data["property"],
            membership=serializer.validated_data["membership"],
        )

    def perform_destroy(self, instance):
        services.unassign_property(request=self.request, assignment=instance)
