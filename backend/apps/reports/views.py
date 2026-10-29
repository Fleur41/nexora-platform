from datetime import timedelta

from django.http import HttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import exceptions, serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import record_event
from apps.billing.periods import month_end
from apps.organizations.access import OrganizationPermission
from apps.organizations.models import organization_today
from apps.properties.access import accessible_properties

from . import services
from .exporters import CONTENT_TYPES, RENDERERS

DESCRIPTIONS = {
    "financial-summary": "Billed income by category, money received, maintenance costs, "
    "deposits and arrears, with a month-by-month chart.",
    "rent-roll": "Every tenancy with its rent, what was billed and paid, and the balance.",
    "arrears": "What each tenant owes, by how long it is overdue (as of today).",
    "occupancy": "Units by status, occupancy over the period and vacant units.",
    "deposits": "Deposits held for each tenancy; they are owed back, not income.",
    "maintenance-costs": "Money spent on repairs, per repair and per property.",
}


class ReportQuery(serializers.Serializer):
    start = serializers.DateField(required=False)
    end = serializers.DateField(required=False)
    property = serializers.UUIDField(required=False)
    export = serializers.ChoiceField(choices=sorted(RENDERERS), required=False)

    def validate(self, attrs):
        start, end = attrs.get("start"), attrs.get("end")
        if start and end and end < start:
            raise serializers.ValidationError({"end": ["The end must be on or after the start."]})
        if start and end and (end - start).days > services.MAX_DAYS:
            raise serializers.ValidationError({"end": ["Choose a period of three years or less."]})
        return attrs


class ReportListView(APIView):
    permission_classes = [IsAuthenticated, OrganizationPermission]
    required_capabilities = {"get": "reports.view"}

    @extend_schema(responses=dict)
    def get(self, request):
        membership = request.membership
        return Response(
            [
                {
                    "key": key,
                    "title": fn.__name__.replace("_", " ").capitalize(),
                    "description": DESCRIPTIONS[key],
                    "available": membership.has_capability(
                        services.EXTRA_CAPABILITY.get(key, "reports.view")
                    ),
                }
                for key, fn in services.REPORTS.items()
            ]
        )


class ReportView(APIView):
    permission_classes = [IsAuthenticated, OrganizationPermission]
    required_capabilities = {"get": "reports.view"}

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "start", str, description="First day (YYYY-MM-DD); default: this month"
            ),
            OpenApiParameter("end", str, description="Last day (YYYY-MM-DD)"),
            OpenApiParameter("property", str, description="Limit to one property"),
            OpenApiParameter(
                "export", str, enum=sorted(RENDERERS), description="Download as a file"
            ),
        ],
        responses=dict,
    )
    def get(self, request, key):
        builder = services.REPORTS.get(key)
        if builder is None:
            raise exceptions.NotFound("No such report.")
        membership = request.membership
        extra = services.EXTRA_CAPABILITY.get(key)
        if extra and not membership.has_capability(extra):
            raise exceptions.PermissionDenied("Your role does not allow this report.")
        query = ReportQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        params = query.validated_data
        organization = request.organization
        today = organization_today(organization)
        start = params.get("start") or today.replace(day=1)
        end = params.get("end") or month_end(start)
        if (end - start).days > services.MAX_DAYS:
            end = start + timedelta(days=services.MAX_DAYS)

        properties = accessible_properties(membership)
        prop = None
        if params.get("property"):
            prop = properties.filter(pk=params["property"]).first()
            if prop is None:
                raise exceptions.NotFound("That property doesn't exist or isn't one of yours.")
            properties = properties.filter(pk=prop.pk)
        scope = services.Scope(
            organization=organization,
            properties=properties,
            property=prop,
            org_wide=membership.has_organization_scope and prop is None,
            start=start,
            end=end,
            can_see_costs=membership.has_capability("maintenance.costs"),
        )
        report = builder(scope)

        fmt = params.get("export")
        if not fmt:
            return Response(report)
        record_event(
            request,
            "report.exported",
            target=organization,
            metadata={
                "report": key,
                "format": fmt,
                "start": str(start),
                "end": str(end),
                "property": str(prop.pk) if prop else None,
            },
        )
        content = RENDERERS[fmt](report)
        name = f"{key}-{report['period']['start']}-to-{report['period']['end']}.{fmt}"
        response = HttpResponse(content, content_type=CONTENT_TYPES[fmt])
        response["Content-Disposition"] = f'attachment; filename="{name}"'
        return response
