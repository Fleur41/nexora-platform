"""Create a realistic SAMPLE organization for local development and demos.

    python manage.py seed_demo                      # create it (once)
    python manage.py seed_demo --owner-email me@x   # also make an existing account an owner
    python manage.py seed_demo --password X         # sample-account password (default Admin@123)

Everything is created through the same services the API uses, so invoices, payments, ledger
entries, deposits and audit events are exactly what real use would produce. All names, phone
numbers and codes are invented; the organization is labelled "(sample data)".

Refuses to run unless DEBUG is on (use --force to override deliberately). Posted financial
records are immutable by design, so there is no "reset": to start over locally, recreate the
database (`docker compose down -v && docker compose up -d db`).
"""

from __future__ import annotations

import random
import string
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import User
from apps.audit.services import record_event
from apps.billing import services as billing
from apps.billing.defaults import ensure_default_charge_types
from apps.billing.models import BillingSettings, ChargeRule, Invoice, SharedCost
from apps.deposits import services as deposits
from apps.leases import services as leases
from apps.leases.models import Lease
from apps.organizations.models import Membership, Organization, organization_today
from apps.organizations.roles import Role
from apps.organizations.services import create_organization
from apps.payments import services as payments
from apps.payments.models import Payment, PaymentConfiguration
from apps.properties import services as properties
from apps.properties.models import PropertyAssignment, Unit
from apps.tenants.models import Tenant
from apps.utilities import services as utilities

ORG_NAME = "Nexora Demo Homes (sample data)"
# Simple default for local testing only (the command refuses to run without DEBUG). Sample
# accounts are created directly, so the stricter sign-up password rules don't apply to them.
PASSWORD = "Admin@123"  # noqa: S105 - public sample-data password, dev only
STAFF = [
    ("owner", "Grace Wanjiku", Role.OWNER),
    ("manager", "Daniel Otieno", Role.PROPERTY_MANAGER),
    ("accountant", "Mercy Achieng", Role.ACCOUNTANT),
    ("caretaker", "Joseph Mutiso", Role.CARETAKER),
]
TENANTS = [
    "Achieng Otieno",
    "Brian Kiprotich",
    "Cynthia Wambui",
    "David Mwangi",
    "Esther Chebet",
    "Faith Njeri",
    "George Omondi",
    "Halima Abdi",
    "Ian Kamau",
    "Joyce Akinyi",
    "Kevin Mutua",
    "Lucy Wairimu",
    "Mohamed Hassan",
    "Nancy Atieno",
    "Peter Kariuki",
    "Rose Nyambura",
    "Samuel Kiptoo",
    "Teresia Muthoni",
    "Victor Ochieng",
    "Winnie Jepkosgei",
    "Yusuf Ali",
    "Zipporah Moraa",
]
# How each tenant tends to pay: share of the invoice paid, and days after the due date.
PROFILES = {
    "prompt": (Decimal("1"), (0, 4)),
    "late": (Decimal("1"), (8, 20)),
    "partial": (Decimal("0.7"), (1, 6)),
    "overpays": (None, (0, 3)),  # rounds up to the next 5,000
    "arrears": (Decimal("0"), (0, 0)),
}


@dataclass
class SeedRequest:
    """Minimal stand-in for an API request so services record the right actor."""

    user: User
    membership: Membership

    def __post_init__(self):
        self.organization = self.membership.organization
        self.META = {"REMOTE_ADDR": None, "HTTP_USER_AGENT": "seed_demo"}


def _months(start: date, end: date):
    current = start.replace(day=1)
    while current <= end:
        yield current
        current = (current + timedelta(days=32)).replace(day=1)


