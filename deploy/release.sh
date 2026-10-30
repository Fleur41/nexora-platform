#!/usr/bin/env bash
# Steps after every deploy (docs/runbooks/deployment.md §2). Safe to run more than once.
set -euo pipefail
cd "$(dirname "$0")"
run() { docker compose -f docker-compose.prod.yml exec -T backend python manage.py "$@"; }
run migrate --noinput
run collectstatic --noinput
run check --deploy
curl -fsS "https://$(sed -n 's/^NEXORA_DOMAIN=//p' .env | tail -1)/api/v1/health/" && echo
