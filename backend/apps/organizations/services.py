"""Business rules for organizations, memberships and invitations.

All mutations go through these functions so the rules (and audit trail) apply
regardless of which API or job triggers them.
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.text import slugify

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.core.modules import registry

from .models import Invitation, Membership, Organization, hash_token
from .roles import Role
from .tasks import send_invitation_email


def _unique_slug(name: str) -> str:
    base = slugify(name)[:60] or "organization"
    slug, n = base, 2
    while Organization.objects.filter(slug=slug).exists():
        slug = f"{base}-{n}"
        n += 1
    return slug


@transaction.atomic
def create_organization(*, request, user, **fields) -> Organization:
    organization = Organization.objects.create(
        slug=_unique_slug(fields["name"]), created_by=user, **fields
    )
    membership = Membership.objects.create(organization=organization, user=user, role=Role.OWNER)
    record_event(request, "organization.created", target=organization, organization=organization)
    record_event(
        request,
        "membership.created",
        target=membership,
        organization=organization,
        changes={"role": {"from": None, "to": Role.OWNER}},
    )
    return organization


@transaction.atomic
def update_organization(*, request, organization: Organization, **fields) -> Organization:
    changes = {
        key: {"from": getattr(organization, key), "to": value}
        for key, value in fields.items()
        if getattr(organization, key) != value
    }
    for key, value in fields.items():
        setattr(organization, key, value)
    organization.save()
    if changes:
        record_event(request, "organization.updated", target=organization, changes=changes)
    return organization


# --- Memberships -------------------------------------------------------------


def _active_owner_count(organization: Organization) -> int:
    return Membership.objects.filter(
        organization=organization, role=Role.OWNER, status=Membership.Status.ACTIVE
    ).count()


def validate_capability_keys(keys: list[str]) -> list[str]:
    unknown = [k for k in keys if not registry.has_capability(k)]
    if unknown:
        raise BusinessRuleViolation(f"Unknown capabilities: {', '.join(sorted(unknown))}")
    return sorted(set(keys))


def _assert_can_manage(actor: Membership, target: Membership | None, new_role: str | None) -> None:
    """Prevent privilege escalation by non-owners."""
    if actor.is_owner:
        return
    if new_role == Role.OWNER:
        raise BusinessRuleViolation("Only an owner can grant the owner role.")
    if target is not None and target.is_owner:
        raise BusinessRuleViolation("Only an owner can change another owner.")
    if target is not None and target.pk == actor.pk:
        raise BusinessRuleViolation("You cannot change your own role or permissions.")


@transaction.atomic
def update_membership(
    *,
    request,
    actor: Membership,
    membership: Membership,
    role: str | None = None,
    extra_permissions: list[str] | None = None,
    revoked_permissions: list[str] | None = None,
) -> Membership:
    membership = Membership.objects.select_for_update().get(pk=membership.pk)
    _assert_can_manage(actor, membership, role)

    if extra_permissions is not None:
        extra_permissions = validate_capability_keys(extra_permissions)
        # Non-owners cannot hand out capabilities they do not hold themselves.
        if not actor.is_owner and not set(extra_permissions) <= actor.capabilities:
            raise BusinessRuleViolation("You cannot grant permissions you do not hold.")
    if revoked_permissions is not None:
        revoked_permissions = validate_capability_keys(revoked_permissions)

    if (
        membership.is_owner
        and role is not None
        and role != Role.OWNER
        and _active_owner_count(membership.organization) <= 1
    ):
        raise BusinessRuleViolation("An organization must keep at least one owner.")

    changes = {}
    for field, value in (
        ("role", role),
        ("extra_permissions", extra_permissions),
        ("revoked_permissions", revoked_permissions),
    ):
        if value is not None and getattr(membership, field) != value:
            changes[field] = {"from": getattr(membership, field), "to": value}
            setattr(membership, field, value)
    if changes:
        membership.save()
        record_event(request, "membership.updated", target=membership, changes=changes)
    return membership


@transaction.atomic
def remove_membership(*, request, actor: Membership, membership: Membership) -> Membership:
    membership = Membership.objects.select_for_update().get(pk=membership.pk)
    if membership.pk != actor.pk:
        _assert_can_manage(actor, membership, None)
    if membership.is_owner and _active_owner_count(membership.organization) <= 1:
        raise BusinessRuleViolation("An organization must keep at least one owner.")
    if membership.status == Membership.Status.REMOVED:
        return membership
    previous = membership.status
    membership.status = Membership.Status.REMOVED
    membership.save(update_fields=["status", "updated_at"])
    record_event(
        request,
        "membership.removed",
        target=membership,
        changes={"status": {"from": previous, "to": membership.status}},
    )
    return membership


# --- Invitations -------------------------------------------------------------


def _schedule_invitation_email(invitation: Invitation, token: str) -> None:
    transaction.on_commit(lambda: send_invitation_email.delay(str(invitation.pk), token))


@transaction.atomic
def create_invitation(*, request, actor: Membership, email: str, role: str) -> Invitation:
    organization = actor.organization
    email = email.strip().lower()
    _assert_can_manage(actor, None, role)

    if Membership.objects.filter(
        organization=organization, user__email__iexact=email, status=Membership.Status.ACTIVE
    ).exists():
        raise BusinessRuleViolation("This person is already a member of the organization.")

    # Expired pending invitations would otherwise block a new one via the unique constraint.
    Invitation.objects.filter(
        organization=organization,
        email__iexact=email,
        status=Invitation.Status.PENDING,
        expires_at__lte=timezone.now(),
    ).update(status=Invitation.Status.REVOKED)

    invitation = Invitation(
        organization=organization,
        email=email,
        role=role,
        invited_by=actor.user,
        expires_at=timezone.now() + timedelta(days=settings.INVITATION_TTL_DAYS),
    )
    token = invitation.issue_token()
    try:
        with transaction.atomic():
            invitation.save()
    except IntegrityError as exc:
        raise BusinessRuleViolation("A pending invitation already exists for this email.") from exc

    record_event(
        request, "invitation.created", target=invitation, metadata={"email": email, "role": role}
    )
    _schedule_invitation_email(invitation, token)
    return invitation


@transaction.atomic
def resend_invitation(*, request, actor: Membership, invitation: Invitation) -> Invitation:
    invitation = Invitation.objects.select_for_update().get(pk=invitation.pk)
    _assert_can_manage(actor, None, invitation.role)
    if invitation.status != Invitation.Status.PENDING:
        raise BusinessRuleViolation("Only pending invitations can be resent.")
    token = invitation.issue_token()  # rotates the token; previous links stop working
    invitation.expires_at = timezone.now() + timedelta(days=settings.INVITATION_TTL_DAYS)
    invitation.save(update_fields=["token_hash", "expires_at", "updated_at"])
    record_event(request, "invitation.resent", target=invitation)
    _schedule_invitation_email(invitation, token)
    return invitation


@transaction.atomic
def revoke_invitation(*, request, actor: Membership, invitation: Invitation) -> Invitation:
    invitation = Invitation.objects.select_for_update().get(pk=invitation.pk)
    _assert_can_manage(actor, None, invitation.role)
    if invitation.status != Invitation.Status.PENDING:
        raise BusinessRuleViolation("Only pending invitations can be revoked.")
    invitation.status = Invitation.Status.REVOKED
    invitation.save(update_fields=["status", "updated_at"])
    record_event(request, "invitation.revoked", target=invitation)
    return invitation


def find_invitation_by_token(token: str) -> Invitation | None:
    if not token:
        return None
    return (
        Invitation.objects.select_related("organization", "invited_by")
        .filter(token_hash=hash_token(token))
        .first()
    )


@transaction.atomic
def accept_invitation(*, request, user, token: str) -> Membership:
    invitation = find_invitation_by_token(token)
    if invitation is None:
        raise BusinessRuleViolation("This invitation link is invalid.")
    invitation = Invitation.objects.select_for_update().get(pk=invitation.pk)
    if not invitation.is_usable:
        raise BusinessRuleViolation("This invitation is no longer valid.")
    if invitation.email.lower() != user.email.lower():
        raise BusinessRuleViolation(
            "This invitation was sent to a different email address. "
            "Sign in with that address to accept it."
        )
    if invitation.organization.status != Organization.Status.ACTIVE:
        raise BusinessRuleViolation("This organization is not currently active.")

    membership, created = Membership.objects.select_for_update().get_or_create(
        organization=invitation.organization,
        user=user,
        defaults={"role": invitation.role, "invited_by": invitation.invited_by},
    )
    if not created:
        if membership.status == Membership.Status.ACTIVE:
            raise BusinessRuleViolation("You are already a member of this organization.")
        # Re-joining after removal: start from a clean permission set.
        membership.role = invitation.role
        membership.status = Membership.Status.ACTIVE
        membership.extra_permissions = []
        membership.revoked_permissions = []
        membership.invited_by = invitation.invited_by
        membership.joined_at = timezone.now()
        membership.save()

    invitation.status = Invitation.Status.ACCEPTED
    invitation.accepted_by = user
    invitation.accepted_at = timezone.now()
    invitation.save(update_fields=["status", "accepted_by", "accepted_at", "updated_at"])

    record_event(
        request,
        "invitation.accepted",
        target=invitation,
        organization=invitation.organization,
    )
    record_event(
        request,
        "membership.created" if created else "membership.reactivated",
        target=membership,
        organization=invitation.organization,
        changes={"role": {"from": None, "to": membership.role}},
    )
    return membership
