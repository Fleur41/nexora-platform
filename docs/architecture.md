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
model (Phase 5), so a tenant can never reach staff endpoints by role misconfiguration.

### Record scope (assigned properties)

Capabilities say *what* a member may do. `Membership.access_scope` says *which records*:

- `organization`: every record in the organization (owners always; accountants by default).
- `assigned`: only properties listed in `PropertyAssignment` for that member (default for
  property managers and caretakers), plus records hanging off them.

`apps.properties.access.PropertyScopedViewSet` applies this on top of organization filtering.
Each view declares `property_path` (e.g. `"unit__property"` for leases). Tenants are visible to
assigned-scope members when they have a lease on an accessible property, or when the member
registered them and they have no lease yet. Serializer related fields (`AccessiblePropertyField`,
`AccessibleUnitField`, `AccessibleTenantField`) apply the same scope to writes. Only members with
organization scope can widen someone else's scope, and a member can only assign properties they
can access themselves.

## Property module invariants

- **Units** have a status. Staff set `available`, `under_maintenance` and `unavailable` by hand.
  `reserved` and `occupied` are set only by lease activation; `notice_submitted` will be set by the
  move-out workflow (Phase 5). Ending a lease moves the unit to a status the closer chooses
  (including `awaiting_inspection`), never automatically to `available`.
- **Leases**: `draft → active → ended`, or `draft → cancelled`. Only drafts are editable. Two
  database constraints protect occupancy: a partial unique index (one active lease per unit) and
  a PostgreSQL exclusion constraint (`btree_gist`) that rejects overlapping date ranges for
  active/ended leases on the same unit, using `daterange(start_date, coalesce(ended_on, end_date))`.
- **Rent** lives in `LeaseRentTerm` rows with `effective_from`. On an active lease new terms
  must start in the future, and terms already in force can't be removed. Changing a unit's
  asking rent never touches existing leases.
- **References** (`PRP-0001`, `LSE-0001`) come from `core.OrganizationSequence`, a per-organization
  counter locked with `SELECT … FOR UPDATE`. Invoices and receipts will use it too.
- **Dates** that matter for business rules ("today") use the organization's timezone
  (`organizations.models.organization_today`), not the server's.
- An hourly Celery beat job (`leases.tasks.sync_unit_occupancy`) flips `reserved` units to
  `occupied` when their lease starts. It runs per organization and is idempotent.

## Documents

`apps.documents.Document` attaches a private file to exactly one of property, unit, tenant or
lease (enforced by a check constraint). Uploads are sniffed by magic bytes; the client's
filename and MIME type are not trusted. Files are stored under `org/<org_id>/<random>.<ext>` in
the `private` storage (local disk in development; point it at an S3-compatible bucket in
production). Viewing needs the view capability of the attached record, except tenant documents
(IDs), which need `tenants.manage`. Deletes are soft and audited. Downloads go through
`/documents/{id}/download/` with `nosniff`, a sandboxing CSP and `no-store`; the frontend fetches
them as blobs because the organization header can't be sent from a plain link.

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

## Billing (Phase 3)

### Charges

- `ChargeType` names a charge and its report category (`rental_income`, `utility_recovery`,
  `service_charge`, `other_income`). Defaults are created per organization, but **nothing is
  billed for a type until there is an enabled `ChargeRule` with a positive amount**.
- `ChargeRule` scopes are organization, property, unit type or unit. The most specific rule in
  force on a day wins, including a *disabled* rule, which is how one unit opts out of a
  property-wide charge. Methods: `fixed_monthly`, `one_time`, `metered` (rate per unit of use)
  and `shared` (amounts come from `SharedCost`). `included_in_rent` rules are shown, never billed.
- Rules are effective-dated. A PostgreSQL exclusion constraint forbids overlapping rules for the
  same charge type and scope (`scope_key`). Once a rule has been billed, only its note can change.
  You end it and add a new rule, so past invoices keep their terms.
- Rent never has rules. It comes from each lease's `LeaseRentTerm`s.

### The billing engine (`billing/engine.py`)

`draft_month(org, month)` computes, without writing anything:

- **Recurring** (rent and fixed charges) for each lease whose billing period starts this month.
  Periods are anchored on the lease's first month (quarterly from October = Oct–Dec, Jan–Mar…).
  Amounts are prorated by day per calendar month: `rate × days / days_in_month`, with segments
  split wherever a rent term or rule changes. Each line is rounded half-up to cents.
- **One-time** charges, once per lease.
- **Metered** usage from consecutive readings where the earlier reading is on/after the lease
  start and the later one is unbilled; the billed line is recorded on the reading.
- **Shared** costs for the month, split evenly to the cent (remainder cents to the first units)
  among occupied units whose resolved rule uses the shared method.

