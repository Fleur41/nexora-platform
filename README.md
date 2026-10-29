# Nexora

Nexora is a multi-tenant, all-in-one business management platform. Property management is the
first business module; the shared platform layer (accounts, organizations, roles, audit) is built
so future modules such as POS, inventory and finance can plug into it.

> **Status: Phases 1–4 are complete**: the platform foundation; properties, units, tenants,
> leases and occupancy; billing (charges, invoices, meters, shared costs, ledgers, deposits); and
> payments (landlord payment methods, receipts, allocation, reconciliation, bank imports and an
> M-Pesa Daraja integration; see [docs/mpesa.md](docs/mpesa.md) for activation). Maintenance,
> notifications and reporting are **not built yet**. See
> [docs/roadmap.md](docs/roadmap.md) for the phase checklist and known limitations.

| Layer    | Stack                                                                          |
| -------- | ------------------------------------------------------------------------------ |
| Backend  | Python 3.11+, Django 5.2 LTS, Django REST Framework, drf-spectacular, Celery   |
| Database | PostgreSQL 17, Redis 7 (cache, throttling, Celery broker)                      |
| Frontend | Next.js 16 (App Router, Cache Components), TypeScript strict, Tailwind CSS 4, Radix/shadcn-style UI, TanStack Query, React Hook Form + Zod |
| Tooling  | Docker Compose, pytest, Vitest + Testing Library, Playwright, Ruff, ESLint, GitHub Actions |

## Repository layout

```
backend/                Django project (owns all business rules, auth and data access)
  config/               settings (base/dev/test/prod), urls, celery
  apps/core/            shared primitives: base models, module registry, error envelope
  apps/accounts/        custom email-based User, auth endpoints
  apps/organizations/   Organization, Membership, Invitation, roles, tenancy enforcement
  apps/audit/           append-only AuditLog
  apps/documents/       private file storage attached to properties, units, tenants, leases
  apps/properties/      Property, UnitType, Unit, PropertyAssignment (Nexora Property module)
  apps/tenants/         Tenant records (never hard-deleted)
  apps/leases/          Lease, effective-dated LeaseRentTerm, occupancy transitions
  apps/billing/         charge types and rules, billing engine, invoices, ledger, shared costs
  apps/utilities/       meters and readings
  apps/deposits/        security deposit ledger (a liability, never income)
  apps/payments/        payment methods, payments, allocation, receipts, M-Pesa, bank imports
  tests/                API, permission and isolation tests
frontend/               Next.js app; talks to Django only through lib/api/client.ts
  app/                  routes: (public) landing, (auth) pages, onboarding, dashboard
  components/           ui primitives, layout shell, providers, brand
  features/             per-domain API hooks, schemas and components
  e2e/                  Playwright tests: page objects, smoke and regression suites
docs/                   architecture and roadmap
docker-compose.yml      Postgres, Redis, Mailpit, backend, Celery worker + beat, frontend
```

## Running locally

### Option A — Docker Compose (everything in containers)

```bash
cp .env.example .env
cp backend/.env.example backend/.env      # set DJANGO_SECRET_KEY
docker compose up --build                 # compose sets CELERY_TASK_ALWAYS_EAGER=false and runs a worker
```

- App: http://localhost:3000 · API docs: http://localhost:8000/api/v1/docs/
- Emails (invitations, password resets): http://localhost:8025 (Mailpit)

### Option B — services in Docker, apps on the host (fastest for development)

```bash
docker compose up -d db redis

# Backend
cd backend
python3.11 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env                       # then set DJANGO_SECRET_KEY
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver       # http://localhost:8000

# Frontend (second terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev                                # http://localhost:3000
```

In option B emails are printed to the Django console, and Celery tasks run inline
(`CELERY_TASK_ALWAYS_EAGER=true`) so no worker is needed. To run a real worker instead, set it
to `false` and run `.venv/bin/celery -A config worker -l info`.