class Command(BaseCommand):
    help = "Create a sample organization with properties, tenants, leases, billing and payments."

    def add_arguments(self, parser):
        parser.add_argument("--owner-email", help="Also add this existing account as an owner.")
        parser.add_argument("--force", action="store_true", help="Run even when DEBUG is off.")
        parser.add_argument(
            "--password",
            default=PASSWORD,
            help=f"Password for the sample accounts (default {PASSWORD}).",
        )

    def handle(self, *args, **options):
        if not settings.DEBUG and not options["force"]:
            raise CommandError(
                "seed_demo creates sample data; it only runs with DEBUG on (or --force)."
            )
        self.password = options["password"]
        existing = Organization.objects.filter(name=ORG_NAME).first()
        if existing:
            for key, name, _ in STAFF:
                self._user(key, name)  # resets sample passwords to the chosen one
            self._attach_owner(existing, options.get("owner_email"))
            self.stdout.write(
                self.style.WARNING(f"{ORG_NAME} already exists; nothing new created.")
            )
            self._print_logins()
            return
        self.rng = random.Random(2026)  # noqa: S311 - deterministic sample data, not security
        with transaction.atomic():
            self._seed(options.get("owner_email"))
        self._print_logins()

    # --- helpers --------------------------------------------------------------------

    def _code(self, prefix="T", length=8) -> str:
        return prefix + "".join(self.rng.choices(string.ascii_uppercase + string.digits, k=length))

    def _phone(self) -> str:
        return f"+2547{self.rng.randint(10, 99)}{self.rng.randint(100000, 999999)}"

    def _user(self, key: str, name: str) -> User:
        email = f"demo-{key}@nexora.test"
        user = User.objects.filter(email=email).first()
        if user is None:
            return User.objects.create_user(email=email, password=self.password, full_name=name)
        if not user.check_password(self.password):
            user.set_password(self.password)
            user.save(update_fields=["password"])
        return user

    def _attach_owner(self, organization, email):
        if not email:
            return
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            raise CommandError(f"No account with email {email}. Register it first.")
        Membership.objects.update_or_create(
            organization=organization,
            user=user,
            defaults={"role": Role.OWNER, "status": Membership.Status.ACTIVE},
        )
        self.stdout.write(self.style.SUCCESS(f"{email} is now an owner of {organization.name}."))

    def _print_logins(self):
        self.stdout.write(f"\nSample logins (password for all: {self.password})")
        for key, name, role in STAFF:
            self.stdout.write(f"  {Role(role).label:<26} demo-{key}@nexora.test  ({name})")

    # --- the seed ------------------------------------------------------------------------

    def _seed(self, owner_email):
        owner = self._user("owner", "Grace Wanjiku")
        org = create_organization(
            request=type("R", (), {"user": owner, "META": {}, "organization": None})(),
            user=owner,
            name=ORG_NAME,
            legal_name="Nexora Demo Homes Ltd (sample)",
            email="hello@demo-homes.test",
            phone="+254700000000",
            address="Kilimani, Nairobi",
        )
        owner_membership = Membership.objects.get(organization=org, user=owner)
        request = SeedRequest(owner, owner_membership)
        today = organization_today(org)
        self.stdout.write(f"Creating {ORG_NAME} …")

        # Team
        members = {}
        for key, name, role in STAFF[1:]:
            members[key] = Membership.objects.create(
                organization=org, user=self._user(key, name), role=role, invited_by=owner
            )
        self._attach_owner(org, owner_email)

        # Properties, unit types and units
        layout = [
            (
                "Kilimani Heights",
                "Kilimani",
                "Nairobi",
                ["Gym", "Lift", "Backup generator", "CCTV", "Parking"],
                [
                    ("One bedroom", "one_bedroom", 1, "25000", "A", 6),
                    ("Two bedroom", "two_bedroom", 2, "38000", "B", 4),
                ],
            ),
            (
                "Ruaka Gardens",
                "Ruaka",
                "Kiambu",
                ["Borehole", "Gated", "Parking"],
                [
                    ("Bedsitter", "bedsitter", 0, "9500", "R", 8),
                    ("Studio", "studio", 0, "14000", "S", 4),
                ],
            ),
            (
                "Nyali Breeze Apartments",
                "Nyali",
                "Mombasa",
                ["Swimming pool", "Sea view", "Backup generator"],
                [("Three bedroom", "three_bedroom", 3, "65000", "N", 4)],
            ),
        ]
        props = []
        for name, town, county, amenities, types in layout:
            prop = properties.create_property(
                request=request,
                organization=org,
                name=name,
                town=town,
                county=county,
                address_line=f"{town} Road",
                amenities=amenities,
                description=f"Sample property in {town}, {county}. All data here is invented.",
            )
            for type_name, category, beds, rent, prefix, count in types:
                unit_type = properties.create_unit_type(
                    request=request,
                    organization=org,
                    property=prop,
                    name=type_name,
                    category=category,
                    bedrooms=beds,
                    bathrooms=max(1, beds),
                    default_rent=Decimal(rent),
                    default_deposit=Decimal(rent),
                )
                properties.bulk_create_units(
                    request=request,
                    organization=org,
                    property=prop,
                    unit_type=unit_type,
                    prefix=prefix,
                    start=1,
                    count=count,
                    floor="",
                )
            props.append(prop)
        kilimani, ruaka, nyali = props
        PropertyAssignment.objects.create(
            organization=org, property=kilimani, membership=members["manager"], assigned_by=owner
        )
        PropertyAssignment.objects.create(
            organization=org, property=ruaka, membership=members["caretaker"], assigned_by=owner
        )

        # Payment methods (the landlord's own; not connected to Daraja)
        paybill = PaymentConfiguration.objects.create(
            organization=org,
            provider="mpesa_paybill",
            display_name="Rent paybill",
            shortcode="522533",
            account_reference_hint="Your lease number (e.g. LSE0001)",
            created_by=owner,
            instructions="Use your lease number as the account number.",
        )
        bank = PaymentConfiguration.objects.create(
            organization=org,
            provider="bank",
            display_name="Equity Bank account",
            bank_name="Equity Bank",
            bank_branch="Kilimani",
            account_name="Nexora Demo Homes Ltd",
            account_number="0170299887766",
            created_by=owner,
        )
        PaymentConfiguration.objects.create(
            organization=org,
            provider="mpesa_till",
            display_name="Nyali till",
            shortcode="884422",
            property=nyali,
            created_by=owner,
            instructions="Nyali residents: pay to the till.",
        )
        PaymentConfiguration.objects.create(
            organization=org, provider="cash", display_name="Cash at the office", created_by=owner
        )

        # Charges: optional services, overrides, metering and sharing
        types = {ct.code: ct for ct in ensure_default_charge_types(org)}
        since = date(today.year, 1, 1)

        def rule(**kw):
            return billing.create_rule(
                request=request, organization=org, effective_from=since, **kw
            )  # noqa: E731
            rule(
                charge_type=types["security"],
                scope="organization",
                method="fixed_monthly",
                amount=Decimal("1500"),
            )

        rule(
            charge_type=types["garbage"],
            scope="property",
            property=ruaka,
            method="fixed_monthly",
            amount=Decimal("300"),
        )
        rule(
            charge_type=types["water"],
            scope="property",
            property=kilimani,
            method="metered",
            amount=Decimal("150"),
            usage_unit="m³",
        )
        rule(
            charge_type=types["water"],
            scope="property",
            property=nyali,
            method="fixed_monthly",
            amount=Decimal("1000"),
            included_in_rent=True,
        )
        rule(
            charge_type=types["shared_electricity"],
            scope="property",
            property=nyali,
            method="shared",
            amount=Decimal("0"),
        )
        units = {u.number: u for u in Unit.objects.filter(organization=org)}
        rule(
            charge_type=types["security"],
            scope="unit",
            unit=units["N4"],
            method="fixed_monthly",
            amount=Decimal("0"),
            is_enabled=False,
            description="Owner's relative: no security charge",
        )
        rule(
            charge_type=types["parking"],
            scope="unit",
            unit=units["B1"],
            method="fixed_monthly",
            amount=Decimal("2000"),
        )
        BillingSettings.objects.update_or_create(
            organization=org, defaults={"auto_generate": False, "generate_day": 1}
        )

        # Tenants and leases
        start_window = [
            date(today.year, m, 1) for m in range(max(1, today.month - 7), today.month - 1)
        ]
        occupied = [
            "A1",
            "A2",
            "A3",
            "A4",
            "A5",
            "B1",
            "B2",
            "B3",
            "R1",
            "R2",
            "R3",
            "R4",
            "R5",
            "R6",
            "R7",
            "S1",
            "S2",
            "S3",
            "N1",
            "N2",
            "N3",
        ]
        profiles = (
            (["prompt"] * 11)
            + (["late"] * 3)
            + (["partial"] * 3)
            + (["overpays"] * 2)
            + (["arrears"] * 2)
        )
        self.rng.shuffle(profiles)
        leases_by_profile = {}
        all_leases = []
        for index, number in enumerate(occupied):
            unit = units[number]
            name = TENANTS[index]
            tenant = Tenant.objects.create(
                organization=org,
                full_name=name,
                phone=self._phone(),
                email=f"{name.split()[0].lower()}.{name.split()[1].lower()}@example.com",
                id_number=str(20000000 + index * 7919),
                occupation=self.rng.choice(
                    [
                        "Teacher",
                        "Nurse",
                        "Software developer",
                        "Accountant",
                        "Business owner",
                        "Engineer",
                    ]
                ),
                emergency_contact_name="Next of kin (sample)",
                emergency_contact_phone=self._phone(),
                created_by=owner,
            )
            start = self.rng.choice(start_window)
            deposit = unit.market_rent if index % 3 else Decimal("0")
            lease = leases.create_lease(
                request=request,
                organization=org,
                tenant=tenant,
                unit=unit,
                start_date=start,
                monthly_rent=unit.market_rent,
                deposit_amount=deposit,
                rent_due_day=5,
                end_date=date(start.year + 1, start.month, 1) - timedelta(days=1)
                if index % 4 == 0
                else None,
                activate=True,
            )
            if deposit:
                deposits.record(
                    request=request,
                    lease=lease,
                    kind="received",
                    amount=deposit,
                    transaction_date=start,
                    method="mpesa",
                    reference=self._code("SD"),
                )
            leases_by_profile[lease.pk] = profiles[index]
            all_leases.append(lease)

        # One tenant moving out at the end of last month (handled after billing below)
        leaving = all_leases[8]
        # A draft lease and a lease starting next month
        spare_tenant = Tenant.objects.create(
            organization=org, full_name=TENANTS[-1], phone=self._phone(), created_by=owner
        )
        leases.create_lease(
            request=request,
            organization=org,
            tenant=spare_tenant,
            unit=units["S4"],
            start_date=today.replace(day=1) + timedelta(days=35),
            monthly_rent=Decimal("14000"),
            deposit_amount=Decimal("14000"),
        )
        future_tenant = Tenant.objects.create(
            organization=org, full_name=TENANTS[-2], phone=self._phone(), created_by=owner
        )
        next_month = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
        leases.create_lease(
            request=request,
            organization=org,
            tenant=future_tenant,
            unit=units["R8"],
            start_date=next_month,
            monthly_rent=Decimal("9500"),
            deposit_amount=Decimal("9500"),
            activate=True,
        )
        properties.set_unit_status(
            request=request, unit=units["A6"], status="under_maintenance", reason="Repainting"
        )
        properties.set_unit_status(
            request=request, unit=units["N4"], status="unavailable", reason="Owner's use"
        )
        leases.add_rent_term(
            request=request,
            lease=all_leases[0],
            effective_from=date(today.year + 1, 1, 1),
            monthly_rent=all_leases[0].rent_terms.first().monthly_rent + Decimal("2000"),
            note="Annual review",
        )

        # Water meters on Kilimani units with monthly readings
        meters = {}
        for lease in all_leases:
            if lease.unit.property_id == kilimani.pk:
                meters[lease.pk] = utilities.create_meter(
                    request=request,
                    organization=org,
                    unit=lease.unit,
                    utility="water",
                    number=f"W-{lease.unit.number}",
                )

        # Month by month: readings, shared costs, billing, then payments as they'd have happened
        first_month = min(lease.start_date for lease in all_leases)
        readings = {pk: Decimal(self.rng.randint(100, 400)) for pk in meters}
        for month in _months(first_month, today):
            for pk, meter in meters.items():
                lease = next(item for item in all_leases if item.pk == pk)
                if lease.start_date <= month <= today:
                    readings[pk] += (
                        Decimal(self.rng.randint(6, 18)) if month > lease.start_date else 0
                    )
                    utilities.record_reading(
                        request=request, meter=meter, reading_date=month, value=readings[pk]
                    )
            if month < today.replace(day=1) or today.day >= 3:
                SharedCost.objects.get_or_create(
                    organization=org,
                    property=nyali,
                    charge_type=types["shared_electricity"],
                    period=month,
                    defaults={
                        "total_amount": Decimal(self.rng.randint(5000, 9000)),
                        "description": "KPLC common areas (sample)",
                        "created_by": owner,
                    },
                )
            result = billing.run_billing(
                request=request, organization=org, month=month, issue_date=month
            )
            for invoice in result.invoices:
                self._pay(
                    request,
                    org,
                    invoice,
                    leases_by_profile.get(invoice.lease_id, "prompt"),
                    paybill,
                    bank,
                    today,
                    month,
                )

        # The leaving tenant moved out on the last day of last month.
        last_day_prev = today.replace(day=1) - timedelta(days=1)
        leaving.refresh_from_db()
        if leaving.status == Lease.Status.ACTIVE and leaving.start_date < last_day_prev:
            leases.end_lease(
                request=request,
                lease=leaving,
                ended_on=last_day_prev,
                unit_status="awaiting_inspection",
                reason="Relocating for work (sample)",
            )
            summary = deposits.summarize(leaving)
            if summary.held > 0:
                deposits.record(
                    request=request,
                    lease=leaving,
                    kind="deduction",
                    amount=Decimal("3000"),
                    transaction_date=today,
                    reason="Repainting and cleaning (sample)",
                )
                deposits.record(
                    request=request,
                    lease=leaving,
                    kind="refund",
                    amount=summary.held - Decimal("3000"),
                    transaction_date=today,
                    method="mpesa",
                    reference=self._code("RF"),
                    reason="Balance of deposit",
                )

        # Two payments nobody could match (typos in the M-Pesa account number)
        for amount, account in ((Decimal("9500"), "R 12"), (Decimal("25000"), "KILIMANI")):
            code = self._code("TJ")
            payments.record_payment(
                request=request,
                organization=org,
                amount=amount,
                received_on=today - timedelta(days=2),
                method="mpesa",
                configuration=paybill,
                reference=code,
                external_id=code,
                payer_name="Unknown payer (sample)",
                payer_phone="2547••••123",
                account_reference=account,
                source=Payment.Source.MPESA_C2B,
            )

        record_event(
            request,
            "demo.seeded",
            target=org,
            metadata={"note": "Sample data created by seed_demo"},
        )
        counts = {
            "properties": len(props),
            "units": Unit.objects.filter(organization=org).count(),
            "tenants": Tenant.objects.filter(organization=org).count(),
            "leases": Lease.objects.filter(organization=org).count(),
            "charge rules": ChargeRule.objects.filter(organization=org).count(),
            "invoices": Invoice.objects.filter(organization=org).count(),
            "payments": Payment.objects.filter(organization=org).count(),
        }
        self.stdout.write(
            self.style.SUCCESS("Created: " + ", ".join(f"{v} {k}" for k, v in counts.items()))
        )

    def _pay(self, request, org, invoice, profile, paybill, bank, today, month):
        share, (low, high) = PROFILES[profile]
        if profile == "arrears" and month < (today.replace(day=1) - timedelta(days=62)):
            share = Decimal("1")  # paid fine until the last couple of months
        if share == 0:
            return
        if share is None:
            amount = ((invoice.total // 5000) + 1) * 5000
        else:
            amount = (invoice.total * share).quantize(Decimal("1"))
        received = invoice.due_date + timedelta(days=self.rng.randint(low, high))
        if received > today or amount <= 0:
            return
        roll = self.rng.random()
        if roll < 0.7:
            config, method, reference = paybill, "mpesa", self._code("S")
        elif roll < 0.9:
            config, method, reference = bank, "bank", self._code("FT", 6)
        else:
            config, method, reference = None, "cash", ""
        payments.record_payment(
            request=request,
            organization=org,
            amount=amount,
            received_on=received,
            method=method,
            lease=invoice.lease,
            configuration=config,
            reference=reference,
            payer_name=invoice.tenant.full_name,
            payer_phone=invoice.tenant.phone,
        )
