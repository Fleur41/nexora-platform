# Runbook: deploying Nexora

One Linux server runs the whole stack with Docker Compose (`deploy/docker-compose.prod.yml`):

```
Internet ──443──▶ Caddy (TLS, HSTS) ─┬─ /api/*, /django-admin/* ─▶ backend (Django + gunicorn)
                                     ├─ /static/*  (files)          worker  (Celery)
                                     └─ everything else ─▶ frontend  beat    (Celery scheduler, 1 only)
                                                          (Next.js)  db (Postgres 17), redis
```

Uploaded files live in the `private_media` volume and the database in `pgdata`. Both are
covered by [backup-and-restore.md](backup-and-restore.md).

This was tested end to end on a local copy of the stack: release steps, TLS, the CSP, the full
browser smoke suite, then backup, verified restore and full restore.

## 1. First-time setup

**Server.** Ubuntu 24.04 LTS, 2 vCPU, 4 GB RAM, 40 GB disk is enough for the first few hundred
organizations. Then:

```bash
# As root: Docker, a deploy user, firewall (SSH + web only)
curl -fsSL https://get.docker.com | sh
adduser --disabled-password nexora && usermod -aG docker nexora
ufw allow OpenSSH && ufw allow 80,443/tcp && ufw allow 443/udp && ufw enable
apt-get install -y rclone        # off-site backups
```

**DNS.** Point an A/AAAA record (e.g. `app.nexora.co.ke`) at the server **before** the first
start. Caddy needs it to get a Let's Encrypt certificate.

**Code and settings** (as `nexora`):

```bash
git clone https://github.com/Fleur41/nexora-platform.git && cd nexora-platform/deploy
cp env.example .env && chmod 600 .env
```

Fill in `.env`. Generate the secrets with:

```bash
openssl rand -hex 24                                    # POSTGRES_PASSWORD
openssl rand -base64 48 | tr -d '\n'; echo              # DJANGO_SECRET_KEY
python3 -c 'import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'
                                                        # NEXORA_FIELD_ENCRYPTION_KEY (Fernet)
openssl rand -base64 32                                 # BACKUP_PASSPHRASE
```

Store these four in the team password manager **now**. Losing
`NEXORA_FIELD_ENCRYPTION_KEY` makes saved M-Pesa credentials unreadable, and losing
`BACKUP_PASSPHRASE` makes every backup useless. Changing `DJANGO_SECRET_KEY` logs everyone out
and changes Nexora's M-Pesa callback URL.

**Start.**

```bash
docker compose -f docker-compose.prod.yml up -d --build
./release.sh            # see §2; the first run also creates the database tables
```

**First platform admin** (the console at `/platform`). This can only be done here, never from
the web:

```bash
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py platform_admin ops@nexora.co.ke --create    # prompts for a password
```

**Checks.**
- `https://app.nexora.co.ke/api/v1/health/` returns `{"status":"ok","database":true}`.
- Sign in at `/platform`. Open **Plans** and set real prices (the seeded prices are placeholders).
- Register a test organization and confirm the trial banner and `/dashboard/settings/subscription`.
- Send a test email: invite a team member.
- Schedule backups (backup runbook §1) and run one by hand.

## 2. Releasing a new version

Every release is a tagged commit on `main` whose CI run is green (backend, frontend, e2e).

```bash
cd ~/nexora-platform && git fetch --tags && git checkout v2026.11.1
cd deploy && sed -i 's/^NEXORA_VERSION=.*/NEXORA_VERSION=2026.11.1/' .env
./backup.sh                                             # always, before migrating
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d         # recreates changed containers
./release.sh
```

`release.sh` runs the steps that must follow every deploy: `migrate`, `collectstatic`,
`check --deploy`, then the health URL.

Downtime is a few seconds while containers restart. Rule for developers: a migration must work
with the previous release's code. Drop or rename columns in two releases, so a rollback (§3)
needs only the code, not a restore.

**After a release:**
- the health URL returns ok;
- `docker compose -f docker-compose.prod.yml ps` shows everything up (backend "healthy");
- sign in, open the dashboard and one report;
- `docker compose -f docker-compose.prod.yml logs --since 10m backend worker | grep -i error`
  shows nothing new.

## 3. Rolling back

Code only, with no new migrations:

```bash
git checkout <previous tag> && sed -i 's/^NEXORA_VERSION=.*/NEXORA_VERSION=<previous>/' .env
docker compose -f docker-compose.prod.yml up -d --build
```

