import pytest

from apps.audit.models import AuditLog
from apps.audit.services import record_event
from apps.core.modules import ModuleDefinition, ModuleRegistry, registry
from apps.organizations.roles import Role

pytestmark = pytest.mark.django_db


def test_audit_entries_are_immutable(org_a):
    entry = record_event(None, "test.event", organization=org_a)
    entry.action = "tampered"
    with pytest.raises(PermissionError):
        entry.save()
    with pytest.raises(PermissionError):
        entry.delete()
    with pytest.raises(PermissionError):
        AuditLog.objects.filter(pk=entry.pk).update(action="tampered")
    with pytest.raises(PermissionError):
        AuditLog.objects.filter(pk=entry.pk).delete()


def test_membership_changes_are_audited_with_diff(make_member, org_a):
    _, client = make_member(org_a)
    target, _ = make_member(org_a, role=Role.CARETAKER)
    client.patch(f"/api/v1/members/{target.pk}/", {"role": "accountant"})
    log = AuditLog.objects.get(action="membership.updated")
    assert log.changes == {"role": {"from": "caretaker", "to": "accountant"}}
    assert log.actor_email
    assert log.organization == org_a


def test_registry_rejects_duplicates_and_unknown_role_grants():
    reg = ModuleRegistry()
    reg.register(ModuleDefinition(key="a", name="A", capabilities={"a.x": "X"}))
    with pytest.raises(ValueError):
        reg.register(ModuleDefinition(key="b", name="B", capabilities={"a.x": "dup"}))
    with pytest.raises(ValueError):
        reg.register(
            ModuleDefinition(
                key="c", name="C", capabilities={"c.x": "X"}, role_defaults={"caretaker": {"c.y"}}
            )
        )


@pytest.fixture
def pos_module():
    """A future module registering its own capabilities on the shared platform registry."""
    module = ModuleDefinition(
        key="pos_test",
        name="Nexora POS (test)",
        capabilities={"pos_test.sell": "Ring up sales"},
        role_defaults={Role.ACCOUNTANT: {"pos_test.sell"}},
    )
    registry.register(module)
    yield module
    registry._modules.pop(module.key)
    registry._capabilities.pop("pos_test.sell")


def test_new_module_capabilities_flow_through_shared_roles(pos_module, make_member, org_a, org_b):
    accountant, _ = make_member(org_a, role=Role.ACCOUNTANT)
    caretaker, _ = make_member(org_a, role=Role.CARETAKER)
    owner_b, _ = make_member(org_b, role=Role.OWNER)
    assert accountant.has_capability("pos_test.sell")
    assert not caretaker.has_capability("pos_test.sell")
    assert owner_b.has_capability("pos_test.sell")  # owners get new module capabilities


def test_health_endpoint(api_client):
    res = api_client.get("/api/v1/health/")
    assert res.status_code == 200
    assert res.data == {"status": "ok", "database": True}


def test_openapi_schema_builds(make_member):
    _, client = make_member()
    res = client.get("/api/v1/schema/")
    assert res.status_code == 200
    assert b"/api/v1/members/" in res.content
