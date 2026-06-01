#!/usr/bin/env bash
set -euo pipefail
DST=/srv/supabase-src/docker/volumes/functions/telegram-notify
mkdir -p "$DST"
cp /mnt/f/*/redesign-v2-fresh/deploy/tasks/functions/telegram-notify/index.ts "$DST/index.ts"
docker restart supabase-edge-functions >/dev/null
echo "TG_FN_DEPLOYED"
