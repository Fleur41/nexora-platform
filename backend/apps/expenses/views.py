from django.db.models import Count, Sum
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.money import ZERO
from apps.organizations.access import RefetchOnWriteMixin
from apps.properties.access import PropertyScopedViewSet

from . import services
from .models import Expense
from .serializers import ExpenseSerializer, ExpenseSummarySerializer, ExpenseVoidSerializer


class ExpenseFilters(serializers.Serializer):
    start = serializers.DateField(required=False)
    end = serializers.DateField(required=False)
    organization_wide = serializers.BooleanField(required=False, allow_null=True, default=None)


class ExpenseViewSet(
    RefetchOnWriteMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    PropertyScopedViewSet,
):
    """Running costs. Members who don't cover the whole organization only see (and record)
    expenses on properties they're assigned to, never organization-wide ones."""

    queryset = Expense.objects.select_related("property", "unit", "created_by", "voided_by")
    serializer_class = ExpenseSerializer
    property_path = "property"
    required_capabilities = {
        "list": "expenses.view",
        "retrieve": "expenses.view",
        "summary": "expenses.view",
        "create": "expenses.record",
        "partial_update": "expenses.record",
        "void": "expenses.void",
    }
    filterset_fields = ["category", "property", "unit", "status", "method"]
    search_fields = ["reference", "description", "supplier_name", "payment_reference"]
    ordering_fields = ["incurred_on", "amount", "created_at"]
    ordering = ["-incurred_on", "-created_at"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action not in ("list", "summary"):
            return queryset
        filters = ExpenseFilters(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        data = filters.validated_data
        if data.get("start"):
            queryset = queryset.filter(incurred_on__gte=data["start"])
        if data.get("end"):
            queryset = queryset.filter(incurred_on__lte=data["end"])
        if data.get("organization_wide") is not None:
            queryset = queryset.filter(property__isnull=data["organization_wide"])
        return queryset

    def perform_create(self, serializer):
        serializer.instance = services.create_expense(
            request=self.request,
            organization=self.request.organization,
            **serializer.validated_data,
        )

    def perform_update(self, serializer):
        serializer.instance = services.update_expense(
            request=self.request, expense=serializer.instance, **serializer.validated_data
        )

    @extend_schema(
        parameters=[
            OpenApiParameter("start", str, description="First day (YYYY-MM-DD)"),
            OpenApiParameter("end", str, description="Last day (YYYY-MM-DD)"),
        ],
        responses=ExpenseSummarySerializer,
    )
    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Totals of recorded (not voided) expenses matching the same filters as the list."""
        queryset = self.filter_queryset(self.get_queryset()).filter(status=Expense.Status.RECORDED)
        labels = dict(Expense.Category.choices)
        rows = list(
            queryset.order_by()
            .values("category")
            .annotate(total=Sum("amount"), count=Count("id"))
            .order_by("-total")
        )
        by_category = [
            {
                "category": r["category"],
                "label": labels[r["category"]],
                "count": r["count"],
                "total": str(r["total"]),
            }
            for r in rows
        ]
        return Response(
            {
                "count": sum(r["count"] for r in by_category),
                "total": str(sum((r["total"] for r in rows), ZERO)),
                "by_category": by_category,
            }
        )

    @extend_schema(request=ExpenseVoidSerializer, responses=ExpenseSerializer)
    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        expense = self.get_object()
        serializer = ExpenseVoidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.void_expense(
            request=request, expense=expense, reason=serializer.validated_data["reason"]
        )
        return Response(self.get_serializer(self.get_queryset().get(pk=expense.pk)).data)
