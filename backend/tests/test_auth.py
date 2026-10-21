import re

import pytest
from django.core import mail
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.audit.models import AuditLog

from .factories import TEST_PASSWORD, UserFactory

pytestmark = pytest.mark.django_db

STRONG = "Nexora-strong-pass-2026"


def test_register_creates_user_and_starts_session(api_client):
    res = api_client.post(
        "/api/v1/auth/register/",
        {"full_name": "Jane Wanjiku", "email": "Jane@Example.com", "password": STRONG},
    )
    assert res.status_code == 201, res.data
    assert res.data["email"] == "jane@example.com"
    assert "password" not in res.data
    assert api_client.get("/api/v1/auth/me/").status_code == 200
    assert AuditLog.objects.filter(action="user.registered").exists()


def test_register_rejects_duplicate_email_case_insensitively(api_client):
    UserFactory(email="owner@example.com")
    res = api_client.post(
        "/api/v1/auth/register/",
        {"full_name": "X", "email": "OWNER@example.com", "password": STRONG},
    )
    assert res.status_code == 400
    assert "email" in res.data["error"]["details"]


def test_register_rejects_weak_password_on_password_field(api_client):
    res = api_client.post(
        "/api/v1/auth/register/",
        {"full_name": "X", "email": "x@example.com", "password": "12345678"},
    )
    assert res.status_code == 400
    assert "password" in res.data["error"]["details"]


def test_login_success_and_uniform_failure_messages(api_client):
    UserFactory(email="a@example.com")
    ok = api_client.post(
        "/api/v1/auth/login/", {"email": "A@example.com", "password": TEST_PASSWORD}
    )
    assert ok.status_code == 200

    other = APIClient()
    wrong_pw = other.post("/api/v1/auth/login/", {"email": "a@example.com", "password": "nope"})
    no_user = other.post("/api/v1/auth/login/", {"email": "ghost@example.com", "password": "nope"})
    assert wrong_pw.status_code == no_user.status_code
    assert wrong_pw.data["error"]["message"] == no_user.data["error"]["message"]


def test_inactive_user_cannot_login(api_client):
    UserFactory(email="gone@example.com", is_active=False)
    res = api_client.post(
        "/api/v1/auth/login/", {"email": "gone@example.com", "password": TEST_PASSWORD}
    )
    assert res.status_code in (401, 403)


def test_me_requires_authentication(api_client):
    res = api_client.get("/api/v1/auth/me/")
    assert res.status_code in (401, 403)
    assert "error" in res.data


def test_me_cannot_change_email_or_platform_flag(api_client, user):
    api_client.force_authenticate(user)
    res = api_client.patch(
        "/api/v1/auth/me/",
        {"full_name": "New Name", "email": "evil@example.com", "is_platform_admin": True},
    )
    assert res.status_code == 200
    user.refresh_from_db()
    assert user.full_name == "New Name"
    assert user.email != "evil@example.com"
    assert user.is_platform_admin is False


def test_csrf_is_enforced_for_session_authenticated_requests():
    UserFactory(email="csrf@example.com")
    client = APIClient(enforce_csrf_checks=True)
    client.get("/api/v1/auth/csrf/")
    token = client.cookies["nexora_csrftoken"].value
    login = client.post(
        "/api/v1/auth/login/",
        {"email": "csrf@example.com", "password": TEST_PASSWORD},
        HTTP_X_CSRFTOKEN=token,
    )
    assert login.status_code == 200
    # Without the token, an unsafe request on the authenticated session is refused.
    no_token = client.post("/api/v1/organizations/", {"name": "Org"})
    assert no_token.status_code == 403
    token = client.cookies["nexora_csrftoken"].value  # rotated on login
    with_token = client.post("/api/v1/organizations/", {"name": "Org"}, HTTP_X_CSRFTOKEN=token)
    assert with_token.status_code == 201


def test_logout_ends_session(api_client):
    UserFactory(email="b@example.com")
    api_client.post("/api/v1/auth/login/", {"email": "b@example.com", "password": TEST_PASSWORD})
    assert api_client.post("/api/v1/auth/logout/").status_code == 204
    assert api_client.get("/api/v1/auth/me/").status_code in (401, 403)


def test_password_change_requires_current_password(api_client, user):
    api_client.force_authenticate(user)
    bad = api_client.post(
        "/api/v1/auth/password/change/", {"current_password": "wrong", "new_password": STRONG}
    )
    assert bad.status_code == 400
    ok = api_client.post(
        "/api/v1/auth/password/change/",
        {"current_password": TEST_PASSWORD, "new_password": STRONG},
    )
    assert ok.status_code == 204
    user.refresh_from_db()
    assert user.check_password(STRONG)


def test_password_reset_flow(api_client):
    user = UserFactory(email="reset@example.com")
    res = api_client.post("/api/v1/auth/password/reset/", {"email": "reset@example.com"})
    assert res.status_code == 202
    assert len(mail.outbox) == 1
    match = re.search(r"uid=([^&\s]+)&token=([^\s]+)", mail.outbox[0].body)
    uid, token = match.groups()

    confirm = api_client.post(
        "/api/v1/auth/password/reset/confirm/",
        {"uid": uid, "token": token, "new_password": STRONG},
    )
    assert confirm.status_code == 204
    user.refresh_from_db()
    assert user.check_password(STRONG)

    reused = api_client.post(
        "/api/v1/auth/password/reset/confirm/",
        {"uid": uid, "token": token, "new_password": "Another-strong-pass-1"},
    )
    assert reused.status_code == 400


def test_password_reset_does_not_reveal_unknown_emails(api_client):
    res = api_client.post("/api/v1/auth/password/reset/", {"email": "nobody@example.com"})
    assert res.status_code == 202
    assert len(mail.outbox) == 0


def test_user_emails_are_stored_lowercase():
    u = User.objects.create_user(email="MiXeD@Example.COM", password=STRONG, full_name="M")
    assert u.email == "mixed@example.com"
