#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT=/mnt/f/Сайт/redesign-v2-fresh
SUPA=/srv/supabase-src/docker
WEB=/srv/daniil-deploy
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="$WEB/backups/remote-mcp-$STAMP"
AUTH_COMPOSE="$SUPA/docker-compose.yml"
AUTH_ENV="$SUPA/.env"
VPS=root@193.124.130.236
PUBLIC_ORIGIN=https://193-124-130-236.sslip.io

test -f "$ROOT/mcp/Dockerfile"
test -f "$ROOT/deploy/nginx.default.conf"
mkdir -p "$BACKUP"
cp "$AUTH_COMPOSE" "$BACKUP/supabase-docker-compose.yml"
cp "$AUTH_ENV" "$BACKUP/supabase.env"
cp "$WEB/docker-compose.web.yml" "$BACKUP/docker-compose.web.yml"
test ! -f "$WEB/nginx.default.conf" || cp "$WEB/nginx.default.conf" "$BACKUP/nginx.default.conf"
docker exec supabase-db pg_dump -U supabase_admin -d postgres -n auth --clean --if-exists --no-owner > "$BACKUP/auth-schema.sql"
if docker exec supabase-db psql -U supabase_admin -d postgres -Atc "select to_regclass('public.mcp_user_access') is not null" | grep -qx t; then
  touch "$BACKUP/mcp-table-preexisting.flag"
fi
CADDY_BACKUP=/etc/caddy/Caddyfile.backup-$STAMP
printf '%s\n' "$CADDY_BACKUP" > "$BACKUP/vps-caddy-backup-path.txt"
ssh "$VPS" "cp /etc/caddy/Caddyfile '$CADDY_BACKUP'"

rollback() {
  bash "$ROOT/deploy/mcp/rollback-remote-mcp.sh" "$BACKUP" || true
}
trap rollback ERR

python3 - "$AUTH_COMPOSE" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
s = s.replace('image: supabase/gotrue:v2.186.0', 'image: supabase/gotrue:v2.195.0')
anchor = '      GOTRUE_SITE_URL: ${SITE_URL}\n'
block = anchor + '''      GOTRUE_OAUTH_SERVER_ENABLED: "true"
      GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH: "/oauth/consent"
      GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION: "true"
      GOTRUE_OAUTH_SERVER_DEFAULT_SCOPE: "openid email profile offline_access"
'''
if 'GOTRUE_OAUTH_SERVER_ENABLED:' not in s:
    if anchor not in s: raise SystemExit('AUTH COMPOSE ANCHOR NOT FOUND')
    s = s.replace(anchor, block, 1)
if 'supabase/gotrue:v2.195.0' not in s: raise SystemExit('AUTH IMAGE PATCH FAILED')
p.write_text(s)
PY

python3 - "$AUTH_ENV" "$PUBLIC_ORIGIN" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
origin = sys.argv[2]
lines = path.read_text().splitlines()
updates = {
    'API_EXTERNAL_URL': origin,
    'SITE_URL': origin,
}
seen = set()
for i, line in enumerate(lines):
    if '=' not in line or line.lstrip().startswith('#'):
        continue
    key = line.split('=', 1)[0]
    if key in updates:
        lines[i] = f'{key}={updates[key]}'
        seen.add(key)
if seen != set(updates):
    raise SystemExit(f'AUTH ENV KEYS MISSING: {sorted(set(updates) - seen)}')
path.write_text('\n'.join(lines) + '\n')
PY

if grep -q '^JWT_KEYS=\[\]$' "$AUTH_ENV" || ! grep -q '^JWT_KEYS=' "$AUTH_ENV"; then
  echo 'JWT_KEYS must contain asymmetric signing keys for OAuth openid' >&2
  exit 1
fi

docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
  < "$ROOT/supabase/migrations/20260811_0001_remote_mcp_access.sql"
touch "$BACKUP/mcp-migration-applied.flag"
bash "$ROOT/deploy/mcp/verify-remote-mcp-rls.sh"

rm -rf "$WEB/mcp-runtime.new"
mkdir -p "$WEB/mcp-runtime.new"
cp "$ROOT/mcp/package.json" "$ROOT/mcp/package-lock.json" "$ROOT/mcp/Dockerfile" "$ROOT/mcp/.dockerignore" "$WEB/mcp-runtime.new/"
cp -r "$ROOT/mcp/src" "$WEB/mcp-runtime.new/src"
rm -rf "$WEB/mcp-runtime"
mv "$WEB/mcp-runtime.new" "$WEB/mcp-runtime"
cp "$ROOT/deploy/docker-compose.web.yml" "$WEB/docker-compose.web.yml"
cp "$ROOT/deploy/nginx.default.conf" "$WEB/nginx.default.conf"

scp "$ROOT/deploy/mcp/Caddyfile" "$VPS:/etc/caddy/Caddyfile.new"
ssh "$VPS" "caddy validate --config /etc/caddy/Caddyfile.new && mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile && systemctl reload caddy"

cd "$SUPA"
docker compose config >/dev/null
docker compose pull auth
touch "$BACKUP/auth-upgrade-started.flag"
docker compose up -d auth
for _ in $(seq 1 30); do docker inspect -f '{{.State.Health.Status}}' supabase-auth 2>/dev/null | grep -q healthy && break; sleep 2; done
docker inspect -f '{{.State.Health.Status}}' supabase-auth | grep -q healthy

cd "$WEB"
docker compose --env-file "$SUPA/.env" config >/dev/null
docker compose --env-file "$SUPA/.env" up -d --build
docker inspect -f '{{.State.Health.Status}}' daniil-mcp | grep -q healthy

bash "$ROOT/deploy/mcp/verify-remote-mcp-http.sh"
trap - ERR
echo "REMOTE_MCP_DEPLOYED backup=$BACKUP"
