"""Consistent API error envelope: {"error": {"code", "message", "details"}}.

Unhandled exceptions are logged server-side and returned as a generic 500 so
stack traces and internals never reach clients.
"""

import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


class BusinessRuleViolation(exceptions.APIException):
    """A request that is well-formed but conflicts with a business rule."""

    status_code = status.HTTP_409_CONFLICT
    default_code = "conflict"
    default_detail = "The request conflicts with the current state of the resource."


def _message_for(detail) -> str:
    if isinstance(detail, dict):
        if set(detail) == {"detail"}:
            return _message_for(detail["detail"])
        if "non_field_errors" in detail:
            return _message_for(detail["non_field_errors"])
        return "Some fields are invalid."
    if isinstance(detail, list) and detail:
        return _message_for(detail[0])
    return str(detail)


def api_exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(
            exc.message_dict if hasattr(exc, "error_dict") else exc.messages
        )
    elif isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()

    response = exception_handler(exc, context)
    if response is None:
        logger.exception("Unhandled API error", exc_info=exc)
        return Response(
            {"error": {"code": "server_error", "message": "An unexpected error occurred."}},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    detail = response.data
    codes = exc.get_codes() if isinstance(exc, exceptions.APIException) else "error"
    code = codes if isinstance(codes, str) else "invalid"
    body = {"code": code, "message": _message_for(detail)}
    if isinstance(exc, exceptions.ValidationError):
        body["details"] = detail if isinstance(detail, dict) else {"non_field_errors": detail}
    response.data = {"error": body}
    return response
