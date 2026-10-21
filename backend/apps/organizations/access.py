"""Active-organization resolution and permission enforcement for organization-scoped APIs.

Every organization-scoped request must send `X-Organization-ID`. The value is only a
*selector*: access is granted solely when the authenticated user holds an active
membership in that (active) organization. Querysets are then filtered to that
organization, so object IDs from other organizations resolve to 404.
"""

import uuid

from rest_framework import exceptions, permissions, serializers, status, viewsets
from rest_framework.response import Response

from .models import Membership, Organization

ORGANIZATION_HEADER = "X-Organization-ID"


def resolve_membership(request) -> Membership:
    raw = request.headers.get(ORGANIZATION_HEADER, "").strip()
    if not raw:
        raise exceptions.PermissionDenied(
            detail=f"The {ORGANIZATION_HEADER} header is required.", code="organization_required"
        )
    try:
        organization_id = uuid.UUID(raw)
    except ValueError as exc:
        raise exceptions.PermissionDenied(
            detail="You do not have access to this organization.", code="not_a_member"
        ) from exc
    membership = (
        Membership.objects.select_related("organization", "user")
        .filter(
            user=request.user,
            organization_id=organization_id,
            status=Membership.Status.ACTIVE,
            organization__status=Organization.Status.ACTIVE,
        )
        .first()
    )
    if membership is None:
        raise exceptions.PermissionDenied(
            detail="You do not have access to this organization.", code="not_a_member"
        )
    return membership


def bind_organization(request, membership: Membership) -> None:
    request.membership = membership
    request.organization = membership.organization
    # Also expose on the underlying Django request (middleware, logging, audit).
    django_request = getattr(request, "_request", None)
    if django_request is not None:
        django_request.membership = membership
        django_request.organization = membership.organization


class OrganizationPermission(permissions.BasePermission):
    """Resolves the active membership, then checks the view's required capability.

    Views declare `required_capabilities = {action: capability | None}`. Actions that
    are not listed are denied (secure by default). `None` means any active member.
    """

    def has_permission(self, request, view) -> bool:
        if not (request.user and request.user.is_authenticated):
            return False
        membership = resolve_membership(request)
        bind_organization(request, membership)

        if hasattr(view, "action_map") and view.action is None:
            return True  # method not routed on this viewset; DRF responds 405
        action = getattr(view, "action", None) or request.method.lower()
        required = getattr(view, "required_capabilities", {})
        if action not in required:
            raise exceptions.PermissionDenied(code="action_not_allowed")
        capability = required[action]
        if capability is not None and not membership.has_capability(capability):
            raise exceptions.PermissionDenied(
                detail="Your role does not allow this action.", code="missing_capability"
            )
        return True


class OrganizationScopedViewSet(viewsets.GenericViewSet):
    """Base viewset for any model with an `organization` foreign key.

    Future business modules (POS, inventory, ...) subclass this to inherit
    membership checks, capability enforcement and queryset isolation.
    """

    permission_classes = [permissions.IsAuthenticated, OrganizationPermission]
    required_capabilities: dict[str, str | None] = {}
    organization_field = "organization"

    def get_queryset(self):
        queryset = super().get_queryset()
        return queryset.filter(**{self.organization_field: self.request.organization})

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["organization"] = getattr(self.request, "organization", None)
        context["membership"] = getattr(self.request, "membership", None)
        return context

    def perform_create(self, serializer):
        serializer.save(**{self.organization_field: self.request.organization})


class OrganizationScopedPrimaryKeyRelatedField(serializers.PrimaryKeyRelatedField):
    """A related-object field that only accepts objects from the active organization.

    Prevents linking records across organizations via crafted IDs.
    """

    organization_field = "organization"

    def __init__(self, *, organization_field: str | None = None, **kwargs):
        if organization_field:
            self.organization_field = organization_field
        super().__init__(**kwargs)

    def get_queryset(self):
        queryset = super().get_queryset()
        organization = self.context.get("organization")
        if organization is None:
            return queryset.none()
        return queryset.filter(**{self.organization_field: organization})


class RefetchOnWriteMixin:
    """Create/update via services, then serialize the object re-read through get_queryset().

    Keeps annotations (counts) and prefetches in the response and guarantees the response
    only contains what the caller is allowed to read.
    """

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        instance = self.get_queryset().get(pk=serializer.instance.pk)
        return Response(self.get_serializer(instance).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object(), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        instance = self.get_queryset().get(pk=serializer.instance.pk)
        return Response(self.get_serializer(instance).data)
