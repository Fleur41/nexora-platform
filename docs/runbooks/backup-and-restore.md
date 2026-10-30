# Runbook: backups and restores

**What is backed up:** the Postgres database (every organization's records, ledgers and audit
log) and the `private_media` volume (leases, IDs, photos, receipts uploaded by users). Both are
needed: a database without its files has broken document links.

**Not backed up, by design:** Redis (queue and cache only), Caddy's certificates (re-issued
automatically) and container images (rebuilt from git). `deploy/.env` must be in the password
manager, not in the backups.

| Target | Value |
| ------ | ----- |
| Recovery point (most data lost) | 24 hours (nightly), or less if you run `backup.sh` more often |
| Recovery time | About 1 hour on a new server: §4 |
| Retention | 14 days on the server (`BACKUP_KEEP_DAYS`), 90 days off-site (bucket lifecycle rule) |

Each backup is a folder `BACKUP_DIR/<UTC timestamp>/` containing:
- `db.dump.enc` (pg_dump custom format) and `media.tar.gz.enc`, both encrypted with
  AES-256 using `BACKUP_PASSPHRASE`;
- `SHA256SUMS` and `VERSION` (the app version at backup time).

## 1. Schedule

As the `nexora` user, run `crontab -e` and add:

```cron
# Nightly backup at 02:30 Nairobi time (server in UTC: 23:30); restore drill on the 1st
30 23 * * *  /home/nexora/nexora-platform/deploy/backup.sh >> /home/nexora/backup.log 2>&1
0 6 1 * *    cd /home/nexora/nexora-platform/deploy && ./restore.sh --verify "$(ls -d /var/backups/nexora/* | tail -1)" >> /home/nexora/restore-drill.log 2>&1
```

**Off-site copy.** Create a bucket with a different provider or region from the server, such as
Backblaze B2, Cloudflare R2 or S3. Then:

```bash
rclone config                                  # create a remote, e.g. "offsite"
# deploy/.env:  BACKUP_RCLONE_REMOTE=offsite:nexora-backups
```

On the bucket:
- add a lifecycle rule that deletes objects after 90 days;
- give the key used on the server **write-only** access (no delete), so a compromised server
  can't erase its own backups.

**Monitoring.** Check `backup.log` weekly, or better, add a heartbeat (e.g. healthchecks.io) to
the end of the cron line: `&& curl -fsS https://hc-ping.com/<uuid>`.

## 2. Check that backups restore (monthly; production is untouched)

```bash
cd deploy
./restore.sh --verify /var/backups/nexora/<timestamp>
```

This checks the checksums, decrypts the backup and restores the database into a throwaway
Postgres container. It then prints row counts (organizations, invoices, payments, audit
entries) and the number of files. Compare the counts with the platform console overview. A
backup that has never been restored doesn't count as a backup.

To check an off-site copy, first fetch it:
`rclone copy offsite:nexora-backups/<timestamp> /tmp/check/<timestamp>`.

## 3. Restore production on the same server

Use this for data corruption or a bad migration. **Everything entered since the backup is
lost**, so tell the affected organizations.

```bash
cd deploy
./backup.sh                                    # keep the current (bad) state, just in case
./restore.sh /var/backups/nexora/<timestamp>   # asks you to type the domain to confirm
```

The script:
1. stops Caddy and the app containers (users see the site down instead of half-restored data);
2. replaces the database and the uploaded files;
3. starts everything and runs `migrate` (in case the backup came from an older version);
4. prints the row counts.

Then check the site as after a release (deployment runbook §2) and note the incident.

If the backup's `VERSION` is newer than the code you're running, check out that version first.

## 4. Restore onto a new server (server lost)

1. Build the server, set up DNS and clone the repository (deployment runbook §1). Check out the
   tag in the backup's `VERSION`.
2. Recreate `deploy/.env` from the password manager. **It must be the same
   `NEXORA_FIELD_ENCRYPTION_KEY` and `BACKUP_PASSPHRASE`**, and should be the same
   `DJANGO_SECRET_KEY` so Nexora's M-Pesa callback URL doesn't change.
3. Fetch the latest backup: `rclone copy offsite:nexora-backups/<timestamp> /var/backups/nexora/<timestamp>`
4. Start the database only, restore, then start everything:

   ```bash
   cd deploy
   docker compose -f docker-compose.prod.yml up -d db
   ./restore.sh /var/backups/nexora/<timestamp>
   ./release.sh
   ```

5. If DNS changed, update the callback URLs registered with Safaricom (each organization's
   payment settings → register URLs).

## 5. Restoring one organization's data

Backups are whole-database. To recover something one organization deleted or broke:
1. Run `restore.sh --verify` on a backup and keep the container. Comment out the `trap` line,
   or restore by hand into a scratch Postgres.
2. Copy out the needed rows with `psql`.
3. Re-enter the data through the app, so ledgers and audit entries stay consistent.

Never write financial rows straight into production. Posted invoices and payments are immutable
by design; corrections go through credits and reversals.
