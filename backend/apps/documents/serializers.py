from rest_framework import serializers

from .access import RULES, can_manage, target_queryset
from .models import Document
from .validation import inspect_upload


class DocumentSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.CharField(
        source="uploaded_by.full_name", read_only=True, default=""
    )
    target_type = serializers.CharField(source="target_field", read_only=True)

    class Meta:
        model = Document
        fields = [
            "id",
            "category",
            "title",
            "original_filename",
            "content_type",
            "size",
            "target_type",
            "property",
            "unit",
            "tenant",
            "lease",
            "uploaded_by_name",
            "created_at",
        ]
        read_only_fields = fields


class DocumentUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    title = serializers.CharField(max_length=200, required=False, allow_blank=True)
    category = serializers.ChoiceField(
        choices=Document.Category.choices, default=Document.Category.OTHER
    )
    property = serializers.UUIDField(required=False)
    unit = serializers.UUIDField(required=False)
    tenant = serializers.UUIDField(required=False)
    lease = serializers.UUIDField(required=False)

    def validate(self, attrs):
        membership = self.context["membership"]
        targets = [f for f in RULES if attrs.get(f)]
        if len(targets) != 1:
            raise serializers.ValidationError(
                {"non_field_errors": ["Attach the file to exactly one record."]}
            )
        field = targets[0]
        target = target_queryset(field, membership).filter(pk=attrs[field]).first()
        if target is None:
            raise serializers.ValidationError({field: ["Record not found."]})
        if not can_manage(membership, field):
            raise serializers.ValidationError(
                {field: ["Your role cannot add documents to this record."]}
            )
        try:
            info = inspect_upload(
                attrs["file"], images_only=attrs["category"] == Document.Category.PHOTO
            )
        except serializers.ValidationError as exc:
            raise serializers.ValidationError({"file": exc.detail}) from exc
        attrs["target_field"] = field
        attrs["target"] = target
        attrs["file_info"] = info
        return attrs