If the bad release ran migrations that the old code can't use, restore the backup taken just
before the release ([backup-and-restore.md](backup-and-restore.md) §3), then start the
previous version. Data entered since that backup is lost, so say so in the incident note.

## 4. Configuration reference (deploy/.env)

| Setting | Notes |
| ------- | ----- |
| `NEXORA_DOMAIN`, `ACME_EMAIL` | Public hostname; Let's Encrypt contact |
| `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS`, `NEXORA_FRONTEND_URL`, `NEXORA_PUBLIC_API_URL` | All the public hostname (with `https://` where it's a URL) |
| `MPESA_CALLBACK_ALLOWED_IPS` | Safaricom's callback source IPs (get the current list from Safaricom). **Set this in production.** |
| `NUM_PROXIES` | Fixed at 1 in the compose file (Caddy). Add one per extra proxy (e.g. Cloudflare). Never set it higher than the real number, or clients can spoof their IP. |
| `NEXORA_PAYBILL`, `NEXORA_BANK_*`, `NEXORA_MPESA_*` | Nexora's own collection accounts, shown to landlords on their invoices. STK prompts need the Daraja credentials. |
| `NEXORA_TRIAL_DAYS`, `NEXORA_TRIAL_PLAN` | Free trial for new organizations (30 days on Growth by default) |
| `THROTTLE_AUTH`, `THROTTLE_ENQUIRY` | Leave the defaults (10/min, 10/hour) in production |
| `PLATFORM_ADMIN_SESSION_AGE` | Seconds; default 8 hours |
| `EMAIL_*` | A transactional SMTP provider. SPF and DKIM must be set up for the sending domain. |

## 5. Routine operations

| Task | Command (from `deploy/`) |
| ---- | ------------------------ |
| Status | `docker compose -f docker-compose.prod.yml ps` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f --tail 200 backend worker beat` |
| Django shell | `docker compose -f docker-compose.prod.yml exec backend python manage.py shell` |
| Grant / revoke a platform admin | `… exec backend python manage.py platform_admin EMAIL [--create \| --revoke]` |
| Run the subscription lifecycle now | `… exec backend python manage.py shell -c "from apps.subscriptions.services import run_lifecycle; from datetime import date; print(run_lifecycle(date.today()))"` |
| OS updates | `apt-get update && apt-get upgrade`, reboot in a quiet hour. Containers restart by themselves. |
| Base image updates | Monthly: `docker compose -f docker-compose.prod.yml build --pull && … up -d` |
| Certificate | Automatic (Caddy renews). Check with `curl -vI https://$NEXORA_DOMAIN 2>&1 \| grep expire` |

## 6. When something is wrong

| Symptom | Look at | Usual cause |
| ------- | ------- | ----------- |
| Site down, browser shows a TLS error | `logs caddy` | DNS changed, or ports 80/443 blocked so the certificate can't renew |
| 502 on `/api/` | `ps`, `logs backend` | Backend crashed on start: a bad `.env` value or a migration that wasn't run |
| Health shows `"database": false` | `logs db`, `df -h` | Disk full (check backups and Docker images: `docker system prune`) |
| Emails not arriving | `logs worker` | SMTP credentials, or the worker is stopped |
| No invoices on the 1st / subscriptions not moving | `logs beat` | Beat is stopped. Start it, then run the job by hand (table above). Billing runs are idempotent. |
| M-Pesa payments not recorded | Payment settings → events; `logs backend \| grep callback` | `NEXORA_PUBLIC_API_URL` wrong, the callback IP isn't in `MPESA_CALLBACK_ALLOWED_IPS`, or the secret changed (re-register the C2B URLs) |
| Everyone suddenly signed out | — | `DJANGO_SECRET_KEY` changed |

**Security incident** (suspected break-in, leaked secret):
1. Revoke access. `platform_admin EMAIL --revoke` removes a staff account's console access;
   suspending an organization in the console blocks one tenant organization.
2. Rotate the leaked secret:
   - **Database password:** change it in Postgres and in `.env`.
   - **Django secret:** change `DJANGO_SECRET_KEY`. This logs everyone out and changes Nexora's
     M-Pesa callback URL.
   - **Daraja credentials:** generate new ones in the Daraja portal, then re-save them in each
     organization's payment settings.
3. Keep the evidence. The audit log is append-only, so export the relevant entries in the Django
   admin, and keep the logs with
   `docker compose -f docker-compose.prod.yml logs --since 72h > incident.log`.
4. Kenya's Data Protection Act 2019 requires notifying the Data Commissioner within 72 hours of
   becoming aware of a breach of personal data, and notifying affected people where there is a
   real risk of harm.
