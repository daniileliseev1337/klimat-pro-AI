#!/usr/bin/env bash
# Верификация Фазы 2 — самодостаточный E2E в транзакции с ROLLBACK (следов нет).
# verify-phase2.sql создаёт temp client+project+file и проверяет переписку/файлы/гейты.
set -euo pipefail
SQL="$(cd "$(dirname "$0")" && pwd)/verify-phase2.sql"
[ -f "$SQL" ] || { echo "NO_SQL $SQL"; exit 1; }
{ echo "begin;"; cat "$SQL"; echo "rollback;"; } \
  | docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1
echo "CLIENT_P2_OK"
