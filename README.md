# Nexora

Nexora is a multi-tenant, all-in-one business management platform. Property management is the
first business module; the shared platform layer (accounts, organizations, roles, audit) is built
so future modules such as POS, inventory and finance can plug into it.

> **Status: Phase 1 (platform foundation) is complete.** Property management, billing, payments
> and reporting are **not built yet**. See [docs/roadmap.md](docs/roadmap.md) for the phase
> checklist and known limitations.

| Layer    | Stack                                                                          |
| -------- | ------------------------------------------------------------------------------ |
| Backend  | Python 3.11+, Django 5.2 LTS, Django REST Framework, drf-spectacular, Celery   |
| Database | PostgreSQL 17, Redis 7 (cache, throttling, Celery broker)                      |
| Frontend | Next.js 16 (App Router, Cache Components), TypeScript strict, Tailwind CSS 4, Radix/shadcn-style UI, TanStack Query, React Hook Form + Zod |
| Tooling  | Docker Compose, pytest, Vitest + Testing Library, Ruff, ESLint, GitHub Actions |

## Repository layout

```
backend/                Django project (owns all business rules, auth and data access)
  config/               settings (base/dev/test/prod), urls, celery
  apps/core/            shared primitives: base models, module registry, error envelope
  apps/accounts/        custom email-based User, auth endpoints
  apps/organizations/   Organization, Membership, Invitation, roles, tenancy enforcement
  apps/audit/           append-only AuditLog
  tests/                API and isolation tests
frontend/               Next.js app; talks to Django only through lib/api/client.ts
  app/                  routes: (public) landing, (auth) pages, onboarding, dashboard
  components/           ui primitives, layout shell, providers, brand
  features/             per-domain API hooks, schemas and components
docs/                   architecture and roadmap
docker-compose.yml      Postgres, Redis, Mailpit, backend, Celery worker, frontend
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
```

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

## Security model (summary)

- Session cookies (HttpOnly, SameSite=Lax) plus CSRF tokens. The browser calls `/api/*` on the
  Next.js origin and Next proxies to Django, so no CORS is needed and cookies stay first-party.
- Every organization-scoped request sends `X-Organization-ID`; Django resolves the user's
  **active membership** for it and filters every queryset by that organization. Foreign IDs
  return 404, foreign organizations 403. The header is only a selector; it grants nothing.
- Capabilities are enforced in DRF permission classes. Unlisted view actions are denied by
  default. Non-owners cannot grant the owner role, change owners, edit themselves, or grant
  permissions they don't hold. The last owner cannot be removed.
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
