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
- [x] Tests: 61 backend (pytest, Postgres), 20 frontend (Vitest + Testing Library)
- [x] CI workflow: ruff, `check --deploy`, migration drift, pytest, ESLint, tsc, Vitest, `next build`

Covered requirement tests: #1 (organization isolation, platform layer), #15 (staff cannot exceed
permissions), #18 (permission/membership changes audited), #20 (future modules reuse the platform
layer with isolation).

## Phase 2 — Properties and tenants (next)

- [ ] `apps/properties`: Property, UnitType (configurable), Unit with an occupancy state machine
- [ ] Property assignments for property managers and caretakers (scope members to properties)
- [ ] `apps/tenants`: TenantProfile; tenant portal identity separate from staff memberships
- [ ] `apps/leases`: Lease with effective-dated terms; DB exclusion constraint against overlapping active leases
- [ ] Private document storage abstraction (S3-compatible) with signed URLs
- [ ] Dashboard pages: properties, units (visual overview), tenants, leases
- [ ] Register `property` module capabilities and role defaults

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

- Only the platform module exists. The dashboard says so, and the navigation lists only built pages.
- No tenant portal, platform admin console or subscriptions yet (Phases 5–7).
- Email is console/Mailpit in development; there's no production email or SMS provider configured.
- `Membership.status = suspended` exists in the model but has no API to set it yet (only removal).
- Organization `status` (suspension) is changed only via the Django admin for now.
- No end-to-end browser tests yet. The register → organization → invite → accept flow was
  verified with API smoke tests through the Next.js proxy, and every page returns 200 from the
  production build. The UI has not been clicked through in a real browser by automation yet.
  Playwright is planned alongside Phase 2.
- `SECURE_HSTS_PRELOAD` is left off deliberately; enable it per deployment once the domain is ready.
- PostgreSQL row-level security is not enabled; isolation is enforced in the application layer and
  covered by tests.
