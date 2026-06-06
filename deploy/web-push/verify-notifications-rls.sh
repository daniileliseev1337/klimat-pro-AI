#!/usr/bin/env bash
# Проверка RLS notifications под двумя реальными пользователями.
# Механика JWT — как в deploy/web-push/verify-rls.sh (HS256, секреты из .env).
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

# подчистим возможные остатки прошлых прогонов (идемпотентность)
docker exec -i supabase-db psql -U postgres -d postgres -c "delete from public.notifications where type='selftest';" >/dev/null

# тестовая строка для A — вставляем как postgres (service role обходит RLS; клиенту insert запрещён)
# grep -Eom1 извлекает ровно UUID (psql -At к INSERT...RETURNING печатает ещё тег "INSERT 0 1")
NID=$(docker exec -i supabase-db psql -U postgres -d postgres -At -c \
  "insert into public.notifications(user_id,type,title,body,url) values ('$A','selftest','КЛИМАТ-ПРО','selftest inbox','/') returning id;" | grep -Eom1 '[0-9a-f-]{36}')
echo "NID=$NID"

echo "== B читает уведомление A (ожидаем []) =="
SEEN=$(curl -s "$REST/notifications?id=eq.$NID&select=id" -H "apikey: $ANON" -H "Authorization: Bearer $JB")
echo "B видит: $SEEN"

echo "== A видит своё (ожидаем id) =="
OWN=$(curl -s "$REST/notifications?id=eq.$NID&select=id" -H "apikey: $ANON" -H "Authorization: Bearer $JA")
echo "A видит: $OWN"

echo "== клиент (A) пытается INSERT (ожидаем 4xx — insert-политики нет) =="
INS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$REST/notifications" -H "apikey: $ANON" -H "Authorization: Bearer $JA" \
  -H "Content-Type: application/json" -d "{\"user_id\":\"$A\",\"type\":\"hack\",\"title\":\"x\",\"body\":\"y\"}")
echo "A insert: HTTP $INS"

echo "== B пытается отметить строку A прочитанной (ожидаем []: 0 изменённых) =="
BPATCH=$(curl -s -X PATCH "$REST/notifications?id=eq.$NID" -H "apikey: $ANON" -H "Authorization: Bearer $JB" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"read":true}')
echo "B patch вернул: $BPATCH"

echo "== A отмечает своё прочитанным (ожидаем read:true) =="
APATCH=$(curl -s -X PATCH "$REST/notifications?id=eq.$NID" -H "apikey: $ANON" -H "Authorization: Bearer $JA" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"read":true}')
echo "A patch вернул: $APATCH"

echo "== cleanup =="
docker exec -i supabase-db psql -U postgres -d postgres -c "delete from public.notifications where id='$NID';" >/dev/null

[ "$SEEN" = "[]" ] && echo "$OWN" | grep -q "$NID" && [ "${INS:0:1}" = "4" ] \
  && [ "$BPATCH" = "[]" ] && echo "$APATCH" | grep -q '"read":true' \
  && echo "RLS_OK" || { echo "RLS_FAIL SEEN=$SEEN OWN=$OWN INS=$INS BPATCH=$BPATCH APATCH=$APATCH"; exit 1; }
