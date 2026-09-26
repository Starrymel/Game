#!/usr/bin/env bash
# Owner: D. Push the current code to the server and restart it (about 15 seconds).
#
#   DEPLOY_HOST=root@<server-ip> ./deploy/deploy.sh              deploy
#   DEPLOY_HOST=root@<server-ip> ./deploy/deploy.sh --env        also copy your local .env up (first time, or when keys change)
#   DEPLOY_HOST=root@<server-ip> ./deploy/deploy.sh --init-db    also create the database tables (first time)
#   DEPLOY_HOST=root@<server-ip> ./deploy/deploy.sh logs         follow the server logs
#   DEPLOY_HOST=root@<server-ip> ./deploy/deploy.sh status       is it running?
set -euo pipefail

: "${DEPLOY_HOST:?Set DEPLOY_HOST, e.g.  DEPLOY_HOST=root@203.0.113.7 ./deploy/deploy.sh}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH=(ssh -o ServerAliveInterval=15)

cmd=deploy; PUSH_ENV=0; INIT_DB=0
for arg in "$@"; do
  case "$arg" in
    logs|status) cmd="$arg" ;;
    --env) PUSH_ENV=1 ;;
    --init-db) INIT_DB=1 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

case "$cmd" in
  logs)   exec "${SSH[@]}" "$DEPLOY_HOST" 'journalctl -u composure -u composure-netplay -n 50 -f' ;;
  status) exec "${SSH[@]}" "$DEPLOY_HOST" 'systemctl --no-pager status composure composure-netplay | head -30; echo; curl -s http://127.0.0.1:3000/api/health; echo' ;;
esac

echo "==> uploading code"
# Excluded paths are also protected on the server: --delete will not remove its .env, node_modules, spool or caches.
rsync -az --delete -e "ssh -o ServerAliveInterval=15" \
  --exclude '.git/' --exclude 'node_modules/' --exclude '.DS_Store' \
  --exclude '.env' --exclude '.domain' --exclude '.npm/' \
  --exclude 'server/spool/' --exclude 'server/ai/cache/' \
  --exclude 'bridge/' --exclude 'tests/' --exclude 'fixtures/' \
  "$ROOT/" "$DEPLOY_HOST:/opt/composure/"

if [ "$PUSH_ENV" = 1 ]; then
  [ -f "$ROOT/.env" ] || { echo "No .env in $ROOT to copy."; exit 1; }
  echo "==> copying your local .env (it contains secrets) to the server"
  scp -q "$ROOT/.env" "$DEPLOY_HOST:/opt/composure/.env"
  "${SSH[@]}" "$DEPLOY_HOST" 'chown composure:composure /opt/composure/.env && chmod 600 /opt/composure/.env'
fi

"${SSH[@]}" "$DEPLOY_HOST" "INIT_DB=$INIT_DB bash -s" <<'REMOTE'
set -euo pipefail
cd /opt/composure
if [ ! -f .env ]; then
  echo "!! /opt/composure/.env is missing. Re-run with --env to copy your local one."; exit 1
fi
chown -R composure:composure /opt/composure

echo "==> installing dependencies"
runuser -u composure -- npm ci --omit=dev --no-audit --no-fund --silent || runuser -u composure -- npm install --omit=dev --no-audit --no-fund --silent
( cd netplay && { runuser -u composure -- npm ci --omit=dev --no-audit --no-fund --silent || runuser -u composure -- npm install --omit=dev --no-audit --no-fund --silent; } )

if [ "${INIT_DB:-0}" = 1 ]; then
  echo "==> creating database tables"
  runuser -u composure -- node scripts/init-db.js
fi

echo "==> restarting"
systemctl restart composure composure-netplay
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/health -o /tmp/composure-health.json 2>/dev/null; then
    echo "==> server is up: $(cat /tmp/composure-health.json)"; break
  fi
  if [ "$i" = 20 ]; then
    echo "!! server did not start. Recent logs:"; journalctl -u composure -n 30 --no-pager; exit 1
  fi
  sleep 1
done
systemctl is-active composure composure-netplay
REMOTE

DOMAIN="$("${SSH[@]}" "$DEPLOY_HOST" 'cat /opt/composure/.domain 2>/dev/null' || true)"
echo
echo "Deployed. Open https://${DOMAIN:-<your server address>}"
