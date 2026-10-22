"""Encryption at rest for integration secrets (e.g. Daraja consumer secret, passkey).

Keys come from NEXORA_FIELD_ENCRYPTION_KEY (comma-separated Fernet keys; the first encrypts,
all decrypt, which allows rotation). Secrets are decrypted only server-side when calling a
provider and are never serialized to API responses.
"""

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import models


@lru_cache(maxsize=1)
def _fernet(keys: str) -> MultiFernet:
    parts = [k.strip() for k in keys.split(",") if k.strip()]
    if not parts:
        raise ImproperlyConfigured(
            "NEXORA_FIELD_ENCRYPTION_KEY is not set. Generate one with: "
            "python -c 'from cryptography.fernet import Fernet; "
            "print(Fernet.generate_key().decode())'"
        )
    return MultiFernet([Fernet(k.encode()) for k in parts])


def encrypt(value: str) -> str:
    return _fernet(settings.NEXORA_FIELD_ENCRYPTION_KEY).encrypt(value.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet(settings.NEXORA_FIELD_ENCRYPTION_KEY).decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise ImproperlyConfigured(
            "A stored secret could not be decrypted with the configured keys."
        ) from exc


class EncryptedTextField(models.TextField):
    """Stores Fernet ciphertext; Python code sees plaintext. Empty strings stay empty."""

    def from_db_value(self, value, expression, connection):
        if not value:
            return value
        return decrypt(value)

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if not value:
            return value
        return encrypt(value)
