from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, mixins, status
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.money import ZERO
from apps.leases.models import Lease
from apps.properties.access import PropertyScopedViewSet

from . import services
from .models import DepositTransaction
from .serializers import (
    DepositTransactionSerializer,
    RecordDepositSerializer,
    ReverseSerializer,
    summary_payload,
)

KIND_CAPABILITY = {
    DepositTransaction.Kind.RECEIVED: "deposits.record",
    DepositTransaction.Kind.DEDUCTION: "deposits.settle",
    DepositTransaction.Kind.REFUND: "deposits.settle",
}


class DepositViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, PropertyScopedViewSet):
    """Deposits per lease (the lease id is the deposit id)."""

    queryset = Lease.objects.select_related("tenant", "unit__property").exclude(
        status=Lease.Status.CANCELLED
    )
    serializer_class = DepositTransactionSerializer  # summaries below are documented as dict
    property_path = "unit__property"
    required_capabilities = {
        "list": "deposits.view",
        "retrieve": "deposits.view",
        "summary": "deposits.view",
        "transactions": "deposits.view",  # per-kind capability checked below
        "reverse": "deposits.settle",
    }
    filterset_fields = ["status", "tenant"]
    search_fields = ["reference", "tenant__full_name", "unit__number"]
    ordering = ["unit__property__name", "unit__number"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == "list":
            queryset = queryset.filter(
                Q(deposit_amount__gt=0) | Q(deposit_transactions__isnull=False)
            ).distinct()
            if self.request.query_params.get("property"):
                queryset = queryset.filter(unit__property_id=self.request.query_params["property"])
        return queryset

    @extend_schema(operation_id="deposits_list", responses=dict)
    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        rows = [summary_payload(lease, services.summarize(lease)) for lease in page]
        return self.get_paginated_response(rows)

    @extend_schema(responses=dict)
    def retrieve(self, request, *args, **kwargs):
        lease = self.get_object()
        transactions = DepositTransaction.objects.filter(lease=lease).select_related(
            "created_by", "reverses"
        )
        return Response(
            {
                **summary_payload(lease, services.summarize(lease)),
                "transactions": DepositTransactionSerializer(transactions, many=True).data,
            }
        )

    @extend_schema(responses=dict)
    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Total deposits held (a liability) and still to collect, across accessible leases."""
        held = outstanding = ZERO
        for lease in (
            self.get_queryset()
            .filter(Q(deposit_amount__gt=0) | Q(deposit_transactions__isnull=False))
            .distinct()
        ):
            s = services.summarize(lease)
            held += s.held
            if lease.status == Lease.Status.ACTIVE:
                outstanding += s.outstanding
        return Response(
            {
                "currency": request.organization.currency,
                "held": str(held),
                "outstanding": str(outstanding),
            }
        )

    @extend_schema(request=RecordDepositSerializer, responses={201: DepositTransactionSerializer})
    @action(detail=True, methods=["post"])
    def transactions(self, request, pk=None):
        lease = self.get_object()
        serializer = RecordDepositSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not request.membership.has_capability(KIND_CAPABILITY[data["kind"]]):
            raise exceptions.PermissionDenied(
                detail="Your role does not allow this action.", code="missing_capability"
            )
        tx = services.record(request=request, lease=lease, **data)
        return Response(DepositTransactionSerializer(tx).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=ReverseSerializer, responses={201: DepositTransactionSerializer})
    @action(
        detail=True, methods=["post"], url_path=r"transactions/(?P<tx_id>[0-9a-f-]{36})/reverse"
    )
    def reverse(self, request, pk=None, tx_id=None):
        lease = self.get_object()
        original = get_object_or_404(DepositTransaction, pk=tx_id, lease=lease)
        serializer = ReverseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tx = services.reverse(request=request, original=original, **serializer.validated_data)
        return Response(DepositTransactionSerializer(tx).data, status=status.HTTP_201_CREATED)
