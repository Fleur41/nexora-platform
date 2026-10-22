"""M-Pesa integration: configuration, STK push requests and Safaricom callbacks.

Callbacks are untrusted input. Each configuration has a secret token in its callback URLs
(Daraja does not sign callbacks); events are stored before processing and processed at most
once per transaction id, and STK results are re-verified with Safaricom's query API before
money is recorded. Callbacks always get a 200 "accepted" answer so Safaricom doesn't retry
indefinitely; anything that can't be processed is kept as a failed/rejected event for review.
"""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.audit.services import record_event
from apps.core.exceptions import BusinessRuleViolation
from apps.leases.models import Lease
from apps.organizations.models import organization_today

from . import services
from .models import (
    IntegrationCredential,
    Payment,
    PaymentConfiguration,
    PaymentRequest,
    ProviderEvent,
)
from .providers.mpesa import NAIROBI, DarajaClient, DarajaError

logger = logging.getLogger(__name__)
Status = PaymentConfiguration.IntegrationStatus


class ProviderUnavailable(BusinessRuleViolation):
    status_code = 502
    default_code = "provider_unavailable"


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def normalize_msisdn(phone: str) -> str:
    """Return 2547XXXXXXXX / 2541XXXXXXXX or raise."""
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("0") and len(digits) == 10:
        digits = "254" + digits[1:]
    elif len(digits) == 9 and digits[0] in "17":
        digits = "254" + digits
    if not re.fullmatch(r"254[17]\d{8}", digits):
        raise BusinessRuleViolation("Enter a Safaricom number like 0712 345 678.")
    return digits


def _require_mpesa(config: PaymentConfiguration) -> None:
    if config.provider not in PaymentConfiguration.MPESA_PROVIDERS:
        raise BusinessRuleViolation("This payment method is not M-Pesa.")


def client_for(config: PaymentConfiguration) -> DarajaClient:
    credential = IntegrationCredential.objects.filter(configuration=config).first()
    if credential is None or not (credential.consumer_key and credential.consumer_secret):
        raise BusinessRuleViolation("Save the Daraja consumer key and secret first.")
    return DarajaClient(
        environment=config.environment,
        consumer_key=credential.consumer_key,
        consumer_secret=credential.consumer_secret,
        shortcode=config.shortcode,
        passkey=credential.passkey,
        timeout=settings.MPESA_TIMEOUT_SECONDS,
    )


# --- Configuration ----------------------------------------------------------------------


@transaction.atomic
def save_credentials(
    *,
    request,
    config: PaymentConfiguration,
    consumer_key: str,
    consumer_secret: str,
    passkey: str = "",
) -> None:
    _require_mpesa(config)
    credential, _ = IntegrationCredential.objects.get_or_create(
        organization=config.organization, configuration=config
    )
    # Blank fields keep the stored value, so owners can update one secret at a time.
    if consumer_key:
        credential.consumer_key = consumer_key.strip()
    if consumer_secret:
        credential.consumer_secret = consumer_secret.strip()
    if passkey:
        credential.passkey = passkey.strip()
    credential.updated_by = request.user
    credential.save()
    if not config.callback_token:
        token = secrets.token_urlsafe(32)
        config.callback_token, config.callback_token_hash = token, token_hash(token)
    config.integration_status = Status.CREDENTIALS_SAVED
    config.integration_message = "Saved. Test the connection to verify them."
    config.save()
    record_event(
        request,
        "payment_settings.credentials_saved",
        target=config,
        metadata={
            "updated": [
                n
                for n, v in (
                    ("consumer_key", consumer_key),
                    ("consumer_secret", consumer_secret),
                    ("passkey", passkey),
                )
                if v
            ]
        },
    )


def test_connection(*, request, config: PaymentConfiguration) -> PaymentConfiguration:
    _require_mpesa(config)
    client = client_for(config)
    try:
        client.access_token()
    except DarajaError as exc:
        config.integration_status, config.integration_message = Status.FAILED, exc.message[:255]
    else:
        config.integration_status = Status.VERIFIED
        environment = (
            "sandbox" if config.environment == config.Environment.SANDBOX else "production"
        )
        config.integration_message = f"Connected to the M-Pesa {environment} environment."
    config.integration_checked_at = timezone.now()
    config.save(
        update_fields=[
            "integration_status",
            "integration_message",
            "integration_checked_at",
            "updated_at",
        ]
    )
    record_event(
        request,
        "payment_settings.connection_tested",
        target=config,
        metadata={"status": config.integration_status},
    )
    return config


