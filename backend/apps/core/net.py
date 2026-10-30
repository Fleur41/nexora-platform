"""The client's IP address, trusting exactly as many reverse proxies as are configured."""

from django.conf import settings


def client_ip(request) -> str | None:
    """REMOTE_ADDR, or with N trusted proxies (NUM_PROXIES) the address the outermost one saw.

    Each proxy appends the address it received the request from to X-Forwarded-For, so only
    the last N entries are trustworthy; anything before them can be forged by the client.
    Matches DRF's throttle identity (REST_FRAMEWORK["NUM_PROXIES"]).
    """
    remote = request.META.get("REMOTE_ADDR") or None
    proxies = settings.NUM_PROXIES
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if proxies and xff:
        hops = [h.strip() for h in xff.split(",") if h.strip()]
        if hops:
            return hops[-min(proxies, len(hops))]
    return remote
