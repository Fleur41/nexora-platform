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

## Phase 5 — Maintenance and operations ✅ complete
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
- [x] Playwright page objects; smoke suite (7, incl. the tenant app at phone size) and a full
      sign-up → move-out regression journey with the landlord and the tenant app side by side
- [x] Phase 5 records in `seed_demo` (repairs, inspections, move-outs, announcements, a tenant
      app account); seeding no longer emails back-filled invoices, and the organization-wide
      security charge it skipped before is now created
- [x] Tests: 188 backend, 37 frontend unit, 8 Playwright (7 smoke + 1 regression)

## Phase 6 — Reports and public website ✅ complete
Financial and occupancy reports (monthly/yearly/custom), exports (CSV/XLSX/PDF), public listings,
enquiries and viewing requests.

- [x] Reports: financial summary (net billed by income category, money received by method,
      maintenance costs, deposits, arrears, collection rate, monthly chart), rent roll, aged
      arrears, occupancy with vacant units, deposits register, maintenance costs
- [x] Month, year or custom periods; one property or all; assigned staff see only their
      properties; income dated by the period it bills for
- [x] Exports: CSV, Excel and PDF, each audited
- [x] Public listings: publish a unit with chosen photos; shown only while the unit is free to
      let; area only, never the street address; search by area, rent and size
- [x] Enquiries and viewing requests from the website: staff notified, confirmation emails,
      viewings booked, outcomes recorded; rate-limited with a spam trap
- [x] Capabilities `reports.view`, `listings.view`, `listings.manage`
- [x] Sample data: published listings and enquiries; the manual covers Reports and Listings
- [x] Tests: 207 backend, 37 frontend unit, Playwright 9 smoke + regression journey

## Phase 7 — SaaS and production readiness ✅ complete
Subscription plans and limits, platform administration console with audited, time-limited
support access, security review, accessibility audit, deployment and backup runbooks.

- [x] Plans priced per unit in tiers (Starter, Growth, Pro, Enterprise by agreement), editable
      by staff; 30-day free trial for every new organization; unit limits enforced when adding
      units; plan changes re-price an unpaid invoice; downgrades below current usage refused
- [x] Nexora invoices: issued a week before access ends; M-Pesa prompt through Nexora's paybill
      (secret callback URL, IP allowlist, amount check) or paybill/bank recorded by staff;
      overdue banner, then read-only after 14 days' grace (enforced centrally, never deletes)
- [x] Owners' Subscription page and status banner (trial ending, overdue, read-only)
- [x] Platform console (`/platform`): overview and MRR, organizations, subscription controls,
      invoices (record payment, void, issue), plans, suspend and reactivate
- [x] Support access: reason, 15–240 minutes, owners notified, read-only stand-in membership,
      every request audited, ended early or by expiry; `manage.py platform_admin` is the only
      way to grant console access
- [x] Security review ([docs/security-review.md](security-review.md)): subscription callback
      secured, trusted-proxy client IPs (throttle bypass fixed), spreadsheet formula injection
      fixed, vulnerable DRF/cryptography upgraded, CSP, short staff sessions, production images
- [x] Accessibility audit ([docs/accessibility.md](accessibility.md)): WCAG 2.1 AA on 43
      screens; contrast, names, tabs, chart semantics, skip link, reduced motion; axe in CI
- [x] Production stack (`deploy/`): Compose + Caddy TLS, standalone Next.js image, non-root
      runtime-only images; runbooks for deployment and backup/restore, with encrypted off-site
      backups and a restore drill, all tested end to end on a local copy
- [x] Tests: 229 backend, 37 frontend unit, Playwright 11 smoke (incl. SaaS flow and
      accessibility) + regression journey

## After Phase 7 — Expenses ✅ complete
The landlord's running costs outside repairs, so reports show what each property really earns.

- [x] Expenses (`/dashboard/expenses`): utility bills, security, cleaning, salaries, rates,
      insurance, fees, bank charges and more, per property (optionally a unit) or
      organization-wide; paid-by method and receipt code; references `EXP-0001`
