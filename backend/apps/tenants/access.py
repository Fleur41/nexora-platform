from django.db.models import Q, QuerySet

from apps.organizations.models import Membership
from apps.properties.access import accessible_properties

from .models import Tenant


def accessible_tenants(membership: Membership) -> QuerySet[Tenant]:
    """Organization-scope members see all tenants. Assigned-scope members see tenants who
    have (or had) a lease on one of their properties, plus tenants they registered who
    have no lease yet."""
    queryset = Tenant.objects.filter(organization=membership.organization)
    if membership.has_organization_scope:
        return queryset
    return queryset.filter(
        Q(leases__unit__property__in=accessible_properties(membership).values("pk"))
        | Q(created_by=membership.user, leases__isnull=True)
    ).distinct()
