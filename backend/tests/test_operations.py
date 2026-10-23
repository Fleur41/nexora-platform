from datetime import date, timedelta
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.billing import services as billing
from apps.billing.models import Invoice
from apps.deposits import services as deposits
from apps.leases.models import Lease, MoveOutNotice
from apps.organizations.models import organization_today
from apps.organizations.roles import Role
from apps.properties.models import Unit

from .factories import LeaseFactory, PropertyFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db


def make_lease(org, rent="30000", deposit="30000", start=date(2026, 8, 1)):
    unit_type = UnitTypeFactory(property=PropertyFactory(organization=org))
    return LeaseFactory(
        unit=UnitFactory(unit_type=unit_type),
        start_date=start,
        rent=Decimal(rent),
        deposit_amount=Decimal(deposit),
    )


# --- Maintenance -----------------------------------------------------------------------------


def test_maintenance_lifecycle_with_internal_notes_and_costs(make_member, org_a):
    _, owner = make_member(org_a)
    lease = make_lease(org_a)
    created = owner.post(
        "/api/v1/maintenance/",
        {
            "unit": str(lease.unit_id),
            "category": "plumbing",
            "title": "Leaking sink",
            "description": "Under the kitchen sink",
            "urgency": "high",
        },
    )
    assert created.status_code == 201, created.data
    rid = created.data["id"]
    assert created.data["reference"] == "MNT-0001" and created.data["tenant"] == lease.tenant_id

    caretaker, care_client = make_member(org_a, role=Role.CARETAKER, access_scope="organization")
    assert (
        owner.post(
            f"/api/v1/maintenance/{rid}/assign/",
            {"membership": str(caretaker.pk), "scheduled_for": "2026-10-25"},
        ).status_code
        == 200
    )
    assert care_client.get("/api/v1/maintenance/", {"mine": "true"}).data["count"] == 1
    assert (
        care_client.post(f"/api/v1/maintenance/{rid}/status/", {"status": "closed"}).status_code
        == 409
    )  # bad transition
    assert (
        care_client.post(
            f"/api/v1/maintenance/{rid}/status/",
            {"status": "in_progress", "note": "Plumber on site"},
        ).status_code
        == 200
    )
    assert (
        care_client.post(
            f"/api/v1/maintenance/{rid}/notes/", {"body": "Tenant was rude", "internal": True}
        ).status_code
        == 200
    )

    # Costs: owner records, caretaker can't see or add them.
    assert (
        owner.post(
            f"/api/v1/maintenance/{rid}/costs/",
            {
                "kind": "quotation",
                "description": "Replace trap",
                "amount": "3500",
                "supplier_name": "FixIt",
            },
        ).status_code
        == 201
    )
    assert (
        care_client.post(
            f"/api/v1/maintenance/{rid}/costs/",
            {"kind": "expense", "description": "x", "amount": "1"},
        ).status_code
        == 403
    )
    assert care_client.get(f"/api/v1/maintenance/{rid}/").data["costs"] is None
    detail = owner.get(f"/api/v1/maintenance/{rid}/").data
    assert [c["status"] for c in detail["costs"]] == ["pending"]
    cost_id = detail["costs"][0]["id"]
    assert (
        owner.post(f"/api/v1/maintenance/{rid}/costs/{cost_id}/decide/", {"approve": True}).data[
            "status"
        ]
        == "approved"
    )
    assert owner.post(f"/api/v1/maintenance/{rid}/status/", {"status": "resolved"}).data[
        "resolved_at"
    ]
    assert {
        "maintenance.created",
        "maintenance.assigned",
        "maintenance.status_changed",
        "maintenance.cost_added",
    } <= set(AuditLog.objects.values_list("action", flat=True))


def test_maintenance_scope_and_isolation(make_member, org_a, org_b):
    _, owner = make_member(org_a)
    lease = make_lease(org_a)
    rid = owner.post(
        "/api/v1/maintenance/",
        {
            "unit": str(lease.unit_id),
            "category": "electrical",
            "title": "Socket",
            "description": "Sparks",
        },
    ).data["id"]
    _, assigned_caretaker = make_member(org_a, role=Role.CARETAKER)  # assigned scope, no properties
    assert assigned_caretaker.get(f"/api/v1/maintenance/{rid}/").status_code == 404
    _, accountant = make_member(org_a, role=Role.ACCOUNTANT)
    assert (
        accountant.post(
            f"/api/v1/maintenance/{rid}/status/", {"status": "acknowledged"}
        ).status_code
        == 403
    )
    _, outsider = make_member(org_b)
    assert outsider.get(f"/api/v1/maintenance/{rid}/").status_code == 404
    assert (
        outsider.post(
            "/api/v1/maintenance/",
            {"unit": str(lease.unit_id), "category": "other", "title": "x", "description": "y"},
        ).status_code
        == 400
    )


