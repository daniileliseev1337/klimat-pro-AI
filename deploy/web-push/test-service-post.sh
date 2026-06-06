#!/usr/bin/env bash
# Проверка пути insertInbox: service_role POST в /rest/v1/notifications создаёт
# строку (обход RLS). Клиенту POST запрещён — см. verify-notifications-rls.sh.
# Не зависит от наличия задач; пишет одну временную строку и удаляет её.
set -euo pipefail
SUPA=/srv/supabase-src/docker
REST=http://localhost:8000/rest/v1
SERVICE=$(grep '^SERVICE_ROLE_KEY=' "$SUPA/.env" | cut -d= -f2-)
[ -n "$SERVICE" ] || { echo "NO_SERVICE_ROLE_KEY"; exit 1; }

U=$(docker exec -i supabase-db psql -U postgres -d postgres -At -c "select id from public.profiles where approved=true order by created_at limit 1;")
[ -n "$U" ] || { echo "NO_APPROVED_USER"; exit 1; }
echo "U=$U"

RESP=$(curl -s -X POST "$REST/notifications" \
  -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "[{\"user_id\":\"$U\",\"type\":\"selftest_post\",\"title\":\"t\",\"body\":\"edge-path test\",\"url\":\"/\"}]")
echo "RESP=$RESP"

# cleanup через REST DELETE по фильтру type (без single-кавычек в SQL)
curl -s -X DELETE "$REST/notifications?type=eq.selftest_post" \
  -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -o /dev/null

echo "$RESP" | grep -q "edge-path test" && echo "SERVICE_POST_OK" || { echo "SERVICE_POST_FAIL"; exit 1; }
