# Nexora architecture

## Shape: modular monolith

One Django project and one Next.js app, deployed independently. There are no microservices: the
domain is still forming and cross-module transactions (e.g. payment allocation touching invoices
and deposits) are much safer in a single database transaction.

```
Browser ──► Next.js (UI only) ──/api/* rewrite──► Django REST API ──► PostgreSQL
                                                     │
                                                     └─► Celery (Redis broker) ─► email/SMS/providers
```

Django owns **all** business rules, authorization, financial calculations and data access. The
frontend only renders state and submits intents; capability checks in the UI are cosmetic hints.

## Layers

| Layer | Location | Responsibility |
| ----- | -------- | -------------- |
| Shared platform | `apps/core`, `apps/accounts`, `apps/organizations`, `apps/audit` | identity, organizations, membership, roles/capabilities, audit, error envelope, module registry |
| Business modules | `apps/<module>` (from Phase 2) | properties, leases, billing, payments, expenses, maintenance, reporting |
| Integrations | `apps/integrations/*` (from Phase 4) | M-Pesa (Daraja), banks, email/SMS providers, storage |
| Experiences | `frontend/app/(public)`, `(auth)`, `dashboard`, later `portal`, `platform` | public site, org dashboard, tenant portal, platform admin |

## Multi-tenancy

- `Organization` is the tenant. Every private business model inherits
  `apps.core.models.OrganizationScopedModel` (UUID PK and a non-null `organization` FK).
- `apps.organizations.access.OrganizationPermission` resolves the active `Membership` from the
  `X-Organization-ID` header and the authenticated user. The membership and organization must
  both be active. The result is bound to `request.membership` / `request.organization`.
- `OrganizationScopedViewSet` filters `get_queryset()` by that organization and injects it on
  create. Views must declare `required_capabilities = {action: capability | None}`; any action
  not listed is denied.
- `OrganizationScopedPrimaryKeyRelatedField` restricts related-object lookups to the active
  organization. Use it for every FK a client can set (e.g. `unit`, `lease`, `invoice`) so records
  can't be linked across organizations by crafted IDs.
- Background jobs must take an `organization_id` argument and query through it, never "all rows".
- PostgreSQL row-level security is a candidate second layer once module tables exist. It is not
  enabled in Phase 1.

## Roles and capabilities

Roles (`owner`, `property_manager`, `accountant`, `caretaker`) are platform-level. Capabilities
are strings registered per module through `apps.core.modules.registry`:

```python
ModuleDefinition(
    key="property",
    name="Nexora Property",
    capabilities={"properties.view": "...", "properties.manage": "..."},
    role_defaults={Role.PROPERTY_MANAGER: {"properties.view", "properties.manage"}},
)
```

A membership's effective capabilities are: owner → all registered; otherwise role defaults ∪
`extra_permissions` − `revoked_permissions`. A new module (e.g. POS) registers its capabilities
in `AppConfig.ready()` and immediately works with existing roles, invitations and isolation.
This is covered by `tests/test_platform.py::test_new_module_capabilities_flow_through_shared_roles`.

Tenants and prospective tenants are **not** memberships. They will get their own portal access
model in Phase 2/5, so a tenant can never reach staff endpoints by role misconfiguration.

## Authentication

- Django sessions (`nexora_session`, HttpOnly, SameSite=Lax; `Secure` in prod) and CSRF cookie
  `nexora_csrftoken` sent back as `X-CSRFToken`. Anonymous auth endpoints are also
  `csrf_protect`ed to prevent login CSRF.
- Passwords use Django's hasher and validators (min length 10, common/numeric/similarity checks).
- Password reset uses Django's token generator; responses never reveal whether an email exists.
- Invitations: a 256-bit random token is emailed; only its SHA-256 is stored. It expires (7 days
  by default), rotates on resend, and must be accepted by the account whose email it was sent to.

## API conventions

- Versioned under `/api/v1/`; OpenAPI at `/api/v1/schema/`, Swagger UI at `/api/v1/docs/`.
- Errors: `{"error": {"code", "message", "details?"}}`. `details` maps field → messages for
  validation errors. Unhandled exceptions are logged with the request id and returned as a
  generic 500.
- Business-rule conflicts (e.g. removing the last owner) return **409** `conflict`.
- Pagination: `?page=`, `?page_size=` (max 100). Filtering, `?search=` and `?ordering=` via
  django-filter / DRF filters.
- Every response carries `X-Request-ID`, which is also written into logs and audit entries.

## Money (for Phase 3+)

Decided now so every module follows it:

- `DecimalField(max_digits=14, decimal_places=2)` and `decimal.Decimal` throughout; no floats.
- Currency stored per organization (default KES) and copied onto financial documents.
- Round half-up to 2 dp at line-item level, then sum. Balances are derived from ledger entries
  and never stored as the only source of truth.
- Posted financial records are never deleted or edited. Corrections are reversals or adjustments
  with an audit entry.
- Refundable deposits are a liability, never income.

## Audit

`apps.audit.services.record_event(request, action, target=..., changes=...)` writes an immutable
`AuditLog` row with actor, organization, IP (from `REMOTE_ADDR`; configure the proxy to set it),
user agent and request id. Call it inside the same transaction as the change it records.
