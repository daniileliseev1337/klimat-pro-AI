#!/usr/bin/env bash
# Проверка RLS push_subscriptions под двумя реальными пользователями.
# Механика JWT — как в deploy/tasks/verify-rls.sh (HS256, секреты из .env).
set -euo pipefail
SUPA=/srv/supabase-src/docker
REST=http://localhost:8000/rest/v1
JWT_SECRET="$(grep '^JWT_SECRET=' "$SUPA/.env" | cut -d= -f2-)"
ANON="$(grep '^ANON_KEY=' "$SUPA/.env" | cut -d= -f2-)"

sign() {
  python3 - "$JWT_SECRET" "$1" <<'PY'
import hmac,hashlib,base64,json,sys,time
secret,uid=sys.argv[1],sys.argv[2]
b=lambda x: base64.urlsafe_b64encode(x).rstrip(b'=')
h=b(json.dumps({"alg":"HS256","typ":"JWT"}).encode()); n=int(time.time())
p=b(json.dumps({"sub":uid,"role":"authenticated","aud":"authenticated","iat":n,"exp":n+3600}).encode())
s=b(hmac.new(secret.encode(),h+b'.'+p,hashlib.sha256).digest())
print((h+b'.'+p+b'.'+s).decode())
PY
}

read -r A B <<EOF
$(docker exec -i supabase-db psql -U postgres -d postgres -At -F' ' -c "SELECT id FROM public.profiles WHERE approved=true ORDER BY created_at LIMIT 2;" | tr '\n' ' ')
EOF
echo "A=$A B=$B"
[ -n "$A" ] && [ -n "$B" ] || { echo "NEED_TWO_APPROVED_USERS"; exit 1; }
JA="$(sign "$A")"; JB="$(sign "$B")"

EP="selftest-push-$A"   # без слэшей/двоеточий, чтобы PostgREST-фильтр eq. был простым

echo "== A вставляет подписку =="
curl -s -X POST "$REST/push_subscriptions" -H "apikey: $ANON" -H "Authorization: Bearer $JA" \
  -H "Content-Type: application/json" \
  -d "{\"user_id\":\"$A\",\"endpoint\":\"$EP\",\"p256dh\":\"x\",\"auth\":\"y\"}" -o /dev/null -w "insert: %{http_code}\n"

echo "== B читает подписку A (ожидаем []) =="
SEEN=$(curl -s "$REST/push_subscriptions?endpoint=eq.$EP&select=endpoint" -H "apikey: $ANON" -H "Authorization: Bearer $JB")
echo "B видит: $SEEN (ожидаем [])"

echo "== A видит свою (ожидаем endpoint) =="
OWN=$(curl -s "$REST/push_subscriptions?endpoint=eq.$EP&select=endpoint" -H "apikey: $ANON" -H "Authorization: Bearer $JA")
echo "A видит: $OWN"

echo "== B пытается вставить подписку от имени A (ожидаем отказ RLS) =="
HACK=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$REST/push_subscriptions" -H "apikey: $ANON" -H "Authorization: Bearer $JB" \
  -H "Content-Type: application/json" -d "{\"user_id\":\"$A\",\"endpoint\":\"hack-$A\",\"p256dh\":\"x\",\"auth\":\"y\"}")
echo "B insert от имени A: HTTP $HACK (ожидаем 4xx)"

echo "== cleanup =="
curl -s -X DELETE "$REST/push_subscriptions?endpoint=eq.$EP" -H "apikey: $ANON" -H "Authorization: Bearer $JA" -o /dev/null -w "delete: %{http_code}\n"
curl -s -X DELETE "$REST/push_subscriptions?endpoint=eq.hack-$A" -H "apikey: $ANON" -H "Authorization: Bearer $JA" -o /dev/null

[ "$SEEN" = "[]" ] && echo "$OWN" | grep -q "$EP" && [ "${HACK:0:1}" = "4" ] && echo "RLS_OK" || { echo "RLS_FAIL"; exit 1; }
