import csv
import io

import pytest

from apps.audit.models import AuditLog
from apps.organizations.roles import Role

from .factories import PropertyFactory, UnitFactory, UnitTypeFactory

pytestmark = pytest.mark.django_db

YEAR = {"start": "2026-01-01", "end": "2026-12-31"}


def ok(res):
    assert 200 <= res.status_code < 300, getattr(res, "data", res)
    return res


@pytest.fixture
def estate(make_member, org_a):
    owner, client = make_member(org_a)
    kilimani = PropertyFactory(organization=org_a, name="Kilimani")
    ruaka = PropertyFactory(organization=org_a, name="Ruaka")
    a1 = UnitFactory(unit_type=UnitTypeFactory(property=kilimani), number="A1")
    return {"owner": owner, "client": client, "kilimani": kilimani, "ruaka": ruaka, "a1": a1}


def expense(client, property_=None, **fields):
    data = {
        "category": "utilities",
        "description": "Common area electricity",
        "amount": "4200",
        "incurred_on": "2026-09-10",
        "property": str(property_.pk) if property_ else None,
        **fields,
    }
    return client.post("/api/v1/expenses/", data, format="json")


def test_record_edit_and_void_an_expense(estate):
    client = estate["client"]
    res = ok(
        expense(
            client,
            estate["kilimani"],
            unit=str(estate["a1"].pk),
            supplier_name="Kenya Power",
            method="mpesa",
            payment_reference="SJK123",
        )
    )
    e = res.data
    assert res.status_code == 201
    assert (e["reference"], e["property_name"], e["unit_number"]) == ("EXP-0001", "Kilimani", "A1")
    assert e["status"] == "recorded" and e["created_by_name"]

    edited = ok(client.patch(f"/api/v1/expenses/{e['id']}/", {"amount": "4500"})).data
    assert edited["amount"] == "4500.00"
    update = AuditLog.objects.get(action="expense.updated")
    assert update.changes == {"amount": {"from": "4200.00", "to": "4500.00"}}

    # Moving to another property drops a unit that belongs to the old one.
    moved = ok(
        client.patch(
            f"/api/v1/expenses/{e['id']}/", {"property": str(estate["ruaka"].pk)}, format="json"
        )
    ).data
    assert (moved["property_name"], moved["unit"]) == ("Ruaka", None)

    assert client.post(f"/api/v1/expenses/{e['id']}/void/", {"reason": " "}).status_code == 400
    voided = ok(client.post(f"/api/v1/expenses/{e['id']}/void/", {"reason": "Entered twice"}))
    assert voided.data["status"] == "voided" and voided.data["void_reason"] == "Entered twice"
    assert client.post(f"/api/v1/expenses/{e['id']}/void/", {"reason": "x"}).status_code == 409
    assert client.patch(f"/api/v1/expenses/{e['id']}/", {"amount": "1"}).status_code == 409
    assert client.delete(f"/api/v1/expenses/{e['id']}/").status_code == 405
    assert set(AuditLog.objects.values_list("action", flat=True)) >= {
        "expense.recorded",
        "expense.updated",
        "expense.voided",
    }


def test_expense_rules(estate):
    client = estate["client"]
    assert expense(client, estate["kilimani"], incurred_on="2099-01-01").status_code == 409
    assert expense(client, estate["kilimani"], amount="0").status_code == 400
    # The unit must belong to the chosen property, and a unit needs a property.
    assert expense(client, estate["ruaka"], unit=str(estate["a1"].pk)).status_code == 409
    assert expense(client, None, unit=str(estate["a1"].pk)).status_code == 409
    # Owners can record organization-wide costs.
    org_wide = ok(expense(client, None, category="professional", description="Audit fee")).data
    assert org_wide["property"] is None and org_wide["property_name"] is None


def test_list_filters_and_summary(estate):
    client = estate["client"]
    ok(expense(client, estate["kilimani"], amount="1000", incurred_on="2026-08-05"))
    ok(expense(client, estate["kilimani"], category="security", amount="3000"))
    ok(expense(client, estate["ruaka"], category="security", amount="2000"))
    office = ok(expense(client, None, category="office", amount="500")).data
    void = ok(expense(client, estate["ruaka"], amount="9999")).data
    ok(client.post(f"/api/v1/expenses/{void['id']}/void/", {"reason": "Wrong"}))

    assert client.get("/api/v1/expenses/").data["count"] == 5
    sept = client.get("/api/v1/expenses/", {"start": "2026-09-01", "end": "2026-09-30"})
    assert sept.data["count"] == 4
    wide = client.get("/api/v1/expenses/", {"organization_wide": "true"}).data
    assert [r["id"] for r in wide["results"]] == [office["id"]]
    assert client.get("/api/v1/expenses/", {"category": "security"}).data["count"] == 2

    s = ok(client.get("/api/v1/expenses/summary/")).data
    assert (s["count"], s["total"]) == (4, "6500.00")  # the voided one doesn't count
    assert s["by_category"][0] == {
        "category": "security",
        "label": "Security",
        "count": 2,
        "total": "5000.00",
    }
    kilimani = ok(
        client.get("/api/v1/expenses/summary/", {"property": str(estate["kilimani"].pk)})
    ).data
    assert kilimani["total"] == "4000.00"


