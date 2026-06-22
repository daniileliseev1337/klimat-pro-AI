#!/usr/bin/env bash
# Транзакционный E2E D роль заказчика фаза 1: миграция + verify-phase1.sql в BEGIN…ROLLBACK (прод не меняется).
# Запуск: wsl -d Ubuntu -u root -- bash -c 'bash /mnt/f/*/redesign-v2-fresh/deploy/client-role/verify-phase1.sh'
set -euo pipefail
MIG=$(ls -d /mnt/f/*/redesign-v2-fresh/supabase/migrations)
VDIR=$(ls -d /mnt/f/*/redesign-v2-fresh/deploy/client-role)
( echo "BEGIN;"
  cat "$MIG"/20260622_0007_client_role_phase1.sql; echo
  cat "$VDIR/verify-phase1.sql"
  echo "ROLLBACK;"
) | docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 | tee /tmp/cr_verify.log
grep -q CLIENT_ROLE_OK /tmp/cr_verify.log && grep -q SET_CLIENT_USER_GATE_OK /tmp/cr_verify.log \
  && echo "VERIFY_PASS" || { echo "VERIFY_FAIL"; exit 1; }
