import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.organizations.models import Membership, Organization
from apps.organizations.roles import Role

pytestmark = pytest.mark.django_db


def test_creating_an_organization_makes_creator_owner_with_kenyan_defaults(api_client, user):
    api_client.force_authenticate(user)
    res = api_client.post("/api/v1/organizations/", {"name": "Kilimani Homes"})
    assert res.status_code == 201, res.data
    assert res.data["role"] == Role.OWNER
    assert res.data["organization"]["currency"] == "KES"
    assert res.data["organization"]["timezone"] == "Africa/Nairobi"
    assert "members.manage" in res.data["capabilities"]
    org = Organization.objects.get(pk=res.data["organization"]["id"])
    assert Membership.objects.get(organization=org).user == user
    assert set(AuditLog.objects.filter(organization=org).values_list("action", flat=True)) == {
        "organization.created",
        "membership.created",
    }


def test_slugs_are_unique(api_client, user):
    api_client.force_authenticate(user)
    a = api_client.post("/api/v1/organizations/", {"name": "Same Name"}).data
    b = api_client.post("/api/v1/organizations/", {"name": "Same Name"}).data
    assert a["organization"]["slug"] != b["organization"]["slug"]


def test_organization_validation(api_client, user):
    api_client.force_authenticate(user)
    res = api_client.post(
        "/api/v1/organizations/", {"name": "X", "timezone": "Mars/Base", "currency": "12"}
    )
    assert res.status_code == 400
    assert {"timezone", "currency"} <= set(res.data["error"]["details"])


def test_list_returns_only_my_active_organizations(make_member, org_a, org_b):
    mine, client = make_member(org_a)
    make_member(org_b)
    suspended = Organization.objects.create(name="S", slug="s", status="suspended")
    Membership.objects.create(organization=suspended, user=mine.user, role=Role.OWNER)
    res = client.get("/api/v1/organizations/")
    assert [o["organization"]["id"] for o in res.data] == [str(org_a.pk)]


def test_user_in_multiple_organizations_switches_with_header(make_member, org_a, org_b):
    membership_a, client = make_member(org_a, role=Role.OWNER)
    Membership.objects.create(organization=org_b, user=membership_a.user, role=Role.CARETAKER)

    res_a = client.get("/api/v1/organizations/current/")
    assert res_a.data["organization"]["id"] == str(org_a.pk)
    assert res_a.data["role"] == Role.OWNER

    res_b = client.get("/api/v1/organizations/current/", HTTP_X_ORGANIZATION_ID=str(org_b.pk))
    assert res_b.data["organization"]["id"] == str(org_b.pk)
    assert res_b.data["role"] == Role.CARETAKER
    # The caretaker role in org B does not inherit owner rights from org A.
    patch = client.patch(
        "/api/v1/organizations/current/", {"name": "Hijack"}, HTTP_X_ORGANIZATION_ID=str(org_b.pk)
    )
    assert patch.status_code == 403


def test_owner_updates_organization_and_change_is_audited(make_member, org_a):
    _, client = make_member(org_a)
    res = client.patch("/api/v1/organizations/current/", {"name": "Alpha Renamed", "phone": "0700"})
    assert res.status_code == 200
    log = AuditLog.objects.get(action="organization.updated")
    assert log.changes["name"] == {"from": "Alpha Properties", "to": "Alpha Renamed"}
    assert log.organization == org_a


def test_scoped_endpoint_requires_organization_header(user):
    client = APIClient()
    client.force_authenticate(user)
    res = client.get("/api/v1/organizations/current/")
    assert res.status_code == 403
    assert res.data["error"]["code"] == "organization_required"


def test_suspended_organization_blocks_access(make_member, org_a):
    _, client = make_member(org_a)
    org_a.status = Organization.Status.SUSPENDED
    org_a.save()
    assert client.get("/api/v1/organizations/current/").status_code == 403


def test_removed_member_loses_access(make_member, org_a):
    membership, client = make_member(org_a, role=Role.ACCOUNTANT)
    membership.status = Membership.Status.REMOVED
    membership.save()
    assert client.get("/api/v1/organizations/current/").status_code == 403
