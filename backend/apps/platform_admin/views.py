"""Nexora platform console API: organizations, subscriptions, invoices, plans, support access.

For Nexora platform admins only (`User.is_platform_admin`). Every change is audited against
the organization it affects, so owners see platform actions in their own audit log too.
"""

from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, OuterRef, Q, Subquery, Sum
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.organizations.models import Membership, Organization
from apps.properties.models import Unit
from apps.subscriptions import services as subscriptions
from apps.subscriptions.models import Plan, Subscription, SubscriptionInvoice
from apps.subscriptions.serializers import PlanSerializer, SubscriptionInvoiceSerializer

from . import support
from .models import SupportGrant


class IsPlatformAdmin(permissions.BasePermission):
    message = "Only Nexora platform staff can do this."

    def has_permission(self, request, view) -> bool:
        return bool(
            request.user and request.user.is_authenticated and request.user.is_platform_admin
        )


class PlatformView(APIView):
    permission_classes = [IsPlatformAdmin]


def _org_row(org: Organization) -> dict:
    sub = getattr(org, "subscription", None)
    return {
        "id": str(org.pk),
        "name": org.name,
        "slug": org.slug,
        "status": org.status,
        "email": org.email,
        "phone": org.phone,
        "created_at": org.created_at,
        "units": org.unit_count,
        "members": org.member_count,
        "plan": sub.plan.name if sub else None,
        "plan_code": sub.plan.code if sub else None,
        "unit_limit": sub.plan.max_units if sub else None,
        "subscription_status": sub.status if sub else None,
        "trial_ends_on": sub.trial_ends_on if sub else None,
        "paid_until": sub.paid_until if sub else None,
        "complimentary": sub.complimentary if sub else False,
        "account_code": sub.account_code if sub else None,
    }


def _organizations():
    units = (
        Unit.objects.filter(organization=OuterRef("pk"))
        .order_by()
        .values("organization")
        .annotate(n=Count("pk"))
        .values("n")
    )
    return Organization.objects.select_related("subscription__plan").annotate(
        unit_count=Coalesce(Subquery(units), 0),
        member_count=Count(
            "memberships", filter=Q(memberships__status=Membership.Status.ACTIVE), distinct=True
        ),
    )


class OverviewView(PlatformView):
    @extend_schema(responses=dict)
    def get(self, request):
        by_status = dict(
            Subscription.objects.values_list("status").annotate(n=Count("pk")).order_by()
        )
        paying = Subscription.objects.filter(
            status__in=[Subscription.Status.ACTIVE, Subscription.Status.PAST_DUE],
            complimentary=False,
        )
        open_invoices = SubscriptionInvoice.objects.filter(status=SubscriptionInvoice.Status.OPEN)
        today = timezone.localdate()
        return Response(
            {
                "organizations": Organization.objects.count(),
                "suspended": Organization.objects.filter(
                    status=Organization.Status.SUSPENDED
                ).count(),
                "subscriptions": {s: by_status.get(s, 0) for s in Subscription.Status.values},
                "units": Unit.objects.count(),
                "monthly_recurring_revenue": str(
                    paying.aggregate(s=Sum("plan__monthly_price"))["s"] or Decimal("0")
                ),
                "open_invoices": open_invoices.count(),
                "open_amount": str(open_invoices.aggregate(s=Sum("amount"))["s"] or Decimal("0")),
                "overdue_amount": str(
                    open_invoices.filter(due_date__lt=today).aggregate(s=Sum("amount"))["s"]
                    or Decimal("0")
                ),
                "trials_ending_7_days": Subscription.objects.filter(
                    status=Subscription.Status.TRIALING,
                    trial_ends_on__range=(today, today + timedelta(days=7)),
                ).count(),
            }
        )


class OrganizationListView(PlatformView):
    @extend_schema(responses=dict, operation_id="platform_organizations_list")
    def get(self, request):
        qs = _organizations().order_by("name")
        q = request.query_params.get("search", "").strip()
        if q:
            qs = qs.filter(
                Q(name__icontains=q)
                | Q(slug__icontains=q)
                | Q(email__icontains=q)
                | Q(subscription__account_code__iexact=q)
                | Q(memberships__user__email__icontains=q)
            ).distinct()
        sub_status = request.query_params.get("subscription_status")
        if sub_status:
            qs = qs.filter(subscription__status=sub_status)
        return Response([_org_row(o) for o in qs[:200]])


