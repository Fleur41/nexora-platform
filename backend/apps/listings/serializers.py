from rest_framework import serializers

from apps.leases.serializers import AccessibleUnitField
from apps.organizations.models import organization_today

from . import services
from .models import Enquiry, Listing


def _photo_url(listing_id, document_id) -> str:
    return f"/api/v1/public/listings/{listing_id}/photos/{document_id}/"


class PublicListingSerializer(serializers.ModelSerializer):
    """What the public sees. Area only (town, county): the street address is shared later."""

    rent = serializers.DecimalField(source="unit.market_rent", max_digits=14, decimal_places=2)
    deposit = serializers.DecimalField(
        source="unit.unit_type.default_deposit", max_digits=14, decimal_places=2
    )
    currency = serializers.CharField(source="organization.currency")
    category = serializers.CharField(source="unit.unit_type.get_category_display")
    bedrooms = serializers.IntegerField(source="unit.unit_type.bedrooms")
    bathrooms = serializers.IntegerField(source="unit.unit_type.bathrooms")
    property_name = serializers.CharField(source="unit.property.name")
    town = serializers.CharField(source="unit.property.town")
    county = serializers.CharField(source="unit.property.county")
    amenities = serializers.ListField(source="unit.property.amenities")
    landlord = serializers.SerializerMethodField()
    available_from = serializers.SerializerMethodField()
    photos = serializers.SerializerMethodField()

    class Meta:
        model = Listing
        fields = [
            "id",
            "title",
            "description",
            "rent",
            "deposit",
            "currency",
            "category",
            "bedrooms",
            "bathrooms",
            "property_name",
            "town",
            "county",
            "amenities",
            "available_from",
            "landlord",
            "photos",
            "published_at",
        ]
        read_only_fields = fields

    def get_landlord(self, listing) -> dict:
        org = listing.organization
        return {"name": org.name, "slug": org.slug, "phone": listing.contact_phone or org.phone}

    def get_available_from(self, listing) -> str | None:
        when = services.available_from(listing)
        return str(when) if when else None

    def get_photos(self, listing) -> list[dict]:
        return [
            {"id": str(link.document_id), "url": _photo_url(listing.pk, link.document_id)}
            for link in listing.photo_links.all()
        ]


class EnquiryInSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=Enquiry.Kind.choices)
    name = serializers.CharField(max_length=150)
    phone = serializers.CharField(max_length=32)
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    message = serializers.CharField(required=False, allow_blank=True, default="", max_length=2000)
    preferred_date = serializers.DateField(required=False, allow_null=True)
    preferred_time = serializers.ChoiceField(
        choices=Enquiry.TimeOfDay.choices, required=False, default=Enquiry.TimeOfDay.ANY
    )
    # Honeypot: hidden from people, filled in by bots. Any value means spam.
    website = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_phone(self, value):
        digits = "".join(c for c in value if c.isdigit())
        if len(digits) < 9:
            raise serializers.ValidationError("Enter a phone number we can call.")
        return value.strip()


class ListingSerializer(serializers.ModelSerializer):
    """Staff view of a listing, including why it isn't shown when it isn't."""

    unit = AccessibleUnitField()
    unit_number = serializers.CharField(source="unit.number", read_only=True)
    unit_status = serializers.CharField(source="unit.status", read_only=True)
    property_id = serializers.UUIDField(source="unit.property_id", read_only=True)
    property_name = serializers.CharField(source="unit.property.name", read_only=True)
    rent = serializers.DecimalField(
        source="unit.market_rent", max_digits=14, decimal_places=2, read_only=True
    )
    photo_ids = serializers.ListField(
        child=serializers.UUIDField(), write_only=True, required=False
    )
    photos = serializers.SerializerMethodField()
    is_public = serializers.SerializerMethodField()
    hidden_reason = serializers.SerializerMethodField()
    public_url = serializers.SerializerMethodField()
    open_enquiries = serializers.SerializerMethodField()

    class Meta:
        model = Listing
        fields = [
            "id",
            "unit",
            "unit_number",
            "unit_status",
            "property_id",
            "property_name",
            "rent",
            "title",
            "description",
            "is_published",
            "available_from",
            "contact_phone",
            "published_at",
            "photo_ids",
            "photos",
            "is_public",
            "hidden_reason",
            "public_url",
            "open_enquiries",
            "created_at",
        ]
        read_only_fields = ["id", "published_at", "created_at"]

    def get_photos(self, listing) -> list[dict]:
        return [
            {"id": str(link.document_id), "title": link.document.title}
            for link in listing.photo_links.all()
        ]

    def get_is_public(self, listing) -> bool:
        return not services.hidden_reason(listing)

    def get_hidden_reason(self, listing) -> str:
        return services.hidden_reason(listing)

    def get_public_url(self, listing) -> str:
        return services.public_url(listing)

    def get_open_enquiries(self, listing) -> int:
        return sum(1 for e in listing.enquiries.all() if e.status in Enquiry.OPEN_STATUSES)


class EnquirySerializer(serializers.ModelSerializer):
    listing_title = serializers.CharField(source="listing.title", read_only=True)
    unit = serializers.UUIDField(source="listing.unit_id", read_only=True)
    unit_number = serializers.CharField(source="listing.unit.number", read_only=True)
    property_name = serializers.CharField(source="listing.unit.property.name", read_only=True)
    handled_by_name = serializers.CharField(
        source="handled_by.user.full_name", default=None, read_only=True
    )

    class Meta:
        model = Enquiry
        fields = [
            "id",
            "reference",
            "listing",
            "listing_title",
            "unit",
            "unit_number",
            "property_name",
            "kind",
            "name",
            "phone",
            "email",
            "message",
            "preferred_date",
            "preferred_time",
            "status",
            "viewing_at",
            "outcome",
            "staff_notes",
            "handled_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            f for f in fields if f not in ("status", "viewing_at", "outcome", "staff_notes")
        ]

    def validate_viewing_at(self, value):
        if value and value.date() < organization_today(self.context["request"].organization):
            raise serializers.ValidationError("Choose a time from today onwards.")
        return value
