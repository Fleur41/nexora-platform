from datetime import date

from django.db.models import Count, DecimalField, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, mixins, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.money import ZERO
from apps.leases.models import Lease
from apps.organizations.access import (
    OrganizationPermission,
    OrganizationScopedViewSet,
    RefetchOnWriteMixin,
)
from apps.organizations.models import organization_today
from apps.properties.access import PropertyScopedViewSet, accessible_properties
from apps.properties.models import Unit
from apps.tenants.access import accessible_tenants

from . import services
from .defaults import ensure_default_charge_types
from .engine import MonthDraft
from .models import (
    BillingRun,
    BillingSettings,
    ChargeRule,
    ChargeType,
    Invoice,
    LedgerEntry,
    SharedCost,
)
from .rules import RuleBook
from .serializers import (
    BillingRunSerializer,
    BillingSettingsSerializer,
    ChargeRuleSerializer,
    ChargeTypeSerializer,
    CreditSerializer,
    EndRuleSerializer,
    InvoiceDetailSerializer,
    InvoiceSerializer,
    LedgerEntrySerializer,
    OneOffInvoiceSerializer,
    PeriodSerializer,
    SharedCostSerializer,
    StatementQuerySerializer,
    VoidSerializer,
)

MONEY = DecimalField(max_digits=14, decimal_places=2)


def _sum(expr, **filter_kwargs):
    agg = Sum(expr, filter=Q(**filter_kwargs)) if filter_kwargs else Sum(expr)
    return Coalesce(agg, Value(ZERO), output_field=MONEY)


def with_amount_due(queryset, name="amount_due"):
    """Annotate each invoice with the sum of its ledger entries (a subquery, so it can be
    filtered and aggregated without join fan-out)."""
    due = (
        LedgerEntry.objects.filter(invoice=OuterRef("pk"))
        .values("invoice")
        .annotate(s=Sum("amount"))
        .values("s")
    )
    return queryset.annotate(
        **{name: Coalesce(Subquery(due, output_field=MONEY), Value(ZERO), output_field=MONEY)}
    )


class ChargeTypeViewSet(
    RefetchOnWriteMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    OrganizationScopedViewSet,
):
    queryset = ChargeType.objects.all()
    serializer_class = ChargeTypeSerializer
    pagination_class = None
    required_capabilities = {
        "list": None,  # names only; needed by anyone picking a charge
        "create": "billing.configure",
        "partial_update": "billing.configure",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        ensure_default_charge_types(self.request.organization)
        return super().get_queryset().order_by("-is_system", "name")

    def perform_create(self, serializer):
        data = dict(serializer.validated_data)
        serializer.instance = services.create_charge_type(
            request=self.request, organization=self.request.organization, **data
        )

    def perform_update(self, serializer):
        instance = serializer.instance
        if instance.is_system and set(serializer.validated_data) - {"is_active"} - {"name"}:
            raise exceptions.ValidationError("Built-in charge types can only be renamed.")
        if instance.is_system and "is_active" in serializer.validated_data:
            raise exceptions.ValidationError("Built-in charge types cannot be deactivated.")
        from apps.properties.services import update_instance

        update_instance(
            request=self.request,
            instance=instance,
            action="charge_type.updated",
            **serializer.validated_data,
        )


class ChargeRuleViewSet(
    RefetchOnWriteMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    OrganizationScopedViewSet,
):
    queryset = ChargeRule.objects.select_related(
        "charge_type", "property", "unit_type__property", "unit__property"
    )
    serializer_class = ChargeRuleSerializer
    required_capabilities = {
        "list": "billing.view",
        "retrieve": "billing.view",
        "create": "billing.configure",
        "partial_update": "billing.configure",
        "destroy": "billing.configure",
        "end": "billing.configure",
        "resolve": "billing.view",
    }
    filterset_fields = [
        "charge_type",
        "scope",
        "property",
        "unit_type",
        "unit",
        "method",
        "is_enabled",
    ]
    ordering = ["charge_type__name", "scope", "-effective_from"]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .annotate(billed_lines=Count("lines", filter=Q(lines__is_void=False)))
        )

    def perform_create(self, serializer):
        serializer.instance = services.create_rule(
            request=self.request,
            organization=self.request.organization,
            **serializer.validated_data,
        )

    def perform_update(self, serializer):
        serializer.instance = services.update_rule(
            request=self.request, rule=serializer.instance, **serializer.validated_data
        )

    def perform_destroy(self, instance):
        services.delete_rule(request=self.request, rule=instance)

    @extend_schema(request=EndRuleSerializer, responses=ChargeRuleSerializer)
    @action(detail=True, methods=["post"])
    def end(self, request, pk=None):
        rule = self.get_object()
        serializer = EndRuleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rule = services.end_rule(request=request, rule=rule, **serializer.validated_data)
        return Response(self.get_serializer(self.get_queryset().get(pk=rule.pk)).data)

    @extend_schema(responses=dict)
    @action(detail=False, methods=["get"])
    def resolve(self, request):
        """What each charge type does for one unit on a date (default: today)."""
        unit = get_object_or_404(
            Unit.objects.filter(
                property__in=accessible_properties(request.membership).values("pk")
            ),
            pk=request.query_params.get("unit"),
        )
        try:
            on = (
                date.fromisoformat(request.query_params["date"])
                if "date" in request.query_params
                else organization_today(request.organization)
            )
        except ValueError as exc:
            raise exceptions.ValidationError({"date": ["Use YYYY-MM-DD."]}) from exc
        book = RuleBook(request.organization)
        rows = []
        for charge_type in sorted(
            ensure_default_charge_types(request.organization), key=lambda c: c.name
        ):
            if charge_type.code == ChargeType.RENT:
                continue
            rule = book.resolve(charge_type.pk, unit, on)
            if rule is None:
                continue
            rows.append(
                {
                    "charge_type": str(charge_type.pk),
                    "charge_type_name": charge_type.name,
                    "rule": str(rule.pk),
                    "scope": rule.scope,
                    "method": rule.method,
                    "amount": str(rule.amount),
                    "usage_unit": rule.usage_unit,
                    "is_enabled": rule.is_enabled,
                    "included_in_rent": rule.included_in_rent,
                    "billable": rule.is_billable,
                }
            )
        return Response({"unit": str(unit.pk), "date": str(on), "charges": rows})


