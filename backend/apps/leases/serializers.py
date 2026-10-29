from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.organizations.models import organization_today
from apps.properties.access import accessible_properties
from apps.properties.models import Unit
from apps.tenants.access import accessible_tenants
from apps.tenants.models import Tenant

from .models import Lease, LeaseRentTerm


@extend_schema_field(OpenApiTypes.UUID)
class AccessibleTenantField(serializers.PrimaryKeyRelatedField):
    def get_queryset(self):
        membership = self.context.get("membership")
        return accessible_tenants(membership) if membership else Tenant.objects.none()


@extend_schema_field(OpenApiTypes.UUID)
class AccessibleUnitField(serializers.PrimaryKeyRelatedField):
    def get_queryset(self):
        membership = self.context.get("membership")
        if membership is None:
            return Unit.objects.none()
        return Unit.objects.filter(property__in=accessible_properties(membership))


class RentTermSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaseRentTerm
        fields = ["id", "effective_from", "monthly_rent", "note", "created_at"]
        read_only_fields = ["id", "created_at"]


class LeaseSerializer(serializers.ModelSerializer):
    tenant = AccessibleTenantField()
    unit = AccessibleUnitField()
    monthly_rent = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=0, write_only=True, required=False
    )
    activate = serializers.BooleanField(write_only=True, required=False, default=False)
    tenant_name = serializers.CharField(source="tenant.full_name", read_only=True)
    tenant_phone = serializers.CharField(source="tenant.phone", read_only=True)
    unit_number = serializers.CharField(source="unit.number", read_only=True)
    property_id = serializers.UUIDField(source="unit.property_id", read_only=True)
    property_name = serializers.CharField(source="unit.property.name", read_only=True)
    current_rent = serializers.SerializerMethodField()
    rent_terms = RentTermSerializer(many=True, read_only=True)

    class Meta:
        model = Lease
        fields = [
            "id",
            "reference",
            "status",
            "tenant",
            "tenant_name",
            "tenant_phone",
            "unit",
            "unit_number",
            "property_id",
            "property_name",
            "start_date",
            "end_date",
            "ended_on",
            "billing_frequency",
            "rent_due_day",
            "deposit_amount",
            "first_month_in_full",
            "monthly_rent",
            "current_rent",
            "rent_terms",
            "notes",
            "end_reason",
            "activate",
            "activated_at",
            "closed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "reference",
            "status",
            "ended_on",
            "end_reason",
            "activated_at",
            "closed_at",
            "created_at",
            "updated_at",
        ]

    def get_current_rent(self, lease) -> str | None:
        # rent_terms are prefetched in order; pick the latest one already in force.
        today = organization_today(lease.organization)
        current = None
        for term in lease.rent_terms.all():
            if term.effective_from <= today:
                current = term
        if current is None and lease.status == Lease.Status.DRAFT:
            terms = list(lease.rent_terms.all())
            current = terms[0] if terms else None
        return str(current.monthly_rent) if current else None

    def validate(self, attrs):
        if self.instance is None and attrs.get("monthly_rent") is None:
            raise serializers.ValidationError({"monthly_rent": ["Enter the monthly rent."]})
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError(
                {"end_date": ["The end date must be on or after the start date."]}
            )
        return attrs


class RentChangeSerializer(serializers.Serializer):
    effective_from = serializers.DateField()
    monthly_rent = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class EndLeaseSerializer(serializers.Serializer):
    ended_on = serializers.DateField()
    unit_status = serializers.ChoiceField(choices=sorted(Unit.POST_LEASE_STATUSES))
    reason = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class FirstMonthSerializer(serializers.Serializer):
    first_month_in_full = serializers.BooleanField()


class CancelLeaseSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
