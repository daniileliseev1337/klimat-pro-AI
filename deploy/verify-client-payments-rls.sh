#!/usr/bin/env bash
# Проверка get_my_project_payments: заказчику видны платежи ТОЛЬКО его проектов (§1).
# Механика JWT — как в deploy/payment-shares/verify-shares-rls.sh (HS256, секреты из .env).
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

# Берём двух одобренных пользователей: A — владелец проекта+заказчик, B — посторонний
read -r A B <<EOF
$(docker exec -i supabase-db psql -U postgres -d postgres -At -F' ' -c \
"SELECT id FROM public.profiles WHERE approved=true ORDER BY created_at LIMIT 2;" | tr '\n' ' ')
EOF
echo "A=$A B=$B"
[ -n "$A" ] && [ -n "$B" ] || { echo "NEED_TWO_APPROVED_USERS"; exit 1; }
JA="$(sign "$A")"; JB="$(sign "$B")"

echo "== A создаёт клиента (linked к user A) =="
CID=$(docker exec -i supabase-db psql -U postgres -d postgres -At -c \
  "INSERT INTO public.clients(name, owner_id, user_id) VALUES ('Selftest Client', '$A', '$A') RETURNING id;" \
  | grep -Eom1 '[0-9a-f-]{36}')
echo "client id=$CID"; [ -n "$CID" ] || { echo "INSERT CLIENT FAILED"; exit 1; }

echo "== A создаёт проект (client_id=$CID) =="
PID=$(curl -s -X POST "$REST/projects" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JA" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"owner_id\":\"$A\",\"client_id\":\"$CID\",\"name\":\"RLS client payments selftest\",\"contract_sum\":100000,\"paid_amount\":0}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if isinstance(d,list) and d else "")')
echo "project id=$PID"; [ -n "$PID" ] || { echo "INSERT PROJECT FAILED"; exit 1; }

echo "== Вставляем платёж 55000 в проект A (через postgres, минуя RLS insert) =="
PAYID=$(docker exec -i supabase-db psql -U postgres -d postgres -At -c \
  "INSERT INTO public.project_payments(project_id, amount, paid_on) VALUES ('$PID', 55000, '2026-07-01') RETURNING id;" \
  | grep -Eom1 '[0-9a-f-]{36}')
echo "payment id=$PAYID"; [ -n "$PAYID" ] || { echo "INSERT PAYMENT FAILED"; exit 1; }

echo "== A (заказчик своего проекта) вызывает get_my_project_payments (ожидаем 1 строку, amount=55000) =="
MA=$(curl -s -X POST "$REST/rpc/get_my_project_payments" -H "apikey: $ANON" -H "Authorization: Bearer $JA" \
  -H "Content-Type: application/json" -d '{}')
echo "get_my_project_payments(A): $MA"
CNTA=$(echo "$MA" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d) if isinstance(d,list) else 'ERR')")
AMTA=$(echo "$MA" | python3 -c "import sys,json;d=json.load(sys.stdin);print(int(round(float(d[0]['amount']))) if isinstance(d,list) and d else '')")
echo "A платежей: $CNTA (ожидаем 1), amount=$AMTA (ожидаем 55000)"

echo "== B (посторонний) вызывает get_my_project_payments (ожидаем 0 строк) =="
MB=$(curl -s -X POST "$REST/rpc/get_my_project_payments" -H "apikey: $ANON" -H "Authorization: Bearer $JB" \
  -H "Content-Type: application/json" -d '{}')
echo "get_my_project_payments(B): $MB"
CNTB=$(echo "$MB" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d) if isinstance(d,list) else 'ERR')")
echo "B платежей: $CNTB (ожидаем 0)"

echo "== cleanup =="
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "DELETE FROM public.project_payments WHERE id='$PAYID';" >/dev/null
curl -s -X DELETE "$REST/projects?id=eq.$PID" -H "apikey: $ANON" -H "Authorization: Bearer $JA" \
  -o /dev/null -w "delete project: %{http_code}\n"
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "DELETE FROM public.clients WHERE id='$CID';" >/dev/null

[ "$CNTA" = "1" ] && [ "$AMTA" = "55000" ] && [ "$CNTB" = "0" ] \
  && echo "CLIENT_PAYMENTS_RLS_OK" || { echo "CLIENT_PAYMENTS_RLS_FAIL CNTA=$CNTA AMTA=$AMTA CNTB=$CNTB"; exit 1; }