class OrganizationDetailView(PlatformView):
    @extend_schema(responses=dict)
    def get(self, request, pk):
        org = get_object_or_404(_organizations(), pk=pk)
        owners = Membership.objects.filter(
            organization=org, role="owner", status=Membership.Status.ACTIVE
        ).select_related("user")
        return Response(
            {
                **_org_row(org),
                "notes": getattr(getattr(org, "subscription", None), "notes", ""),
                "owners": [{"name": m.user.full_name, "email": m.user.email} for m in owners],
                "invoices": SubscriptionInvoiceSerializer(
                    SubscriptionInvoice.objects.filter(organization=org), many=True
                ).data,
                "support_grants": [
                    {
                        "id": str(g.pk),
                        "user": g.user.full_name,
                        "reason": g.reason,
                        "created_at": g.created_at,
                        "expires_at": g.expires_at,
                        "ended_at": g.ended_at,
                        "active": g.is_active,
                        "mine": g.user_id == request.user.pk,
                    }
                    for g in SupportGrant.objects.filter(organization=org).select_related("user")[
                        :20
                    ]
                ],
                "recent_activity": [
                    {"action": a.action, "actor": a.actor_email, "created_at": a.created_at}
                    for a in AuditLog.objects.filter(organization=org).order_by("-created_at")[:15]
                ],
            }
        )


class SubscriptionUpdate(serializers.Serializer):
    plan = serializers.SlugRelatedField(
        slug_field="code", queryset=Plan.objects.all(), required=False
    )
    trial_ends_on = serializers.DateField(required=False, allow_null=True)
    paid_until = serializers.DateField(required=False, allow_null=True)
    complimentary = serializers.BooleanField(required=False)
    notes = serializers.CharField(required=False, allow_blank=True)


class OrganizationSubscriptionView(PlatformView):
    """Change plan, extend a trial or paid-up date, make complimentary, keep notes."""

    @extend_schema(request=SubscriptionUpdate, responses=dict)
    def post(self, request, pk):
        org = get_object_or_404(Organization, pk=pk)
        data = SubscriptionUpdate(data=request.data)
        data.is_valid(raise_exception=True)
        values = dict(data.validated_data)
        sub = subscriptions.subscription_for(org)
        if "plan" in values:
            sub = subscriptions.change_plan(
                request=request, organization=org, plan=values.pop("plan")
            )
        changes = {}
        for key, value in values.items():
            if getattr(sub, key) != value:
                changes[key] = {"from": str(getattr(sub, key)), "to": str(value)}
                setattr(sub, key, value)
        # Extending access (or making it free) lifts read-only / past-due straight away.
        today = timezone.localdate()
        ends = sub.access_ends_on
        lifted = sub.complimentary or (ends and ends >= today)
        if lifted and sub.status in (Subscription.Status.PAST_DUE, Subscription.Status.LAPSED):
            changes["status"] = {"from": sub.status, "to": "active"}
            sub.status = (
                Subscription.Status.TRIALING
                if sub.trial_ends_on and sub.trial_ends_on >= today and not sub.paid_until
                else Subscription.Status.ACTIVE
            )
        sub.save()
        if changes:
            record_event(
                request,
                "platform.subscription_updated",
                target=sub,
                organization=org,
                changes=changes,
            )
        return OrganizationDetailView().get(request, pk)


class SuspendSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)


class OrganizationStatusView(PlatformView):
    """Suspend (nobody in the organization can sign in to it) or reactivate."""

    @extend_schema(request=SuspendSerializer, responses=dict)
    def post(self, request, pk, action):
        org = get_object_or_404(Organization, pk=pk)
        if action == "suspend":
            data = SuspendSerializer(data=request.data)
            data.is_valid(raise_exception=True)
            org.status = Organization.Status.SUSPENDED
            reason = data.validated_data["reason"]
        elif action == "reactivate":
            org.status = Organization.Status.ACTIVE
            reason = ""
        else:
            return Response(status=status.HTTP_404_NOT_FOUND)
        org.save(update_fields=["status", "updated_at"])
        record_event(
            request,
            f"platform.organization_{action}d",
            target=org,
            organization=org,
            metadata={"reason": reason},
        )
        return OrganizationDetailView().get(request, pk)


class IssueInvoiceView(PlatformView):
    """Invoice the next month now (instead of waiting for the daily job)."""

    @extend_schema(request=None, responses=dict)
    def post(self, request, pk):
        org = get_object_or_404(Organization, pk=pk)
        sub = subscriptions.subscription_for(org)
        start = (sub.access_ends_on or timezone.localdate()) + timedelta(days=1)
        invoice = subscriptions.issue_invoice(sub, start, actor=request.user)
        if invoice is None:
            raise BusinessRuleViolation(
                "Nothing to invoice: the plan is complimentary or priced by agreement, "
                "or the next month is already invoiced."
            )
        return Response(SubscriptionInvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)


