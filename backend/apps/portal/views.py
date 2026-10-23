"""Tenant portal API.

Every endpoint is scoped to a Tenant record linked to the signed-in user
(`Tenant.user == request.user`); nothing here uses organization memberships, so a tenant
can only ever reach their own leases, invoices, payments, maintenance requests and notices.
Internal maintenance notes, costs and staff notes on move-out notices are never serialized.
"""

from __future__ import annotations

from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, serializers, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.audit.services import record_event
from apps.billing.models import Invoice
from apps.billing.services import lease_balance, statement
from apps.billing.views import with_amount_due
from apps.core.exceptions import BusinessRuleViolation
from apps.core.money import ZERO
from apps.deposits.services import summarize
from apps.documents.models import Document
from apps.documents.validation import IMAGE_TYPES, inspect_upload
from apps.leases import moveout
from apps.leases.models import Lease, MoveOutNotice
from apps.maintenance import services as maintenance
from apps.maintenance.models import MaintenanceRequest
from apps.organizations.models import organization_today
from apps.payments import mpesa
from apps.payments.models import Payment, PaymentConfiguration
from apps.payments.services import applicable_configurations, lease_credit
from apps.tenants import portal_access
from apps.tenants.models import Tenant


class PortalRequest:
    """Adapter so services/audit see the tenant's organization without a membership."""

    def __init__(self, request, tenant: Tenant):
        self.user = request.user
        self.organization = tenant.organization
        self.META = request.META


def tenancy(request, tenant_id) -> Tenant:
    return get_object_or_404(
        Tenant.objects.select_related("organization"), pk=tenant_id, user=request.user
    )


class PortalView(APIView):
    permission_classes = [IsAuthenticated]


# --- Serializers (tenant-safe fields only) ------------------------------------------------


class LineOut(serializers.Serializer):
    description = serializers.CharField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)


class InvoiceOut(serializers.ModelSerializer):
    amount_due = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    unit_number = serializers.CharField(source="unit.number")
    property_name = serializers.CharField(source="unit.property.name")

    class Meta:
        model = Invoice
        fields = [
            "id",
            "number",
            "kind",
            "status",
            "period_start",
            "period_end",
            "issue_date",
            "due_date",
            "currency",
            "total",
            "amount_due",
            "unit_number",
            "property_name",
        ]


class PaymentOut(serializers.ModelSerializer):
    invoices = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            "id",
            "receipt_number",
            "amount",
            "received_on",
            "method",
            "reference",
            "status",
            "invoices",
        ]

    def get_invoices(self, payment) -> list[dict]:
        return [
            {"number": a.invoice.number, "amount": str(a.amount)}
            for a in payment.allocations.filter(is_reversed=False).select_related("invoice")
        ]


class MaintenanceOut(serializers.ModelSerializer):
    unit_number = serializers.CharField(source="unit.number")
    property_name = serializers.CharField(source="unit.property.name")
    is_assigned = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceRequest
        fields = [
            "id",
            "reference",
            "unit_number",
            "property_name",
            "category",
            "title",
            "description",
            "urgency",
            "status",
            "is_assigned",
            "scheduled_for",
            "resolved_at",
            "created_at",
            "updated_at",
        ]

    def get_is_assigned(self, req) -> bool:
        return req.assigned_to_id is not None


class MaintenanceIn(serializers.Serializer):
    lease = serializers.UUIDField()
    category = serializers.ChoiceField(choices=MaintenanceRequest.Category.choices)
    title = serializers.CharField(max_length=160)
    description = serializers.CharField(max_length=5000)
    urgency = serializers.ChoiceField(choices=MaintenanceRequest.Urgency.choices, default="normal")


class MoveOutOut(serializers.ModelSerializer):
    lease_reference = serializers.CharField(source="lease.reference")
    inspection_date = serializers.DateField(source="inspection.scheduled_for", default=None)

    class Meta:
        model = MoveOutNotice
        fields = [
            "id",
            "lease",
            "lease_reference",
            "intended_date",
            "message",
            "status",
            "inspection_date",
            "created_at",
            "acknowledged_at",
            "completed_at",
        ]


