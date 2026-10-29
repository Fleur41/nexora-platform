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

## Phase 3 — Billing and accounting ✅ complete

- [x] `apps/billing`: default charge types; scoped, effective-dated charge rules (fixed monthly,
      one-time, metered, shared, included-in-rent, disabled overrides) with a DB no-overlap constraint
- [x] Billing engine with daily proration, period anchoring for quarterly/semi-annual/annual
      leases, mid-month rent/rule changes, final bills for ended leases
- [x] Idempotent billing runs with preview, supplementary invoices for late items, and DB-enforced
      dedupe keys; optional scheduled monthly billing (Celery beat, per-organization day)
- [x] Immutable invoices and append-only tenant ledger; credits (`CRN-`) and voids with reasons and
      audit; one-off invoices (occasional charges, opening balances); lease/tenant statements
- [x] `apps/utilities`: meters, readings with monotonic validation, bulk walk-round entry, locked
      once billed
- [x] Shared costs split exactly to the cent between units set up to share them
- [x] `apps/deposits`: received/deduction/refund/reversal ledger kept out of rent and income
- [x] Capabilities: `billing.view/configure/generate/adjust`, `meters.view/record`,
      `deposits.view/record/settle`; corrections and deposit settlement owner-only by default
- [x] Frontend: Billing (invoices, runs, shared costs, generate-with-preview), invoice detail with
      credit/void, Charges (rules, charge types, automatic billing), Utilities (meters, bulk
      readings, history), lease Account/Deposit/Charges panels, tenant balance, overview finance stats
- [x] Tests: 146 backend, 37 frontend unit, 4 Playwright (new: full billing flow)

Covered requirement tests: #3 (disabled/zero charges create no debt), #12 (deposits excluded from
rental income), #14 (no double counting: credits/voids net through one ledger), #17 (scheduled
and repeated billing cannot duplicate), #18 (financial corrections create audit records), plus
#1/#15 for all billing records.

## Phase 4 — Payments ✅ complete

- [x] Landlord-specific payment methods (M-Pesa paybill/till, bank, cash, other) with property
      overrides, tenant-facing instructions, validity dates and enable/disable
- [x] Encrypted provider credentials (Fernet, rotatable), write-only via the API
- [x] Payments with receipts, oldest-first or manual allocation, partial payments, overpayment
      credit auto-applied to later invoices, refunds of credit, full reversals; all through the
      lease ledger with audit events and row locks
- [x] Duplicate protection: unique provider/import ids and live payment references
- [x] Configuration snapshots on payments (settings changes never rewrite history)
- [x] Reconciliation queue for unmatched payments with manual matching
- [x] Bank CSV statement import with fingerprint de-duplication and automatic lease matching
- [x] M-Pesa Daraja: OAuth connection test, C2B URL registration, idempotent C2B confirmations
      matched by lease/unit account, STK push with server-side STK-query verification, per-config
      secret callback URLs, optional IP allowlist, masked event storage, stale-request expiry
- [x] Frontend: Payments (list, unmatched, M-Pesa requests, bank imports), payment detail with
      apply credit/refund/reverse, printable receipts, Payment settings with M-Pesa connection
      panel, lease page record payment / M-Pesa prompt / payment instructions, overview collections
- [x] Tests: 174 backend, 37 frontend unit, 5 Playwright (new: payments flow)

Covered requirement tests: #4 (partial payments), #5 (repeated callbacks), #6 (no cross-organization
allocation), #7 (different M-Pesa/bank arrangements per landlord), #8 (settings changes preserve
history), #19 (provider failures handled safely), plus #1/#15/#18 for payments.

**Not live yet:** M-Pesa has only been exercised against a simulated Daraja. Real sandbox/production
use needs the landlord's Daraja credentials and a public HTTPS URL ([mpesa.md](mpesa.md)).

## Phase 5 — Maintenance and operations (in progress)
Maintenance requests and work orders, inspections, move-out workflow, deposit settlement,
notification abstraction (in-app/email/SMS) with delivery records and de-duplication.

- [x] Maintenance: tenant/staff reporting, status workflow, assignment, quotes and costs
      (restricted to `maintenance.costs`), tenant-visible updates vs internal notes, photos
- [x] Inspections: move-in/move-out/routine, default checklist, conditions, damage charges,
      keys returned, typed signatures
- [x] Move-outs: private notices, acknowledgement, inspection scheduling, settlement preview and
      one-step completion (final bill, damages, deposit to arrears, refund, lease closure, unit)
- [x] Notifications: in-app inbox and bell, email/SMS with de-duplication, scheduled reminders,
      announcements, delivery log, per-organization settings
- [x] Tenant portal (`/portal`): home balance, bills, receipts, statement, pay (M-Pesa prompt or
      paybill/till/bank instructions), repairs with photos and messages, move-out notice
- [x] Tenant mobile app: the portal is an installable web app (own manifest, icons, home-screen
      install prompt incl. iOS instructions, offline page via a service worker that never
      caches account data)
- [x] Staff invite tenants to the app from the tenant page (email link, resend, revoke)
- [x] Playwright page objects; smoke suite (7) and a full sign-up → move-out regression journey
- [ ] Phase 5 records in `seed_demo` (inspections, notices, announcements, portal tenant)

## Phase 6 — Reports and public website
Financial and occupancy reports (monthly/yearly/custom), exports (CSV/XLSX/PDF), public listings,
enquiries and viewing requests.

## Phase 7 — SaaS and production readiness
Subscription plans and limits, platform administration console with audited, time-limited
support access, security review, accessibility audit, deployment and backup runbooks.

## Known limitations (current)

- Reports are not built yet; the navigation lists only built pages.
- M-Pesa integration is untested against Safaricom's real APIs (needs credentials); no direct bank
  API integration (CSV import only); receipts are printable pages, not emailed/SMSed yet (Phase 5).
- Payment allocation can't be moved between invoices after the fact; reverse and re-record instead.
- Invoices are not yet emailed/SMSed to tenants or downloadable as PDF (Phases 5–6).
- Shared costs split evenly per occupied unit; weighting by unit size or meter is not supported yet.
- Proration is by calendar day for all charges; there is no per-charge "no proration" option yet.
- Move-out settlement doesn't credit unused days on a month that was already billed; staff credit
  that invoice by hand if the agreement allows it (the settlement preview says so).
- Property photos are private for now. Public listings (Phase 6) will add an explicit
  publish step for chosen photos.
- Lists used in pickers (properties, tenants in the lease form) load the first 50–100 records
  plus server-side search. Very large portfolios will want typeahead pickers.
- No platform admin console or subscriptions yet (Phases 6–7).
- The tenant app is a web app installed to the home screen, not an App Store / Play Store app.
  Push notifications are not enabled yet; tenants see notifications in the app and by email.
- The tenant app works online only. Offline, it shows an offline page: nothing from the account is
  cached on the phone, by design.
- Email is console/Mailpit in development; there's no production email or SMS provider configured.
- `Membership.status = suspended` exists in the model but has no API to set it yet (only removal).
- Organization `status` (suspension) is changed only via the Django admin for now.
- Staff invitation acceptance and caretaker scoping are covered by API tests, not yet by browser
  tests. The tenant invitation is covered end to end (email read from Mailpit).
- `SECURE_HSTS_PRELOAD` is left off deliberately; enable it per deployment once the domain is ready.
- PostgreSQL row-level security is not enabled; isolation is enforced in the application layer and
  covered by tests.
