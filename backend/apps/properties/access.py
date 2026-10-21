"""Record-level access for the property module.

Organization-scope members see every property in the organization. Assigned-scope
members (e.g. caretakers) see only properties they are assigned to, and records that
hang off those properties (units, leases, documents, tenants on those leases).
"""

from django.db.models import QuerySet

from apps.organizations.access import OrganizationScopedViewSet
from apps.organizations.models import Membership

from .models import Property


def accessible_properties(membership: Membership) -> QuerySet[Property]:
    queryset = Property.objects.filter(organization=membership.organization)
    if membership.has_organization_scope:
        return queryset
    return queryset.filter(assignments__membership=membership)


def can_access_property(membership: Membership, property_id) -> bool:
    return accessible_properties(membership).filter(pk=property_id).exists()


class PropertyScopedViewSet(OrganizationScopedViewSet):
    """Adds property-level filtering on top of organization isolation.

    `property_path` is the ORM path from the model to its Property ("" for Property itself).
    """

    property_path = "property"

    def get_queryset(self):
        queryset = super().get_queryset()
        membership = self.request.membership
        if membership.has_organization_scope:
            return queryset
        lookup = f"{self.property_path}__in" if self.property_path else "pk__in"
        return queryset.filter(**{lookup: accessible_properties(membership).values("pk")})
