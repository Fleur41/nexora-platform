import logging

from django.conf import settings
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, mixins, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from apps.audit.services import record_event
from apps.billing.models import LedgerEntry
from apps.core.exceptions import BusinessRuleViolation
from apps.core.money import ZERO
from apps.core.net import client_ip
from apps.leases.models import Lease
from apps.organizations.access import (
    OrganizationPermission,
    OrganizationScopedViewSet,
    RefetchOnWriteMixin,
)
from apps.organizations.models import organization_today
from apps.properties.access import PropertyScopedViewSet, accessible_properties

from . import imports, mpesa, services
from .models import Payment, PaymentConfiguration, PaymentRequest, ProviderEvent, StatementImport
from .serializers import (
    AllocateSerializer,
    CredentialSerializer,
    MatchSerializer,
    PaymentConfigurationSerializer,
    PaymentDetailSerializer,
    PaymentRequestSerializer,
    PaymentReverseSerializer,
    PaymentSerializer,
    ProviderEventSerializer,
    RecordPaymentSerializer,
    RefundInputSerializer,
    RefundSerializer,
    StatementImportSerializer,
    StatementUploadSerializer,
    StkRequestSerializer,
)

logger = logging.getLogger(__name__)


def _require_organization_scope(request, what: str) -> None:
    if not request.membership.has_organization_scope:
        raise exceptions.PermissionDenied(f"{what} needs whole-organization access.")


