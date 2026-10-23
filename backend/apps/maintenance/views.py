from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.properties.access import PropertyScopedViewSet

from . import services
from .models import MaintenanceCost, MaintenanceRequest
from .serializers import (
    AssignSerializer,
    CostInputSerializer,
    DecideSerializer,
    MaintenanceCostSerializer,
    MaintenanceDetailSerializer,
    MaintenanceRequestSerializer,
    NoteSerializer,
    StatusSerializer,
)


class MaintenanceViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, PropertyScopedViewSet):
    queryset = MaintenanceRequest.objects.select_related(
        "unit__property", "tenant", "assigned_to__user"
    )
    serializer_class = MaintenanceRequestSerializer
    property_path = "unit__property"
    required_capabilities = {
        "list": "maintenance.view",
        "retrieve": "maintenance.view",
        "create": "maintenance.manage",
        "set_status": "maintenance.manage",
        "notes": "maintenance.manage",
        "assign": "maintenance.manage",
        "costs": "maintenance.costs",
        "decide": "maintenance.costs",
    }
    filterset_fields = ["status", "urgency", "category", "unit", "tenant", "assigned_to"]
    search_fields = ["reference", "title", "unit__number", "tenant__full_name"]
    ordering_fields = ["created_at", "urgency", "status"]
    ordering = ["-created_at"]

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params
        if params.get("open") == "true":
            queryset = queryset.filter(status__in=MaintenanceRequest.OPEN_STATUSES)
        if params.get("mine") == "true":
            queryset = queryset.filter(assigned_to=self.request.membership)
        if params.get("property"):
            queryset = queryset.filter(unit__property_id=params["property"])
        return queryset

    def get_serializer_class(self):
        return (
            MaintenanceRequestSerializer
            if self.action in ("list", "create")
            else MaintenanceDetailSerializer
        )

    def _detail(self, req, code=status.HTTP_200_OK):
        fresh = self.get_queryset().get(pk=req.pk)
        return Response(
            MaintenanceDetailSerializer(fresh, context=self.get_serializer_context()).data,
            status=code,
        )

    @extend_schema(
        request=MaintenanceRequestSerializer, responses={201: MaintenanceDetailSerializer}
    )
    def create(self, request):
        serializer = MaintenanceRequestSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        req = services.create_request(
            request=request,
            organization=request.organization,
            unit=data["unit"],
            category=data["category"],
            title=data["title"],
            description=data["description"],
            urgency=data.get("urgency", "normal"),
        )
        return self._detail(req, status.HTTP_201_CREATED)

    @extend_schema(request=StatusSerializer, responses=MaintenanceDetailSerializer)
    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        req = self.get_object()
        serializer = StatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.change_status(request=request, req=req, **serializer.validated_data)
        return self._detail(req)

    @extend_schema(request=NoteSerializer, responses=MaintenanceDetailSerializer)
    @action(detail=True, methods=["post"])
    def notes(self, request, pk=None):
        req = self.get_object()
        serializer = NoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.add_update(
            request=request,
            req=req,
            body=serializer.validated_data["body"],
            internal=serializer.validated_data["internal"],
        )
        return self._detail(req)

    @extend_schema(request=AssignSerializer, responses=MaintenanceDetailSerializer)
    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        req = self.get_object()
        serializer = AssignSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        services.assign(
            request=request,
            req=req,
            membership=serializer.validated_data["membership"],
            scheduled_for=serializer.validated_data.get("scheduled_for"),
        )
        return self._detail(req)

    @extend_schema(request=CostInputSerializer, responses={201: MaintenanceCostSerializer})
    @action(detail=True, methods=["post"])
    def costs(self, request, pk=None):
        req = self.get_object()
        serializer = CostInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        cost = services.add_cost(request=request, req=req, **serializer.validated_data)
        return Response(MaintenanceCostSerializer(cost).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=DecideSerializer, responses=MaintenanceCostSerializer)
    @action(detail=True, methods=["post"], url_path=r"costs/(?P<cost_id>[0-9a-f-]{36})/decide")
    def decide(self, request, pk=None, cost_id=None):
        req = self.get_object()
        cost = get_object_or_404(MaintenanceCost, pk=cost_id, request=req)
        serializer = DecideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not request.membership.has_capability("maintenance.manage"):
            raise exceptions.PermissionDenied("Approving quotations needs maintenance.manage too.")
        cost = services.decide_quotation(
            request=request, cost=cost, approve=serializer.validated_data["approve"]
        )
        return Response(MaintenanceCostSerializer(cost).data)