def callback_urls(config: PaymentConfiguration) -> dict[str, str] | None:
    if not config.callback_token or not settings.NEXORA_PUBLIC_API_URL:
        return None
    base = f"{settings.NEXORA_PUBLIC_API_URL}/api/v1/integrations/mpesa/{config.callback_token}"
    return {
        "confirmation": f"{base}/c2b/confirmation/",
        "validation": f"{base}/c2b/validation/",
        "stk_callback": f"{base}/stk/callback/",
    }


def register_c2b(*, request, config: PaymentConfiguration) -> PaymentConfiguration:
    _require_mpesa(config)
    if config.integration_status != Status.VERIFIED:
        raise BusinessRuleViolation(
            "Test the connection successfully before registering callback URLs."
        )
    urls = callback_urls(config)
    if urls is None or not urls["confirmation"].startswith("https://"):
        raise BusinessRuleViolation(
            "Set NEXORA_PUBLIC_API_URL to this API's public https address first."
        )
    try:
        client_for(config).register_c2b_urls(
            confirmation_url=urls["confirmation"], validation_url=urls["validation"]
        )
    except DarajaError as exc:
        raise ProviderUnavailable(exc.message) from exc
    config.c2b_registered_at = timezone.now()
    config.save(update_fields=["c2b_registered_at", "updated_at"])
    record_event(request, "payment_settings.c2b_registered", target=config)
    return config


# --- STK push -------------------------------------------------------------------------------


def stk_configuration(lease: Lease) -> PaymentConfiguration | None:
    return next(
        (
            c
            for c in services.applicable_configurations(lease)
            if c.provider in PaymentConfiguration.MPESA_PROVIDERS
            and c.integration_status == Status.VERIFIED
        ),
        None,
    )


def request_stk_payment(*, request, lease: Lease, amount: Decimal, phone: str) -> PaymentRequest:
    if lease.status != Lease.Status.ACTIVE:
        raise BusinessRuleViolation("Payment requests can only be sent for active leases.")
    if amount != amount.to_integral_value() or amount < 1:
        raise BusinessRuleViolation("M-Pesa payment requests must be whole shillings (at least 1).")
    config = stk_configuration(lease)
    if config is None:
        raise BusinessRuleViolation(
            "No verified M-Pesa integration applies to this lease. "
            "Set one up under Payment settings."
        )
    urls = callback_urls(config)
    if urls is None or not urls["stk_callback"].startswith("https://"):
        raise BusinessRuleViolation(
            "Set NEXORA_PUBLIC_API_URL to this API's public https address first."
        )
    msisdn = normalize_msisdn(phone)
    account = lease.reference.replace("-", "")[:12]
    try:
        response = client_for(config).stk_push(
            phone=msisdn,
            amount=int(amount),
            account_reference=account,
            description="Rent",
            callback_url=urls["stk_callback"],
            till=config.provider == PaymentConfiguration.Provider.MPESA_TILL,
        )
    except DarajaError as exc:
        raise ProviderUnavailable(exc.message) from exc
    payment_request = PaymentRequest.objects.create(
        organization=lease.organization,
        configuration=config,
        lease=lease,
        phone=msisdn,
        amount=amount,
        account_reference=account,
        merchant_request_id=response.get("MerchantRequestID", ""),
        checkout_request_id=response["CheckoutRequestID"],
        created_by=request.user,
    )
    record_event(
        request,
        "payment.stk_requested",
        target=lease,
        metadata={
            "amount": str(amount),
            "checkout_request_id": payment_request.checkout_request_id,
            "phone": msisdn[-3:],
        },
    )
    return payment_request


# --- Callbacks ------------------------------------------------------------------------------


def _mask(value) -> str:
    text = str(value or "")
    return f"***{text[-3:]}" if len(text) > 3 else "***"


def _event(
    config, event_type, external_id, payload, status, message="", payment=None, remote_addr=None
) -> ProviderEvent:
    try:
        with transaction.atomic():
            return ProviderEvent.objects.create(
                organization=config.organization if config else None,
                configuration=config,
                event_type=event_type,
                external_id=external_id or "",
                payload=payload,
                status=status,
                message=message[:255],
                payment=payment,
                remote_addr=remote_addr,
            )
    except IntegrityError:
        # Another delivery of the same transaction was processed concurrently.
        return ProviderEvent.objects.create(
            organization=config.organization if config else None,
            configuration=config,
            event_type=event_type,
            external_id=external_id or "",
            payload=payload,
            status=ProviderEvent.Status.DUPLICATE,
            message="Already processed",
            remote_addr=remote_addr,
        )