class BillingSettingsView(APIView):
    permission_classes = [IsAuthenticated, OrganizationPermission]
    required_capabilities = {"get": "billing.view", "patch": "billing.configure"}

    def _settings(self, request):
        return BillingSettings.objects.get_or_create(organization=request.organization)[0]

    @extend_schema(responses=BillingSettingsSerializer)
    def get(self, request):
        return Response(BillingSettingsSerializer(self._settings(request)).data)

    @extend_schema(request=BillingSettingsSerializer, responses=BillingSettingsSerializer)
    def patch(self, request):
        from apps.properties.services import update_instance

        instance = self._settings(request)
        serializer = BillingSettingsSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        update_instance(
            request=request,
            instance=instance,
            action="billing.settings_updated",
            **serializer.validated_data,
        )
        return Response(BillingSettingsSerializer(instance).data)


class SharedCostViewSet(
    RefetchOnWriteMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    PropertyScopedViewSet,
):
    queryset = SharedCost.objects.select_related("property", "charge_type")
    serializer_class = SharedCostSerializer
    required_capabilities = {
        "list": "billing.view",
        "retrieve": "billing.view",
        "create": "billing.generate",
        "destroy": "billing.generate",
    }
    filterset_fields = ["property", "charge_type", "period"]
    ordering = ["-period", "property__name"]

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .annotate(
                allocated_amount=_sum("lines__amount", lines__is_void=False),
                allocated_units=Count("lines", filter=Q(lines__is_void=False)),
            )
        )

    def perform_create(self, serializer):
        from apps.audit.services import record_event

        serializer.save(organization=self.request.organization, created_by=self.request.user)
        record_event(
            self.request,
            "shared_cost.created",
            target=serializer.instance,
            metadata={
                "total": str(serializer.instance.total_amount),
                "split_by": serializer.instance.split_by,
            },
        )

    def perform_destroy(self, instance):
        from apps.audit.services import record_event
        from apps.core.exceptions import BusinessRuleViolation

        if instance.lines.filter(is_void=False).exists():
            raise BusinessRuleViolation("This cost has been billed. Void those invoices first.")
        record_event(self.request, "shared_cost.deleted", target=instance)
        instance.delete()


def _parse_period(request) -> date:
    serializer = PeriodSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    year, month = serializer.validated_data["period"].split("-")
    return date(int(year), int(month), 1)


