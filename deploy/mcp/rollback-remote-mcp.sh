#!/usr/bin/env bash
set -euo pipefail

SUPA=/srv/supabase-src/docker
WEB=/srv/daniil-deploy
VPS=root@193.124.130.236
BACKUP=${1:-}

case "$BACKUP" in
  /srv/daniil-deploy/backups/remote-mcp-*) ;;
  *) echo "Usage: $0 /srv/daniil-deploy/backups/remote-mcp-<timestamp>" >&2; exit 2 ;;
esac

test -d "$BACKUP"
test -f "$BACKUP/supabase-docker-compose.yml"
test -f "$BACKUP/supabase.env"
test -f "$BACKUP/docker-compose.web.yml"
test -f "$BACKUP/auth-schema.sql"
test -f "$BACKUP/vps-caddy-backup-path.txt"

echo "ROLLBACK from $BACKUP" >&2

if test -f "$BACKUP/auth-upgrade-started.flag"; then
  (cd "$SUPA" && docker compose stop auth)
  docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "$BACKUP/auth-schema.sql"
fi

if test -f "$BACKUP/mcp-migration-applied.flag" && ! test -f "$BACKUP/mcp-table-preexisting.flag"; then
  docker exec supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c \
    'drop function if exists public.admin_set_mcp_access(uuid, text); drop table if exists public.mcp_user_access;'
fi

cp "$BACKUP/supabase-docker-compose.yml" "$SUPA/docker-compose.yml"
cp "$BACKUP/supabase.env" "$SUPA/.env"
cp "$BACKUP/docker-compose.web.yml" "$WEB/docker-compose.web.yml"
if test -f "$BACKUP/nginx.default.conf"; then
  cp "$BACKUP/nginx.default.conf" "$WEB/nginx.default.conf"
else
  rm -f "$WEB/nginx.default.conf"
fi

CADDY_BACKUP=$(cat "$BACKUP/vps-caddy-backup-path.txt")
case "$CADDY_BACKUP" in /etc/caddy/Caddyfile.backup-*) ;; *) echo 'Bad Caddy backup path' >&2; exit 2 ;; esac
ssh "$VPS" "cp '$CADDY_BACKUP' /etc/caddy/Caddyfile && caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy"

(cd "$SUPA" && docker compose up -d auth)
(cd "$WEB" && docker compose --env-file "$SUPA/.env" up -d --build)
echo "REMOTE_MCP_ROLLED_BACK backup=$BACKUP"