Every line carries a `dedupe_key` (e.g. `recurring:<lease>:<charge type>:<period start>`,
`meter:<meter>:<reading>`, `shared:<cost>:<lease>`, `once:<lease>:<charge type>`). A partial
unique index on `(organization, dedupe_key)` for non-void lines is the hard guarantee against
double billing. The engine also drops already-billed keys, so re-running a month only posts what
is new. That new material lands on a *supplementary* invoice if the regular one already exists.

`services.run_billing` locks the organization's `BillingSettings` row (serialising runs), posts
each invoice in its own savepoint, and records a `BillingRun` and an audit event. The preview
endpoint returns the same drafts without saving. Billing runs need whole-organization access.

### Ledger and corrections

`LedgerEntry` is append-only per lease: `+` for invoices; `−` for credits, voids and (Phase 4)
payments. Balances and statements are sums; an invoice's amount due is the sum of its entries.
A void reverses the whole invoice and frees its dedupe keys and readings for rebilling. It's only
allowed while nothing has been credited or paid against the invoice; otherwise you credit the
balance. Credits get `CRN-` references.

### Deposits

`DepositTransaction` (received, deduction, refund, reversal) is a separate liability ledger:
held = received − deducted − refunded. Deposits never appear on invoices or in rent balances.
Deductions and refunds need a reason and can't exceed what's held, and a receipt can't be
reversed while deductions/refunds made from it stand. Transactions are immutable; reversals undo
them.

### Scheduled billing

`billing.tasks.run_scheduled_billing_for_all` runs several times a day via Celery beat. For each
organization with `auto_generate` on, once the organization-local date reaches `generate_day`, it
runs the current month at most once (`trigger=scheduled`). Thanks to dedupe keys, even a duplicate
run cannot double-bill.

## Payments (Phase 4)

### Payment methods

`PaymentConfiguration` holds a landlord's own method (M-Pesa paybill/till, bank, cash, other),
organization-wide or for one property (a property's methods replace the organization's for its
tenants). Tenant-facing details live there. Provider secrets live in `IntegrationCredential`,
encrypted with `core.crypto.EncryptedTextField` (Fernet, `NEXORA_FIELD_ENCRYPTION_KEY`, rotation
via `MultiFernet`). `integration_status` only becomes `verified` after a successful OAuth call.
Each payment stores a `configuration_snapshot`, so editing a method never rewrites history.

### Payments and allocation

`Payment` is immutable money received with a receipt number (`RCT-`). It's unmatched while
`lease` is null. Ledger representation per lease (`billing.LedgerEntry`, now with a `payment` FK):

| Event | Entries |
| ----- | ------- |
| Payment A allocated aᵢ to invoices | `−aᵢ` (invoice i) each, and `−(A−Σaᵢ)` (no invoice) as credit held |
| Credit c applied to invoice I | `+c` (no invoice), `−c` (invoice I) (type `allocation`) |
| Refund f of credit | `+f` (no invoice) (type `refund`) |
| Reversal | the exact opposite of every entry of the payment (type `payment_reversal`) |

So a lease balance stays the sum of its entries, an invoice's amount due is the sum of entries
pointing at it, and credit held is minus the sum of no-invoice payment entries. Default allocation
is oldest due first. Credit is applied automatically after each billing run and one-off invoice.
All movements lock the lease row. Invoices with payments against them can't be voided.

Uniqueness: `(organization, source, external_id)` for provider transactions and import rows, and
`(organization, method, reference)` for live (non-reversed) payments.

### M-Pesa (`payments/mpesa.py`, `payments/providers/mpesa.py`)

`DarajaClient` covers OAuth, STK push, STK query and C2B URL registration over urllib, with
timeouts and staff-safe error messages (`DarajaError`). Callbacks arrive at
`/api/v1/integrations/mpesa/<secret-token>/{c2b/confirmation,c2b/validation,stk/callback}/`; the token
is stored encrypted plus hashed for lookup, and optional IP allowlisting applies. Each callback is
saved as a `ProviderEvent` (phones masked). A partial unique index allows only one *processed*
event per transaction, so repeats become `duplicate`. STK results are re-verified with the STK
query API and amount-checked before a payment is recorded; mismatches go to *needs review*. See
[mpesa.md](mpesa.md).

### Bank statements

Bank account numbers alone don't reveal incoming money. `payments/imports.py` reads CSV
statements (flexible headers; DD/MM/YYYY and ISO dates). Credit rows become payments with a SHA-256
fingerprint as `external_id`, so re-imports are no-ops. Rows naming exactly one lease reference
(`LSE-…`) are matched; the rest go to the reconciliation queue. No bank API is integrated yet; the
import is the supported path.
