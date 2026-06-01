#!/usr/bin/env bash
# Проверка RLS project_tasks под двумя реальными пользователями.
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

echo "== A создаёт ЛИЧНУЮ задачу =="
RID=$(curl -s -X POST "$REST/project_tasks" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JA" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"author_id\":\"$A\",\"title\":\"RLS selftest личная\"}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if isinstance(d,list) and d else "")')
echo "task id=$RID"; [ -n "$RID" ] || { echo "INSERT A FAILED"; exit 1; }

echo "== B читает личную задачу A через get_tasks (ожидаем 0) =="
SEEN=$(curl -s -X POST "$REST/rpc/get_tasks" -H "apikey: $ANON" -H "Authorization: Bearer $JB" \
  -H "Content-Type: application/json" -d '{}' | python3 -c "import sys,json;print(sum(1 for r in json.load(sys.stdin) if r['id']=='$RID'))")
echo "B видит личную задачу A: $SEEN (ожидаем 0)"

echo "== A видит свою задачу (ожидаем 1) =="
SEENA=$(curl -s -X POST "$REST/rpc/get_tasks" -H "apikey: $ANON" -H "Authorization: Bearer $JA" \
  -H "Content-Type: application/json" -d '{}' | python3 -c "import sys,json;print(sum(1 for r in json.load(sys.stdin) if r['id']=='$RID'))")
echo "A видит свою задачу: $SEENA (ожидаем 1)"

echo "== cleanup =="
curl -s -X DELETE "$REST/project_tasks?id=eq.$RID" -H "apikey: $ANON" -H "Authorization: Bearer $JA" -o /dev/null -w "delete: %{http_code}\n"
[ "$SEEN" = "0" ] && [ "$SEENA" = "1" ] && echo "RLS_OK" || { echo "RLS_FAIL"; exit 1; }
