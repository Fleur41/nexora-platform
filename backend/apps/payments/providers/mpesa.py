"""Minimal Safaricom Daraja client (OAuth, STK push, STK query, C2B URL registration).

No third-party HTTP library: requests go through urllib with explicit timeouts. Every
failure is raised as DarajaError with a message safe to show staff; secrets and raw
provider responses are never included in it.
"""

from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

BASE_URLS = {
    "sandbox": "https://sandbox.safaricom.co.ke",
    "production": "https://api.safaricom.co.ke",
}
NAIROBI = ZoneInfo("Africa/Nairobi")


class DarajaError(Exception):
    def __init__(self, message: str, *, status: int | None = None):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class DarajaClient:
    environment: str
    consumer_key: str
    consumer_secret: str
    shortcode: str = ""
    passkey: str = ""
    timeout: int = 20

    @property
    def base_url(self) -> str:
        return BASE_URLS[self.environment]

    # Isolated so tests can replace the network layer.
    def _request(self, method: str, path: str, *, headers: dict, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        # base_url is one of two fixed https hosts (BASE_URLS), never user input.
        req = urllib.request.Request(  # noqa: S310
            self.base_url + path, data=data, method=method, headers=headers
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:  # noqa: S310 - fixed https hosts
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as exc:
            try:
                detail = json.loads(exc.read() or b"{}")
            except ValueError:
                detail = {}
            message = (
                detail.get("errorMessage") or detail.get("error_description") or f"HTTP {exc.code}"
            )
            logger.warning("Daraja %s %s failed: %s", method, path, message)
            raise DarajaError(f"M-Pesa rejected the request: {message}", status=exc.code) from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            logger.warning("Daraja %s %s unreachable: %s", method, path, exc)
            raise DarajaError("Could not reach M-Pesa. Try again shortly.") from exc
        except ValueError as exc:
            raise DarajaError("M-Pesa returned an unexpected response.") from exc

    def access_token(self) -> str:
        if not (self.consumer_key and self.consumer_secret):
            raise DarajaError("Consumer key and secret are required.")
        basic = base64.b64encode(f"{self.consumer_key}:{self.consumer_secret}".encode()).decode()
        data = self._request(
            "GET",
            "/oauth/v1/generate?grant_type=client_credentials",
            headers={"Authorization": f"Basic {basic}"},
        )
        token = data.get("access_token")
        if not token:
            raise DarajaError(
                "M-Pesa did not return an access token. Check the consumer key and secret."
            )
        return token

    def _authorized(self, path: str, body: dict) -> dict:
        headers = {
            "Authorization": f"Bearer {self.access_token()}",
            "Content-Type": "application/json",
        }
        return self._request("POST", path, headers=headers, body=body)

    def _password(self) -> tuple[str, str]:
        if not (self.shortcode and self.passkey):
            raise DarajaError(
                "A shortcode and Lipa na M-Pesa passkey are required for payment requests."
            )
        timestamp = datetime.now(NAIROBI).strftime("%Y%m%d%H%M%S")
        password = base64.b64encode(f"{self.shortcode}{self.passkey}{timestamp}".encode()).decode()
        return password, timestamp

    def stk_push(
        self,
        *,
        phone: str,
        amount: int,
        account_reference: str,
        description: str,
        callback_url: str,
        till: bool,
    ) -> dict:
        password, timestamp = self._password()
        data = self._authorized(
            "/mpesa/stkpush/v1/processrequest",
            {
                "BusinessShortCode": self.shortcode,
                "Password": password,
                "Timestamp": timestamp,
                "TransactionType": "CustomerBuyGoodsOnline" if till else "CustomerPayBillOnline",
                "Amount": amount,
                "PartyA": phone,
                "PartyB": self.shortcode,
                "PhoneNumber": phone,
                "CallBackURL": callback_url,
                "AccountReference": account_reference[:12],
                "TransactionDesc": description[:13],
            },
        )
        if str(data.get("ResponseCode")) != "0" or not data.get("CheckoutRequestID"):
            raise DarajaError(
                "M-Pesa did not accept the payment request: "
                f"{data.get('ResponseDescription', 'unknown error')}"
            )
        return data

    def stk_query(self, checkout_request_id: str) -> dict:
        password, timestamp = self._password()
        return self._authorized(
            "/mpesa/stkpushquery/v1/query",
            {
                "BusinessShortCode": self.shortcode,
                "Password": password,
                "Timestamp": timestamp,
                "CheckoutRequestID": checkout_request_id,
            },
        )

    def register_c2b_urls(self, *, confirmation_url: str, validation_url: str) -> dict:
        data = self._authorized(
            "/mpesa/c2b/v1/registerurl",
            {
                "ShortCode": self.shortcode,
                "ResponseType": "Completed",
                "ConfirmationURL": confirmation_url,
                "ValidationURL": validation_url,
            },
        )
        if str(data.get("ResponseCode", "0")) not in ("0", "00000000"):
            raise DarajaError(
                "M-Pesa did not register the URLs: "
                f"{data.get('ResponseDescription', 'unknown error')}"
            )
        return data
