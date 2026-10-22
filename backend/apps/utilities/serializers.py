from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.leases.serializers import AccessibleUnitField

from .models import Meter, MeterReading


@extend_schema_field(OpenApiTypes.UUID)
class AccessibleMeterField(serializers.PrimaryKeyRelatedField):
    def get_queryset(self):
        from apps.properties.access import accessible_properties

        membership = self.context.get("membership")
        if membership is None:
            return Meter.objects.none()
        return Meter.objects.filter(
            unit__property__in=accessible_properties(membership).values("pk")
        )


class MeterSerializer(serializers.ModelSerializer):
    unit = AccessibleUnitField()
    unit_number = serializers.CharField(source="unit.number", read_only=True)
    property_id = serializers.UUIDField(source="unit.property_id", read_only=True)
    property_name = serializers.CharField(source="unit.property.name", read_only=True)
    last_reading_date = serializers.DateField(read_only=True)
    last_reading_value = serializers.DecimalField(max_digits=14, decimal_places=3, read_only=True)

    class Meta:
        model = Meter
        fields = [
            "id",
            "unit",
            "unit_number",
            "property_id",
            "property_name",
            "utility",
            "number",
            "is_active",
            "last_reading_date",
            "last_reading_value",
            "created_at",
        ]
        read_only_fields = ["id", "is_active", "created_at"]
        validators = []


class MeterReadingSerializer(serializers.ModelSerializer):
    meter = AccessibleMeterField()
    utility = serializers.CharField(source="meter.utility", read_only=True)
    unit_number = serializers.CharField(source="meter.unit.number", read_only=True)
    is_billed = serializers.SerializerMethodField()
    recorded_by_name = serializers.CharField(
        source="recorded_by.full_name", default="", read_only=True
    )

    class Meta:
        model = MeterReading
        fields = [
            "id",
            "meter",
            "utility",
            "unit_number",
            "reading_date",
            "value",
            "is_estimate",
            "note",
            "is_billed",
            "recorded_by_name",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]
        validators = []

    def get_is_billed(self, reading) -> bool:
        return reading.invoice_line_id is not None


class BulkReadingRowSerializer(serializers.Serializer):
    meter = AccessibleMeterField()
    value = serializers.DecimalField(max_digits=14, decimal_places=3, min_value=0)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class BulkReadingSerializer(serializers.Serializer):
    reading_date = serializers.DateField()
    readings = BulkReadingRowSerializer(many=True)

    def validate_readings(self, value):
        if not value:
            raise serializers.ValidationError("Enter at least one reading.")
        meters = [row["meter"].pk for row in value]
        if len(meters) != len(set(meters)):
            raise serializers.ValidationError("Each meter can only appear once.")
        return value
