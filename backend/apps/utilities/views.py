from django.db import transaction
from django.db.models import OuterRef, Subquery
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.organizations.access import RefetchOnWriteMixin
from apps.properties.access import PropertyScopedViewSet

from . import services
from .models import Meter, MeterReading
from .serializers import BulkReadingSerializer, MeterReadingSerializer, MeterSerializer


class MeterViewSet(
    RefetchOnWriteMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    PropertyScopedViewSet,
):
    queryset = Meter.objects.select_related("unit__property")
    serializer_class = MeterSerializer
    property_path = "unit__property"
    required_capabilities = {
        "list": "meters.view",
        "retrieve": "meters.view",
        "create": "meters.record",
        "partial_update": "meters.record",
        "deactivate": "meters.record",
    }
    filterset_fields = ["unit", "utility", "is_active", "unit__property"]
    search_fields = ["unit__number", "number", "unit__property__name"]
    ordering = ["unit__property__name", "unit__number", "utility"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        latest = MeterReading.objects.filter(meter=OuterRef("pk")).order_by("-reading_date")
        return (
            super()
            .get_queryset()
            .annotate(
                last_reading_date=Subquery(latest.values("reading_date")[:1]),
                last_reading_value=Subquery(latest.values("value")[:1]),
            )
        )

    def perform_create(self, serializer):
        serializer.instance = services.create_meter(
            request=self.request,
            organization=self.request.organization,
            **serializer.validated_data,
        )

    def perform_update(self, serializer):
        if set(serializer.validated_data) - {"number"}:
            raise exceptions.ValidationError("Only the meter number can be changed.")
        from apps.properties.services import update_instance

        update_instance(
            request=self.request,
            instance=serializer.instance,
            action="meter.updated",
            **serializer.validated_data,
        )

    @extend_schema(request=None, responses=MeterSerializer)
    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        meter = self.get_object()
        if not meter.is_active:
            raise BusinessRuleViolation("This meter is already inactive.")
        meter.is_active = False
        meter.save(update_fields=["is_active", "updated_at"])
        record_event(request, "meter.deactivated", target=meter)
        return Response(self.get_serializer(self.get_queryset().get(pk=meter.pk)).data)


class MeterReadingViewSet(
    RefetchOnWriteMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    PropertyScopedViewSet,
):
    queryset = MeterReading.objects.select_related("meter__unit", "recorded_by")
    serializer_class = MeterReadingSerializer
    property_path = "meter__unit__property"
    required_capabilities = {
        "list": "meters.view",
        "retrieve": "meters.view",
        "create": "meters.record",
        "partial_update": "meters.record",
        "destroy": "meters.record",
        "bulk": "meters.record",
    }
    filterset_fields = ["meter", "reading_date", "meter__unit", "meter__unit__property"]
    ordering = ["-reading_date", "meter__unit__number"]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def perform_create(self, serializer):
        data = serializer.validated_data
        serializer.instance = services.record_reading(
            request=self.request,
            meter=data["meter"],
            reading_date=data["reading_date"],
            value=data["value"],
            note=data.get("note", ""),
            is_estimate=data.get("is_estimate", False),
        )

    def perform_update(self, serializer):
        data = dict(serializer.validated_data)
        if "meter" in data and data["meter"].pk != serializer.instance.meter_id:
            raise exceptions.ValidationError({"meter": ["A reading cannot move to another meter."]})
        data.pop("meter", None)
        serializer.instance = services.update_reading(
            request=self.request, reading=serializer.instance, **data
        )

    def perform_destroy(self, instance):
        services.delete_reading(request=self.request, reading=instance)

    @extend_schema(
        request=BulkReadingSerializer, responses={201: MeterReadingSerializer(many=True)}
    )
    @action(detail=False, methods=["post"])
    def bulk(self, request):
        """Record one reading per meter for the same date (e.g. a monthly walk-round).
        All or nothing: if any row is invalid, nothing is saved and errors are listed per row."""
        serializer = BulkReadingSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        created, errors = [], {}
        with transaction.atomic():
            for index, row in enumerate(data["readings"]):
                try:
                    with transaction.atomic():
                        created.append(
                            services.record_reading(
                                request=request,
                                meter=row["meter"],
                                reading_date=data["reading_date"],
                                value=row["value"],
                                note=row.get("note", ""),
                            )
                        )
                except BusinessRuleViolation as exc:
                    errors[str(index)] = [str(exc.detail)]
            if errors:
                transaction.set_rollback(True)
        if errors:
            raise exceptions.ValidationError({"readings": errors})
        fresh = self.get_queryset().filter(pk__in=[r.pk for r in created])
        return Response(
            MeterReadingSerializer(fresh, many=True).data, status=status.HTTP_201_CREATED
        )
