#!/usr/bin/env bash
# RLS-проверка task_photos на живой БД (на деплое). Паттерн verify-rls.sh: JWT+REST.
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
[ -n "$A" ] && [ -n "$B" ] || { echo "NEED_TWO_APPROVED_USERS"; exit 1; }
JA="$(sign "$A")"; JB="$(sign "$B")"

echo "== A создаёт ЛИЧНУЮ задачу =="
TID=$(curl -s -X POST "$REST/project_tasks" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JA" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"author_id\":\"$A\",\"title\":\"photo-rls selftest\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if isinstance(d,list) and d else "")')
[ -n "$TID" ] || { echo "TASK INSERT FAILED"; exit 1; }

echo "== A вставляет метаданные фото (ожидаем 201) =="
PID=$(curl -s -X POST "$REST/task_photos" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JA" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"task_id\":\"$TID\",\"file_path\":\"tasks/$TID/t.png\",\"file_name\":\"t.png\",\"file_size\":100,\"uploaded_by\":\"$A\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if isinstance(d,list) and d else "")')
[ -n "$PID" ] || { echo "FAIL: photo insert by author"; exit 1; }

echo "== A видит (1), B не видит (0) =="
CA=$(curl -s "$REST/task_photos?task_id=eq.$TID&select=id" -H "apikey: $ANON" -H "Authorization: Bearer $JA" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
CB=$(curl -s "$REST/task_photos?task_id=eq.$TID&select=id" -H "apikey: $ANON" -H "Authorization: Bearer $JB" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
echo "A=$CA B=$CB"
[ "$CA" = "1" ] && [ "$CB" = "0" ] || { echo "FAIL: visibility"; exit 1; }

echo "== B не может вставить фото в задачу A (ожидаем 4xx) =="
BC=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$REST/task_photos" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JB" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TID\",\"file_path\":\"tasks/$TID/h.png\",\"file_name\":\"h.png\",\"file_size\":1,\"uploaded_by\":\"$B\"}")
echo "B insert: HTTP $BC"
case "$BC" in 4*) ;; *) echo "FAIL: stranger inserted"; exit 1;; esac

echo "== B не может удалить фото A (0 строк) =="
BD=$(curl -s -X DELETE "$REST/task_photos?id=eq.$PID" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JB" -H "Prefer: return=representation" \
  | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
[ "$BD" = "0" ] || { echo "FAIL: stranger deleted"; exit 1; }

echo "== каскад: удаляем задачу A -> метаданные фото исчезают =="
curl -s -X DELETE "$REST/project_tasks?id=eq.$TID" -H "apikey: $ANON" -H "Authorization: Bearer $JA" -o /dev/null
ORPH=$(docker exec -i supabase-db psql -U postgres -d postgres -At -c \
  "SELECT count(*) FROM public.task_photos WHERE task_id='$TID';")
[ "$ORPH" = "0" ] || { echo "FAIL: cascade left $ORPH"; exit 1; }

echo "TASK_PHOTOS_RLS_OK"
