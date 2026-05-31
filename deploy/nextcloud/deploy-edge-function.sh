#!/usr/bin/env bash
# Деплой Edge Function `nextcloud` в локальный Supabase. Идемпотентно.
set -euo pipefail
SUPA=/srv/supabase-src/docker
NC=/srv/nextcloud
DST="$SUPA/volumes/functions/nextcloud"

mkdir -p "$DST"
cp /mnt/f/*/redesign-v2-fresh/deploy/nextcloud/functions/nextcloud/index.ts "$DST/index.ts"

# config.json с кредами Nextcloud — только на сервере, не в git
NC_USER="$(grep '^NC_APP_USER=' "$NC/.env" | cut -d= -f2-)"
NC_PASS="$(grep '^NC_APP_PASSWORD=' "$NC/.env" | cut -d= -f2-)"
cat > "$DST/config.json" <<JSON
{"url":"http://nextcloud","user":"$NC_USER","password":"$NC_PASS"}
JSON
chmod 600 "$DST/config.json"

# сбросить кэш модулей edge-runtime (не трогаем compose-файлы)
docker restart supabase-edge-functions >/dev/null
echo "EDGE_DEPLOYED"
