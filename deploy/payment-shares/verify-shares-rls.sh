#!/usr/bin/env bash
# Проверка RLS project_shares + get_my_shares под двумя реальными пользователями.
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
$(docker exec -i supabase-db psql -U postgres -d postgres -At -F' ' -c \
"SELECT id FROM public.profiles WHERE approved=true ORDER BY created_at LIMIT 2;" | tr '\n' ' ')
EOF
echo "A=$A B=$B"
[ -n "$A" ] && [ -n "$B" ] || { echo "NEED_TWO_APPROVED_USERS"; exit 1; }
JA="$(sign "$A")"; JB="$(sign "$B")"

echo "== A создаёт проект =="
PID=$(curl -s -X POST "$REST/projects" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JA" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"owner_id\":\"$A\",\"name\":\"RLS shares selftest\",\"contract_sum\":100000,\"paid_amount\":40000}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if isinstance(d,list) and d else "")')
echo "project id=$PID"; [ -n "$PID" ] || { echo "INSERT PROJECT FAILED"; exit 1; }

echo "== A добавляет долю участнику B (30%) =="
SID=$(curl -s -X POST "$REST/project_shares" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JA" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"project_id\":\"$PID\",\"participant_user_id\":\"$B\",\"share_kind\":\"percent\",\"share_value\":30}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if isinstance(d,list) and d else "")')
echo "share id=$SID"; [ -n "$SID" ] || { echo "INSERT SHARE FAILED"; exit 1; }

echo "== B видит свою долю через get_my_shares (ожидаем 1 строку, my_amount=30000, my_received=12000) =="
MS=$(curl -s -X POST "$REST/rpc/get_my_shares" -H "apikey: $ANON" -H "Authorization: Bearer $JB" \
  -H "Content-Type: application/json" -d '{}')
echo "get_my_shares(B): $MS"
CNT=$(echo "$MS" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
AMT=$(echo "$MS" | python3 -c "import sys,json;d=json.load(sys.stdin);print(int(round(float(d[0]['my_amount']))) if d else '')")
RCV=$(echo "$MS" | python3 -c "import sys,json;d=json.load(sys.stdin);print(int(round(float(d[0]['my_received']))) if d else '')")
echo "B долей: $CNT (ожидаем 1), my_amount=$AMT (ожидаем 30000), my_received=$RCV (ожидаем 12000)"

echo "== B НЕ может писать в project_shares (ожидаем 4xx, НЕ 201) =="
WCODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$REST/project_shares" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JB" -H "Content-Type: application/json" \
  -d "{\"project_id\":\"$PID\",\"participant_name\":\"hack\",\"share_kind\":\"percent\",\"share_value\":10}")
echo "B пишет долю: HTTP $WCODE (ожидаем 401/403/4xx)"

echo "== B видит только свою строку доли (RLS) =="
ROWS=$(curl -s "$REST/project_shares?select=id" -H "apikey: $ANON" -H "Authorization: Bearer $JB" \
  | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
echo "B видит строк project_shares: $ROWS (ожидаем 1 — только свою)"

echo "== anon НЕ видит долей =="
AOUT=$(curl -s "$REST/project_shares?select=id" -H "apikey: $ANON" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d) if isinstance(d,list) else 'ERR')")
echo "anon видит долей: $AOUT (ожидаем 0)"

echo "== cleanup =="
curl -s -X DELETE "$REST/projects?id=eq.$PID" -H "apikey: $ANON" -H "Authorization: Bearer $JA" -o /dev/null -w "delete project: %{http_code}\n"

[ "$CNT" = "1" ] && [ "$AMT" = "30000" ] && [ "$RCV" = "12000" ] && [ "$ROWS" = "1" ] && [ "$AOUT" = "0" ] \
  && echo "SHARES_RLS_OK" || { echo "SHARES_RLS_FAIL"; exit 1; }
