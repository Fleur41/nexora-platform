from __future__ import annotations

from typing import Any

from apps.core.middleware import get_request_id
from apps.core.net import client_ip

from .models import AuditLog


def _client_ip(request) -> str | None:
    return client_ip(request) if hasattr(request, "META") else None


def record_event(
    request,
    action: str,
    *,
    target=None,
    organization=None,
    actor=None,
    changes: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditLog:
    """Append an audit entry. `request` may be None for background jobs."""
    if actor is None and request is not None and request.user.is_authenticated:
        actor = request.user
    if organization is None and request is not None:
        organization = getattr(request, "organization", None)
    return AuditLog.objects.create(
        organization=organization,
        actor=actor,
        actor_email=getattr(actor, "email", "") or "",
        action=action,
        target_type=target._meta.label_lower if target is not None else "",
        target_id=str(target.pk) if target is not None else "",
        target_repr=str(target)[:255] if target is not None else "",
        changes=changes or {},
        metadata=metadata or {},
        ip_address=_client_ip(request) if request is not None else None,
        user_agent=(request.META.get("HTTP_USER_AGENT", "")[:255] if request is not None else ""),
        request_id=get_request_id(),
    )


def diff(instance, fields: list[str], new_values: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Build a {field: {"from": old, "to": new}} dict for fields that actually change."""
    changes = {}
    for field in fields:
        if field in new_values and getattr(instance, field) != new_values[field]:
            changes[field] = {"from": getattr(instance, field), "to": new_values[field]}
    return changes
