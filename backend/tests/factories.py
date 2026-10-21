import factory

from apps.accounts.models import User
from apps.organizations.models import Membership, Organization
from apps.organizations.roles import Role

TEST_PASSWORD = "Str0ng-test-passphrase!"


class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User
        skip_postgeneration_save = True

    email = factory.Sequence(lambda n: f"user{n}@example.com")
    full_name = factory.Faker("name")
    password = factory.PostGenerationMethodCall("set_password", TEST_PASSWORD)

    @factory.post_generation
    def _save(obj, create, extracted, **kwargs):  # noqa: N805
        if create:
            obj.save()


class OrganizationFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Organization

    name = factory.Sequence(lambda n: f"Landlord Org {n}")
    slug = factory.Sequence(lambda n: f"landlord-org-{n}")


class MembershipFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Membership

    organization = factory.SubFactory(OrganizationFactory)
    user = factory.SubFactory(UserFactory)
    role = Role.OWNER
