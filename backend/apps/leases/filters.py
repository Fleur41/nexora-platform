from datetime import timedelta

import django_filters

from apps.organizations.models import organization_today

from .models import Lease


class LeaseFilter(django_filters.FilterSet):
    property = django_filters.UUIDFilter(field_name="unit__property")
    expiring_within_days = django_filters.NumberFilter(method="filter_expiring")

    class Meta:
        model = Lease
        fields = ["status", "tenant", "unit", "billing_frequency"]

    def filter_expiring(self, queryset, name, value):
        """Active fixed-term leases whose end date falls within the next N days."""
        organization = self.request.organization
        today = organization_today(organization)
        return queryset.filter(
            status=Lease.Status.ACTIVE,
            end_date__isnull=False,
            end_date__lte=today + timedelta(days=int(value)),
        ).order_by("end_date")
