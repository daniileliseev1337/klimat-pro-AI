#!/usr/bin/env bash
# Деплой edge-функции admin-create-user в self-hosted Supabase.
set -euo pipefail
SRC="/mnt/f/Сайт/redesign-v2-fresh/deploy/admin-create-user/functions/admin-create-user"
DST="/srv/supabase-src/docker/volumes/functions/admin-create-user"
mkdir -p "$DST"
cp "$SRC/index.ts" "$DST/index.ts"
docker restart supabase-edge-functions >/dev/null 2>&1
echo "deployed admin-create-user"
ls -1 "$DST"
