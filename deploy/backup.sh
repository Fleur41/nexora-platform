#!/usr/bin/env bash
# Nightly backup: database + uploaded files, encrypted, kept locally and (optionally) off-site.
# Run from deploy/ (cron: see docs/runbooks/backup-and-restore.md).
#
#   ./backup.sh            make a backup now
set -euo pipefail
cd "$(dirname "$0")"
# .env is docker compose syntax, not shell: read just the keys this script needs.
setting() { sed -n "s/^$1=//p" .env | tail -1; }
BACKUP_PASSPHRASE=${BACKUP_PASSPHRASE:-$(setting BACKUP_PASSPHRASE)}
BACKUP_DIR=${BACKUP_DIR:-$(setting BACKUP_DIR)}
BACKUP_KEEP_DAYS=${BACKUP_KEEP_DAYS:-$(setting BACKUP_KEEP_DAYS)}
BACKUP_RCLONE_REMOTE=${BACKUP_RCLONE_REMOTE:-$(setting BACKUP_RCLONE_REMOTE)}
NEXORA_VERSION=${NEXORA_VERSION:-$(setting NEXORA_VERSION)}
export BACKUP_PASSPHRASE
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE in deploy/.env}"
BACKUP_DIR=${BACKUP_DIR:-/var/backups/nexora}
KEEP=${BACKUP_KEEP_DAYS:-14}
COMPOSE=(docker compose -f docker-compose.prod.yml)
PROJECT=$("${COMPOSE[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/$STAMP"
mkdir -p "$OUT"
umask 077

encrypt() { openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -out "$1"; }

echo "[$STAMP] database"
"${COMPOSE[@]}" exec -T db pg_dump -U nexora -d nexora --format=custom --no-owner | encrypt "$OUT/db.dump.enc"

echo "[$STAMP] uploaded files"
docker run --rm -v "${PROJECT}_private_media:/media:ro" alpine:3 tar -C /media -czf - . | encrypt "$OUT/media.tar.gz.enc"

(cd "$OUT" && sha256 ./*.enc > SHA256SUMS)
echo "$NEXORA_VERSION" > "$OUT/VERSION"

if [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  echo "[$STAMP] off-site copy to $BACKUP_RCLONE_REMOTE"
  rclone copy "$OUT" "$BACKUP_RCLONE_REMOTE/$STAMP"
fi

# Local retention. Off-site retention is a lifecycle rule on the bucket (see the runbook).
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP" -exec rm -rf {} +
echo "[$STAMP] done: $OUT ($(du -sh "$OUT" | cut -f1))"
