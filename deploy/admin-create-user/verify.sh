#!/usr/bin/env bash
# E2E: админ создаёт пользователя через функцию → проверка approved/роль/логин/аудит → cleanup.
set -euo pipefail
SUPA=/srv/supabase-src/docker
BASE=http://localhost:8000
JWT_SECRET="$(grep '^JWT_SECRET=' "$SUPA/.env" | cut -d= -f2-)"
ANON="$(grep '^ANON_KEY=' "$SUPA/.env" | cut -d= -f2-)"
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -At"

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

ADMIN=$($PSQL -c "SELECT id FROM public.profiles WHERE role='admin' AND approved=true ORDER BY created_at LIMIT 1;" | grep -Eom1 '[0-9a-f-]{36}')
[ -n "$ADMIN" ] || { echo "NO_ADMIN"; exit 1; }
JA="$(sign "$ADMIN")"
EMAIL="e2e-admincreate-$(date +%s)@example.local"
PASS="verifypass123"

echo "== создать через функцию =="
RES=$(curl -s -X POST "$BASE/functions/v1/admin-create-user" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JA" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"E2E User\",\"role\":\"client\"}")
echo "resp: $RES"
NUID=$(echo "$RES" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("user_id","") if d.get("ok") else "")')
[ -n "$NUID" ] || { echo "CREATE_FAIL"; exit 1; }

echo "== approved/роль =="
APPROVED=$($PSQL -c "SELECT approved FROM public.profiles WHERE id='$NUID';")
ROLES=$($PSQL -c "SELECT string_agg(role,',' ORDER BY role) FROM public.user_roles WHERE user_id='$NUID';")
AUDIT=$($PSQL -c "SELECT count(*) FROM public.activity_log WHERE action='user_created_by_admin' AND target_id='$NUID';")
echo "approved=$APPROVED roles=$ROLES audit=$AUDIT"

echo "== логин работает? =="
LOGIN=$(curl -s -X POST "$BASE/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
HAS_TOKEN=$(echo "$LOGIN" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("yes" if d.get("access_token") else "no")')
echo "login token: $HAS_TOKEN"

echo "== cleanup =="
$PSQL -c "DELETE FROM auth.users WHERE id='$NUID';" >/dev/null

[ "$APPROVED" = "t" ] && [ "$ROLES" = "client" ] && [ "$AUDIT" = "1" ] && [ "$HAS_TOKEN" = "yes" ] \
  && echo "ADMIN_CREATE_USER_OK" || { echo "ADMIN_CREATE_USER_FAIL approved=$APPROVED roles=$ROLES audit=$AUDIT login=$HAS_TOKEN"; exit 1; }