def _already_processed(event_type: str, external_id: str) -> bool:
    return (
        bool(external_id)
        and ProviderEvent.objects.filter(
            provider="mpesa",
            event_type=event_type,
            external_id=external_id,
            status=ProviderEvent.Status.PROCESSED,
        ).exists()
    )


def _match_lease(config: PaymentConfiguration, account: str):
    """Find the single lease an account reference points to (lease reference or unit number)."""
    account = re.sub(r"\s+", "", account or "").upper()
    if not account:
        return None
    leases = Lease.objects.filter(
        organization=config.organization, status=Lease.Status.ACTIVE
    ).select_related("unit")
    if config.property_id:
        leases = leases.filter(unit__property_id=config.property_id)
    by_reference = [
        lease for lease in leases if lease.reference.replace("-", "") == account.replace("-", "")
    ]
    if len(by_reference) == 1:
        return by_reference[0]
    by_unit = [lease for lease in leases if lease.unit.number.replace(" ", "").upper() == account]
    return by_unit[0] if len(by_unit) == 1 else None


def config_for_token(token: str) -> PaymentConfiguration | None:
    if not token:
        return None
    return (
        PaymentConfiguration.objects.select_related("organization")
        .filter(callback_token_hash=token_hash(token))
        .first()
    )


def handle_c2b_confirmation(
    config: PaymentConfiguration, payload: dict, remote_addr=None
) -> ProviderEvent:
    trans_id = str(payload.get("TransID", "")).strip()
    stored = {**payload, "MSISDN": _mask(payload.get("MSISDN"))}
    if _already_processed("c2b_confirmation", trans_id):
        return _event(
            config,
            "c2b_confirmation",
            trans_id,
            stored,
            ProviderEvent.Status.DUPLICATE,
            "Already processed",
            remote_addr=remote_addr,
        )
    try:
        amount = Decimal(str(payload.get("TransAmount", "")))
    except InvalidOperation:
        amount = Decimal("0")
    if not trans_id or amount <= 0:
        return _event(
            config,
            "c2b_confirmation",
            trans_id,
            stored,
            ProviderEvent.Status.REJECTED,
            "Missing transaction id or amount",
            remote_addr=remote_addr,
        )
    if str(payload.get("BusinessShortCode", "")) != config.shortcode:
        return _event(
            config,
            "c2b_confirmation",
            trans_id,
            stored,
            ProviderEvent.Status.REJECTED,
            "Shortcode does not match this configuration",
            remote_addr=remote_addr,
        )
    try:
        received = (
            datetime.strptime(str(payload.get("TransTime", "")), "%Y%m%d%H%M%S")
            .replace(tzinfo=NAIROBI)
            .date()
        )
    except ValueError:
        received = organization_today(config.organization)
    received = min(received, organization_today(config.organization))
    account = str(payload.get("BillRefNumber", ""))
    lease = _match_lease(config, account)
    name = " ".join(
        filter(None, [payload.get("FirstName"), payload.get("MiddleName"), payload.get("LastName")])
    )
    try:
        with transaction.atomic():
            payment = services.record_payment(
                request=None,
                organization=config.organization,
                amount=amount,
                received_on=received,
                method=config.method,
                lease=lease,
                configuration=config,
                reference=trans_id,
                external_id=trans_id,
                payer_name=name,
                payer_phone=str(payload.get("MSISDN", "")),
                account_reference=account,
                source=Payment.Source.MPESA_C2B,
            )
            return _event(
                config,
                "c2b_confirmation",
                trans_id,
                stored,
                ProviderEvent.Status.PROCESSED,
                "Matched to a lease" if lease else "Unmatched: waiting for reconciliation",
                payment=payment,
                remote_addr=remote_addr,
            )
    except BusinessRuleViolation as exc:  # e.g. already recorded manually with the same code
        return _event(
            config,
            "c2b_confirmation",
            trans_id,
            stored,
            ProviderEvent.Status.DUPLICATE,
            str(exc.detail),
            remote_addr=remote_addr,
        )


def _metadata(callback: dict) -> dict:
    items = (callback.get("CallbackMetadata") or {}).get("Item") or []
    return {item.get("Name"): item.get("Value") for item in items if isinstance(item, dict)}


