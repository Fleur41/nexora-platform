"""Upload validation by content, not by the client-supplied name or MIME type."""

import hashlib
import zipfile

from django.conf import settings
from rest_framework import serializers

# (extension, content type, check(header_bytes) -> bool)
_SIGNATURES = [
    (".pdf", "application/pdf", lambda h: h.startswith(b"%PDF-")),
    (".png", "image/png", lambda h: h.startswith(b"\x89PNG\r\n\x1a\n")),
    (".jpg", "image/jpeg", lambda h: h.startswith(b"\xff\xd8\xff")),
    (".webp", "image/webp", lambda h: h[:4] == b"RIFF" and h[8:12] == b"WEBP"),
]
DOCX = (
    ".docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
)
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}


def _is_docx(upload) -> bool:
    upload.seek(0)
    try:
        with zipfile.ZipFile(upload) as archive:
            names = set(archive.namelist())
    except zipfile.BadZipFile:
        return False
    finally:
        upload.seek(0)
    return "[Content_Types].xml" in names and any(n.startswith("word/") for n in names)


def inspect_upload(upload, *, images_only: bool = False) -> dict:
    """Return detected extension/content type/size/sha256, or raise ValidationError."""
    if upload.size == 0:
        raise serializers.ValidationError("The file is empty.")
    if upload.size > settings.DOCUMENT_MAX_UPLOAD_BYTES:
        limit_mb = settings.DOCUMENT_MAX_UPLOAD_BYTES // (1024 * 1024)
        raise serializers.ValidationError(f"Files must be {limit_mb} MB or smaller.")

    upload.seek(0)
    header = upload.read(16)
    upload.seek(0)
    detected = next(((ext, ctype) for ext, ctype, check in _SIGNATURES if check(header)), None)
    if detected is None and header.startswith(b"PK") and _is_docx(upload):
        detected = DOCX
    if detected is None:
        raise serializers.ValidationError("Upload a PDF, Word (.docx), JPEG, PNG or WebP file.")
    if images_only and detected[1] not in IMAGE_TYPES:
        raise serializers.ValidationError("Photos must be JPEG, PNG or WebP images.")

    digest = hashlib.sha256()
    for chunk in upload.chunks():
        digest.update(chunk)
    upload.seek(0)
    return {
        "extension": detected[0],
        "content_type": detected[1],
        "size": upload.size,
        "sha256": digest.hexdigest(),
    }