Create a Django admin superuser with `.venv/bin/python manage.py createsuperuser`
(admin at http://localhost:8000/django-admin/).

## Sample data

```bash
cd backend
.venv/bin/python manage.py seed_demo                          # once; DEBUG must be on
.venv/bin/python manage.py seed_demo --owner-email you@x.com  # also make your account an owner
```

Creates **Nexora Demo Homes (sample data)**:
- **Properties and units:** 3 properties in Nairobi, Kiambu and Mombasa with 26 units.
- **Tenants and leases:** 22 tenants (all invented) on active, ended, draft and future-start leases.
- **Charges:** security, garbage, metered water, included-in-rent water, a shared electricity bill, a parking charge, and one unit opted out of security.
- **Billing history:** invoices since the earliest lease start, with tenants who pay on time, pay late, pay partially, overpay, or are in arrears.
- **Payments:** M-Pesa, bank and cash payments, plus two unmatched M-Pesa payments waiting to be reconciled.
- **Deposits:** received deposits, and one move-out with a deposit deduction and refund.

It all goes through the normal services, so ledgers and audit logs are consistent. Sign in as any role, password `Admin@123` (local testing only; change it with `--password`):

| Role | Email | Sees |
| ---- | ----- | ---- |
| Owner | demo-owner@nexora.test | everything |
| Property manager | demo-manager@nexora.test | Kilimani Heights only (assigned) |
| Accountant | demo-accountant@nexora.test | all properties; billing and payments, no corrections |
| Caretaker | demo-caretaker@nexora.test | Ruaka Gardens only; units, tenants' contacts, meters |

Posted financial records can't be deleted (by design), so to start over, recreate the local
database: `docker compose down -v && docker compose up -d db`, then migrate and seed again.

## Verifying

```bash
# Backend (needs the Postgres container running)
cd backend
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/python manage.py makemigrations --check --dry-run
.venv/bin/pytest

# Frontend
cd frontend
npm run lint && npm run typecheck && npm test && npm run build

# Browser end-to-end tests: start Django (:8000) and Next.js (:3000) first
npx playwright install chromium            # once
npm run test:e2e                           # smoke tests, headless (CI)
npm run test:regression                    # QA: full sign-up → move-out journey, visible and slowed down
```

See `frontend/e2e/README.md` for the page objects, the regression stages and speed options.

CI (`.github/workflows/ci.yml`) runs the same checks plus `manage.py check --deploy`.

### Manual walkthrough of Phase 1

1. Open http://localhost:3000, choose **Get started**, register.
2. Create your organization (defaults: Kenya, KES, Africa/Nairobi).
3. **Team → Invite member**: invite an address as *Accountant*. Copy the link from the email
   (console or Mailpit).
4. In a private window, open the link, create an account with the invited email and accept.
5. As the accountant: the sidebar shows *Audit log* but not *Team* or *Organization*. The API
   returns 403 for those endpoints regardless of the UI.
6. As the owner: **Team → Edit access** to grant/revoke individual permissions; check
   **Audit log** for the recorded changes.

### Manual walkthrough of Phase 2

1. **Properties → Add property**, then open it. On **Unit types**, add e.g. a one-bedroom with
   a default rent and deposit (a deposit of 0 means none).
2. On **Units**, choose **Add several** to create a numbered run (e.g. C1–C10). Click a tile to
   see details or set it *Under maintenance* / *Unavailable*.
3. **Tenants → Register tenant**. Phone numbers are normalised to +254 format. ID numbers must
   be unique within the organization.
4. From the tenant page choose **New lease**, pick the property and an available unit. Rent and
   deposit prefill from the unit and remain editable. With **Activate now** checked, the unit
   becomes *Occupied*, or *Reserved* if the lease starts in the future.
5. On the lease, **Schedule rent change** adds a future-dated term. Past terms can't be changed.
   **End lease** closes it and sets the unit's next status (e.g. *Awaiting inspection*).
6. Invite a caretaker. They see no properties until assigned under **Property → Staff access**
   (or Team → Edit access), and never see leases or rent.

### Manual walkthrough of Phase 3

1. **Charges → Add rule**: e.g. Security, *All properties*, fixed monthly 1,500. Add a second
   rule for one unit with **Charge enabled** unticked: that unit opts out. Garbage with no rule
   at all is never billed.
2. **Billing → Generate invoices**, choose a month and **Preview**. Rent is prorated by day for
   move-ins and rent changes. **Post invoices**. Run the same month again: "Nothing new to bill".
3. Open an invoice: **Credit** part of it (a reason is required), or **Void** it if nothing has
   been credited against it. Both appear in the tenant's statement and the audit log.
4. **Utilities**: add a water meter to a unit, record a baseline reading, then a later one. With a
   metered water rule (e.g. 150 per m³), the next billing run bills the usage exactly once.
5. **Billing → Shared costs**: enter a property-wide bill. It's split to the cent between occupied
   units whose rule for that charge uses the *shared* method.
6. On a lease: **Account** shows the balance and running statement; **Deposit** records money
   received, deductions and refunds separately from rent (held deposits are a liability).
7. **Charges → Automatic billing** generates each month's invoices on a chosen day (Celery beat).

### Manual walkthrough of Phase 4

1. **Payment settings → Add payment method**: an M-Pesa paybill (or till) and a bank account. A
   property can have its own methods, which replace the organization-wide ones for its tenants.
2. On a lease: **Record payment** (partial or full). It's applied to the oldest invoices first;
   any extra becomes credit and is used automatically when the next invoices are generated.
   Open **Payments → RCT-…** → **Receipt** to print or save a PDF.
3. **Payments → Bank imports**: upload a CSV statement. Lines mentioning a lease number are
   applied automatically; others appear under **Unmatched** to match by hand. Re-importing the
   same file adds nothing.
4. **Reverse** a payment (e.g. a bounced cheque) or **refund** credit. Owner-only by default, with
   a reason, and audited.
5. M-Pesa automation (paybill callbacks and STK prompts) needs Daraja credentials and a public URL:
   follow [docs/mpesa.md](docs/mpesa.md).

## Security model (summary)

- Session cookies (HttpOnly, SameSite=Lax) plus CSRF tokens. The browser calls `/api/*` on the
  Next.js origin and Next proxies to Django, so no CORS is needed and cookies stay first-party.
- Every organization-scoped request sends `X-Organization-ID`; Django resolves the user's
  **active membership** for it and filters every queryset by that organization. Foreign IDs
  return 404, foreign organizations 403. The header is only a selector; it grants nothing.
- Capabilities are enforced in DRF permission classes. Unlisted view actions are denied by
  default. Non-owners cannot grant the owner role, change owners, edit themselves, or grant
  permissions they don't hold. The last owner cannot be removed.
- Members are either whole-organization or assigned-properties-only (the default for property
  managers and caretakers). Assigned-scope members only reach their properties and the units,
  tenants, leases and documents on them.
- Uploaded files are validated by content (PDF, DOCX, JPEG, PNG, WebP), stored under random
  names in private storage, and only served through a permission-checked download endpoint.
- Posted invoices and ledger entries are immutable. Corrections are credits or voids with a
  reason, an audit entry and a ledger movement. A unique database index on each line's dedupe
  key makes double billing impossible even under concurrent or repeated runs.
- Voids, credits, deposit deductions and refunds are owner-only by default (delegable per member).
- Payments are immutable; reversals and refunds are separate audited entries. A unique index on
  provider transaction ids and on live payment references prevents recording the same money twice.
- Provider secrets (Daraja consumer secret, passkey) are encrypted at rest with
  `NEXORA_FIELD_ENCRYPTION_KEY` and are never returned by the API. Callback URLs carry a
  per-configuration secret; every callback is stored and processed at most once per transaction.
- Platform administrators get **no** implicit access to organization data.
- Audit log entries are append-only (model, queryset and admin all refuse updates and deletes).
- Login, registration, password reset and invitation endpoints are rate-limited and CSRF-protected,
  and they don't reveal whether an email address is registered.

Details are in [docs/architecture.md](docs/architecture.md).

## Network note (this development machine)

On the machine where this was set up, IPv4 connections to `files.pythonhosted.org` time out while
IPv6 works, so `pip install` hangs. The workaround used was a `sitecustomize.py` on `PYTHONPATH`
that sorts IPv6 addresses first. Docker image builds (`docker compose up --build`) hit the same
problem from inside the build container. This is an environment problem, not a project problem.