# --- Inspections and move-out (requirements #9, #10) ----------------------------------------------


def test_move_out_notice_is_private_and_never_releases_the_unit(make_member, org_a):
    _, owner = make_member(org_a)
    lease = make_lease(org_a)
    today = organization_today(org_a)
    notice = owner.post(
        "/api/v1/move-outs/",
        {"lease": str(lease.pk), "intended_date": str(today + timedelta(days=30))},
    )
    assert notice.status_code == 201, notice.data
    nid = notice.data["id"]
    assert Unit.objects.get(pk=lease.unit_id).status == "occupied"  # submitting changes nothing

    _, caretaker = make_member(org_a, role=Role.CARETAKER, access_scope="organization")
    assert caretaker.get("/api/v1/move-outs/").status_code == 403
    assert caretaker.get(f"/api/v1/units/{lease.unit_id}/").data["status"] == "occupied"
    assert (
        owner.post(
            "/api/v1/move-outs/", {"lease": str(lease.pk), "intended_date": str(today)}
        ).status_code
        == 409
    )

    owner.post(f"/api/v1/move-outs/{nid}/acknowledge/", {"staff_notes": "Relocating"})
    assert Unit.objects.get(pk=lease.unit_id).status == "notice_submitted"  # still not available
    assert (
        owner.post(f"/api/v1/units/{lease.unit_id}/status/", {"status": "available"}).status_code
        == 409
    )
    owner.post(f"/api/v1/move-outs/{nid}/withdraw/")
    assert Unit.objects.get(pk=lease.unit_id).status == "occupied"


def test_inspection_checklist_and_completion(make_member, org_a):
    _, owner = make_member(org_a)
    lease = make_lease(org_a)
    res = owner.post(
        "/api/v1/inspections/",
        {"unit": str(lease.unit_id), "kind": "routine", "scheduled_for": "2026-10-30"},
    )
    assert res.status_code == 201
    inspection = res.data
    assert len(inspection["items"]) > 10 and inspection["reference"] == "INS-0001"
    url = f"/api/v1/inspections/{inspection['id']}/"
    first = inspection["items"][0]["id"]
    assert (
        owner.patch(
            url + "items/", {"items": [{"id": first, "charge_amount": "100"}]}, format="json"
        ).status_code
        == 409
    )
    assert (
        owner.post(url + "complete/", {"inspector_signature_name": "Grace"}).status_code == 409
    )  # unchecked items
    owner.patch(
        url + "items/",
        {"items": [{"id": i["id"], "condition": "good"} for i in inspection["items"]]},
        format="json",
    )
    done = owner.post(
        url + "complete/", {"inspector_signature_name": "Grace W", "keys_returned": 2}
    )
    assert done.status_code == 200 and done.data["status"] == "completed"
    assert (
        owner.patch(
            url + "items/", {"items": [{"id": first, "condition": "poor"}]}, format="json"
        ).status_code
        == 409
    )


