# Nexora roadmap and progress

Each phase is done only when it meets the Definition of Done: models and migrations, working
APIs, frontend wired to the real backend, authorization enforced, all UI states handled,
automated tests, and README instructions.

## Phase 1 — Platform foundation ✅ complete

- [x] Monorepo: `backend/` (Django 5.2 + DRF), `frontend/` (Next.js 16), `docs/`
- [x] Docker Compose: Postgres 17, Redis 7, Mailpit, backend, Celery worker, frontend
- [x] Environment-based settings (`base`/`dev`/`test`/`prod`), `.env.example` files
- [x] Custom email-based `User` (UUID PK, case-insensitive unique email)
- [x] Session auth + CSRF: register, login, logout, me, change password, password reset
- [x] `Organization`, `Membership` (soft removal), `Invitation` (hashed, expiring, rotating tokens)
- [x] Roles + capability registry with per-member grants/revocations; escalation guards
- [x] Active-organization resolution (`X-Organization-ID`) with membership checks on every request
- [x] `OrganizationScopedModel` / `OrganizationScopedViewSet` / scoped related field for future modules
- [x] Append-only audit log with diffs, request ids, IP and user agent
- [x] Consistent error envelope, throttling on auth/public endpoints, request-id logging, health endpoint
- [x] OpenAPI schema + Swagger UI (validated with `--fail-on-warn`)
- [x] Frontend: landing page, auth pages, invitation acceptance, onboarding, dashboard shell with
      organization switcher, team management (members, invitations, access editing), audit log,
      organization settings, account settings; loading/empty/error/confirm states; PWA manifest
- [x] Tests at the end of Phase 1: 61 backend (pytest, Postgres), 20 frontend (Vitest + Testing Library)
- [x] CI workflow: ruff, `check --deploy`, migration drift, pytest, ESLint, tsc, Vitest, `next build`

Covered requirement tests: #1 (organization isolation, platform layer), #15 (staff cannot exceed
permissions), #18 (permission/membership changes audited), #20 (future modules reuse the platform
layer with isolation).

## Phase 2 — Properties, tenants and leases ✅ complete

- [x] `Membership.access_scope` (whole organization vs assigned properties) with role defaults,
      escalation guards and a data migration for existing members
- [x] `apps/properties`: Property (per-org `PRP-` references), configurable UnitType per property,
      Unit with manual and lease-driven statuses, PropertyAssignment, bulk unit creation, summaries
- [x] `apps/tenants`: Tenant with Kenyan phone normalisation, unique identity per organization,
      sensitive fields hidden without `tenants.manage`, archive/restore (no deletion)
- [x] `apps/leases`: draft/active/ended/cancelled lifecycle, effective-dated rent terms, optional
      (zero) deposits, unit occupancy transitions, DB exclusion constraint against overlapping
      tenancies, expiring-lease filter, hourly `reserved → occupied` beat job
- [x] `apps/documents`: private uploads validated by content, soft delete, permission-checked downloads
- [x] Per-organization reference sequences (`core.OrganizationSequence`) and money conventions (`core.money`)
- [x] Frontend: properties list and detail (visual unit grid, unit types, details, photos and files,
      staff access), units list, tenants list and detail, leases list (incl. expiring), new lease
      form, lease detail (rent schedule, activate/cancel/end), overview occupancy stats, team
      record-access controls
- [x] Tests: 106 backend, 35 frontend unit, 3 Playwright browser tests (full owner flow on desktop,
      landing/auth at phone width); e2e job added to CI

Covered requirement tests: #2 (multiple properties and unit types), #11 (overlapping active leases
prevented), #15 (scoped staff cannot exceed permissions or reach unassigned properties), #1/#20
extended to every property-module record. A unit is never released automatically when a lease
ends (#10, groundwork for move-out notices).

## Phase 3 — Billing and accounting
Charge types and effective-dated rules (organization/property/unit-type/unit scope), invoices and
line items, idempotent period billing, utility meters and readings, deposits as liabilities,
tenant ledger.

## Phase 4 — Payments
Per-organization payment configurations (with history), manual payments, allocations, receipts,
reversals, reconciliation queue, Daraja adapter (sandbox), bank statement import, encrypted
integration credentials.

## Phase 5 — Maintenance and operations
Maintenance requests and work orders, inspections, move-out workflow, deposit settlement,
notification abstraction (in-app/email/SMS) with delivery records and de-duplication.

## Phase 6 — Reports and public website
Financial and occupancy reports (monthly/yearly/custom), exports (CSV/XLSX/PDF), public listings,
enquiries and viewing requests.

## Phase 7 — SaaS and production readiness
Subscription plans and limits, platform administration console with audited, time-limited
support access, security review, accessibility audit, deployment and backup runbooks.

## Known limitations (current)

- Billing, payments, deposits ledger, maintenance and reports are not built yet; the navigation
  lists only built pages.
- Ending a lease is the authorized closing step only. Move-out notices, inspections and deposit
  settlement arrive in Phase 5.
- Property photos are private for now. Public listings (Phase 6) will add an explicit
  publish step for chosen photos.
- Utility meter numbers are stored on units, but readings and consumption billing are Phase 3.
- Lists used in pickers (properties, tenants in the lease form) load the first 50–100 records
  plus server-side search. Very large portfolios will want typeahead pickers.
- No tenant portal, platform admin console or subscriptions yet (Phases 5–7).
- Email is console/Mailpit in development; there's no production email or SMS provider configured.
- `Membership.status = suspended` exists in the model but has no API to set it yet (only removal).
- Organization `status` (suspension) is changed only via the Django admin for now.
- Browser tests cover the owner property flow and mobile auth pages. Invitation acceptance and
  caretaker scoping are covered by API tests, not yet by browser tests.
- `SECURE_HSTS_PRELOAD` is left off deliberately; enable it per deployment once the domain is ready.
- PostgreSQL row-level security is not enabled; isolation is enforced in the application layer and
  covered by tests.
