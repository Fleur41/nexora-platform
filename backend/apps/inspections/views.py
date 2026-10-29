from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.properties.access import PropertyScopedViewSet

from . import services
from .models import Inspection
from .serializers import (
    InspectionCompleteSerializer,
    InspectionDetailSerializer,
    InspectionSerializer,
    ItemsSerializer,
)


class InspectionViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, PropertyScopedViewSet):
    queryset = Inspection.objects.select_related(
        "unit__property", "lease__tenant", "inspector__user"
    ).prefetch_related("items")
    serializer_class = InspectionSerializer
    property_path = "unit__property"
    required_capabilities = {
        "list": "inspections.view",
        "retrieve": "inspections.view",
        "create": "inspections.manage",
        "items": "inspections.manage",
        "complete": "inspections.manage",
        "cancel": "inspections.manage",
    }
    filterset_fields = ["status", "kind", "unit", "lease", "inspector"]
    search_fields = ["reference", "unit__number", "lease__tenant__full_name"]
    ordering = ["-scheduled_for", "-created_at"]

    def get_serializer_class(self):
        return (
            InspectionSerializer
            if self.action in ("list", "create")
            else InspectionDetailSerializer
        )

    def _detail(self, inspection, code=status.HTTP_200_OK):
        fresh = self.get_queryset().get(pk=inspection.pk)
        return Response(
            InspectionDetailSerializer(fresh, context=self.get_serializer_context()).data,
            status=code,
        )

    @extend_schema(request=InspectionSerializer, responses={201: InspectionDetailSerializer})
    def create(self, request):
        serializer = InspectionSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        inspection = services.schedule(
            request=request,
            organization=request.organization,
            unit=data["unit"],
            kind=data["kind"],
            scheduled_for=data["scheduled_for"],
            inspector=data.get("inspector"),
        )
        return self._detail(inspection, status.HTTP_201_CREATED)

    @extend_schema(request=ItemsSerializer, responses=InspectionDetailSerializer)
    @action(detail=True, methods=["patch"])
    def items(self, request, pk=None):
        inspection = self.get_object()
        serializer = ItemsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.update_items(
            request=request, inspection=inspection, items=serializer.validated_data["items"]
        )
        return self._detail(inspection)

    @extend_schema(request=InspectionCompleteSerializer, responses=InspectionDetailSerializer)
    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        inspection = self.get_object()
        serializer = InspectionCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.complete(request=request, inspection=inspection, **serializer.validated_data)
        return self._detail(inspection)

    @extend_schema(request=None, responses=InspectionDetailSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        inspection = self.get_object()
        services.cancel(request=request, inspection=inspection)
        return self._detail(inspection)
