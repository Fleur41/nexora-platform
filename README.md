# Nexora

Nexora is a multi-tenant, all-in-one business management platform. Property management is the
first business module; the shared platform layer (accounts, organizations, roles, audit) is built
so future modules such as POS, inventory and finance can plug into it.

> **Status: Phases 1–7 are complete.** Phases 1–4 built the platform foundation, then
> properties, units, tenants, leases and occupancy, then billing and deposits, then payments
> (M-Pesa Daraja, bank imports; see [docs/mpesa.md](docs/mpesa.md)). Phase 5 added operations
> and the tenant app, and Phase 6 reports and public listings. Phase 7 added Nexora
> subscriptions, the platform console and production readiness:
> [security review](docs/security-review.md), [accessibility audit](docs/accessibility.md),
> [deployment](docs/runbooks/deployment.md) and
> [backup](docs/runbooks/backup-and-restore.md) runbooks. See
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
  apps/maintenance/     repair requests, quotes, messages
  apps/expenses/        running costs (utility bills, salaries, rates…), per property or organization-wide
  apps/inspections/     move-in, routine and move-out inspections
  apps/notifications/   in-app and email notifications, announcements
  apps/portal/          tenant app API (bills, payments, repairs, move-out notice)
  apps/reports/         financial and occupancy reports, CSV/Excel/PDF exports
  apps/listings/        public listings, enquiries and viewing requests
  apps/subscriptions/   Nexora plans, trials, unit limits, invoices to organizations, read-only lapse
  apps/platform_admin/  platform console API, audited time-limited support access
  tests/                API, permission and isolation tests
frontend/               Next.js app; talks to Django only through lib/api/client.ts
  app/                  routes: (public) landing, (auth) pages, onboarding, dashboard,
                        portal (tenant app), platform (Nexora staff console)
  components/           ui primitives, layout shell, providers, brand
  features/             per-domain API hooks, schemas and components
  e2e/                  Playwright tests: page objects, smoke and regression suites
docs/                   architecture, roadmap, security review, accessibility, runbooks, manual
deploy/                 production compose stack, Caddy (TLS), backup/restore/release scripts
docker-compose.yml      development: Postgres, Redis, Mailpit, backend, Celery worker + beat, frontend
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

To see emails in a browser inbox instead (and to run the browser tests, which read the tenant
invitation email), start Mailpit and point Django at it:

```bash
docker compose up -d mailpit                               # inbox at http://localhost:8025
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend EMAIL_PORT=1025 \
  .venv/bin/python manage.py runserver
```

For the browser tests also add `THROTTLE_AUTH=1000/min`: every test signs up fresh accounts, and
the normal sign-in limit (10 a minute) would start refusing them part-way through a run.

Otherwise in option B emails are printed to the Django console, and Celery tasks run inline
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
- **Deposits:** received deposits, applied and refunded through the move-out settlement.
- **Repairs:** requests in every state: new, a tenant-reported one in progress with an internal
  note and the tenant's reply, one on hold awaiting quote approval, resolved, and closed with an
  approved quote and the actual cost.
- **Inspections:** a completed move-in inspection, an upcoming routine inspection, and move-out
  inspections.
- **Move-outs:** one completed (notice → inspection with a damage charge → settlement, unit set
  under maintenance), a new private notice from a tenant, and one with the inspection booked.
