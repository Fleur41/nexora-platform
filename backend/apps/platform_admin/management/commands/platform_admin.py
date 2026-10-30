"""Grant or revoke access to the platform console.

    python manage.py platform_admin ops@nexora.co.ke            # existing account
    python manage.py platform_admin ops@nexora.co.ke --create   # new account; asks for a password
    python manage.py platform_admin ops@nexora.co.ke --revoke

There is deliberately no way to do this from the web app.
"""

import getpass

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User
from apps.audit.services import record_event


class Command(BaseCommand):
    help = "Grant (or revoke) Nexora platform-console access for an account."

    def add_arguments(self, parser):
        parser.add_argument("email")
        parser.add_argument("--create", action="store_true", help="Create the account if missing.")
        parser.add_argument("--full-name", default="Nexora Support")
        parser.add_argument(
            "--password", help="For --create without a prompt (CI). Avoid on shared machines."
        )
        parser.add_argument("--revoke", action="store_true")

    def handle(self, *args, email, create, full_name, password, revoke, **options):
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            if revoke or not create:
                raise CommandError(f"No account with email {email}. Use --create to add one.")
            password = password or getpass.getpass("Password: ")
            try:
                validate_password(password)
            except ValidationError as exc:
                raise CommandError(" ".join(exc.messages)) from exc
            user = User.objects.create_user(email=email, password=password, full_name=full_name)
        user.is_platform_admin = not revoke
        user.save(update_fields=["is_platform_admin"])
        record_event(
            None,
            "platform.admin_revoked" if revoke else "platform.admin_granted",
            target=user,
            metadata={"email": user.email, "via": "manage.py"},
        )
        verb = "can no longer" if revoke else "can now"
        self.stdout.write(self.style.SUCCESS(f"{user.email} {verb} use the platform console."))
