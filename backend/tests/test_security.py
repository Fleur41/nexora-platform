"""Cross-cutting security checks (see docs/security-review.md)."""

import pytest
from django.test import RequestFactory
from rest_framework.throttling import AnonRateThrottle

from apps.core.net import client_ip

FORGED = {"HTTP_X_FORWARDED_FOR": "6.6.6.6, 203.0.113.9", "REMOTE_ADDR": "10.0.0.2"}


@pytest.mark.parametrize(
    ("proxies", "expected"),
    [(0, "10.0.0.2"), (1, "203.0.113.9"), (5, "6.6.6.6")],
)
def test_client_ip_trusts_only_the_configured_proxies(settings, proxies, expected):
    settings.NUM_PROXIES = proxies
    assert client_ip(RequestFactory().get("/", **FORGED)) == expected


def test_throttles_ignore_forwarded_for_without_trusted_proxies():
    # With NUM_PROXIES unset DRF would key throttles on the raw header, which clients control.
    request = RequestFactory().get("/", **FORGED)
    assert AnonRateThrottle().get_ident(request) == "10.0.0.2"


@pytest.mark.django_db
def test_platform_admin_sessions_are_short(client, settings):
    from .factories import UserFactory

    for admin in (False, True):
        user = UserFactory(is_platform_admin=admin)
        user.set_password("Pass-word-2026!")
        user.save()
        client.get("/api/v1/auth/csrf/")
        res = client.post(
            "/api/v1/auth/login/",
            {"email": user.email, "password": "Pass-word-2026!"},
            content_type="application/json",
        )
        assert res.status_code == 200
        expected = settings.PLATFORM_ADMIN_SESSION_AGE if admin else settings.SESSION_COOKIE_AGE
        assert client.session.get_expiry_age() == expected
        client.logout()