class PaymentConfigurationViewSet(
    RefetchOnWriteMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    OrganizationScopedViewSet,
):
    queryset = PaymentConfiguration.objects.select_related("property", "credential")
    serializer_class = PaymentConfigurationSerializer
    pagination_class = None
    required_capabilities = {
        "list": "payments.view",
        "retrieve": "payments.view",
        "create": "payment_settings.manage",
        "partial_update": "payment_settings.manage",
        "credentials": "payment_settings.manage",
        "test": "payment_settings.manage",
        "register_c2b": "payment_settings.manage",
        "events": "payment_settings.manage",
    }
    filterset_fields = ["provider", "property", "is_enabled"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def perform_create(self, serializer):
        serializer.save(organization=self.request.organization, created_by=self.request.user)
        record_event(
            self.request,
            "payment_settings.created",
            target=serializer.instance,
            metadata=serializer.instance.snapshot(),
        )

    def perform_update(self, serializer):
        from apps.properties.services import update_instance

        update_instance(
            request=self.request,
            instance=serializer.instance,
            action="payment_settings.updated",
            **serializer.validated_data,
        )

    def _fresh(self, config):
        return Response(self.get_serializer(self.get_queryset().get(pk=config.pk)).data)

    @extend_schema(request=CredentialSerializer, responses=PaymentConfigurationSerializer)
    @action(detail=True, methods=["post"])
    def credentials(self, request, pk=None):
        config = self.get_object()
        serializer = CredentialSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if "environment" in data and data["environment"] != config.environment:
            config.environment = data["environment"]
            config.save(update_fields=["environment", "updated_at"])
        mpesa.save_credentials(
            request=request,
            config=config,
            consumer_key=data.get("consumer_key", ""),
            consumer_secret=data.get("consumer_secret", ""),
            passkey=data.get("passkey", ""),
        )
        return self._fresh(config)

    @extend_schema(request=None, responses=PaymentConfigurationSerializer)
    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        return self._fresh(mpesa.test_connection(request=request, config=self.get_object()))

    @extend_schema(request=None, responses=PaymentConfigurationSerializer)
    @action(detail=True, methods=["post"], url_path="register-c2b")
    def register_c2b(self, request, pk=None):
        return self._fresh(mpesa.register_c2b(request=request, config=self.get_object()))

    @extend_schema(responses=ProviderEventSerializer(many=True))
    @action(detail=True, methods=["get"])
    def events(self, request, pk=None):
        events = ProviderEvent.objects.filter(configuration=self.get_object()).select_related(
            "payment"
        )[:50]
        return Response(ProviderEventSerializer(events, many=True).data)


class PaymentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, PropertyScopedViewSet):
    queryset = Payment.objects.select_related(
        "lease__unit__property", "tenant", "created_by", "reversed_by"
    )
    serializer_class = PaymentSerializer
    property_path = "lease__unit__property"
    required_capabilities = {
        "list": "payments.view",
        "retrieve": "payments.view",
        "create": "payments.record",
        "allocate": "payments.record",
        "match": "payments.record",
        "reverse": "payments.reverse",
        "refund": "payments.reverse",
        "summary": "payments.view",
        "pdf": "payments.view",
    }
    filterset_fields = ["status", "method", "source", "lease", "tenant", "statement_import"]
    search_fields = [
        "receipt_number",
        "reference",
        "payer_name",
        "account_reference",
        "tenant__full_name",
    ]
    ordering_fields = ["received_on", "amount", "receipt_number"]
    ordering = ["-received_on", "-created_at"]

    def get_queryset(self):
        queryset = super().get_queryset()
        matched = self.request.query_params.get("matched")
        if matched in ("true", "false"):
            queryset = queryset.filter(lease__isnull=matched == "false")
        if self.action == "retrieve":
            queryset = queryset.prefetch_related("allocations__invoice", "refunds__created_by")
        return queryset

    def get_serializer_class(self):
        return PaymentSerializer if self.action == "list" else PaymentDetailSerializer

    def _detail(self, payment, code=status.HTTP_200_OK):
        fresh = (
            self.get_queryset()
            .prefetch_related("allocations__invoice", "refunds")
            .get(pk=payment.pk)
        )
        return Response(
            PaymentDetailSerializer(fresh, context=self.get_serializer_context()).data, status=code
        )

    @extend_schema(request=RecordPaymentSerializer, responses={201: PaymentDetailSerializer})
    def create(self, request):
        serializer = RecordPaymentSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        allocations = (
            [(a["invoice"], a["amount"]) for a in data["allocations"]]
            if data.get("allocations")
            else None
        )
        payment = services.record_payment(
            request=request,
            organization=request.organization,
            amount=data["amount"],
            received_on=data["received_on"],
            method=data.get("method", ""),
            lease=data["lease"],
            configuration=data.get("configuration"),
            reference=data.get("reference", ""),
            payer_name=data.get("payer_name", ""),
            payer_phone=data.get("payer_phone", ""),
            notes=data.get("notes", ""),
            allocations=allocations,
        )
        return self._detail(payment, status.HTTP_201_CREATED)

    @extend_schema(request=AllocateSerializer, responses=PaymentDetailSerializer)
    @action(detail=True, methods=["post"])
    def allocate(self, request, pk=None):
        payment = self.get_object()
        serializer = AllocateSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        if payment.lease_id is None:
            raise exceptions.ValidationError("Match the payment to a lease first.")
        requested = serializer.validated_data.get("allocations")
        services.allocate_credit(
            request=request,
            payment=payment,
            allocations=[(a["invoice"], a["amount"]) for a in requested] if requested else None,
        )
        return self._detail(payment)

    @extend_schema(request=MatchSerializer, responses=PaymentDetailSerializer)
    @action(detail=True, methods=["post"])
    def match(self, request, pk=None):
        _require_organization_scope(request, "Matching payments")
        payment = self.get_object()
        serializer = MatchSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        services.match_payment(
            request=request, payment=payment, lease=serializer.validated_data["lease"]
        )
        return self._detail(payment)

    @extend_schema(request=PaymentReverseSerializer, responses=PaymentDetailSerializer)
    @extend_schema(responses={(200, "application/pdf"): bytes})
    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        """The receipt as a PDF (the same file the tenant gets by email)."""
        from apps.core.pdf import pdf_response

        from .pdf import receipt_filename, receipt_pdf

        payment = self.get_object()
        if payment.lease_id is None:
            raise BusinessRuleViolation("Match this payment to a tenant before issuing a receipt.")
        return pdf_response(receipt_pdf(payment), receipt_filename(payment))

    @action(detail=True, methods=["post"])
    def reverse(self, request, pk=None):
        payment = self.get_object()
        serializer = PaymentReverseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.reverse_payment(request=request, payment=payment, **serializer.validated_data)
        return self._detail(payment)

    @extend_schema(request=RefundInputSerializer, responses={201: RefundSerializer})
    @action(detail=True, methods=["post"])
    def refund(self, request, pk=None):
        payment = self.get_object()
        serializer = RefundInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        refund = services.refund_credit(
            request=request, payment=payment, **serializer.validated_data
        )
        return Response(RefundSerializer(refund).data, status=status.HTTP_201_CREATED)

    @extend_schema(responses=dict)
    @action(detail=False, methods=["get"])
    def summary(self, request):
        today = organization_today(request.organization)
        payments = self.get_queryset().filter(status=Payment.Status.COMPLETED)
        collected = (
            payments.filter(received_on__gte=today.replace(day=1)).aggregate(t=Sum("amount"))["t"]
            or ZERO
        )
        unmatched = payments.filter(lease__isnull=True)
        return Response(
            {
                "currency": request.organization.currency,
                "collected_this_month": str(collected),
                "unmatched_count": unmatched.count(),
                "unmatched_amount": str(unmatched.aggregate(t=Sum("amount"))["t"] or ZERO),
                # Payment money not applied to any invoice (net of credit applied and refunds).
                "credit_held": str(
                    -(
                        LedgerEntry.objects.filter(
                            payment__in=payments, invoice__isnull=True
                        ).aggregate(t=Sum("amount"))["t"]
                        or ZERO
                    )
                ),
            }
        )


class PaymentRequestViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, PropertyScopedViewSet):
    queryset = PaymentRequest.objects.select_related("lease__tenant", "payment")
    serializer_class = PaymentRequestSerializer
    property_path = "lease__unit__property"
    required_capabilities = {"list": "payments.view", "create": "payments.record"}
    filterset_fields = ["status", "lease"]

    @extend_schema(request=StkRequestSerializer, responses={201: PaymentRequestSerializer})
    def create(self, request):
        serializer = StkRequestSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        req = mpesa.request_stk_payment(request=request, **serializer.validated_data)
        return Response(PaymentRequestSerializer(req).data, status=status.HTTP_201_CREATED)


class StatementImportViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    OrganizationScopedViewSet,
):
    queryset = StatementImport.objects.select_related("configuration", "created_by")
    serializer_class = StatementImportSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    required_capabilities = {
        "list": "payments.view",
        "retrieve": "payments.view",
        "create": "payments.record",
    }

    @extend_schema(request=StatementUploadSerializer, responses={201: StatementImportSerializer})
    def create(self, request):
        _require_organization_scope(request, "Importing statements")
        serializer = StatementUploadSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        batch = imports.import_statement(
            request=request,
            config=serializer.validated_data["configuration"],
            upload=serializer.validated_data["file"],
        )
        return Response(StatementImportSerializer(batch).data, status=status.HTTP_201_CREATED)


class PaymentInstructionsView(APIView):
    """How the tenant on a lease should pay (the landlord's own enabled methods)."""

    permission_classes = [IsAuthenticated, OrganizationPermission]
    required_capabilities = {"get": "payments.view"}

    @extend_schema(responses=dict)
    def get(self, request, pk):
        lease = get_object_or_404(
            Lease.objects.filter(
                organization=request.organization,
                unit__property__in=accessible_properties(request.membership).values("pk"),
            ).select_related("unit"),
            pk=pk,
        )
        account = lease.reference.replace("-", "")
        methods = []
        for config in services.applicable_configurations(lease):
            methods.append(
                {
                    "id": str(config.pk),
                    "provider": config.provider,
                    "display_name": config.display_name,
                    "shortcode": config.shortcode,
                    "account_number_to_use": account
                    if config.provider == PaymentConfiguration.Provider.MPESA_PAYBILL
                    else "",
                    "account_reference_hint": config.account_reference_hint,
                    "bank_name": config.bank_name,
                    "bank_branch": config.bank_branch,
                    "account_name": config.account_name,
                    "account_number": config.account_number,
                    "instructions": config.instructions,
                    "supports_payment_request": config.provider
                    in PaymentConfiguration.MPESA_PROVIDERS
                    and config.integration_status
                    == PaymentConfiguration.IntegrationStatus.VERIFIED,
                }
            )
        return Response({"lease": str(lease.pk), "account_reference": account, "methods": methods})


class CallbackThrottle(AnonRateThrottle):
    rate = "300/min"


class MpesaCallbackView(APIView):
    """Public endpoint for Safaricom. Authenticated by the secret token in the URL."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [CallbackThrottle]
    accepted = {"ResultCode": 0, "ResultDesc": "Accepted"}

    @extend_schema(
        request=dict, responses=dict, auth=[], summary="Safaricom Daraja callback (C2B / STK)"
    )
    def post(self, request, token, kind):
        config = mpesa.config_for_token(token)
        if config is None:
            raise exceptions.NotFound()
        remote = client_ip(request)
        if (
            settings.MPESA_CALLBACK_ALLOWED_IPS
            and remote not in settings.MPESA_CALLBACK_ALLOWED_IPS
        ):
            ProviderEvent.objects.create(
                organization=config.organization,
                configuration=config,
                event_type=kind,
                status=ProviderEvent.Status.REJECTED,
                message="Source IP not allowed",
                payload={},
                remote_addr=remote,
            )
            raise exceptions.PermissionDenied()
        payload = request.data if isinstance(request.data, dict) else {}
        if kind == "c2b_validation":
            if not config.is_enabled:
                return Response({"ResultCode": "C2B00016", "ResultDesc": "Rejected"})
            return Response(self.accepted)
        try:
            if kind == "c2b_confirmation":
                mpesa.handle_c2b_confirmation(config, payload, remote_addr=remote)
            else:
                mpesa.handle_stk_callback(config, payload, remote_addr=remote)
        except Exception:
            # Unexpected failure: let Safaricom retry; events are idempotent.
            logger.exception("M-Pesa %s callback failed for configuration %s", kind, config.pk)
            return Response(
                {"ResultCode": 1, "ResultDesc": "Temporary error"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response(self.accepted)