def handle_stk_callback(
    config: PaymentConfiguration, payload: dict, remote_addr=None
) -> ProviderEvent:
    callback = ((payload or {}).get("Body") or {}).get("stkCallback") or {}
    checkout_id = str(callback.get("CheckoutRequestID", ""))
    meta = _metadata(callback)
    stored = {**payload}
    if meta.get("PhoneNumber"):
        stored = {
            "Body": {
                "stkCallback": {
                    **callback,
                    "CallbackMetadata": {
                        "Item": [
                            {**i, "Value": _mask(i.get("Value"))}
                            if i.get("Name") == "PhoneNumber"
                            else i
                            for i in callback["CallbackMetadata"]["Item"]
                        ]
                    },
                }
            }
        }
    if _already_processed("stk_callback", checkout_id):
        return _event(
            config,
            "stk_callback",
            checkout_id,
            stored,
            ProviderEvent.Status.DUPLICATE,
            "Already processed",
            remote_addr=remote_addr,
        )

    with transaction.atomic():
        payment_request = (
            PaymentRequest.objects.select_for_update()
            .filter(configuration=config, checkout_request_id=checkout_id)
            .select_related("lease")
            .first()
        )
        if payment_request is None:
            return _event(
                config,
                "stk_callback",
                checkout_id,
                stored,
                ProviderEvent.Status.REJECTED,
                "Unknown payment request",
                remote_addr=remote_addr,
            )
        if payment_request.status == PaymentRequest.Status.COMPLETED:
            return _event(
                config,
                "stk_callback",
                checkout_id,
                stored,
                ProviderEvent.Status.DUPLICATE,
                "Already paid",
                remote_addr=remote_addr,
            )

        result_code = str(callback.get("ResultCode", ""))
        payment_request.result_code = result_code
        payment_request.result_description = str(callback.get("ResultDesc", ""))[:255]
        if result_code != "0":
            payment_request.status = PaymentRequest.Status.FAILED
            payment_request.save()
            return _event(
                config,
                "stk_callback",
                checkout_id,
                stored,
                ProviderEvent.Status.PROCESSED,
                f"Not paid: {payment_request.result_description}",
                remote_addr=remote_addr,
            )

        receipt = str(meta.get("MpesaReceiptNumber", "")).strip()
        try:
            amount = Decimal(str(meta.get("Amount", "")))
        except InvalidOperation:
            amount = Decimal("0")
        problem = None
        if not receipt:
            problem = "Callback has no M-Pesa receipt number"
        elif amount != payment_request.amount:
            problem = f"Paid amount {amount} differs from requested {payment_request.amount}"
        else:
            # Server-side verification: ask Safaricom whether this request really succeeded.
            try:
                verification = client_for(config).stk_query(checkout_id)
                if str(verification.get("ResultCode")) != "0":
                    detail = verification.get("ResultDesc", "no result")
                    problem = f"Safaricom did not confirm the payment ({detail})"
            except (DarajaError, BusinessRuleViolation) as exc:
                problem = f"Could not verify with Safaricom: {getattr(exc, 'message', exc)}"
        if problem:
            payment_request.status = PaymentRequest.Status.NEEDS_REVIEW
            payment_request.save()
            return _event(
                config,
                "stk_callback",
                checkout_id,
                stored,
                ProviderEvent.Status.FAILED,
                problem,
                remote_addr=remote_addr,
            )

        try:
            with transaction.atomic():
                payment = services.record_payment(
                    request=None,
                    organization=config.organization,
                    amount=amount,
                    received_on=organization_today(config.organization),
                    method=config.method,
                    lease=payment_request.lease,
                    configuration=config,
                    reference=receipt,
                    external_id=receipt,
                    payer_phone=payment_request.phone,
                    account_reference=payment_request.account_reference,
                    source=Payment.Source.MPESA_STK,
                    actor=payment_request.created_by,
                )
        except BusinessRuleViolation as exc:
            payment_request.status = PaymentRequest.Status.NEEDS_REVIEW
            payment_request.save()
            return _event(
                config,
                "stk_callback",
                checkout_id,
                stored,
                ProviderEvent.Status.FAILED,
                str(exc.detail),
                remote_addr=remote_addr,
            )
        payment_request.status = PaymentRequest.Status.COMPLETED
        payment_request.payment = payment
        payment_request.save()
        return _event(
            config,
            "stk_callback",
            checkout_id,
            stored,
            ProviderEvent.Status.PROCESSED,
            "Paid",
            payment=payment,
            remote_addr=remote_addr,
        )
