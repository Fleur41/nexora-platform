"""Giving tenants access to the tenant portal (invite → accept with matching email)."""

from __future__ import annotations

import secrets
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.organizations.models import hash_token

from .models import PortalInvitation, Tenant


def _send(invitation: PortalInvitation, token: str) -> None:
    org = invitation.organization
    link = f"{settings.FRONTEND_URL}/portal/join/{token}"
    send_mail(
        subject=f"Your tenant account with {org.name}",
        message=(
            f"Hello {invitation.tenant.full_name},\n\n{org.name} uses Nexora. "
            "Create your tenant account to see "
            f"your bills and receipts, pay rent and report maintenance issues:\n{link}\n\n"
            f"This link expires on {invitation.expires_at:%d %b %Y}."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[invitation.email],
        fail_silently=True,
    )


@transaction.atomic
def invite(*, request, tenant: Tenant, email: str) -> PortalInvitation:
    tenant = Tenant.objects.select_for_update().get(pk=tenant.pk)
    if tenant.status != Tenant.Status.ACTIVE:
        raise BusinessRuleViolation("Restore the tenant before inviting them.")
    if tenant.user_id:
        raise BusinessRuleViolation("This tenant already has portal access.")
    email = email.strip().lower()
    PortalInvitation.objects.filter(tenant=tenant, status=PortalInvitation.Status.PENDING).update(
        status=PortalInvitation.Status.REVOKED
    )
    token = secrets.token_urlsafe(32)
    invitation = PortalInvitation.objects.create(
        organization=tenant.organization,
        tenant=tenant,
        email=email,
        token_hash=hash_token(token),
        expires_at=timezone.now() + timedelta(days=14),
        invited_by=request.user,
    )
    if not tenant.email:
        tenant.email = email
        tenant.save(update_fields=["email", "updated_at"])
    record_event(request, "tenant.portal_invited", target=tenant, metadata={"email": email})
    transaction.on_commit(lambda: _send(invitation, token))
    return invitation


def find(token: str) -> PortalInvitation | None:
    return (
        PortalInvitation.objects.select_related("tenant", "organization")
        .filter(token_hash=hash_token(token))
        .first()
        if token
        else None
    )


@transaction.atomic
def accept(*, request, token: str) -> Tenant:
    invitation = find(token)
    if invitation is None:
        raise BusinessRuleViolation("This invitation link is invalid.")
    invitation = PortalInvitation.objects.select_for_update().get(pk=invitation.pk)
    if (
        invitation.status != PortalInvitation.Status.PENDING
        or invitation.expires_at <= timezone.now()
    ):
        raise BusinessRuleViolation(
            "This invitation is no longer valid. Ask your landlord for a new one."
        )
    if invitation.email.lower() != request.user.email.lower():
        raise BusinessRuleViolation("This invitation was sent to a different email address.")
    tenant = Tenant.objects.select_for_update().get(pk=invitation.tenant_id)
    if tenant.user_id and tenant.user_id != request.user.pk:
        raise BusinessRuleViolation("This tenant record is already linked to another account.")
    tenant.user = request.user
    try:
        with transaction.atomic():
            tenant.save(update_fields=["user", "updated_at"])
    except IntegrityError as exc:
        raise BusinessRuleViolation(
            "Your account is already linked to another tenant record with this landlord."
        ) from exc
    invitation.status, invitation.accepted_at = PortalInvitation.Status.ACCEPTED, timezone.now()
    invitation.save(update_fields=["status", "accepted_at", "updated_at"])
    record_event(request, "tenant.portal_joined", target=tenant, organization=tenant.organization)
    return tenant


@transaction.atomic
def revoke_access(*, request, tenant: Tenant) -> Tenant:
    tenant = Tenant.objects.select_for_update().get(pk=tenant.pk)
    PortalInvitation.objects.filter(tenant=tenant, status=PortalInvitation.Status.PENDING).update(
        status=PortalInvitation.Status.REVOKED
    )
    if tenant.user_id:
        tenant.user = None
        tenant.save(update_fields=["user", "updated_at"])
        record_event(request, "tenant.portal_revoked", target=tenant)
    return tenant
