from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail


@shared_task(bind=True, max_retries=5, default_retry_delay=60)
def send_invitation_email(self, invitation_id: str, token: str) -> None:
    from .models import Invitation

    invitation = (
        Invitation.objects.select_related("organization", "invited_by")
        .filter(pk=invitation_id, status=Invitation.Status.PENDING)
        .first()
    )
    if invitation is None:
        return
    inviter = invitation.invited_by.full_name if invitation.invited_by else "A team member"
    link = f"{settings.FRONTEND_URL}/invitations/{token}"
    try:
        send_mail(
            subject=f"You're invited to join {invitation.organization.name} on Nexora",
            message=(
                f"{inviter} has invited you to join {invitation.organization.name} on Nexora "
                f"as {invitation.get_role_display()}.\n\n"
                f"Accept the invitation:\n{link}\n\n"
                f"This link expires on {invitation.expires_at:%d %b %Y}."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[invitation.email],
        )
    except Exception as exc:  # noqa: BLE001 - retry any transport failure
        raise self.retry(exc=exc) from exc
