#!/usr/bin/env bash
# E2E проверка файлового хранилища 6.3: upload -> download -> delete через
# Edge Function `nextcloud` с настоящим JWT существующего пользователя (HS256,
# подпись секретом локального Supabase). Проверяет всю цепочку: RLS + WebDAV.
# Только чтение конфигов + временный тестовый файл, который сам же удаляет.
set -euo pipefail
SUPA=/srv/supabase-src/docker
FN=http://localhost:8000/functions/v1/nextcloud

JWT_SECRET="$(grep '^JWT_SECRET=' "$SUPA/.env" | cut -d= -f2-)"
[ -n "$JWT_SECRET" ] || { echo "NO JWT_SECRET"; exit 1; }

# взять approved-владельца проекта (гарантирован доступ + is_approved)
read -r UID_ PID_ <<EOF
$(docker exec -i supabase-db psql -U postgres -d postgres -At -F' ' -c \
"SELECT p.owner_id, p.id FROM projects p JOIN profiles pr ON pr.id=p.owner_id WHERE pr.approved=true LIMIT 1;")
EOF
echo "user=$UID_ project=$PID_"
[ -n "$UID_" ] && [ -n "$PID_" ] || { echo "NO TEST USER/PROJECT"; exit 1; }

# подписать JWT (python3)
JWT="$(python3 - "$JWT_SECRET" "$UID_" <<'PY'
import hmac,hashlib,base64,json,sys,time
secret,uid=sys.argv[1],sys.argv[2]
b=lambda x: base64.urlsafe_b64encode(x).rstrip(b'=')
h=b(json.dumps({"alg":"HS256","typ":"JWT"}).encode())
n=int(time.time())
p=b(json.dumps({"sub":uid,"role":"authenticated","aud":"authenticated","iat":n,"exp":n+3600}).encode())
s=b(hmac.new(secret.encode(),h+b'.'+p,hashlib.sha256).digest())
print((h+b'.'+p+b'.'+s).decode())
PY
)"

AUTH="Authorization: Bearer $JWT"
CT="Content-Type: application/json"
B64="$(printf 'nextcloud e2e %s' "$(date -u +%FT%TZ)" | base64 -w0)"

echo "===== UPLOAD ====="
printf '{"action":"upload","projectId":"%s","filename":"e2e_test.txt","mimeType":"text/plain","fileBase64":"%s"}' "$PID_" "$B64" > /tmp/up.json
UP="$(curl -s -m 30 -X POST "$FN" -H "$AUTH" -H "$CT" --data @/tmp/up.json)"
echo "$UP"
FID="$(echo "$UP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("file",{}).get("id",""))' 2>/dev/null || true)"
echo "file_id=$FID"
[ -n "$FID" ] || { echo "UPLOAD FAILED"; exit 1; }

echo "===== DOWNLOAD ====="
printf '{"action":"download","id":"%s"}' "$FID" > /tmp/dl2.json
curl -s -m 30 -X POST "$FN" -H "$AUTH" -H "$CT" --data @/tmp/dl2.json -w '\n[download HTTP %{http_code}]\n'

echo "===== DELETE ====="
printf '{"action":"delete","id":"%s"}' "$FID" > /tmp/del.json
curl -s -m 30 -X POST "$FN" -H "$AUTH" -H "$CT" --data @/tmp/del.json -w '\n[delete HTTP %{http_code}]\n'

echo "===== VERIFY GONE (expect 403/not found) ====="
curl -s -m 30 -X POST "$FN" -H "$AUTH" -H "$CT" --data @/tmp/dl2.json -w '\n[download-after-delete HTTP %{http_code}]\n'

rm -f /tmp/up.json /tmp/dl2.json /tmp/del.json
echo "E2E_DONE"
