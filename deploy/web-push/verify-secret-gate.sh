#!/usr/bin/env bash
# Верификация edge-гейта web-push-notify: 401 без auth и на anon-JWT, 200 на секрет
# и на реальный user-JWT (temp-пользователь: создать → password grant → удалить),
# cron-джоб пересоздан с заголовком. Тип __gate_check не имеет side-effect (unknown type).
set -euo pipefail
SUPA=/srv/supabase-src/docker
BASE=http://localhost:8000
URL=$BASE/functions/v1/web-push-notify
ANON="$(grep '^ANON_KEY=' "$SUPA/.env" | cut -d= -f2-)"
SERVICE="$(grep '^SERVICE_ROLE_KEY=' "$SUPA/.env" | cut -d= -f2-)"
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -At"
SECRET=$($PSQL -c "select decrypted_secret from vault.decrypted_secrets where name='web_push_secret';")
[ -n "$SECRET" ] || { echo "NO_VAULT_SECRET"; exit 1; }
FAIL=0
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

C=$(code -X POST "$URL" -H "Content-Type: application/json" -d '{"type":"__gate_check"}')
echo "no-auth: $C (ожидаем 401)"; [ "$C" = 401 ] || FAIL=1

C=$(code -X POST "$URL" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"type":"__gate_check"}')
echo "anon-jwt: $C (ожидаем 401)"; [ "$C" = 401 ] || FAIL=1

C=$(code -X POST "$URL" -H "X-Push-Secret: $SECRET" -H "Content-Type: application/json" -d '{"type":"__gate_check"}')
echo "secret: $C (ожидаем 200)"; [ "$C" = 200 ] || FAIL=1

EMAIL="e2e-pushgate-$(date +%s)@example.local"; PASS="verifypass123"
NUID=$(curl -s -X POST "$BASE/auth/v1/admin/users" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
  -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))')
[ -n "$NUID" ] || { echo "TEMP_USER_CREATE_FAIL"; exit 1; }
# temp-юзер удаляется на ЛЮБОМ выходе (в т.ч. прерывание) — не оставляем orphan в auth.users
cleanup() { $PSQL -c "delete from auth.users where id='$NUID';" >/dev/null 2>&1 || true; }
trap cleanup EXIT
TOKEN=$(curl -s -X POST "$BASE/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')
C=$(code -X POST "$URL" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"type":"__gate_check"}')
echo "user-jwt: $C (ожидаем 200)"; [ "$C" = 200 ] || FAIL=1

HAS=$($PSQL -c "select count(*) from cron.job where jobname='web-push-deadline' and command like '%X-Push-Secret%';")
echo "cron header: $HAS (ожидаем 1)"; [ "$HAS" = 1 ] || FAIL=1

[ "$FAIL" = 0 ] && echo "PUSH_GATE_OK" || { echo "PUSH_GATE_FAIL"; exit 1; }