- **Announcements:** a water interruption for Ruaka Gardens and a fire drill for everyone.
- **Tenant app:** one tenant (who pays partially, so there's a balance) can sign in to `/portal`
  and sees their bills, repairs and notifications.
- **Listings:** two vacant units on the public website (`/listings`), with a new viewing request
  and an enquiry that has a viewing booked.

While seeding, emails are switched off so back-filled invoices and receipts don't email anyone;
in-app notifications are still recorded.

It all goes through the normal services, so ledgers and audit logs are consistent. Sign in as any role, password `Admin@123` (local testing only; change it with `--password`):

| Role | Email | Sees |
| ---- | ----- | ---- |
| Owner | demo-owner@nexora.test | everything |
| Property manager | demo-manager@nexora.test | Kilimani Heights only (assigned) |
| Accountant | demo-accountant@nexora.test | all properties; billing and payments, no corrections |
| Caretaker | demo-caretaker@nexora.test | Ruaka Gardens only; units, tenants' contacts, meters |
| Tenant | demo-tenant@nexora.test | the tenant app (`/portal`) for their own home |
| Nexora staff | demo-platform@nexora.test | the platform console (`/platform`): every organization's plan and billing; their data only through a support session |

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

# Browser end-to-end tests: start Django (:8000, sending email to Mailpit as above) and Next.js (:3000) first.
# The SaaS and accessibility tests sign in as Nexora staff; grant that once:
#   cd backend && .venv/bin/python manage.py platform_admin e2e-platform@example.com --create --password Nexora-e2e-pass-2026
npx playwright install chromium            # once
npm run test:e2e                           # smoke tests incl. accessibility (axe), headless (CI)
npm run test:regression                    # QA: full sign-up → move-out journey, visible and slowed down
```

See `frontend/e2e/README.md` for the page objects, the regression stages and speed options.

**Illustrated user manual (PDF):** [`docs/manual/Nexora-User-Manual.pdf`](docs/manual/Nexora-User-Manual.pdf),
the walkthrough below with a screenshot of every step. Regenerate it after UI changes with
`npm run docs:manual` (from `frontend/`, with the app, Django and Mailpit running as for the tests).

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

## Client walkthrough: a tenancy from start to finish

This walkthrough takes one tenant through the whole life of a tenancy, from the landlord's side
and the tenant's: sign-up, letting a unit, the tenant joining the tenant app, billing, payments,
a repair, moving out and the final settlement. Follow it in order; each step builds on the one
before. It takes about 30 minutes.

**You need two windows.** Use your normal browser window as the **landlord**. For the
**tenant**, use a private window (or a phone on the same network). Steps marked **Tenant app**
happen in that window.

Use a fresh account so the numbers below match. Where a step says **Check**, confirm you see
that result before moving on. The same journey runs automatically, in two browser windows, with
`npm run test:regression` (see `frontend/e2e/README.md`).

**Before you start:** the invitation in step 4 is sent by email. Locally, start Mailpit and run
Django with email going to it (see *Running locally*); the emails appear at
http://localhost:8025.

**Dates used:** the lease starts on the **1st of last month**, so two months are billed. The
move-out happens **today**.

**Money used throughout:**

| | Amount (KES) |
| --- | --- |
| Monthly rent + security charge | 22,000 + 1,500 = 23,500 |
| Billed for two months | 47,000 |
| Deposit received | 22,000 |
| Cash payment | 30,000 → balance 17,000 |
| Damage found at move-out | 3,000 |
| Deposit used to clear the balance | 17,000 |
| Refund to the tenant | 2,000 |

### 1. Sign up

1. Open http://localhost:3000 and choose **Get started**.
2. Enter your **Full name**, **Work email** and a **Password**, then **Create account**.
3. Enter an **Organization name** (e.g. *Riverside Lettings*) and **Create organization**.

**Check:** you land on the dashboard with your organization's name at the top.

### 2. Property and units

1. In the sidebar, open **Properties → Add property**.
2. **Name:** Riverside Apartments · **Town / area:** Westlands · **County:** Nairobi →
   **Create property**.
3. Open the **Unit types** tab → **Add unit type**. **Category:** One bedroom ·
   **Default monthly rent:** 22000 · **Default deposit:** 22000 → **Save**.
4. Open the **Units** tab → **Add several**. **Prefix:** R · **How many:** 4 → **Create units**.

**Check:** units R1 to R4 appear in the grid, all **Available**.

### 3. Tenant and lease

1. **Tenants → Register tenant**. **Full name:** Wanjiku Kamau · **Phone:** 0722 456 789 ·
   **Email:** an address you can check (any address works with Mailpit) · **ID number:** any →
   **Register tenant**.
2. On the tenant's page choose **New lease**.
3. **Property:** Riverside Apartments · **Unit:** R1. Rent and deposit fill in from the unit
   type (22,000 each). Set **Start date** to the 1st of last month → **Create lease**.

**Check:** the lease **LSE-0001** shows **Active**. On the property page, R1 is now
**Occupied**.

> **Moving in mid-month?** Normally the first bill covers only the days from the start date (e.g.
> 13,000 rent from the 29th of a 31-day month bills 3 days, 1,258.06). If the agreement says the
> first month is paid in full, tick **Charge the first month in full** on the new-lease form, or
> use **First month → Change** on the lease page. If that month is already billed, void its
> invoice first, switch the option, then generate the month again.

### 4. Tenant joins the tenant app

1. **Landlord:** open **Tenants → Wanjiku Kamau**. In the **Tenant app** card the badge says
   **Not invited**. Check the email and choose **Send invitation**.
   **Check:** the badge changes to **Invited**.
2. Open the invitation email (Mailpit: http://localhost:8025) and copy the link.
3. **Tenant app:** paste the link in the private window. Choose **Create account**, enter
   Wanjiku's **Full name** and a **Password** (the email is filled in) → **Create account**, then
   **Open my home**.

**Check:** the tenant app says *Hi Wanjiku*, shows **Riverside Apartments · Unit R1** and a
balance of **Ksh 0**. On a phone, the app offers to install itself (Android: **Install app**;
iPhone: Share → **Add to Home Screen**). Back on the landlord's tenant page (refresh), the
badge says **Using the app**.

### 5. Charges and two months of billing

1. **Landlord:** **Charges → Add rule**. **Charge:** Security · **Amount:** 1500 ·
   **Effective from:** the 1st of last month → **Save rule**.
2. **Billing → Generate invoices**. **Month:** last month → **Preview**.
   **Check:** *1 invoice totalling Ksh 23,500* (rent 22,000 + security 1,500).
3. **Post invoices**.
4. Repeat steps 2–3 for **this month**.

**Check:** the billing list shows two invoices, and on the lease page (**Leases → LSE-0001**)
the **Balance** is **Ksh 47,000**. **Tenant app:** **Home** shows *You owe Ksh 47,000*, and
**Bills** lists both bills.

### 6. Deposit, payment and receipt

1. **Landlord:** on the lease page, in the deposit card, choose **Record received**.
   **Amount:** 22000 · **Reference:** e.g. DEP-001 → **Save**.
   **Check:** **Held now** shows Ksh 22,000. The deposit is not added to what the tenant owes.
2. Choose **Record payment**. **Amount:** 30000 · **Paid via:** Cash → **Record payment**.
   **Check:** a message confirms *Receipt RCT-00001 issued*, and the **Balance** drops to
   **Ksh 17,000**.
3. **Payments → RCT-00001 → Receipt**.
   **Check:** a printable receipt for Wanjiku Kamau showing *Account balance now: Ksh 17,000*.

**Check (Tenant app):** **Home** shows *You owe Ksh 17,000* and **Deposit held Ksh 22,000**.
**Bills → Receipts → RCT-00001** shows the 30,000 receipt. **Pay** shows how to pay the rest.

### 7. Announcement

1. **Landlord:** open **Communications** (the **Announcements** tab).
2. **Send to:** All properties · **Title:** Water interruption on Saturday · **Message:**
   Supply is off from 8am to 2pm for tank cleaning. Leave **Email** ticked → **Send** →
   **Send now**.
   **Check:** *Sent to 1 tenant*, and the announcement is listed on the right.
3. Open the **Delivery log** tab.
   **Check:** an email to the tenant's address for the announcement.
4. Open **Reminders & channels**, set **Rent due reminder** to 5 days → **Save settings**.

**Check (Tenant app):** the bell shows unread notifications, including the announcement.

### 8. A repair reported in the tenant app

1. **Tenant app:** **Repairs → Report a repair**. **What kind?** Plumbing · **How urgent?**
   High · **What's wrong?** Kitchen sink leaking · **Details:** Water pooling under the sink.
   Optionally add a photo (on a phone this opens the camera) → **Send report**.
   **Check:** the repair shows **Sent to your landlord**.
2. **Landlord:** **Maintenance** → open **Kitchen sink leaking** (marked *from tenant*) →
   **Acknowledge**.
3. In **Assignment**, choose who will handle it, set a **Visit date** → **Save assignment**.
4. In **Quotes & costs**: type **Quotation**, **Amount** 2500, **Description** *Replace trap
   and seal*, **Supplier** *Westlands Plumbers* → **Add**, then **Approve**.
5. Choose **Start work**.
6. Tick **Internal note (never shown to the tenant)**, type *Plumber visited, waiting for a
   part* → **Add update**.
7. Untick it, type *The plumber comes back tomorrow at 10am with the part.* → **Add update**.
8. **Tenant app:** open the repair (refresh if it's already open).
   **Check:** it shows **Being fixed** and the landlord's update about tomorrow, but **not** the
   internal note. Reply *Thanks, someone will be home.* → **Send**.
9. **Landlord:** refresh: the tenant's reply is under **Updates**. Choose **Mark resolved**,
   then **Close**.

**Check:** the request shows **Closed** for the landlord and **Closed** in the tenant app.

### 9. Move-out notice from the tenant app

1. **Tenant app:** **Move out**. **Date you plan to move out:** today · **Message:** Relocating
   to Nakuru for work → **Send notice** → confirm.
   **Check:** the notice shows **Notice sent**; it can be withdrawn until it's acknowledged.
2. **Landlord:** the notice is private until acknowledged, so on the property page R1 is still
   **Occupied**. Open **Move-outs → Wanjiku Kamau**: *Given by the tenant from the portal*,
   with her message, status **New notice**.
3. Choose **Acknowledge**, add **Staff notes** (optional) → **Acknowledge**.

**Check:** on the property page R1 is now **Notice submitted**. **Tenant app:** **Move out**
shows **Acknowledged**.

### 10. Inspection with a damage charge

1. **Landlord:** on the move-out page choose **Schedule inspection**. **Date:** today →
   **Schedule**. (**Tenant app:** the move-out screen now shows the inspection date.)
2. Click the inspection reference (**INS-0001**) to open the checklist.
3. Optional: add an item that isn't on the standard list. **Area:** Balcony ·
   **Item:** Railing → **Add item**.
4. Set every item to **Good**, except **Windows** under *Living room*: set it to **Damaged**.
   Notes and a charge box appear for it. **Notes:** Window pane cracked · **Charge:** 3000.
5. **Save checklist**.
   **Check:** *Every item has been checked.* The summary shows **Damage charges: Ksh 3,000**.
6. Choose **Complete**. **Keys returned:** 2 · tick **Tenant was present** · **Tenant
   signature:** Wanjiku Kamau · **Inspector signature:** your name → **Complete inspection**.

**Check:** the inspection shows **Completed** with both signatures, and the checklist can no
longer be edited.

### 11. Settlement and refund

1. **Landlord:** go back to **Move-outs → Wanjiku Kamau**. The **Settle and close** card shows:

   | | |
   | --- | --- |
   | Deposit held | Ksh 22,000 |
   | Damages deducted | Ksh 3,000 |
   | Balance owed before settlement | Ksh 17,000 |
   | Deposit applied to balance | Ksh 17,000 |
   | Refund to tenant | Ksh 2,000 |
   | Balance still owed after | Ksh 0 |

   Damages come from the inspection automatically. To use a different amount, type it in
   **Damages override**. Untick *Use the remaining deposit to clear unpaid rent and charges* to
   refund the whole remainder instead.
2. **Unit R1 becomes:** Available · **Refund paid by:** M-Pesa · **Refund reference:** the
   M-Pesa code → **Complete move-out**, then confirm.

**Check:** the notice shows **Moved out**, with a **Final settlement** record of the amounts.

### 12. Lease ended, unit available again, tenant app up to date

1. **Landlord:** open **Leases → LSE-0001**.
   **Check:** status **Ended** and **Balance Ksh 0**. The deposit card shows the 3,000
   deduction and the 2,000 refund.
2. Open **Properties → Riverside Apartments**.
   **Check:** unit R1 is **Available** and ready to let again.
3. **Tenant app:** **Home**.
   **Check:** *You're all paid up*, and the home is marked **Ended**. **Move out** lists the
   notice as **Moved out**, and **Pay** says there's no active lease. Her bills and receipts
   stay available.
4. Optional: **Audit log** lists every action taken above, by the landlord and the tenant, with
   who did it and when.

## Reports

**Sidebar → Reports** (owners, property managers and accountants). Choose a report, a period
(this month, last month, this year, last year or custom dates) and optionally one property:

- **Financial summary**: what was billed by income category (net of credits), money received by
  payment method, maintenance costs, other expenses and net operating income, deposits and what
  tenants owe, with a month-by-month chart. A month's rent counts in that month even if it was
  invoiced later.
- **Rent roll**, **Arrears** (aged: not yet due, 1–30, 31–60, 61–90, over 90 days),
  **Occupancy** (with vacant units and days vacant), **Deposits**, **Maintenance costs** and
  **Expenses** (all spending by category and property, including repairs).

**PDF**, **Excel** and **CSV** download any report for your accountant; every download is recorded
in the audit log. Managers assigned to some properties only see those properties.

## Expenses

**Sidebar → Expenses** (owners, accountants, and property managers for their properties). Record
the landlord's running costs: utility bills, guards, cleaning and garbage, salaries, land rates,
insurance, agent and professional fees, bank and M-Pesa charges. Each expense belongs to a
property (optionally one unit) or, for owners and organization-wide staff, to the whole
organization (office rent, the accountant's fee). Repairs stay on maintenance requests.

Edits are kept in the audit log. An expense entered by mistake is **voided** with a reason rather
than deleted; voiding is owner-only by default (capability `expenses.void`). Voided expenses drop
out of every report.

## Public listings

Vacant units can be advertised at **/listings** ("Find a home" on the public site).

1. **Sidebar → Listings → New listing**: choose the property and unit, write a title and
   description, tick the photos to show (upload them first on the unit or property page, category
   *Photo*) → **Save listing**. It shows **Live** with a link to copy and share.
2. Visitors search by area, rent and size, open the home and **Book a viewing** or **Ask a
   question**. Only the town and county are shown, never the street address.
3. You're notified of each request. **Listings → Enquiries & viewings**: call them, **book a
   viewing** (they're emailed the time if they gave an email), keep internal notes, and **close**
   with the outcome.

A listing comes down by itself once the unit is let, and goes back up if it becomes free again
while still published. A unit on notice can be listed too: it shows "available from" the day
after the tenant moves out.

The listing pages are rendered on the server, so search engines index each home and a link shared
on WhatsApp, Facebook or X shows the title, rent, area and first photo. `/sitemap.xml` lists
every advertised home and `/robots.txt` points crawlers to it; both use the domain the site is
visited on.

## Subscriptions (what landlords pay Nexora)

Every new organization gets a **30-day free trial** on the Growth plan. Plans are priced by
how many units you manage. These are the starting prices; Nexora staff change them in the console:

| Plan | Units | Per month |
| ---- | ----- | --------- |
| Starter | up to 20 | Ksh 2,000 |
| Growth | up to 100 | Ksh 7,500 |
| Pro | up to 500 | Ksh 25,000 |
| Enterprise | unlimited | by agreement |

**Sidebar → Subscription** (owners only) shows the plan, units used and Nexora's invoices, and
lets you switch plan. Adding units beyond the plan's limit is refused with a prompt to upgrade.

- A week before the trial (or the paid month) ends, Nexora issues an invoice and the owners are
  notified. Pay with an **M-Pesa prompt** to your phone, or to Nexora's paybill or bank account
  with your account number (`NX…`). Paybill and bank payments are recorded by Nexora staff.
- When the invoice is unpaid after access ends, a banner says **payment overdue**. Everything
  still works.
- **14 days later, Nexora becomes read-only.** You can see and download everything, but can't
  change anything until you pay. Tenants' records are never deleted.

## Platform console (Nexora staff)

`/platform` is for Nexora's own team (accounts with `is_platform_admin`). That can only be
granted on the server, with `manage.py platform_admin EMAIL --create`. The console has:

- **Organizations:** monthly recurring revenue, trials ending, overdue amounts; each
  organization's plan, units and status.
  - Change the plan.
  - Extend a trial or the paid-until date. This lifts "overdue" or read-only immediately.
  - Mark an organization complimentary.
  - Issue an invoice now.
  - Suspend it, for fraud or abuse.
- **Invoices:** every Nexora invoice. **Record payment** for paybill and bank transfers, or void
  an invoice.
- **Plans:** prices, unit limits, which plans are offered.
- **Support access.** Staff can't see an organization's data by default. To help a customer:
  1. Open the organization, enter a reason (e.g. the ticket number) and a duration (15 minutes
     to 4 hours), then **Start support session**. The owners are notified with the reason.
  2. **Open their dashboard** shows exactly what an owner sees, **read-only**, with a banner.
     Every page opened is recorded in the organization's audit log.
  3. The session ends when time runs out, or with **End session**.

## Tenant app

Tenants get their own app at `/portal`. It works in any phone browser and installs to the home
screen like a native app ("My home"), with no app store involved.

**What tenants can do:** see what they owe and what's overdue, open each bill, download
receipts, read their statement, pay with M-Pesa (a payment prompt on their phone when the
landlord's M-Pesa integration is verified, otherwise the paybill/till/bank details with the right
account number), report repairs with photos and follow the landlord's updates, give notice to move
out and follow the inspection and settlement. Notifications appear under the bell and by email.

**Giving a tenant access (staff):**
1. Make sure the tenant has an email address, then open **Tenants → the tenant**.
2. In **Tenant app**, check the email and choose **Send invitation**. The badge shows **Invited**.
3. The tenant opens the link in the email, creates an account with that email (or signs in) and
   chooses **Open my home**. The badge changes to **Using the app**.

**Resend invitation** cancels the earlier link (links last 14 days). **Remove access** stops the
tenant seeing this account in the app; their records are unchanged. Staff internal notes on
repairs are never shown to tenants, and a move-out notice stays private until it's acknowledged.

**Installing on a phone (tenants):**
- **Android (Chrome):** open the app; tap **Install app** on the banner (or ⋮ → **Install app** /
  **Add to Home screen**).
- **iPhone (Safari):** open the app; tap **Share** → **Add to Home Screen**.

The app opens full screen from the "My home" icon. It needs a connection: offline it shows an
offline page, and nothing from the account is stored on the phone. Installing needs HTTPS in
production (localhost is fine for testing).

**Trying it locally:** start Mailpit as above, invite a tenant using an email address of your
choice, then open the invitation in Mailpit (http://localhost:8025) in a private window. To see
the phone layout on a computer, use the browser's device toolbar (Chrome: ⌥⌘I → toggle device).

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
- Platform administrators get **no** implicit access to organization data. They can open a
  **support session**: read-only, 15 minutes to 4 hours, with a reason, owners notified, and
  every request audited. Staff sessions expire after 8 hours.
- Organizations whose subscription has lapsed become read-only (enforced on every request),
  never deleted.
- Report exports neutralise spreadsheet formulas in user-entered text. The web app sends a
  strict Content-Security-Policy. Client IPs trust only the configured number of proxies.
- Audit log entries are append-only (model, queryset and admin all refuse updates and deletes).
- Login, registration, password reset and invitation endpoints are rate-limited and CSRF-protected,
  and they don't reveal whether an email address is registered.

Details are in [docs/architecture.md](docs/architecture.md). The Phase 7 review, with findings
and residual risks, is in [docs/security-review.md](docs/security-review.md).

## Production

[docs/runbooks/deployment.md](docs/runbooks/deployment.md) covers one server with Docker
Compose and Caddy (automatic HTTPS): setup, secrets, releases, rollback, configuration and
troubleshooting. [docs/runbooks/backup-and-restore.md](docs/runbooks/backup-and-restore.md)
covers nightly encrypted backups with an off-site copy, monthly restore drills, and recovery
onto the same or a new server.

## Network note (this development machine)

On the machine where this was set up, IPv4 connections to `files.pythonhosted.org` time out while
IPv6 works, so `pip install` hangs. The workaround used was a `sitecustomize.py` on `PYTHONPATH`
that sorts IPv6 addresses first. Docker image builds (`docker compose up --build`) hit the same
problem from inside the build container. This is an environment problem, not a project problem.
