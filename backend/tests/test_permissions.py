import pytest

from apps.core.modules import registry
from apps.organizations.models import Membership
from apps.organizations.roles import Role

pytestmark = pytest.mark.django_db


def test_owner_holds_every_registered_capability(make_member):
    owner, _ = make_member(role=Role.OWNER)
    assert owner.capabilities == {c.key for c in registry.capabilities()}


def test_owner_capabilities_cannot_be_revoked(make_member):
    owner, _ = make_member(role=Role.OWNER, revoked_permissions=["members.manage"])
    assert owner.has_capability("members.manage")


def test_caretaker_cannot_view_team_or_audit(make_member):
    _, client = make_member(role=Role.CARETAKER)
    assert client.get("/api/v1/members/").status_code == 403
    assert client.get("/api/v1/audit-logs/").status_code == 403
    assert client.get("/api/v1/organizations/current/").status_code == 200


def test_property_manager_can_view_but_not_manage_team(make_member, org_a):
    _, client = make_member(org_a, role=Role.PROPERTY_MANAGER)
    assert client.get("/api/v1/members/").status_code == 200
    res = client.post("/api/v1/invitations/", {"email": "n@example.com", "role": "caretaker"})
    assert res.status_code == 403
    assert res.data["error"]["code"] == "missing_capability"
    assert res.data["error"]["message"] == "Your role does not allow this action."
    assert client.patch("/api/v1/organizations/current/", {"name": "X"}).status_code == 403


def test_accountant_cannot_change_security_settings(make_member, org_a):
    _, client = make_member(org_a, role=Role.ACCOUNTANT)
    owner, _ = make_member(org_a, role=Role.OWNER)
    assert client.patch(f"/api/v1/members/{owner.pk}/", {"role": "caretaker"}).status_code == 403
    assert client.patch("/api/v1/organizations/current/", {"name": "X"}).status_code == 403


def test_revoked_permission_is_enforced(make_member, org_a):
    _, client = make_member(org_a, role=Role.PROPERTY_MANAGER, revoked_permissions=["members.view"])
    assert client.get("/api/v1/members/").status_code == 403


def test_extra_permission_is_enforced(make_member, org_a):
    _, client = make_member(org_a, role=Role.CARETAKER, extra_permissions=["members.view"])
    assert client.get("/api/v1/members/").status_code == 200


class TestPrivilegeEscalation:
    @pytest.fixture
    def delegated_manager(self, make_member, org_a):
        # A non-owner who has been delegated members.manage.
        return make_member(org_a, role=Role.PROPERTY_MANAGER, extra_permissions=["members.manage"])

    def test_cannot_grant_owner_role(self, delegated_manager, make_member, org_a):
        _, client = delegated_manager
        target, _ = make_member(org_a, role=Role.CARETAKER)
        assert client.patch(f"/api/v1/members/{target.pk}/", {"role": "owner"}).status_code == 409
        res = client.post("/api/v1/invitations/", {"email": "o@example.com", "role": "owner"})
        assert res.status_code == 409

    def test_cannot_modify_or_remove_an_owner(self, delegated_manager, make_member, org_a):
        _, client = delegated_manager
        owner, _ = make_member(org_a, role=Role.OWNER)
        assert (
            client.patch(f"/api/v1/members/{owner.pk}/", {"role": "caretaker"}).status_code == 409
        )
        assert client.delete(f"/api/v1/members/{owner.pk}/").status_code == 409

    def test_cannot_change_own_permissions(self, delegated_manager):
        me, client = delegated_manager
        res = client.patch(f"/api/v1/members/{me.pk}/", {"extra_permissions": ["audit.view"]})
        assert res.status_code == 409

    def test_cannot_grant_capabilities_they_do_not_hold(
        self, delegated_manager, make_member, org_a
    ):
        _, client = delegated_manager
        target, _ = make_member(org_a, role=Role.CARETAKER)
        res = client.patch(f"/api/v1/members/{target.pk}/", {"extra_permissions": ["audit.view"]})
        assert res.status_code == 409
        ok = client.patch(f"/api/v1/members/{target.pk}/", {"extra_permissions": ["members.view"]})
        assert ok.status_code == 200


def test_unknown_capabilities_are_rejected(make_member, org_a):
    _, client = make_member(org_a)
    target, _ = make_member(org_a, role=Role.CARETAKER)
    res = client.patch(f"/api/v1/members/{target.pk}/", {"extra_permissions": ["god.mode"]})
    assert res.status_code == 409


def test_last_owner_cannot_be_demoted_or_removed(make_member, org_a):
    owner, client = make_member(org_a)
    assert client.patch(f"/api/v1/members/{owner.pk}/", {"role": "caretaker"}).status_code == 409
    assert client.delete(f"/api/v1/members/{owner.pk}/").status_code == 409
    second, _ = make_member(org_a, role=Role.OWNER)
    assert client.patch(f"/api/v1/members/{second.pk}/", {"role": "accountant"}).status_code == 200


def test_owner_removes_member_softly(make_member, org_a):
    _, client = make_member(org_a)
    target, target_client = make_member(org_a, role=Role.CARETAKER)
    assert client.delete(f"/api/v1/members/{target.pk}/").status_code == 204
    target.refresh_from_db()
    assert target.status == Membership.Status.REMOVED
    assert target_client.get("/api/v1/organizations/current/").status_code == 403
    listed = client.get("/api/v1/members/").data["results"]
    assert str(target.pk) not in {m["id"] for m in listed}


def test_capability_catalog_lists_roles_and_capabilities(make_member):
    _, client = make_member()
    res = client.get("/api/v1/permissions/catalog/")
    assert res.status_code == 200
    roles = {r["key"]: r for r in res.data["roles"]}
    assert set(roles) == set(Role.values)
    assert "members.view" in roles["property_manager"]["default_capabilities"]
