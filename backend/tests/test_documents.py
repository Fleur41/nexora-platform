import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.documents.models import Document
from apps.organizations.roles import Role

from .factories import LeaseFactory, PropertyFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db

PDF = b"%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


@pytest.fixture
def lease(org_a):
    return LeaseFactory(
        unit=UnitFactory(unit_type=UnitTypeFactory(property=PropertyFactory(organization=org_a)))
    )


def _upload(client, content, name="lease.pdf", **target):
    return client.post(
        "/api/v1/documents/",
        {
            "file": SimpleUploadedFile(name, content, content_type="application/octet-stream"),
            **target,
        },
        format="multipart",
    )


def test_upload_and_download_lease_document(make_member, org_a, lease):
    _, client = make_member(org_a)
    res = _upload(
        client, PDF, lease=str(lease.pk), category="lease_agreement", title="Signed lease"
    )
    assert res.status_code == 201, res.data
    assert res.data["content_type"] == "application/pdf"  # detected, not trusted from client
    assert res.data["target_type"] == "lease"
    doc = Document.objects.get()
    assert "lease.pdf" not in doc.file.name  # stored under a random name

    dl = client.get(f"/api/v1/documents/{doc.pk}/download/")
    assert dl.status_code == 200
    assert b"".join(dl.streaming_content) == PDF
    assert dl["X-Content-Type-Options"] == "nosniff"
    assert "attachment" in dl["Content-Disposition"]
    listed = client.get("/api/v1/documents/", {"lease": str(lease.pk)}).data
    assert listed["count"] == 1


def test_disguised_files_and_wrong_photo_types_are_rejected(make_member, org_a, lease):
    _, client = make_member(org_a)
    exe = _upload(client, b"MZ\x90\x00 not really a pdf", name="invoice.pdf", lease=str(lease.pk))
    assert exe.status_code == 400
    assert "file" in exe.data["error"]["details"]
    pdf_as_photo = _upload(client, PDF, property=str(lease.unit.property_id), category="photo")
    assert pdf_as_photo.status_code == 400
    photo = _upload(
        client, PNG, name="front.png", property=str(lease.unit.property_id), category="photo"
    )
    assert photo.status_code == 201


@override_settings(DOCUMENT_MAX_UPLOAD_BYTES=20)
def test_size_limit(make_member, org_a, lease):
    _, client = make_member(org_a)
    assert _upload(client, PDF, lease=str(lease.pk)).status_code == 400


def test_exactly_one_target_required(make_member, org_a, lease):
    _, client = make_member(org_a)
    assert _upload(client, PDF).status_code == 400
    both = _upload(client, PDF, lease=str(lease.pk), tenant=str(lease.tenant_id))
    assert both.status_code == 400


def test_tenant_identity_documents_need_manage_permission(make_member, org_a, lease):
    _, owner = make_member(org_a)
    id_doc = _upload(owner, PDF, tenant=str(lease.tenant_id), category="identity").data
    photo = _upload(
        owner, PNG, name="p.png", property=str(lease.unit.property_id), category="photo"
    ).data

    _, caretaker = make_member(org_a, role=Role.CARETAKER, access_scope="organization")
    ids = {d["id"] for d in caretaker.get("/api/v1/documents/").data["results"]}
    assert ids == {photo["id"]}
    assert caretaker.get(f"/api/v1/documents/{id_doc['id']}/download/").status_code == 404
    # Caretakers can view property photos but not upload or remove them.
    assert caretaker.delete(f"/api/v1/documents/{photo['id']}/").status_code == 403
    assert (
        _upload(
            caretaker, PNG, name="x.png", property=str(lease.unit.property_id), category="photo"
        ).status_code
        == 400
    )


def test_documents_are_isolated_between_organizations(make_member, org_a, org_b, lease):
    _, owner = make_member(org_a)
    doc = _upload(owner, PDF, lease=str(lease.pk)).data
    _, outsider = make_member(org_b)
    assert outsider.get(f"/api/v1/documents/{doc['id']}/download/").status_code == 404
    assert outsider.get("/api/v1/documents/").data["count"] == 0
    # Nor attach files to another organization's records.
    assert _upload(outsider, PDF, lease=str(lease.pk)).status_code == 400


def test_delete_is_soft_and_audited(make_member, org_a, lease):
    _, client = make_member(org_a)
    doc = _upload(client, PDF, lease=str(lease.pk)).data
    assert client.delete(f"/api/v1/documents/{doc['id']}/").status_code == 204
    assert client.get(f"/api/v1/documents/{doc['id']}/").status_code == 404
    stored = Document.objects.get(pk=doc["id"])
    assert stored.deleted_at is not None and stored.file