def test_permissions_and_assigned_scope(estate, make_member, org_a, org_b):
    client = estate["client"]
    ok(expense(client, estate["kilimani"]))
    ok(expense(client, estate["ruaka"]))
    office = ok(expense(client, None, category="office")).data

    manager, as_manager = make_member(org_a, role=Role.PROPERTY_MANAGER)
    ok(
        client.post(
            "/api/v1/property-assignments/",
            {"property": str(estate["kilimani"].pk), "membership": str(manager.pk)},
        )
    )
    seen = as_manager.get("/api/v1/expenses/").data
    assert [r["property_name"] for r in seen["results"]] == ["Kilimani"]
    assert as_manager.get(f"/api/v1/expenses/{office['id']}/").status_code == 404
    ok(expense(as_manager, estate["kilimani"]))
    assert expense(as_manager, estate["ruaka"]).status_code == 400  # not their property
    assert expense(as_manager, None).status_code == 409  # can't record organization-wide
    mine = seen["results"][0]["id"]
    # Voiding is owner-only by default.
    assert as_manager.post(f"/api/v1/expenses/{mine}/void/", {"reason": "x"}).status_code == 403

    _, accountant = make_member(org_a, role=Role.ACCOUNTANT)
    assert accountant.get("/api/v1/expenses/").data["count"] == 4
    _, caretaker = make_member(org_a, role=Role.CARETAKER)
    assert caretaker.get("/api/v1/expenses/").status_code == 403

    _, outsider = make_member(org_b)
    assert outsider.get("/api/v1/expenses/").data["count"] == 0
    assert outsider.get(f"/api/v1/expenses/{office['id']}/").status_code == 404
    assert expense(outsider, estate["kilimani"]).status_code == 400


@pytest.fixture
def spending(estate):
    """Kilimani: 3,000 security + a 2,500 repair; Ruaka: 1,000 utilities; office: 500."""
    client = estate["client"]
    ok(expense(client, estate["kilimani"], category="security", amount="3000"))
    ok(expense(client, estate["ruaka"], amount="1000"))
    ok(expense(client, None, category="office", description="Office rent", amount="500"))
    voided = ok(expense(client, estate["ruaka"], amount="7777")).data
    ok(client.post(f"/api/v1/expenses/{voided['id']}/void/", {"reason": "Wrong"}))
    repair = ok(
        client.post(
            "/api/v1/maintenance/",
            {
                "unit": str(estate["a1"].pk),
                "category": "plumbing",
                "title": "Leak",
                "description": "Sink",
                "urgency": "normal",
            },
        )
    ).data
    ok(
        client.post(
            f"/api/v1/maintenance/{repair['id']}/costs/",
            {
                "kind": "expense",
                "description": "New trap",
                "amount": "2500",
                "incurred_on": "2026-09-15",
            },
        )
    )
    return estate


def report(client, key, **params):
    return ok(client.get(f"/api/v1/reports/{key}/", params)).data


def summary(data):
    return {i["label"]: i["value"] for i in data["summary"]}


def test_financial_summary_includes_expenses_and_net_operating_income(spending):
    data = report(spending["client"], "financial-summary", **YEAR)
    s = summary(data)
    assert (s["Maintenance costs"], s["Other expenses"]) == ("2500.00", "4500.00")
    assert s["Net operating income"] == "-7000.00"  # nothing billed in this estate
    other = next(sec for sec in data["sections"] if sec["title"] == "Other expenses")
    assert [r["category"] for r in other["rows"]][0] == "Security"
    assert other["totals"]["amount"] == "4500.00"

    # One property: organization-wide costs are left out.
    ruaka = summary(
        report(spending["client"], "financial-summary", property=str(spending["ruaka"].pk), **YEAR)
    )
    assert ruaka["Other expenses"] == "1000.00"


def test_expenses_report(spending, make_member, org_a):
    data = report(spending["client"], "expenses", **YEAR)
    s = summary(data)
    assert (s["Spent"], s["Expenses recorded"], s["Largest category"]) == (
        "7000.00",
        "4",
        "Security",
    )
    by_category = {r["category"]: r for r in data["sections"][0]["rows"]}
    assert by_category["Repairs (maintenance requests)"]["amount"] == "2500.00"
    assert by_category["Security"]["share"] == "42.9"
    by_property = [(r["property"], r["amount"]) for r in data["sections"][1]["rows"]]
    assert by_property == [
        ("Kilimani", "5500.00"),
        ("Ruaka", "1000.00"),
        ("Organization-wide", "500.00"),
    ]
    assert data["sections"][2]["totals"]["amount"] == "7000.00"

    # An accountant without maintenance.costs sees running costs only.
    _, client = make_member(org_a, role=Role.ACCOUNTANT, revoked_permissions=["maintenance.costs"])
    assert summary(report(client, "expenses", **YEAR))["Spent"] == "4500.00"

    _, caretaker = make_member(org_a, role=Role.CARETAKER)
    assert caretaker.get("/api/v1/reports/expenses/").status_code == 403
    listed = {r["key"]: r for r in spending["client"].get("/api/v1/reports/").data}
    assert listed["expenses"]["available"] is True


def test_expenses_report_exports(spending):
    res = spending["client"].get("/api/v1/reports/expenses/", {**YEAR, "export": "csv"})
    assert res.status_code == 200
    rows = list(csv.reader(io.StringIO(res.content.decode("utf-8-sig"))))
    assert any("Office rent" in row for row in rows)
    assert ["Total", "", "", "", "", "", "", "", "7000.00"] in rows
    assert "expenses-2026-01-01-to-2026-12-31.csv" in res["Content-Disposition"]
    for fmt in ("pdf", "xlsx"):  # the totals row has "Total" in the date column
        res = spending["client"].get("/api/v1/reports/expenses/", {**YEAR, "export": fmt})
        assert res.status_code == 200 and len(res.content) > 1000
