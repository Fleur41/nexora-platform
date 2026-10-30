# Security review (Phase 7, October 2026)

Scope: the whole application as of Phase 7, covering the Django API, the Next.js app, the
tenant app, the platform console, subscriptions, deployment configuration and dependencies.
Method: code review of every unauthenticated endpoint, every permission boundary and every file
or money path; `manage.py check --deploy` under production settings; `pip-audit` and `npm audit`;
running the browser suites against the production build behind TLS (`deploy/`).

The design-level controls are summarised in the README ("Security model"). This document records
what was checked, what was found and fixed, and what risk remains.

## Findings fixed in this review

| # | Severity | Finding | Fix | Test |
| - | -------- | ------- | --- | ---- |
| 1 | High | **Nexora's own M-Pesa callback** (`/subscription/mpesa/callback/`) was public with no secret, IP allowlist or throttle. Anyone who learned a `CheckoutRequestID` could post a fake "paid" result and lift an organization out of read-only. | The callback URL now carries a secret token derived from `SECRET_KEY` (`/subscription/mpesa/<token>/callback/`, constant-time compare), honours `MPESA_CALLBACK_ALLOWED_IPS`, and is throttled. A result is only accepted if the amount paid covers the request. | `test_mpesa_prompt_and_callback`, `test_short_mpesa_payment_does_not_settle_the_invoice` |
| 2 | High | **Client IP spoofing.** DRF's `NUM_PROXIES` was unset, so throttles keyed on the raw `X-Forwarded-For` header, which clients control. Rotating that header bypassed the login/registration (10/min) and public enquiry (10/hour) limits. Behind a proxy, audit IPs and the Safaricom allowlist would have seen only the proxy. | `NUM_PROXIES` setting (0 by default, 1 in `deploy/`); `apps.core.net.client_ip` trusts exactly that many proxies and is used for throttles, audit entries and both callback allowlists. Caddy overwrites any client-sent `X-Forwarded-For`. | `tests/test_security.py` |
| 3 | Medium | **Spreadsheet formula injection** in report exports. Text such as a tenant name `=HYPERLINK(...)` became a live formula in the Excel export (openpyxl stores strings starting with `=` as formulas) and in CSV opened in Excel. | XLSX cells with text are always stored as strings; CSV text starting with `= + - @` (or tab/CR) is prefixed with `'`. Numbers keep their sign. | `test_exports_never_turn_user_text_into_formulas` |
| 4 | Medium | **Vulnerable dependencies:** djangorestframework 3.16.1 (5 advisories) and cryptography 46.0.7 (7 advisories). | DRF ≥ 3.18.2, cryptography ≥ 50.0.0. DRF 3.17+ validates conditional unique constraints itself; the move-out serializer opts out so the service keeps its clear 409 message. | full suite; `pip-audit`: no known vulnerabilities |
| 5 | Medium | **No Content-Security-Policy** on the web app. | CSP restricting everything to the site's own origin, with no framing, no plugins, and `base-uri`/`form-action` limited to self. `'unsafe-inline'` scripts are still needed for Next's bootstrap (see residual risks). | checked on the production build: smoke suite passes with the CSP |
| 6 | Low | Platform-admin sessions lasted 7 days like everyone else's, although they reach every organization's billing. | `PLATFORM_ADMIN_SESSION_AGE` (8 hours) applied at login. | `test_platform_admin_sessions_are_short` |
| 7 | Low | The production backend image installed dev tools (pytest, ruff), and uploaded files in a local `private_media/` could be baked into an image. | `REQUIREMENTS` build arg (runtime-only by default), `.dockerignore` excludes `private_media`, and the frontend gets a separate production stage (standalone server, non-root). | image inspected |
| 8 | Info | Support page views (one audit entry per request) crowded out real changes in the owner's "Recent activity". | Dashboard asks for `exclude_action=support.request`; the full audit log still shows every view. | `test_support_access_…` |

## Checked, no change needed

- **Authentication.** Session cookies are HttpOnly, SameSite=Lax and Secure in production. CSRF
  is enforced on every unsafe method, including anonymous login (login CSRF). `login()` rotates
  the session key. Password validators are on. Login and password reset return the same message
  whether or not the account exists.
- **Authorization.** Every organization-scoped view goes through `OrganizationPermission`, and
  actions not listed are denied. The isolation tests cover cross-organization IDs (404) and
  foreign organizations (403).
- **Platform console.** Every endpoint requires `is_platform_admin`. The flag is read-only in
  the API and only `manage.py platform_admin` (or the database) can set it. Grants and
  revocations are audited.
- **Support access.**
  - Platform admins see nothing inside an organization without a grant.
  - A grant needs a reason, lasts 15–240 minutes and notifies the owners.
  - It gives view-only capabilities, and every write is refused before any capability check.
  - Every request is audited in the organization's own log, and expiry is enforced on each request.
- **Read-only (lapsed) mode** is enforced centrally. Only paying and changing plan are exempt,
  and those are owner-only.
- **Uploads.** Content is sniffed and restricted to PDF, DOCX, JPEG, PNG and WebP, with a 10 MB
  cap (Caddy caps request bodies at 12 MB). Files are stored under random names outside the web
  root and served only through permission-checked views. Inline display is limited to images.
- **Public endpoints.** Listings only expose published listings and photos chosen for
  publishing. Enquiries are throttled per IP. Health reports database status only.
- **Tenant payment callbacks** were already protected by a per-configuration URL secret plus the
  IP allowlist, with idempotent processing.
- **Secrets.** Daraja credentials are encrypted at rest (`NEXORA_FIELD_ENCRYPTION_KEY`) and never
  returned by the API. No secrets are in the repository: `.env` files are ignored, and
  `deploy/env.example` holds placeholders only.
- **Django deploy check** (`check --deploy`, production settings) is clean apart from
  `SECURE_HSTS_PRELOAD`, which is deliberately off. Preloading is hard to undo, so decide once
  the domain is final.
- `npm audit`: no known vulnerabilities.

## Residual risks and recommendations

1. **No second factor.** Platform admins in particular should get TOTP or passkeys. Until then:
   keep the list of platform admins short, use unique long passwords, and review
   `platform.admin_granted` audit entries.
2. **CSP allows inline scripts.** Moving to per-request nonces (Next middleware) would remove
   `'unsafe-inline'`. React escapes output and nothing uses `dangerouslySetInnerHTML`, so the
   practical XSS surface is small.
3. **Registration reveals whether an email is registered** ("An account with this email already
   exists"). This is accepted for usability and rate-limited.
4. **M-Pesa callbacks rely on URL secrecy plus Safaricom's IP list.** Daraja doesn't sign
   callbacks. Set `MPESA_CALLBACK_ALLOWED_IPS` in production. A stronger check would query the
   transaction status API before settling.
5. **Single server.** The database, files and app share one host. Backups are encrypted and kept
   off-site (see the backup runbook), but there is no hot standby.
6. **Celery beat** schedules billing and the subscription lifecycle. Exactly one beat process must
   run, and the compose file enforces this.

## Re-running this review

```bash
cd backend
.venv/bin/pip-audit -r requirements.txt
DJANGO_SETTINGS_MODULE=config.settings.prod DJANGO_SECRET_KEY=x DJANGO_ALLOWED_HOSTS=example.com \
  .venv/bin/python manage.py check --deploy
.venv/bin/pytest tests/test_security.py tests/test_isolation.py tests/test_permissions.py tests/test_platform_admin.py
cd ../frontend && npm audit
```
