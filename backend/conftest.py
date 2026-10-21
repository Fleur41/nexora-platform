import pytest
from rest_framework.test import APIClient

from apps.organizations.roles import Role
from tests.factories import MembershipFactory, OrganizationFactory, UserFactory


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def make_member():
    """Create a user with a membership; returns (membership, client authenticated as them)."""

    def _make(organization=None, role=Role.OWNER, **membership_kwargs):
        organization = organization or OrganizationFactory()
        membership = MembershipFactory(organization=organization, role=role, **membership_kwargs)
        # Default header (overridable per request) selects the active organization.
        client = APIClient(headers={"X-Organization-ID": str(organization.pk)})
        client.force_authenticate(membership.user)
        return membership, client

    return _make


@pytest.fixture
def org_a():
    return OrganizationFactory(name="Alpha Properties")


@pytest.fixture
def org_b():
    return OrganizationFactory(name="Beta Estates")


@pytest.fixture
def user():
    return UserFactory()