def _draft_payload(draft: MonthDraft, request) -> dict:
    allowed = set(accessible_properties(request.membership).values_list("pk", flat=True))
    invoices = [d for d in draft.invoices if d.lease.unit.property_id in allowed]
    return {
        "period": f"{draft.month:%Y-%m}",
        "invoice_count": len(invoices),
        "total": str(sum((d.total for d in invoices), ZERO)),
        "notes": draft.notes,
        "invoices": [
            {
                "lease": str(d.lease.pk),
                "lease_reference": d.lease.reference,
                "tenant_name": d.lease.tenant.full_name,
                "unit_number": d.lease.unit.number,
                "property_name": d.lease.unit.property.name,
                "kind": d.kind,
                "period_start": str(d.period_start),
                "period_end": str(d.period_end),
                "due_date": str(d.due_date),
                "total": str(d.total),
                "lines": [
                    {"description": line.description, "amount": str(line.amount)}
                    for line in d.lines
                ],
            }
            for d in invoices
        ],
    }


class BillingRunViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, OrganizationScopedViewSet
):
    queryset = BillingRun.objects.select_related("created_by")
    serializer_class = BillingRunSerializer
    required_capabilities = {
        "list": "billing.view",
        "retrieve": "billing.view",
        "create": "billing.generate",
        "preview": "billing.generate",
    }

    def _require_organization_scope(self, request):
        # A run bills the whole organization, so it needs whole-organization access.
        if not request.membership.has_organization_scope:
            raise exceptions.PermissionDenied(
                "Billing runs cover every property; ask someone with whole-organization access."
            )

    @extend_schema(request=PeriodSerializer, responses=dict)
    @action(detail=False, methods=["post"])
    def preview(self, request):
        self._require_organization_scope(request)
        draft = services.preview_billing(
            organization=request.organization, month=_parse_period(request)
        )
        return Response(_draft_payload(draft, request))

    @extend_schema(request=PeriodSerializer, responses={201: BillingRunSerializer})
    def create(self, request):
        self._require_organization_scope(request)
        result = services.run_billing(
            request=request, organization=request.organization, month=_parse_period(request)
        )
        return Response(BillingRunSerializer(result.run).data, status=status.HTTP_201_CREATED)


class InvoiceViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    PropertyScopedViewSet,
):
    queryset = Invoice.objects.select_related("tenant", "unit__property", "lease")
    serializer_class = InvoiceSerializer
    property_path = "unit__property"
    required_capabilities = {
        "list": "billing.view",
        "retrieve": "billing.view",
        "create": "billing.generate",
        "void": "billing.adjust",
        "credit": "billing.adjust",
        "pdf": "billing.view",
    }
    filterset_fields = ["status", "kind", "lease", "tenant", "unit", "billing_run"]
    search_fields = ["number", "tenant__full_name", "unit__number", "lease__reference"]
    ordering_fields = ["issue_date", "due_date", "total", "number"]
    ordering = ["-issue_date", "-number"]

    def get_queryset(self):
        queryset = with_amount_due(super().get_queryset())
        params = self.request.query_params
        if params.get("property"):
            queryset = queryset.filter(unit__property_id=params["property"])
        if params.get("period"):
            try:
                year, month = (int(x) for x in params["period"].split("-"))
                queryset = queryset.filter(period_start__year=year, period_start__month=month)
            except ValueError as exc:
                raise exceptions.ValidationError({"period": ["Use YYYY-MM."]}) from exc
        if params.get("outstanding") == "true":
            queryset = queryset.filter(status=Invoice.Status.ISSUED, amount_due__gt=0)
        if params.get("overdue") == "true":
            today = organization_today(self.request.organization)
            queryset = queryset.filter(
                status=Invoice.Status.ISSUED, amount_due__gt=0, due_date__lt=today
            )
        if self.action == "retrieve":
            queryset = queryset.prefetch_related(
                "lines__charge_type", "ledger_entries__created_by"
            ).select_related("created_by", "voided_by")
        return queryset

    def get_serializer_class(self):
        return InvoiceDetailSerializer if self.action != "list" else InvoiceSerializer

    def _detail(self, invoice, code=status.HTTP_200_OK):
        fresh = (
            self.get_queryset()
            .prefetch_related("lines__charge_type", "ledger_entries__created_by")
            .get(pk=invoice.pk)
        )
        return Response(
            InvoiceDetailSerializer(fresh, context=self.get_serializer_context()).data, status=code
        )

    @extend_schema(request=OneOffInvoiceSerializer, responses={201: InvoiceDetailSerializer})
    def create(self, request):
        serializer = OneOffInvoiceSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        invoice = services.create_one_off_invoice(
            request=request,
            organization=request.organization,
            lease=data["lease"],
            lines=data["lines"],
            due_date=data.get("due_date"),
            notes=data.get("notes", ""),
        )
        return self._detail(invoice, status.HTTP_201_CREATED)

    @extend_schema(responses={(200, "application/pdf"): bytes})
    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        """The invoice as a PDF (the same file tenants get by email)."""
        from apps.core.pdf import pdf_response

        from .pdf import invoice_filename, invoice_pdf

        invoice = self.get_object()
        return pdf_response(invoice_pdf(invoice), invoice_filename(invoice))

    @extend_schema(request=VoidSerializer, responses=InvoiceDetailSerializer)
    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        invoice = self.get_object()
        serializer = VoidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.void_invoice(request=request, invoice=invoice, **serializer.validated_data)
        return self._detail(invoice)

    @extend_schema(request=CreditSerializer, responses=InvoiceDetailSerializer)
    @action(detail=True, methods=["post"])
    def credit(self, request, pk=None):
        invoice = self.get_object()
        serializer = CreditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.credit_invoice(request=request, invoice=invoice, **serializer.validated_data)
        return self._detail(invoice)


