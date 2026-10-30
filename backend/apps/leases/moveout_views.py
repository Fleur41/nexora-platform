from datetime import date
from decimal import Decimal

from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.billing.serializers import AccessibleLeaseField
from apps.deposits.models import DepositTransaction
from apps.organizations.access import OrganizationScopedPrimaryKeyRelatedField
from apps.organizations.models import Membership
from apps.properties.access import PropertyScopedViewSet
from apps.properties.models import Unit

from . import moveout
from .models import MoveOutNotice


class MoveOutSerializer(serializers.ModelSerializer):
    lease = AccessibleLeaseField()
    lease_reference = serializers.CharField(source="lease.reference", read_only=True)
    tenant_name = serializers.CharField(source="tenant.full_name", read_only=True)
    unit_number = serializers.CharField(source="lease.unit.number", read_only=True)
    property_name = serializers.CharField(source="lease.unit.property.name", read_only=True)
    inspection_reference = serializers.CharField(
        source="inspection.reference", default=None, read_only=True
    )
    inspection_status = serializers.CharField(
        source="inspection.status", default=None, read_only=True
    )

    class Meta:
        model = MoveOutNotice
        fields = [
            "id",
            "lease",
            "lease_reference",
            "tenant",
            "tenant_name",
            "unit_number",
            "property_name",
            "intended_date",
            "message",
            "from_tenant",
            "status",
            "staff_notes",
            "inspection",
            "inspection_reference",
            "inspection_status",
            "settlement",
            "acknowledged_at",
            "completed_at",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "tenant",
            "from_tenant",
            "status",
            "inspection",
            "settlement",
            "acknowledged_at",
            "completed_at",
            "created_at",
        ]
        # One open notice per lease is checked by the service (409 with a clear message);
        # DRF 3.17+ would otherwise turn the conditional unique constraint into a 400.
        validators: list = []


class AcknowledgeSerializer(serializers.Serializer):
    staff_notes = serializers.CharField(required=False, allow_blank=True, default="")


class ScheduleSerializer(serializers.Serializer):
    scheduled_for = serializers.DateField()
    inspector = OrganizationScopedPrimaryKeyRelatedField(
        queryset=Membership.objects.filter(status=Membership.Status.ACTIVE),
        required=False,
        allow_null=True,
    )


class SettlementInputSerializer(serializers.Serializer):
    moved_out_on = serializers.DateField()
    apply_deposit_to_balance = serializers.BooleanField(default=True)
    damages = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0"), required=False, allow_null=True
    )


class MoveOutCompleteSerializer(SettlementInputSerializer):
    unit_status = serializers.ChoiceField(choices=sorted(Unit.POST_LEASE_STATUSES))
    refund_method = serializers.ChoiceField(
        choices=DepositTransaction.Method.choices, required=False, default=""
    )
    refund_reference = serializers.CharField(
        max_length=64, required=False, allow_blank=True, default=""
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class MoveOutViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, PropertyScopedViewSet):
    queryset = MoveOutNotice.objects.select_related("lease__unit__property", "tenant", "inspection")
    serializer_class = MoveOutSerializer
    property_path = "lease__unit__property"
    required_capabilities = {
        "list": "moveouts.view",
        "retrieve": "moveouts.view",
        "create": "moveouts.manage",
        "acknowledge": "moveouts.manage",
        "withdraw": "moveouts.manage",
        "schedule_inspection": "moveouts.manage",
        "settlement": "moveouts.view",
        "complete": "moveouts.manage",
    }
    filterset_fields = ["status", "lease", "tenant"]
    search_fields = ["lease__reference", "tenant__full_name", "lease__unit__number"]
    ordering = ["intended_date"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.query_params.get("open") == "true":
            queryset = queryset.filter(status__in=MoveOutNotice.OPEN_STATUSES)
        return queryset

    def _detail(self, notice, code=status.HTTP_200_OK):
        return Response(
            self.get_serializer(self.get_queryset().get(pk=notice.pk)).data, status=code
        )

    @extend_schema(request=MoveOutSerializer, responses={201: MoveOutSerializer})
    def create(self, request):
        serializer = MoveOutSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        notice = moveout.submit_notice(
            request=request,
            lease=data["lease"],
            intended_date=data["intended_date"],
            message=data.get("message", ""),
            from_tenant=False,
        )
        return self._detail(notice, status.HTTP_201_CREATED)

    @extend_schema(request=AcknowledgeSerializer, responses=MoveOutSerializer)
    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        notice = self.get_object()
        serializer = AcknowledgeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._detail(
            moveout.acknowledge(request=request, notice=notice, **serializer.validated_data)
        )

    @extend_schema(request=None, responses=MoveOutSerializer)
    @action(detail=True, methods=["post"])
    def withdraw(self, request, pk=None):
        return self._detail(moveout.withdraw(request=request, notice=self.get_object()))

    @extend_schema(request=ScheduleSerializer, responses=MoveOutSerializer)
    @action(detail=True, methods=["post"], url_path="schedule-inspection")
    def schedule_inspection(self, request, pk=None):
        notice = self.get_object()
        serializer = ScheduleSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        return self._detail(
            moveout.schedule_inspection(request=request, notice=notice, **serializer.validated_data)
        )

    @extend_schema(parameters=[SettlementInputSerializer], responses=dict)
    @action(detail=True, methods=["get"])
    def settlement(self, request, pk=None):
        notice = self.get_object()
        params = request.query_params.copy()
        params.setdefault("moved_out_on", str(min(notice.intended_date, date.today())))
        serializer = SettlementInputSerializer(data=params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        preview = moveout.preview_settlement(
            notice,
            moved_out_on=data["moved_out_on"],
            apply_deposit_to_balance=data["apply_deposit_to_balance"],
            damages=data.get("damages"),
        )
        return Response(preview.as_dict())

    @extend_schema(request=MoveOutCompleteSerializer, responses=MoveOutSerializer)
    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        notice = self.get_object()
        serializer = MoveOutCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return self._detail(
            moveout.complete_move_out(request=request, notice=notice, **serializer.validated_data)
        )
