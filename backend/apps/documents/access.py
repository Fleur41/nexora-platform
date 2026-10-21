"""Who may see or change a document depends on the record it is attached to.

Identity documents on tenants are sensitive, so tenant documents need tenants.manage
even to view. Everything also respects property assignment scope.
"""

from django.db.models import Q

from apps.organizations.models import Membership

# target field -> (capability to view, capability to upload/delete)
RULES = {
    "property": ("properties.view", "properties.manage"),
    "unit": ("properties.view", "properties.manage"),
    "tenant": ("tenants.manage", "tenants.manage"),
    "lease": ("leases.view", "leases.manage"),
}


def target_queryset(field: str, membership: Membership):
    from apps.leases.models import Lease
    from apps.properties.access import accessible_properties
    from apps.properties.models import Unit
    from apps.tenants.access import accessible_tenants

    properties = accessible_properties(membership)
    if field == "property":
        return properties
    if field == "unit":
        return Unit.objects.filter(property__in=properties.values("pk"))
    if field == "tenant":
        return accessible_tenants(membership)
    if field == "lease":
        return Lease.objects.filter(unit__property__in=properties.values("pk"))
    raise ValueError(field)


def viewable_filter(membership: Membership) -> Q:
    q = Q(pk__in=[])
    for field, (view_cap, _) in RULES.items():
        if membership.has_capability(view_cap):
            q |= Q(**{f"{field}__in": target_queryset(field, membership).values("pk")})
    return q


def can_manage(membership: Membership, field: str) -> bool:
    return membership.has_capability(RULES[field][1])
