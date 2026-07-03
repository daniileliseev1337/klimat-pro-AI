#!/usr/bin/env bash
# Внедрение edge-гейта web-push-notify (m6), шаги 1-2: секрет в vault + config.json,
# затем миграция cron. Деплой функции — ОТДЕЛЬНО deploy-edge-function.sh (шаг 3),
# порядок обязателен: cron с заголовком раньше гейченной функции (иначе окно 401).
# Запуск (WSL root): bash apply-secret-gate.sh
set -euo pipefail
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -At"
FN_DIR=/srv/supabase-src/docker/volumes/functions/web-push-notify
MIG="$(cd "$(dirname "$0")/../../supabase/migrations" && pwd)/20260703_0002_web_push_cron_secret.sql"
[ -f "$MIG" ] || { echo "NO_MIGRATION $MIG"; exit 1; }
[ -f "$FN_DIR/config.json" ] || { echo "NO_CONFIG $FN_DIR/config.json"; exit 1; }

# 1) секрет: переиспользовать из vault или создать
SECRET=$($PSQL -c "select decrypted_secret from vault.decrypted_secrets where name='web_push_secret';")
if [ -z "$SECRET" ]; then
  SECRET=$(openssl rand -hex 32)
  $PSQL -c "select vault.create_secret('$SECRET', 'web_push_secret', 'edge-гейт web-push-notify (m6)');" >/dev/null
  echo "vault: web_push_secret создан"
else
  echo "vault: web_push_secret уже есть — переиспользую"
fi

# 2) тот же секрет в config.json функции (merge поверх VAPID, ничего не терять)
SECRET="$SECRET" python3 - "$FN_DIR/config.json" <<'PY'
import json, os, sys
p = sys.argv[1]
cfg = json.load(open(p))
cfg["pushSecret"] = os.environ["SECRET"]
json.dump(cfg, open(p, "w"), ensure_ascii=False, indent=2)
PY
echo "config.json: pushSecret записан"

# 3) cron-джоб с заголовком (миграция)
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG"
echo "SECRET_GATE_APPLIED"
