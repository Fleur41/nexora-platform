from datetime import date, timedelta

import pytest
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.listings.models import Enquiry
from apps.notifications.models import Notification
from apps.organizations.roles import Role
from apps.properties.models import Unit

from .factories import LeaseFactory, PropertyFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def ok(res):
    assert 200 <= res.status_code < 300, getattr(res, "data", res)
    return res


def upload_photo(client, **target):
    return ok(
        client.post(
            "/api/v1/documents/",
            {
                "file": SimpleUploadedFile(
                    "photo.png", PNG, content_type="application/octet-stream"
                ),
                "category": "photo",
                **target,
            },
            format="multipart",
        )
    ).data


@pytest.fixture
def setup(make_member, org_a):
    owner, client = make_member(org_a)
    org_a.phone = "+254700111222"
    org_a.save()
    prop = PropertyFactory(organization=org_a, name="Riverside", town="Westlands", county="Nairobi")
    unit_type = UnitTypeFactory(property=prop, bedrooms=2, default_deposit=40000)
    unit = UnitFactory(unit_type=unit_type, number="R1", market_rent=40000)
    Unit.objects.filter(pk=unit.pk).update(status=Unit.Status.AVAILABLE)
    unit_photo = upload_photo(client, unit=str(unit.pk))
    property_photo = upload_photo(client, property=str(prop.pk))
    return {
        "owner": owner,
        "client": client,
        "org": org_a,
        "prop": prop,
        "unit": unit,
        "photos": [unit_photo["id"], property_photo["id"]],
    }


def publish(setup, **extra):
    return ok(
        setup["client"].post(
            "/api/v1/listings/",
            {
                "unit": str(setup["unit"].pk),
                "title": "Bright 2-bedroom in Westlands",
                "description": "Balcony, parking, borehole water.",
                "is_published": True,
                "photo_ids": setup["photos"],
                **extra,
            },
            format="json",
        )
    ).data


def test_published_listing_is_public_with_area_only_and_chosen_photos(setup):
    listing = publish(setup)
    assert listing["is_public"] is True and listing["hidden_reason"] == ""
    assert listing["public_url"].endswith(f"/listings/{listing['id']}")
    assert AuditLog.objects.filter(action="listing.published").exists()

    public = APIClient()
    results = ok(public.get("/api/v1/public/listings/")).data["results"]
    assert [r["id"] for r in results] == [listing["id"]]
    item = results[0]
    assert (item["rent"], item["deposit"], item["bedrooms"], item["town"]) == (
        "40000.00",
        "40000.00",
        2,
        "Westlands",
    )
    assert item["landlord"]["phone"] == "+254700111222"
    assert "address_line" not in item and "unit_number" not in item  # no street address in public
    photo = ok(public.get(item["photos"][0]["url"]))
    assert photo["Content-Type"] == "image/png"

    # A photo not chosen for the listing is never served publicly.
    other = upload_photo(setup["client"], unit=str(setup["unit"].pk))
    assert (
        public.get(f"/api/v1/public/listings/{listing['id']}/photos/{other['id']}/").status_code
        == 404
    )


def test_listing_is_hidden_while_the_unit_is_let_or_unpublished(setup):
    listing = publish(setup)
    LeaseFactory(unit=setup["unit"])  # marks the unit occupied
    public = APIClient()
    assert public.get("/api/v1/public/listings/").data["count"] == 0
    assert public.get(f"/api/v1/public/listings/{listing['id']}/").status_code == 404
    assert (
        public.get(
            f"/api/v1/public/listings/{listing['id']}/photos/{setup['photos'][0]}/"
        ).status_code
        == 404
    )
    staff = ok(setup["client"].get(f"/api/v1/listings/{listing['id']}/")).data
    assert staff["hidden_reason"] == "Hidden while the unit is occupied"

    Unit.objects.filter(pk=setup["unit"].pk).update(status=Unit.Status.AVAILABLE)
    ok(
        setup["client"].patch(
            f"/api/v1/listings/{listing['id']}/", {"is_published": False}, format="json"
        )
    )
    assert public.get("/api/v1/public/listings/").data["count"] == 0


