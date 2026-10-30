from decimal import Decimal

from django.db.models import Count, Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.organizations.access import OrganizationScopedPrimaryKeyRelatedField
from apps.organizations.models import Membership

from .access import accessible_properties
from .models import Property, PropertyAssignment, Unit, UnitType


@extend_schema_field(OpenApiTypes.UUID)
class AccessiblePropertyField(serializers.PrimaryKeyRelatedField):
    """Accepts only properties the requesting member can access (org + assignment scope)."""

    def get_queryset(self):
        membership = self.context.get("membership")
        if membership is None:
            return Property.objects.none()
        return accessible_properties(membership)


@extend_schema_field(OpenApiTypes.UUID)
class AccessibleUnitTypeField(serializers.PrimaryKeyRelatedField):
    def get_queryset(self):
        membership = self.context.get("membership")
        if membership is None:
            return UnitType.objects.none()
        return UnitType.objects.filter(property__in=accessible_properties(membership))


def unit_status_counts(queryset) -> dict:
    """Aggregate unit counts by status, with an occupancy rate over lettable units."""
    counts = {status: 0 for status in Unit.Status.values}
    # order_by() clears any ordering, which would otherwise be added to GROUP BY.
    for row in queryset.order_by().values("status").annotate(n=Count("id")):
        counts[row["status"]] = row["n"]
    total = sum(counts.values())
    # Units let to a tenant (including those serving notice) count as occupied.
    occupied = counts["occupied"] + counts["notice_submitted"]
    lettable = total - counts["unavailable"]
    return {
        "total": total,
        "by_status": counts,
        "occupied": occupied,
        "vacant": counts["available"],
        "occupancy_rate": round(occupied / lettable * 100, 1) if lettable else None,
    }


class PropertySerializer(serializers.ModelSerializer):
    unit_count = serializers.IntegerField(read_only=True)
    occupied_count = serializers.IntegerField(read_only=True)
    available_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Property
        fields = [
            "id",
            "name",
            "reference",
            "slug",
            "property_type",
            "address_line",
            "town",
            "county",
            "country",
            "latitude",
            "longitude",
            "map_url",
            "description",
            "amenities",
            "is_listed_publicly",
            "is_active",
            "unit_count",
            "occupied_count",
            "available_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "reference", "slug", "created_at", "updated_at"]

    def validate_amenities(self, value):
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise serializers.ValidationError("Amenities must be a list of text labels.")
        cleaned = sorted({v.strip()[:60] for v in value if v.strip()})
        if len(cleaned) > 50:
            raise serializers.ValidationError("Use at most 50 amenities.")
        return cleaned

    def validate_country(self, value):
        value = value.upper()
        if len(value) != 2 or not value.isalpha():
            raise serializers.ValidationError("Use a 2-letter ISO 3166 country code.")
        return value


def annotate_property_counts(queryset):
    return queryset.annotate(
        unit_count=Count("units", distinct=True),
        occupied_count=Count(
            "units",
            filter=Q(units__status__in=[Unit.Status.OCCUPIED, Unit.Status.NOTICE_SUBMITTED]),
            distinct=True,
        ),
        available_count=Count(
            "units", filter=Q(units__status=Unit.Status.AVAILABLE), distinct=True
        ),
    )


class UnitTypeSerializer(serializers.ModelSerializer):
    property = AccessiblePropertyField()
    unit_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = UnitType
        fields = [
            "id",
            "property",
            "name",
            "category",
            "bedrooms",
            "bathrooms",
            "default_rent",
            "default_deposit",
            "description",
            "is_active",
            "unit_count",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        if (
            self.instance is not None
            and "property" in attrs
            and attrs["property"].pk != self.instance.property_id
        ):
            raise serializers.ValidationError(
                {"property": ["A unit type cannot be moved to another property."]}
            )
        return attrs


class UnitSerializer(serializers.ModelSerializer):
    property = AccessiblePropertyField()
    unit_type = AccessibleUnitTypeField()
    property_name = serializers.CharField(source="property.name", read_only=True)
    unit_type_name = serializers.CharField(source="unit_type.name", read_only=True)
    market_rent = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=0, required=False
    )
    floor_area = serializers.DecimalField(
        max_digits=8, decimal_places=2, min_value=Decimal("0.01"), required=False, allow_null=True
    )
    current_lease = serializers.SerializerMethodField()

    class Meta:
        model = Unit
        fields = [
            "id",
            "property",
            "property_name",
            "unit_type",
            "unit_type_name",
            "number",
            "floor",
            "status",
            "market_rent",
            "water_meter_number",
            "electricity_meter_number",
            "floor_area",
            "notes",
            "current_lease",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "status", "created_at", "updated_at"]

    def get_current_lease(self, unit) -> dict | None:
        # Populated by UnitViewSet via Prefetch(to_attr="active_leases").
        leases = getattr(unit, "active_leases", None)
        lease = leases[0] if leases else None
        membership = self.context.get("membership")
        if lease is None or membership is None:
            return None
        data = {"id": str(lease.pk), "reference": lease.reference}
        if membership.has_capability("tenants.view"):
            data["tenant_name"] = lease.tenant.full_name
        return data


class UnitStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=sorted(Unit.MANUAL_STATUSES))
    reason = serializers.CharField(max_length=255, required=False, allow_blank=True)


class BulkUnitSerializer(serializers.Serializer):
    property = AccessiblePropertyField()
    unit_type = AccessibleUnitTypeField()
    prefix = serializers.CharField(max_length=16, allow_blank=True, default="")
    start = serializers.IntegerField(min_value=0, max_value=99999, default=1)
    count = serializers.IntegerField(min_value=1, max_value=200)
    floor = serializers.CharField(max_length=32, allow_blank=True, default="")


class PropertyAssignmentSerializer(serializers.ModelSerializer):
    property = AccessiblePropertyField()
    membership = OrganizationScopedPrimaryKeyRelatedField(
        queryset=Membership.objects.filter(status=Membership.Status.ACTIVE)
    )
    property_name = serializers.CharField(source="property.name", read_only=True)
    member_name = serializers.CharField(source="membership.user.full_name", read_only=True)
    member_email = serializers.CharField(source="membership.user.email", read_only=True)

    class Meta:
        model = PropertyAssignment
        fields = [
            "id",
            "property",
            "property_name",
            "membership",
            "member_name",
            "member_email",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]