- [x] Corrections are audited edits; mistakes are voided with a reason, never deleted
      (`expenses.void` is owner-only by default)
- [x] Members on assigned properties see and record expenses only for those properties, never
      organization-wide ones; capabilities `expenses.view`, `expenses.record`, `expenses.void`
- [x] Financial summary adds other expenses and net operating income; new **Expenses** report
      (by category, by property, every expense, with repairs from maintenance requests)
- [x] Report exports no longer fail on a "Total" label in a date column (affected PDF exports
      of maintenance costs)
- [x] Sample data: a year of guards, garbage, water, salaries, office rent, fees and land rates

## After Phase 7 — Server-rendered public listings ✅ complete
Homes are in the page's HTML, so search engines index them and shared links show a preview.

- [x] `/listings` and `/listings/{id}` render on the server (static shell, homes streamed in);
      filters stay in the URL, and result pages are real links
- [x] Each home has its own title, description, canonical URL and Open Graph/Twitter card with
      its first photo; a home that's been let shows "no longer advertised" and isn't indexed
- [x] `sitemap.xml` lists every advertised home; `robots.txt` keeps crawlers out of signed-in areas
- [x] Server-side API reads forward the visitor's host, scheme and address, so Django's host
      checks, HTTPS redirect and per-visitor rate limits are unchanged; nothing is fetched at build
- [x] Friendly error when homes can't be loaded (e.g. rate-limited)

## After Phase 7 — Invoice and receipt PDFs ✅ complete
Proper documents for tenants and accountants, instead of printing the web page.

- [x] Generated A4 PDFs for invoices and receipts: the organization's letterhead (legal name,
      address, contact), lines, credits, payments and amount due, how to pay (the lease's paybill,
      till or bank account), and a VOID, PAID or REVERSED stamp
- [x] Attached to the invoice and receipt emails sent to tenants, rendered at send time; if
      rendering fails the email still goes, without the attachment (logged)
- [x] **Download PDF** for staff (`billing.view` / `payments.view`) on invoices and receipts, and
      for tenants in the tenant app on their own bills and receipts; always the current state
- [x] Downloads are private and never cached (`Cache-Control: private, no-store`); text typed by
      users is escaped, so it can't change the document's layout

## After Phase 7 — Weighted shared costs ✅ complete
A property-wide bill can be shared fairly, not only evenly.

- [x] Each shared cost is split **evenly**, **by floor area** or **by metered usage**, still exact
      to the cent (leftover cents to the largest remainders)
- [x] Units have an optional floor area (m²); a floor-area split needs it on every sharing unit
- [x] A usage split is for a charge linked to a meter type (e.g. the main water bill): each unit's
      usage from readings taken that month during the tenancy; units that used nothing get no line
- [x] Anything missing (an area, a reading) holds the whole cost back with a note in the preview
      naming the units, so nobody is overcharged; generating again bills it once fixed
- [x] Invoice lines say how they were split (e.g. "shared by floor area, 45 of 300 m²")
- [x] Sample data splits Nyali's common-area electricity by floor area

## Known limitations (current)

- The arrears report is always as of today; other reports cover any past period.
- M-Pesa integration is untested against Safaricom's real APIs (needs credentials); no direct bank
  API integration (CSV import only).
- Payment allocation can't be moved between invoices after the fact; reverse and re-record instead.
- Proration is by calendar day. A lease can charge its first month in full instead; there is no
  per-charge "no proration" option for other months (e.g. a mid-month rent change).
- Move-out settlement doesn't credit unused days on a month that was already billed; staff credit
  that invoice by hand if the agreement allows it (the settlement preview says so).
- Lists used in pickers (properties, tenants in the lease form) load the first 50–100 records
  plus server-side search. Very large portfolios will want typeahead pickers.
- No second factor (TOTP/passkeys) for sign-in yet; recommended first for platform admins.
- Subscription prices in the seed are placeholders; set real prices in the console before launch.
- The production stack is a single server (no hot standby); see the backup runbook for recovery.
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