def test_photos_must_belong_to_the_unit_or_its_property(setup, make_member, org_a):
    elsewhere = PropertyFactory(organization=org_a)
    stray = upload_photo(setup["client"], property=str(elsewhere.pk))
    res = setup["client"].post(
        "/api/v1/listings/",
        {"unit": str(setup["unit"].pk), "title": "X", "photo_ids": [stray["id"]]},
        format="json",
    )
    assert res.status_code == 409
    options = ok(
        setup["client"].get("/api/v1/listings/photo-options/", {"unit": str(setup["unit"].pk)})
    ).data
    assert {o["id"] for o in options} == set(setup["photos"])


def test_public_search_filters(setup):
    publish(setup)
    public = APIClient()
    count = lambda **q: public.get("/api/v1/public/listings/", q).data["count"]  # noqa: E731
    assert count(q="westlands") == 1
    assert count(max_rent="30000") == 0
    assert count(min_rent="30000", bedrooms="2") == 1
    assert count(bedrooms="3") == 0
    assert count(landlord=setup["org"].slug) == 1


def test_viewing_request_notifies_staff_and_confirms_by_email(
    setup, make_member, org_a, django_capture_on_commit_callbacks
):
    listing = publish(setup)
    _, caretaker_client = make_member(org_a, role=Role.CARETAKER)
    public = APIClient()
    url = f"/api/v1/public/listings/{listing['id']}/enquiries/"
    tomorrow = str(date.today() + timedelta(days=1))
    with django_capture_on_commit_callbacks(execute=True):  # emails go out after commit
        res = public.post(
            url,
            {
                "kind": "viewing",
                "name": "Amina Yusuf",
                "phone": "0722 333 444",
                "email": "amina@example.com",
                "preferred_date": tomorrow,
                "preferred_time": "evening",
                "message": "After work please",
            },
            format="json",
        )
    assert ok(res).data["reference"] == "ENQ-0001"
    enquiry = Enquiry.objects.get()
    assert (enquiry.kind, enquiry.status, enquiry.preferred_time) == ("viewing", "new", "evening")
    assert Notification.objects.filter(kind="enquiry", recipient_user=setup["owner"].user).exists()
    assert any("We received your viewing request" in m.subject for m in mail.outbox)
    # A viewing request needs a day; validation rejects junk phone numbers.
    assert (
        public.post(
            url, {"kind": "viewing", "name": "B", "phone": "0722333444"}, format="json"
        ).status_code
        == 409
    )
    assert (
        public.post(url, {"kind": "enquiry", "name": "B", "phone": "12"}, format="json").status_code
        == 400
    )


def test_honeypot_swallows_spam(setup):
    listing = publish(setup)
    res = APIClient().post(
        f"/api/v1/public/listings/{listing['id']}/enquiries/",
        {"kind": "enquiry", "name": "Bot", "phone": "0700000000", "website": "http://spam.example"},
        format="json",
    )
    assert res.status_code == 201 and res.data["reference"] is None
    assert not Enquiry.objects.exists()


def test_staff_book_a_viewing_and_close_the_enquiry(
    setup, make_member, org_a, django_capture_on_commit_callbacks
):
    listing = publish(setup)
    ok(
        APIClient().post(
            f"/api/v1/public/listings/{listing['id']}/enquiries/",
            {
                "kind": "enquiry",
                "name": "Amina",
                "phone": "0722333444",
                "email": "amina@example.com",
            },
            format="json",
        )
    )
    enquiry = Enquiry.objects.get()
    client = setup["client"]
    url = f"/api/v1/enquiries/{enquiry.pk}/"
    when = (timezone.now() + timedelta(days=2)).replace(microsecond=0).isoformat()
    with django_capture_on_commit_callbacks(execute=True):  # emails go out after commit
        res = client.patch(url, {"viewing_at": when, "staff_notes": "Called her"}, format="json")
    data = ok(res).data
    assert data["status"] == "viewing_booked" and data["handled_by_name"]
    assert any(m.subject.startswith("Viewing booked") for m in mail.outbox)
    assert (
        client.patch(url, {"status": "closed"}, format="json").status_code == 409
    )  # needs an outcome
    data = ok(client.patch(url, {"status": "closed", "outcome": "let"}, format="json")).data
    assert data["status"] == "closed"
    assert AuditLog.objects.filter(action="enquiry.updated").count() == 2

    # Caretakers can see enquiries but not change them; other organizations can't see them.
    _, caretaker = make_member(org_a, role=Role.CARETAKER)
    _, owner_b = make_member()
    assert caretaker.patch(url, {"staff_notes": "x"}, format="json").status_code == 403
    assert owner_b.get(url).status_code == 404
