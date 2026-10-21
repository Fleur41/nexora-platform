from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, mixins, status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.audit.services import record_event
from apps.organizations.access import OrganizationScopedViewSet

from .access import can_manage, viewable_filter
from .models import Document
from .serializers import DocumentSerializer, DocumentUploadSerializer
from .validation import IMAGE_TYPES


class DocumentViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    OrganizationScopedViewSet,
):
    """Capabilities depend on what a document is attached to, so they are checked per
    target (see documents.access) rather than per action."""

    queryset = Document.objects.select_related("uploaded_by")
    serializer_class = DocumentSerializer
    required_capabilities = {
        "list": None,
        "retrieve": None,
        "create": None,
        "destroy": None,
        "download": None,
    }
    filterset_fields = ["property", "unit", "tenant", "lease", "category"]
    search_fields = ["title", "original_filename"]
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .filter(deleted_at__isnull=True)
            .filter(viewable_filter(self.request.membership))
        )

    @extend_schema(request=DocumentUploadSerializer, responses={201: DocumentSerializer})
    def create(self, request, *args, **kwargs):
        serializer = DocumentUploadSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        upload = data["file"]
        with transaction.atomic():
            document = Document(
                organization=request.organization,
                category=data["category"],
                title=data.get("title") or upload.name[:200],
                original_filename=upload.name[:255],
                uploaded_by=request.user,
                **{data["target_field"]: data["target"]},
                **data["file_info"],
            )
            document.file.save("upload", upload, save=False)
            document.save()
            record_event(
                request,
                "document.uploaded",
                target=document,
                metadata={"attached_to": data["target_field"], "sha256": document.sha256},
            )
        return Response(DocumentSerializer(document).data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        if not can_manage(self.request.membership, instance.target_field):
            raise exceptions.PermissionDenied("Your role cannot remove this document.")
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.save(update_fields=["deleted_at", "deleted_by", "updated_at"])
        record_event(self.request, "document.deleted", target=instance)

    @extend_schema(responses={(200, "application/octet-stream"): bytes})
    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        document = self.get_object()
        inline = request.query_params.get("inline") == "1" and document.content_type in IMAGE_TYPES
        response = FileResponse(
            document.file.open("rb"),
            as_attachment=not inline,
            filename=document.original_filename,
            content_type=document.content_type,
        )
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; sandbox"
        response["Cache-Control"] = "private, no-store"
        return response