def test_move_out_settlement(make_member, org_a):
    _, owner = make_member(org_a)
    today = organization_today(org_a)
    lease = make_lease(org_a, rent="30000", deposit="30000", start=date(2026, 8, 1))
    for period in ("2026-08", "2026-09"):
        owner.post("/api/v1/billing-runs/", {"period": period})
    owner.post(
        "/api/v1/payments/",
        {"lease": str(lease.pk), "amount": "48000", "received_on": "2026-09-05", "method": "cash"},
    )
    owner.post(
        f"/api/v1/deposits/{lease.pk}/transactions/",
        {"kind": "received", "amount": "30000", "transaction_date": "2026-08-01"},
    )

    nid = owner.post(
        "/api/v1/move-outs/", {"lease": str(lease.pk), "intended_date": str(today)}
    ).data["id"]
    owner.post(f"/api/v1/move-outs/{nid}/acknowledge/")
    scheduled = owner.post(
        f"/api/v1/move-outs/{nid}/schedule-inspection/", {"scheduled_for": str(today)}
    )
    assert scheduled.data["status"] == "inspection_scheduled"
    inspection_id = scheduled.data["inspection"]
    items = owner.get(f"/api/v1/inspections/{inspection_id}/").data["items"]
    owner.patch(
        f"/api/v1/inspections/{inspection_id}/items/",
        {
            "items": [
                {
                    "id": i["id"],
                    "condition": "damaged" if n == 0 else "good",
                    "charge_amount": "5000" if n == 0 else "0",
                }
                for n, i in enumerate(items)
            ]
        },
        format="json",
    )
    owner.post(
        f"/api/v1/inspections/{inspection_id}/complete/",
        {"inspector_signature_name": "Grace", "tenant_signature_name": "Tenant"},
    )

    moved_out_on = date(2026, 10, 15)
    preview = owner.get(
        f"/api/v1/move-outs/{nid}/settlement/", {"moved_out_on": str(moved_out_on)}
    ).data
    assert preview["damages_found"] == "5000.00" and preview["deposit_held"] == "30000.00"

    _, accountant = make_member(org_a, role=Role.ACCOUNTANT)
    body = {
        "moved_out_on": str(moved_out_on),
        "unit_status": "awaiting_inspection",
        "refund_method": "mpesa",
        "refund_reference": "RFD1",
    }
    assert accountant.post(f"/api/v1/move-outs/{nid}/complete/", body).status_code == 403
    done = owner.post(f"/api/v1/move-outs/{nid}/complete/", body)
    assert done.status_code == 200, done.data
    s = done.data["settlement"]
    # Billed Aug 30k + Sep 30k + Oct 1–15 prorated 15/31×30k = 14,516.13; paid 48k → owed 26,516.13.
    final = Invoice.objects.get(lease=lease, period_start=date(2026, 10, 1))
    assert final.total == Decimal("14516.13")
    assert s["damages_deducted"] == "5000.00"
    assert s["applied_to_balance"] == "25000.00"  # all that's left after damages
    assert s["refund"] == "0.00"
    lease.refresh_from_db()
    assert (lease.status, lease.ended_on) == ("ended", moved_out_on)
    assert Unit.objects.get(pk=lease.unit_id).status == "awaiting_inspection"
    assert deposits.summarize(lease).held == Decimal("0.00")
    assert billing.lease_balance(lease) == Decimal("1516.13")
    assert MoveOutNotice.objects.get(pk=nid).status == "completed"
    assert AuditLog.objects.filter(action="move_out.completed").exists()


def test_settlement_refunds_unused_deposit(make_member, org_a):
    _, owner = make_member(org_a)
    today = organization_today(org_a)
    lease = make_lease(org_a, rent="10000", deposit="10000", start=today.replace(day=1))
    owner.post(
        f"/api/v1/deposits/{lease.pk}/transactions/",
        {"kind": "received", "amount": "10000", "transaction_date": str(today.replace(day=1))},
    )
    owner.post("/api/v1/billing-runs/", {"period": today.strftime("%Y-%m")})
    invoice = Invoice.objects.get(lease=lease)
    owner.post(
        "/api/v1/payments/",
        {
            "lease": str(lease.pk),
            "amount": str(invoice.total),
            "received_on": str(today),
            "method": "cash",
        },
    )
    nid = owner.post(
        "/api/v1/move-outs/", {"lease": str(lease.pk), "intended_date": str(today)}
    ).data["id"]
    body = {"moved_out_on": str(today), "unit_status": "available"}
    assert (
        owner.post(f"/api/v1/move-outs/{nid}/complete/", body).status_code == 409
    )  # refund method needed
    done = owner.post(f"/api/v1/move-outs/{nid}/complete/", {**body, "refund_method": "mpesa"})
    assert done.data["settlement"]["refund"] == "10000.00"
    assert Lease.objects.get(pk=lease.pk).status == "ended"
    assert Unit.objects.get(pk=lease.unit_id).status == "available"


# --- Portal ------------------------------------------------------------------------------------