class MoveOutIn(serializers.Serializer):
    lease = serializers.UUIDField()
    intended_date = serializers.DateField()
    message = serializers.CharField(required=False, allow_blank=True, default="", max_length=2000)


class PayIn(serializers.Serializer):
    lease = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=0, min_value=1)
    phone = serializers.CharField(max_length=20)


class TokenIn(serializers.Serializer):
    token = serializers.CharField(max_length=128)


def _lease(tenant: Tenant, lease_id) -> Lease:
    return get_object_or_404(
        Lease.objects.select_related("unit__property"), pk=lease_id, tenant=tenant
    )


def _methods(lease: Lease) -> list[dict]:
    account = lease.reference.replace("-", "")
    return [
        {
            "provider": c.provider,
            "display_name": c.display_name,
            "shortcode": c.shortcode,
            "account_number_to_use": account
            if c.provider == PaymentConfiguration.Provider.MPESA_PAYBILL
            else "",
            "bank_name": c.bank_name,
            "bank_branch": c.bank_branch,
            "account_name": c.account_name,
            "account_number": c.account_number,
            "reference_to_use": account,
            "instructions": c.instructions,
            "supports_payment_request": c.provider in PaymentConfiguration.MPESA_PROVIDERS
            and c.integration_status == PaymentConfiguration.IntegrationStatus.VERIFIED,
        }
        for c in applicable_configurations(lease)
    ]


# --- Endpoints -------------------------------------------------------------------------------


class TenanciesView(PortalView):
    @extend_schema(operation_id="portal_tenancies_list", responses=dict)
    def get(self, request):
        rows = []
        for tenant in Tenant.objects.filter(user=request.user).select_related("organization"):
            org = tenant.organization
            rows.append(
                {
                    "tenant": str(tenant.pk),
                    "full_name": tenant.full_name,
                    "organization": {
                        "id": str(org.pk),
                        "name": org.name,
                        "currency": org.currency,
                        "timezone": org.timezone,
                        "phone": org.phone,
                        "email": org.email,
                    },
                }
            )
        return Response(rows)


class SummaryView(PortalView):
    @extend_schema(responses=dict)
    def get(self, request, tenant_id):
        tenant = tenancy(request, tenant_id)
        today = organization_today(tenant.organization)
        leases = (
            Lease.objects.filter(
                tenant=tenant, status__in=[Lease.Status.ACTIVE, Lease.Status.ENDED]
            )
            .select_related("unit__property")
            .order_by("-start_date")
        )
        open_invoices = (
            with_amount_due(Invoice.objects.filter(tenant=tenant, status=Invoice.Status.ISSUED))
            .filter(amount_due__gt=0)
            .select_related("unit__property")
            .order_by("due_date")
        )
        balance = sum((lease_balance(lease) for lease in leases), ZERO)
        lease_rows = []
        for lease in leases:
            deposit = summarize(lease)
            current_rent = (
                lease.rent_terms.filter(effective_from__lte=today)
                .order_by("-effective_from")
                .first()
            )
            lease_rows.append(
                {
                    "id": str(lease.pk),
                    "reference": lease.reference,
                    "status": lease.status,
                    "property_name": lease.unit.property.name,
                    "unit_number": lease.unit.number,
                    "start_date": str(lease.start_date),
                    "end_date": str(lease.end_date) if lease.end_date else None,
                    "ended_on": str(lease.ended_on) if lease.ended_on else None,
                    "monthly_rent": str(current_rent.monthly_rent) if current_rent else None,
                    "rent_due_day": lease.rent_due_day,
                    "balance": str(lease_balance(lease)),
                    "credit": str(lease_credit(lease)),
                    "deposit_held": str(deposit.held),
                    "payment_methods": _methods(lease)
                    if lease.status == Lease.Status.ACTIVE
                    else [],
                }
            )
        return Response(
            {
                "tenant": str(tenant.pk),
                "full_name": tenant.full_name,
                "currency": tenant.organization.currency,
                "balance": str(balance),
                "overdue": str(
                    sum((i.amount_due for i in open_invoices if i.due_date < today), ZERO)
                ),
                "next_due": InvoiceOut(open_invoices[0]).data if open_invoices else None,
                "open_invoices": InvoiceOut(open_invoices[:5], many=True).data,
                "recent_payments": PaymentOut(
                    Payment.objects.filter(tenant=tenant, status=Payment.Status.COMPLETED).order_by(
                        "-received_on"
                    )[:5],
                    many=True,
                ).data,
                "leases": lease_rows,
                "open_maintenance": MaintenanceRequest.objects.filter(
                    tenant=tenant, status__in=MaintenanceRequest.OPEN_STATUSES
                ).count(),
            }
        )