class InvoiceListView(PlatformView):
    @extend_schema(responses=dict)
    def get(self, request):
        qs = SubscriptionInvoice.objects.select_related("organization").order_by("due_date")
        if request.query_params.get("status"):
            qs = qs.filter(status=request.query_params["status"])
        return Response(
            [
                {
                    **SubscriptionInvoiceSerializer(i).data,
                    "organization": {"id": str(i.organization_id), "name": i.organization.name},
                }
                for i in qs[:300]
            ]
        )


class PlatformRecordPayment(serializers.Serializer):
    method = serializers.ChoiceField(choices=SubscriptionInvoice.Method.choices)
    reference = serializers.CharField(max_length=64, allow_blank=True, required=False, default="")


class VoidInvoice(serializers.Serializer):
    reason = serializers.CharField(max_length=255)


class InvoiceActionView(PlatformView):
    @extend_schema(request=PlatformRecordPayment, responses=SubscriptionInvoiceSerializer)
    def post(self, request, pk, action):
        invoice = get_object_or_404(SubscriptionInvoice, pk=pk)
        if action == "record-payment":
            data = PlatformRecordPayment(data=request.data)
            data.is_valid(raise_exception=True)
            invoice = subscriptions.mark_paid(
                invoice=invoice,
                method=data.validated_data["method"],
                reference=data.validated_data["reference"],
                actor=request.user,
                request=request,
            )
        elif action == "void":
            data = VoidInvoice(data=request.data)
            data.is_valid(raise_exception=True)
            if invoice.status != SubscriptionInvoice.Status.OPEN:
                raise BusinessRuleViolation("Only unpaid invoices can be voided.")
            invoice.status = SubscriptionInvoice.Status.VOID
            invoice.save(update_fields=["status", "updated_at"])
            record_event(
                request,
                "platform.invoice_voided",
                target=invoice,
                organization=invoice.organization,
                metadata={"reason": data.validated_data["reason"]},
            )
        else:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(SubscriptionInvoiceSerializer(invoice).data)


class PlanListView(PlatformView):
    @extend_schema(responses=PlanSerializer(many=True))
    def get(self, request):
        plans = Plan.objects.annotate(organizations=Count("subscriptions"))
        return Response(
            [{**PlanSerializer(p).data, "organizations": p.organizations} for p in plans]
        )

    @extend_schema(request=PlanSerializer, responses={201: PlanSerializer})
    def post(self, request):
        data = PlanSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        plan = data.save()
        record_event(request, "platform.plan_created", target=plan, metadata=data.data)
        return Response(PlanSerializer(plan).data, status=status.HTTP_201_CREATED)


class PlanDetailView(PlatformView):
    @extend_schema(request=PlanSerializer, responses=PlanSerializer)
    def patch(self, request, pk):
        plan = get_object_or_404(Plan, pk=pk)
        before = PlanSerializer(plan).data
        data = PlanSerializer(plan, data=request.data, partial=True)
        data.is_valid(raise_exception=True)
        plan = data.save()
        after = PlanSerializer(plan).data
        record_event(
            request,
            "platform.plan_updated",
            target=plan,
            changes={
                k: {"from": str(before[k]), "to": str(after[k])}
                for k in after
                if before[k] != after[k]
            },
        )
        return Response(after)


class StartSupport(serializers.Serializer):
    reason = serializers.CharField(max_length=255)
    minutes = serializers.IntegerField(min_value=support.MIN_MINUTES, max_value=support.MAX_MINUTES)


class SupportStartView(PlatformView):
    @extend_schema(request=StartSupport, responses={201: dict})
    def post(self, request, pk):
        org = get_object_or_404(Organization, pk=pk, status=Organization.Status.ACTIVE)
        data = StartSupport(data=request.data)
        data.is_valid(raise_exception=True)
        grant = support.start(request=request, organization=org, **data.validated_data)
        return Response(
            {"id": str(grant.pk), "organization": str(org.pk), "expires_at": grant.expires_at},
            status=status.HTTP_201_CREATED,
        )


class SupportEndView(PlatformView):
    @extend_schema(request=None, responses=dict)
    def post(self, request, pk):
        grant = get_object_or_404(SupportGrant, pk=pk, user=request.user)
        support.end(request=request, grant=grant)
        return Response({"id": str(grant.pk), "ended_at": grant.ended_at})
