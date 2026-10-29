"""Support access: a platform admin's temporary, read-only view of an organization."""

from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.core.modules import registry
from apps.organizations.models import Membership, Organization
from apps.organizations.roles import AccessScope, Role

from .models import SupportGrant

MIN_MINUTES, MAX_MINUTES = 15, 240


def support_membership(grant: SupportGrant) -> Membership:
    """An unsaved stand-in membership that can view everything and change nothing."""
    every = {c.key for c in registry.capabilities()}
    view = sorted(k for k in every if k.endswith(".view") or k == "audit.view")
    membership = Membership(
        organization=grant.organization,
        user=grant.user,
        role=Role.ACCOUNTANT,
        status=Membership.Status.ACTIVE,
        access_scope=AccessScope.ORGANIZATION,
        extra_permissions=view,
        revoked_permissions=sorted(every - set(view)),
    )
    membership.is_support = True
    membership.support_grant = grant
    return membership


def active_support_membership(user, organization_id) -> Membership | None:
    if not getattr(user, "is_platform_admin", False):
        return None
    grant = (
        SupportGrant.objects.active()
        .select_related("organization", "user")
        .filter(
            user=user,
            organization_id=organization_id,
            organization__status=Organization.Status.ACTIVE,
        )
        .first()
    )
    return support_membership(grant) if grant else None


@transaction.atomic
def start(*, request, organization: Organization, reason: str, minutes: int) -> SupportGrant:
    from apps.notifications.services import notify

    if not reason.strip():
        raise BusinessRuleViolation("Say why you need access (it's shown to the organization).")
    if not MIN_MINUTES <= minutes <= MAX_MINUTES:
        raise BusinessRuleViolation(f"Choose between {MIN_MINUTES} and {MAX_MINUTES} minutes.")
    SupportGrant.objects.active().filter(user=request.user, organization=organization).update(
        ended_at=timezone.now()
    )
    grant = SupportGrant.objects.create(
        organization=organization,
        user=request.user,
        reason=reason.strip(),
        expires_at=timezone.now() + timedelta(minutes=minutes),
    )
    record_event(
        request,
        "support.started",
        target=grant,
        organization=organization,
        metadata={"reason": grant.reason, "minutes": minutes},
    )
    owners = [
        m.user
        for m in Membership.objects.filter(
            organization=organization, role=Role.OWNER, status=Membership.Status.ACTIVE
        ).select_related("user")
    ]
    notify(
        organization=organization,
        kind="support",
        users=owners,
        title="Nexora support is viewing your account",
        body=f"{request.user.full_name} (Nexora support), read-only, for {minutes} minutes: "
        f"{grant.reason}",
        link="/dashboard/audit",
        dedupe_key=f"support:{grant.pk}",
    )
    return grant


@transaction.atomic
def end(*, request, grant: SupportGrant) -> SupportGrant:
    if grant.ended_at is None:
        grant.ended_at = timezone.now()
        grant.save(update_fields=["ended_at", "updated_at"])
        record_event(request, "support.ended", target=grant, organization=grant.organization)
    return grant
