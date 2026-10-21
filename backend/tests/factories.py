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


# --- Property module --------------------------------------------------------

from decimal import Decimal  # noqa: E402

from apps.leases.models import Lease, LeaseRentTerm  # noqa: E402
from apps.properties.models import Property, Unit, UnitType  # noqa: E402
from apps.tenants.models import Tenant  # noqa: E402


class PropertyFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Property

    organization = factory.SubFactory(OrganizationFactory)
    name = factory.Sequence(lambda n: f"Riverside Court {n}")
    reference = factory.Sequence(lambda n: f"PRP-T{n:04d}")
    slug = factory.Sequence(lambda n: f"riverside-court-{n}")
    town = "Nairobi"
    county = "Nairobi"


class UnitTypeFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = UnitType

    property = factory.SubFactory(PropertyFactory)
    organization = factory.SelfAttribute("property.organization")
    name = factory.Sequence(lambda n: f"Two bedroom {n}")
    category = UnitType.Category.TWO_BEDROOM
    bedrooms = 2
    default_rent = Decimal("25000.00")
    default_deposit = Decimal("25000.00")


class UnitFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Unit

    unit_type = factory.SubFactory(UnitTypeFactory)
    property = factory.SelfAttribute("unit_type.property")
    organization = factory.SelfAttribute("unit_type.organization")
    number = factory.Sequence(lambda n: f"A{n}")
    market_rent = factory.SelfAttribute("unit_type.default_rent")


class TenantFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Tenant

    organization = factory.SubFactory(OrganizationFactory)
    full_name = factory.Faker("name")
    phone = factory.Sequence(lambda n: f"+2547{n:08d}")
    id_number = factory.Sequence(lambda n: f"{30000000 + n}")


class LeaseFactory(factory.django.DjangoModelFactory):
    """An active lease with an initial rent term (the unit is marked occupied)."""

    class Meta:
        model = Lease
        skip_postgeneration_save = True

    unit = factory.SubFactory(UnitFactory)
    organization = factory.SelfAttribute("unit.organization")
    tenant = factory.SubFactory(TenantFactory, organization=factory.SelfAttribute("..organization"))
    reference = factory.Sequence(lambda n: f"LSE-T{n:04d}")
    status = Lease.Status.ACTIVE
    start_date = factory.Faker("date_between", start_date="-300d", end_date="-30d")

    @factory.post_generation
    def rent(obj, create, extracted, **kwargs):  # noqa: N805
        if not create:
            return
        LeaseRentTerm.objects.create(
            lease=obj, effective_from=obj.start_date, monthly_rent=extracted or Decimal("25000")
        )
        if obj.status == Lease.Status.ACTIVE:
            Unit.objects.filter(pk=obj.unit_id).update(status=Unit.Status.OCCUPIED)
