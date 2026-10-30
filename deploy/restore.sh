#!/usr/bin/env bash
# Restore a backup made by backup.sh.
#
#   ./restore.sh --verify <backup-dir>   restore into a throwaway database and print counts
#                                        (monthly drill; production is untouched)
#   ./restore.sh <backup-dir>            REPLACE production data with the backup
set -euo pipefail
cd "$(dirname "$0")"
# .env is docker compose syntax, not shell: read just the keys this script needs.
setting() { sed -n "s/^$1=//p" .env | tail -1; }
BACKUP_PASSPHRASE=${BACKUP_PASSPHRASE:-$(setting BACKUP_PASSPHRASE)}
NEXORA_DOMAIN=${NEXORA_DOMAIN:-$(setting NEXORA_DOMAIN)}
export BACKUP_PASSPHRASE
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE in deploy/.env}"

VERIFY=false
if [[ "${1:-}" == "--verify" ]]; then VERIFY=true; shift; fi
SRC=${1:?usage: restore.sh [--verify] <backup-dir>}
COMPOSE=(docker compose -f docker-compose.prod.yml)
PROJECT=$("${COMPOSE[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')

(cd "$SRC" && sha256 -c SHA256SUMS)
decrypt() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$1"; }

COUNTS="select 'organizations', count(*) from organizations_organization
  union all select 'invoices', count(*) from billing_invoice
  union all select 'payments', count(*) from payments_payment
  union all select 'audit entries', count(*) from audit_auditlog;"

if $VERIFY; then
  NAME="nexora-restore-check-$$"
  docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=check -e POSTGRES_DB=nexora postgres:17-alpine >/dev/null
  trap 'docker stop "$NAME" >/dev/null' EXIT
  # Over TCP: during first start the image runs a socket-only server, then restarts.
  until docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres -d nexora >/dev/null 2>&1; do sleep 1; done
  decrypt "$SRC/db.dump.enc" | docker exec -i "$NAME" pg_restore -h 127.0.0.1 -U postgres -d nexora --no-owner --exit-on-error
  docker exec "$NAME" psql -h 127.0.0.1 -U postgres -d nexora -At -F ': ' -c "$COUNTS"
  decrypt "$SRC/media.tar.gz.enc" | tar -tzf - | wc -l | xargs echo "uploaded files:"
  echo "Backup $SRC restores cleanly."
  exit 0
fi

read -r -p "This REPLACES all production data with $SRC. Type the domain ($NEXORA_DOMAIN) to continue: " answer
[[ "$answer" == "$NEXORA_DOMAIN" ]] || { echo "Cancelled."; exit 1; }

"${COMPOSE[@]}" stop caddy backend worker beat
decrypt "$SRC/db.dump.enc" | "${COMPOSE[@]}" exec -T db pg_restore -U nexora -d nexora --clean --if-exists --no-owner --exit-on-error
decrypt "$SRC/media.tar.gz.enc" | docker run --rm -i -v "${PROJECT}_private_media:/media" alpine:3 \
  sh -c 'find /media -mindepth 1 -delete && tar -C /media -xzf - && chown -R 1000:1000 /media'
"${COMPOSE[@]}" up -d
"${COMPOSE[@]}" exec -T backend python manage.py migrate --noinput
"${COMPOSE[@]}" exec -T db psql -U nexora -d nexora -At -F ': ' -c "$COUNTS"
echo "Restored $SRC."