class LeaseAccountView(APIView):
    """Balance and statement for one lease."""

    permission_classes = [IsAuthenticated, OrganizationPermission]
    required_capabilities = {"get": "billing.view"}

    @extend_schema(parameters=[StatementQuerySerializer], responses=dict)
    def get(self, request, pk):
        lease = get_object_or_404(
            Lease.objects.filter(
                organization=request.organization,
                unit__property__in=accessible_properties(request.membership).values("pk"),
            ),
            pk=pk,
        )
        query = StatementQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        result = services.statement(
            lease, query.validated_data.get("start"), query.validated_data.get("end")
        )
        today = organization_today(request.organization)
        overdue = with_amount_due(
            Invoice.objects.filter(lease=lease, status=Invoice.Status.ISSUED, due_date__lt=today),
            "due",
        ).aggregate(total=_sum("due"))["total"]
        return Response(
            {
                "lease": str(lease.pk),
                "currency": request.organization.currency,
                "balance": str(services.lease_balance(lease)),
                "overdue": str(max(overdue or ZERO, ZERO)),
                "opening_balance": str(result["opening_balance"]),
                "closing_balance": str(result["closing_balance"]),
                "entries": [
                    {**LedgerEntrySerializer(entry).data, "balance": str(balance)}
                    for entry, balance in result["rows"]
                ],
            }
        )


class TenantAccountView(APIView):
    """A tenant's balance across all their leases."""

    permission_classes = [IsAuthenticated, OrganizationPermission]
    required_capabilities = {"get": "billing.view"}

    @extend_schema(responses=dict)
    def get(self, request, pk):
        tenant = get_object_or_404(accessible_tenants(request.membership), pk=pk)
        leases = (
            Lease.objects.filter(
                tenant=tenant,
                unit__property__in=accessible_properties(request.membership).values("pk"),
            )
            .annotate(balance=_sum("ledger_entries__amount"))
            .select_related("unit__property")
        )
        rows = [
            {
                "lease": str(lease.pk),
                "reference": lease.reference,
                "status": lease.status,
                "unit_number": lease.unit.number,
                "property_name": lease.unit.property.name,
                "balance": str(lease.balance),
            }
            for lease in leases
        ]
        return Response(
            {
                "tenant": str(tenant.pk),
                "currency": request.organization.currency,
                "balance": str(sum((lease.balance for lease in leases), ZERO)),
                "leases": rows,
            }
        )


class BillingSummaryView(APIView):
    """Headline numbers for the dashboard, limited to properties the member can access."""

    permission_classes = [IsAuthenticated, OrganizationPermission]
    required_capabilities = {"get": "billing.view"}

    @extend_schema(responses=dict)
    def get(self, request):
        today = organization_today(request.organization)
        invoices = with_amount_due(
            Invoice.objects.filter(
                organization=request.organization,
                status=Invoice.Status.ISSUED,
                unit__property__in=accessible_properties(request.membership).values("pk"),
            ),
            "due",
        )
        month = today.replace(day=1)
        billed_this_month = invoices.filter(issue_date__gte=month).aggregate(t=_sum("total"))["t"]
        outstanding = invoices.filter(due__gt=0)
        overdue = outstanding.filter(due_date__lt=today)
        return Response(
            {
                "currency": request.organization.currency,
                "month": f"{month:%Y-%m}",
                "billed_this_month": str(billed_this_month),
                "outstanding": str(outstanding.aggregate(t=_sum("due"))["t"]),
                "outstanding_invoices": outstanding.count(),
                "overdue": str(overdue.aggregate(t=_sum("due"))["t"]),
                "overdue_invoices": overdue.count(),
            }
        )
