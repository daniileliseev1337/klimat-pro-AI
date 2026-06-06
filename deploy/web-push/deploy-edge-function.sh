#!/usr/bin/env bash
# Деплой edge-функции web-push-notify в self-hosted Supabase.
# config.json (VAPID private) кладётся отдельно (НЕ в git) — см. config.example.json.
set -euo pipefail
SRC="/mnt/f/Сайт/redesign-v2-fresh/deploy/web-push/functions/web-push-notify"
DST="/srv/supabase-src/docker/volumes/functions/web-push-notify"
mkdir -p "$DST"
cp "$SRC/index.ts" "$DST/index.ts"
if [ ! -f "$DST/config.json" ]; then
  echo "WARN: $DST/config.json отсутствует — положить VAPID-ключи (формат config.example.json)"
fi
docker restart supabase-edge-functions >/dev/null 2>&1
echo "deployed web-push-notify"
ls -1 "$DST"
