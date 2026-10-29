from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.organizations.access import OrganizationPermission
from apps.organizations.models import organization_today

from . import services
from .models import Plan, SubscriptionInvoice
from .serializers import (
    ChangePlanSerializer,
    PayInvoiceSerializer,
    PlanSerializer,
    SubscriptionInvoiceSerializer,
    SubscriptionSerializer,
)


class SubscriptionView(APIView):
    """The organization's Nexora subscription. Every member sees the status (for banners);
    plans, usage, invoices and how to pay are for members with subscription.manage."""

    permission_classes = [IsAuthenticated, OrganizationPermission]
    required_capabilities = {"get": None}

    @extend_schema(responses=dict)
    def get(self, request):
        org = request.organization
        sub = services.subscription_for(org)
        today = organization_today(org)
        ends = sub.access_ends_on
        data = {
            **SubscriptionSerializer(sub).data,
            "read_only": services.is_read_only(org),
            "days_left": (ends - today).days if ends else None,
            "can_manage": request.membership.has_capability("subscription.manage"),
        }
        if data["can_manage"]:
            open_invoice = (
                SubscriptionInvoice.objects.filter(
                    organization=org, status=SubscriptionInvoice.Status.OPEN
                )
                .order_by("due_date")
                .first()
            )
            data.update(
                units_used=services.units_used(org),
                plans=PlanSerializer(Plan.objects.filter(is_active=True), many=True).data,
                open_invoice=SubscriptionInvoiceSerializer(open_invoice).data
                if open_invoice
                else None,
                payment=services.payment_instructions(sub),
            )
        return Response(data)


class SubscriptionInvoicesView(APIView):
    permission_classes = [IsAuthenticated, OrganizationPermission]
    required_capabilities = {"get": "subscription.manage"}

    @extend_schema(responses=SubscriptionInvoiceSerializer(many=True))
    def get(self, request):
        invoices = SubscriptionInvoice.objects.filter(organization=request.organization)
        return Response(SubscriptionInvoiceSerializer(invoices, many=True).data)


class ChangePlanView(APIView):
    permission_classes = [IsAuthenticated, OrganizationPermission]
    required_capabilities = {"post": "subscription.manage"}
    allowed_when_read_only = True  # e.g. upgrade to make room, then pay

    @extend_schema(request=ChangePlanSerializer, responses=SubscriptionSerializer)
    def post(self, request):
        data = ChangePlanSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        sub = services.change_plan(
            request=request, organization=request.organization, plan=data.validated_data["plan"]
        )
        return Response(SubscriptionSerializer(sub).data)


class PayInvoiceView(APIView):
    permission_classes = [IsAuthenticated, OrganizationPermission]
    required_capabilities = {"post": "subscription.manage"}
    allowed_when_read_only = True  # paying is how you get out of read-only mode

    @extend_schema(request=PayInvoiceSerializer, responses={201: dict})
    def post(self, request, pk):
        invoice = SubscriptionInvoice.objects.filter(
            organization=request.organization, pk=pk
        ).first()
        if invoice is None:
            raise exceptions.NotFound()
        data = PayInvoiceSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        payment = services.request_payment(
            request=request, invoice=invoice, phone=data.validated_data["phone"]
        )
        return Response(
            {"id": str(payment.pk), "status": payment.status}, status=status.HTTP_201_CREATED
        )


class MpesaCallbackView(APIView):
    """Daraja's result for prompts sent through Nexora's own paybill."""

    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(request=dict, responses=dict)
    def post(self, request):
        with transaction.atomic():
            services.handle_stk_callback(request.data if isinstance(request.data, dict) else {})
        return Response({"ResultCode": 0, "ResultDesc": "Accepted"})