class InvoicesView(PortalView):
    @extend_schema(responses=InvoiceOut(many=True))
    def get(self, request, tenant_id):
        tenant = tenancy(request, tenant_id)
        invoices = with_amount_due(
            Invoice.objects.filter(tenant=tenant).select_related("unit__property")
        ).order_by("-issue_date", "-number")[:200]
        return Response(InvoiceOut(invoices, many=True).data)


class InvoiceDetailView(PortalView):
    @extend_schema(responses=dict)
    def get(self, request, tenant_id, invoice_id):
        tenant = tenancy(request, tenant_id)
        invoice = get_object_or_404(
            with_amount_due(Invoice.objects.filter(tenant=tenant).select_related("unit__property")),
            pk=invoice_id,
        )
        lines = (
            invoice.lines.filter(is_void=False)
            if invoice.status == Invoice.Status.ISSUED
            else invoice.lines.all()
        )
        return Response({**InvoiceOut(invoice).data, "lines": LineOut(lines, many=True).data})


class PaymentsView(PortalView):
    @extend_schema(responses=PaymentOut(many=True))
    def get(self, request, tenant_id):
        tenant = tenancy(request, tenant_id)
        return Response(
            PaymentOut(
                Payment.objects.filter(tenant=tenant).order_by("-received_on")[:200], many=True
            ).data
        )


class ReceiptView(PortalView):
    @extend_schema(responses=dict)
    def get(self, request, tenant_id, payment_id):
        tenant = tenancy(request, tenant_id)
        payment = get_object_or_404(
            Payment.objects.select_related("lease__unit__property"), pk=payment_id, tenant=tenant
        )
        org = tenant.organization
        return Response(
            {
                **PaymentOut(payment).data,
                "tenant_name": tenant.full_name,
                "lease_reference": payment.lease.reference if payment.lease else None,
                "property_name": payment.lease.unit.property.name if payment.lease else None,
                "unit_number": payment.lease.unit.number if payment.lease else None,
                "organization": {
                    "name": org.legal_name or org.name,
                    "phone": org.phone,
                    "email": org.email,
                    "address": org.address,
                    "currency": org.currency,
                },
            }
        )


class StatementView(PortalView):
    @extend_schema(responses=dict)
    def get(self, request, tenant_id, lease_id):
        tenant = tenancy(request, tenant_id)
        lease = _lease(tenant, lease_id)
        result = statement(lease, None, None)
        return Response(
            {
                "balance": str(lease_balance(lease)),
                "entries": [
                    {
                        "date": str(e.effective_date),
                        "type": e.entry_type,
                        "description": e.description,
                        "reference": e.reference,
                        "amount": str(e.amount),
                        "balance": str(bal),
                    }
                    for e, bal in result["rows"]
                ],
            }
        )


