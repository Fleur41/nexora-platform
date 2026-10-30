"""Delivery channels. Email uses Django's mail backend (console/Mailpit locally); SMS goes
through a pluggable backend. The development default prints SMS to the log, so nothing
external is needed to run Nexora. Africa's Talking is wired but only works once an
account's username and API key are configured."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.core.mail import EmailMessage

logger = logging.getLogger(__name__)


class DeliveryError(Exception):
    pass


def send_email(
    to: str, subject: str, body: str, attachments: list[tuple[str, bytes, str]] = ()
) -> None:
    """Send one email; `attachments` are (filename, content, MIME type)."""
    try:
        message = EmailMessage(
            subject=subject, body=body, from_email=settings.DEFAULT_FROM_EMAIL, to=[to]
        )
        for filename, content, mimetype in attachments:
            message.attach(filename, content, mimetype)
        message.send()
    except Exception as exc:  # noqa: BLE001 - surface transport failures as delivery errors
        raise DeliveryError(f"Email could not be sent: {exc.__class__.__name__}") from exc


class ConsoleSms:
    """Development backend: logs instead of sending."""

    def send(self, to: str, message: str) -> None:
        logger.info("SMS to %s: %s", to, message)


class AfricasTalkingSms:
    """Africa's Talking bulk SMS (https://developers.africastalking.com)."""

    def __init__(self):
        self.username = settings.AFRICASTALKING_USERNAME
        self.api_key = settings.AFRICASTALKING_API_KEY
        self.sender = settings.AFRICASTALKING_SENDER_ID
        if not (self.username and self.api_key):
            raise DeliveryError(
                "Africa's Talking is not configured (username and API key required)."
            )
        host = (
            "api.sandbox.africastalking.com"
            if self.username == "sandbox"
            else "api.africastalking.com"
        )
        self.url = f"https://{host}/version1/messaging"

    def send(self, to: str, message: str) -> None:
        fields = {"username": self.username, "to": to, "message": message}
        if self.sender:
            fields["from"] = self.sender
        req = urllib.request.Request(  # noqa: S310 - fixed https host
            self.url,
            data=urllib.parse.urlencode(fields).encode(),
            headers={"apiKey": self.api_key, "Accept": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as res:  # noqa: S310
                data = json.loads(res.read() or b"{}")
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            raise DeliveryError("SMS provider unreachable.") from exc
        recipients = (data.get("SMSMessageData") or {}).get("Recipients") or []
        if not recipients or recipients[0].get("status") != "Success":
            raise DeliveryError(
                f"SMS rejected: {(recipients[0] if recipients else data).get('status', 'unknown')}"
            )


def sms_backend():
    name = settings.NOTIFICATION_SMS_BACKEND
    if name == "africastalking":
        return AfricasTalkingSms()
    return ConsoleSms()
