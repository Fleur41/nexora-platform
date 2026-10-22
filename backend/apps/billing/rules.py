"""Resolve which charge rule applies to a unit on a date."""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from .models import ChargeRule

ONE_DAY_ORDINAL = 1


class RuleBook:
    """All charge rules of an organization, loaded once per billing run."""

    def __init__(self, organization):
        self._by_type: dict = defaultdict(list)
        for rule in ChargeRule.objects.filter(organization=organization).select_related(
            "charge_type"
        ):
            self._by_type[rule.charge_type_id].append(rule)

    def charge_type_ids(self):
        return list(self._by_type)

    @staticmethod
    def _matches(rule: ChargeRule, unit) -> bool:
        if rule.scope == ChargeRule.Scope.ORGANIZATION:
            return True
        if rule.scope == ChargeRule.Scope.PROPERTY:
            return rule.property_id == unit.property_id
        if rule.scope == ChargeRule.Scope.UNIT_TYPE:
            return rule.unit_type_id == unit.unit_type_id
        return rule.unit_id == unit.pk

    def resolve(self, charge_type_id, unit, on: date) -> ChargeRule | None:
        """The most specific rule in force on `on`, enabled or not.

        A disabled rule still wins over broader ones: that is how a unit opts out of a
        property-wide charge.
        """
        candidates = [
            r
            for r in self._by_type.get(charge_type_id, ())
            if r.effective_from <= on
            and (r.effective_to is None or r.effective_to >= on)
            and self._matches(r, unit)
        ]
        if not candidates:
            return None
        return max(candidates, key=lambda r: ChargeRule.SPECIFICITY[r.scope])

    def change_dates(self, charge_type_id) -> list[date]:
        """Days on which the applicable rule for this charge type may change."""
        dates = []
        for rule in self._by_type.get(charge_type_id, ()):
            dates.append(rule.effective_from)
            if rule.effective_to is not None:
                dates.append(date.fromordinal(rule.effective_to.toordinal() + ONE_DAY_ORDINAL))
        return dates