class PayView(PortalView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(request=PayIn, responses=dict)
    def post(self, request, tenant_id):
        tenant = tenancy(request, tenant_id)
        data = PayIn(data=request.data)
        data.is_valid(raise_exception=True)
        lease = _lease(tenant, data.validated_data["lease"])
        req = mpesa.request_stk_payment(
            request=PortalRequest(request, tenant),
            lease=lease,
            amount=data.validated_data["amount"],
            phone=data.validated_data["phone"],
        )
        return Response({"id": str(req.pk), "status": req.status}, status=status.HTTP_201_CREATED)


class MaintenanceListView(PortalView):
    @extend_schema(responses=MaintenanceOut(many=True))
    def get(self, request, tenant_id):
        tenant = tenancy(request, tenant_id)
        return Response(
            MaintenanceOut(
                MaintenanceRequest.objects.filter(tenant=tenant).select_related("unit__property"),
                many=True,
            ).data
        )

    @extend_schema(request=MaintenanceIn, responses={201: MaintenanceOut})
    def post(self, request, tenant_id):
        tenant = tenancy(request, tenant_id)
        data = MaintenanceIn(data=request.data)
        data.is_valid(raise_exception=True)
        lease = _lease(tenant, data.validated_data["lease"])
        if lease.status != Lease.Status.ACTIVE:
            raise BusinessRuleViolation("Report issues on your current home only.")
        req = maintenance.create_request(
            request=PortalRequest(request, tenant),
            organization=tenant.organization,
            unit=lease.unit,
            category=data.validated_data["category"],
            title=data.validated_data["title"],
            description=data.validated_data["description"],
            urgency=data.validated_data["urgency"],
            tenant=tenant,
            source=MaintenanceRequest.Source.TENANT,
            actor=request.user,
        )
        return Response(MaintenanceOut(req).data, status=status.HTTP_201_CREATED)


class MaintenanceDetailView(PortalView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def _req(self, request, tenant_id, request_id):
        tenant = tenancy(request, tenant_id)
        return tenant, get_object_or_404(
            MaintenanceRequest.objects.select_related("unit__property"),
            pk=request_id,
            tenant=tenant,
        )

    @extend_schema(responses=dict)
    def get(self, request, tenant_id, request_id):
        tenant, req = self._req(request, tenant_id, request_id)
        updates = [
            {
                "id": str(u.pk),
                "author_name": u.author_name if u.from_tenant else "Your landlord",
                "from_tenant": u.from_tenant,
                "body": u.body,
                "status_to": u.status_to,
                "created_at": u.created_at,
            }
            for u in req.updates.filter(is_internal=False)  # internal notes never reach tenants
        ]
        photos = [
            {"id": str(d.pk), "title": d.title}
            for d in Document.objects.filter(
                maintenance_request=req, deleted_at__isnull=True, content_type__in=IMAGE_TYPES
            )
        ]
        return Response({**MaintenanceOut(req).data, "updates": updates, "photos": photos})

    @extend_schema(operation_id="portal_maintenance_action", request=dict, responses=dict)
    def post(self, request, tenant_id, request_id):
        """action=message|cancel|photo"""
        tenant, req = self._req(request, tenant_id, request_id)
        portal_request = PortalRequest(request, tenant)
        action = request.data.get("action")
        if action == "message":
            maintenance.add_update(
                request=portal_request,
                req=req,
                body=str(request.data.get("body", "")),
                internal=False,
                from_tenant=True,
                actor=request.user,
            )
        elif action == "cancel":
            maintenance.tenant_cancel(request=portal_request, req=req, actor=request.user)
        elif action == "photo":
            upload = request.FILES.get("file")
            if upload is None:
                raise exceptions.ValidationError({"file": ["Choose a photo."]})
            if req.status in (
                MaintenanceRequest.Status.CLOSED,
                MaintenanceRequest.Status.CANCELLED,
            ):
                raise BusinessRuleViolation("This request is closed.")
            try:
                info = inspect_upload(upload, images_only=True)
            except serializers.ValidationError as exc:
                raise exceptions.ValidationError({"file": exc.detail}) from exc
            with transaction.atomic():
                document = Document(
                    organization=tenant.organization,
                    category=Document.Category.PHOTO,
                    title=(request.data.get("title") or upload.name)[:200],
                    original_filename=upload.name[:255],
                    uploaded_by=request.user,
                    maintenance_request=req,
                    **info,
                )
                document.file.save("upload", upload, save=False)
                document.save()
                record_event(
                    portal_request,
                    "document.uploaded",
                    target=document,
                    organization=tenant.organization,
                    metadata={"attached_to": "maintenance_request", "by_tenant": True},
                )
        else:
            raise exceptions.ValidationError({"action": ["Use message, cancel or photo."]})
        return self.get(request, tenant_id, request_id)


class MaintenancePhotoView(PortalView):
    @extend_schema(responses={(200, "image/*"): bytes})
    def get(self, request, tenant_id, request_id, document_id):
        tenant = tenancy(request, tenant_id)
        document = get_object_or_404(
            Document,
            pk=document_id,
            maintenance_request_id=request_id,
            maintenance_request__tenant=tenant,
            deleted_at__isnull=True,
            content_type__in=IMAGE_TYPES,
        )
        response = FileResponse(document.file.open("rb"), content_type=document.content_type)
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        response["Cache-Control"] = "private, no-store"
        return response


class MoveOutView(PortalView):
    @extend_schema(responses=MoveOutOut(many=True))
    def get(self, request, tenant_id):
        tenant = tenancy(request, tenant_id)
        return Response(
            MoveOutOut(
                MoveOutNotice.objects.filter(tenant=tenant).select_related("lease", "inspection"),
                many=True,
            ).data
        )

    @extend_schema(request=MoveOutIn, responses={201: MoveOutOut})
    def post(self, request, tenant_id):
        tenant = tenancy(request, tenant_id)
        data = MoveOutIn(data=request.data)
        data.is_valid(raise_exception=True)
        lease = _lease(tenant, data.validated_data["lease"])
        notice = moveout.submit_notice(
            request=PortalRequest(request, tenant),
            lease=lease,
            intended_date=data.validated_data["intended_date"],
            message=data.validated_data["message"],
            from_tenant=True,
            actor=request.user,
        )
        return Response(MoveOutOut(notice).data, status=status.HTTP_201_CREATED)


class MoveOutWithdrawView(PortalView):
    @extend_schema(request=None, responses=MoveOutOut)
    def post(self, request, tenant_id, notice_id):
        tenant = tenancy(request, tenant_id)
        notice = get_object_or_404(MoveOutNotice, pk=notice_id, tenant=tenant)
        notice = moveout.withdraw(
            request=PortalRequest(request, tenant),
            notice=notice,
            by_tenant=True,
            actor=request.user,
        )
        return Response(MoveOutOut(notice).data)


class InvitationPreviewView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(request=TokenIn, responses=dict)
    def post(self, request):
        data = TokenIn(data=request.data)
        data.is_valid(raise_exception=True)
        invitation = portal_access.find(data.validated_data["token"])
        if invitation is None:
            raise exceptions.NotFound("This invitation link is invalid.")
        from django.utils import timezone

        return Response(
            {
                "organization_name": invitation.organization.name,
                "tenant_name": invitation.tenant.full_name,
                "email": invitation.email,
                "expires_at": invitation.expires_at,
                "is_usable": invitation.status == "pending"
                and invitation.expires_at > timezone.now(),
            }
        )


class InvitationAcceptView(PortalView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    @extend_schema(request=TokenIn, responses=dict)
    def post(self, request):
        data = TokenIn(data=request.data)
        data.is_valid(raise_exception=True)
        tenant = portal_access.accept(request=request, token=data.validated_data["token"])
        return Response({"tenant": str(tenant.pk), "organization_name": tenant.organization.name})
