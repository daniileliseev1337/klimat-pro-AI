#!/usr/bin/env bash
# Постоянное применение миграции Фазы 2 к живой БД (по слову «деплой»).
set -euo pipefail
MIG="$(cd "$(dirname "$0")/../../supabase/migrations" && pwd)/20260703_0003_client_phase2.sql"
[ -f "$MIG" ] || { echo "NO_MIGRATION $MIG"; exit 1; }
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG"
echo "MIGRATIONS_DONE"
