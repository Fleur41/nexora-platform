import re
from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.organizations.models import Invitation, Membership
from apps.organizations.roles import Role

from .factories import UserFactory

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _commit_hooks(django_capture_on_commit_callbacks, monkeypatch):
    """Emails are queued with transaction.on_commit; run those hooks after each request."""
    original = APIClient.generic

    def generic(self, *args, **kwargs):
        with django_capture_on_commit_callbacks(execute=True):
            return original(self, *args, **kwargs)

    monkeypatch.setattr(APIClient, "generic", generic)


def _invite(client, email="new.staff@example.com", role="property_manager"):
    return client.post("/api/v1/invitations/", {"email": email, "role": role})


def _token_from_outbox(index=-1) -> str:
    return re.search(r"/invitations/([\w-]+)", mail.outbox[index].body).group(1)


def _client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def test_invitation_sends_email_and_stores_only_token_hash(make_member, org_a):
    _, client = make_member(org_a)
    res = _invite(client, email="New.Staff@Example.com")
    assert res.status_code == 201, res.data
    assert res.data["email"] == "new.staff@example.com"
    assert len(mail.outbox) == 1
    token = _token_from_outbox()
    invitation = Invitation.objects.get()
    assert token not in invitation.token_hash
    assert "token" not in res.data and "token_hash" not in res.data
    assert AuditLog.objects.filter(action="invitation.created", organization=org_a).exists()


def test_duplicate_pending_invitation_is_rejected(make_member, org_a):
    _, client = make_member(org_a)
    assert _invite(client).status_code == 201
    assert _invite(client, email="NEW.STAFF@example.com").status_code == 409


def test_cannot_invite_existing_member(make_member, org_a):
    _, client = make_member(org_a)
    existing, _ = make_member(org_a, role=Role.CARETAKER)
    assert _invite(client, email=existing.user.email).status_code == 409


def test_preview_and_accept_invitation(make_member, org_a):
    _, client = make_member(org_a)
    _invite(client)
    token = _token_from_outbox()

    preview = APIClient().post("/api/v1/invitations/preview/", {"token": token})
    assert preview.status_code == 200
    assert preview.data["organization_name"] == org_a.name
    assert preview.data["is_usable"] is True

    invitee = UserFactory(email="new.staff@example.com")
    res = _client_for(invitee).post("/api/v1/invitations/accept/", {"token": token})
    assert res.status_code == 200, res.data
    assert res.data["role"] == Role.PROPERTY_MANAGER
    assert Membership.objects.get(user=invitee, organization=org_a).status == "active"
    assert Invitation.objects.get().status == Invitation.Status.ACCEPTED

    again = _client_for(invitee).post("/api/v1/invitations/accept/", {"token": token})
    assert again.status_code == 409


def test_invitation_cannot_be_accepted_by_a_different_account(make_member, org_a):
    _, client = make_member(org_a)
    _invite(client)
    token = _token_from_outbox()
    intruder = UserFactory(email="intruder@example.com")
    res = _client_for(intruder).post("/api/v1/invitations/accept/", {"token": token})
    assert res.status_code == 409
    assert not Membership.objects.filter(user=intruder).exists()


def test_invalid_token_preview_is_404(api_client):
    assert api_client.post("/api/v1/invitations/preview/", {"token": "bogus"}).status_code == 404


def test_expired_invitation_cannot_be_accepted(make_member, org_a):
    _, client = make_member(org_a)
    _invite(client)
    token = _token_from_outbox()
    Invitation.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
    invitee = UserFactory(email="new.staff@example.com")
    assert (
        _client_for(invitee).post("/api/v1/invitations/accept/", {"token": token}).status_code
        == 409
    )
    # An expired invite does not block re-inviting the same person.
    assert _invite(client).status_code == 201


def test_revoked_invitation_cannot_be_accepted(make_member, org_a):
    _, client = make_member(org_a)
    invitation_id = _invite(client).data["id"]
    token = _token_from_outbox()
    assert client.post(f"/api/v1/invitations/{invitation_id}/revoke/").status_code == 200
    invitee = UserFactory(email="new.staff@example.com")
    assert (
        _client_for(invitee).post("/api/v1/invitations/accept/", {"token": token}).status_code
        == 409
    )


def test_resend_rotates_token(make_member, org_a):
    _, client = make_member(org_a)
    invitation_id = _invite(client).data["id"]
    old_token = _token_from_outbox()
    assert client.post(f"/api/v1/invitations/{invitation_id}/resend/").status_code == 200
    new_token = _token_from_outbox()
    assert new_token != old_token
    invitee = UserFactory(email="new.staff@example.com")
    c = _client_for(invitee)
    assert c.post("/api/v1/invitations/accept/", {"token": old_token}).status_code == 409
    assert c.post("/api/v1/invitations/accept/", {"token": new_token}).status_code == 200


def test_rejoining_after_removal_resets_custom_permissions(make_member, org_a):
    _, owner_client = make_member(org_a)
    former, _ = make_member(org_a, role=Role.CARETAKER, extra_permissions=["audit.view"])
    owner_client.delete(f"/api/v1/members/{former.pk}/")
    _invite(owner_client, email=former.user.email, role="caretaker")
    token = _token_from_outbox()
    res = _client_for(former.user).post("/api/v1/invitations/accept/", {"token": token})
    assert res.status_code == 200
    former.refresh_from_db()
    assert former.status == Membership.Status.ACTIVE
    assert former.extra_permissions == []
    assert AuditLog.objects.filter(action="membership.reactivated").exists()