@pytest.fixture
def portal(make_member, org_a):
    """Owner client, a lease, and an API client for the tenant's portal account."""
    from django.core import mail

    from .factories import UserFactory

    _, owner = make_member(org_a)
    lease = make_lease(org_a)
    owner.post("/api/v1/billing-runs/", {"period": "2026-08"})
    owner.post(f"/api/v1/tenants/{lease.tenant_id}/portal-invite/", {"email": "tenant@example.com"})
    token = mail.outbox[-1].body.split("/portal/join/")[1].split()[0]
    user = UserFactory(email="tenant@example.com")
    client = APIClient()
    client.force_authenticate(user)
    assert client.post("/api/v1/portal/invitations/accept/", {"token": token}).status_code == 200
    return owner, lease, client, user


@pytest.fixture(autouse=True)
def _run_on_commit(django_capture_on_commit_callbacks, monkeypatch):
    original = APIClient.generic

    def generic(self, *args, **kwargs):
        with django_capture_on_commit_callbacks(execute=True):
            return original(self, *args, **kwargs)

    monkeypatch.setattr(APIClient, "generic", generic)


def test_tenant_portal_shows_only_their_own_records(portal, make_member, org_a):
    owner, lease, client, user = portal
    other = make_lease(org_a)
    owner.post("/api/v1/billing-runs/", {"period": "2026-09"})
    base = f"/api/v1/portal/tenancies/{lease.tenant_id}"
    summary = client.get(base + "/").data
    assert summary["balance"] == "60000.00" and len(summary["leases"]) == 1
    invoices = client.get(base + "/invoices/").data
    assert {i["number"] for i in invoices} == set(
        Invoice.objects.filter(lease=lease).values_list("number", flat=True)
    )
    other_invoice = Invoice.objects.filter(lease=other).first()
    assert client.get(f"{base}/invoices/{other_invoice.pk}/").status_code == 404
    assert client.get(f"/api/v1/portal/tenancies/{other.tenant_id}/").status_code == 404
    assert client.get(f"{base}/leases/{other.pk}/statement/").status_code == 404
    # Tenants have no staff access at all.
    staff_api = APIClient(headers={"X-Organization-ID": str(org_a.pk)})
    staff_api.force_authenticate(user)
    assert staff_api.get("/api/v1/invoices/").status_code == 403
    assert staff_api.get("/api/v1/tenants/").status_code == 403


def test_tenant_reports_maintenance_and_never_sees_internal_notes(portal, make_member, org_a):
    owner, lease, client, user = portal
    base = f"/api/v1/portal/tenancies/{lease.tenant_id}"
    created = client.post(
        base + "/maintenance/",
        {
            "lease": str(lease.pk),
            "category": "plumbing",
            "title": "No water",
            "description": "Since morning",
            "urgency": "emergency",
        },
    )
    assert created.status_code == 201
    rid = created.data["id"]
    owner.post(
        f"/api/v1/maintenance/{rid}/notes/", {"body": "Tenant is behind on rent", "internal": True}
    )
    owner.post(f"/api/v1/maintenance/{rid}/notes/", {"body": "Plumber coming at 2pm"})
    owner.post(
        f"/api/v1/maintenance/{rid}/costs/",
        {"kind": "expense", "description": "Pump", "amount": "9000"},
    )
    detail = client.get(f"{base}/maintenance/{rid}/").data
    bodies = [u["body"] for u in detail["updates"]]
    assert "Plumber coming at 2pm" in bodies and "Tenant is behind on rent" not in bodies
    assert "costs" not in detail
    assert (
        client.post(
            f"{base}/maintenance/{rid}/", {"action": "message", "body": "Thanks!"}
        ).status_code
        == 200
    )
    staff_view = owner.get(f"/api/v1/maintenance/{rid}/").data
    assert any(u["from_tenant"] and u["body"] == "Thanks!" for u in staff_view["updates"])
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    from django.core.files.uploadedfile import SimpleUploadedFile

    photo = client.post(
        f"{base}/maintenance/{rid}/",
        {"action": "photo", "file": SimpleUploadedFile("leak.png", png)},
        format="multipart",
    )
    assert photo.status_code == 200 and len(photo.data["photos"]) == 1
    res = client.get(f"{base}/maintenance/{rid}/photos/{photo.data['photos'][0]['id']}/")
    assert res.status_code == 200 and b"".join(res.streaming_content) == png
    # Still "submitted" (notes don't change status), so the tenant may cancel it, once.
    cancelled = client.post(f"{base}/maintenance/{rid}/", {"action": "cancel"})
    assert cancelled.status_code == 200 and cancelled.data["status"] == "cancelled"
    assert client.post(f"{base}/maintenance/{rid}/", {"action": "cancel"}).status_code == 409
