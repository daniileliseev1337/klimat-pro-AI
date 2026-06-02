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

echo "== 6.4b: пересоздать задачу A с исполнителем B (для двустороннего апрува) =="
curl -s -X DELETE "$REST/project_tasks?id=eq.$RID" -H "apikey: $ANON" -H "Authorization: Bearer $JA" -o /dev/null
RID=$(curl -s -X POST "$REST/project_tasks" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JA" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"author_id\":\"$A\",\"assigned_to\":\"$B\",\"title\":\"6.4b selftest\",\"description\":\"строка1\nстрока2\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if isinstance(d,list) and d else "")')
echo "task id=$RID"; [ -n "$RID" ] || { echo "INSERT 6.4b FAILED"; exit 1; }

rpc() { # rpc <jwt> <fn> <json-body>
  curl -s -X POST "$REST/rpc/$2" -H "apikey: $ANON" -H "Authorization: Bearer $1" \
    -H "Content-Type: application/json" -d "$3"
}

echo "== A предлагает изменение ТЗ -> ожидаем pending (есть исполнитель, A=сторона) =="
ST=$(rpc "$JA" propose_tz_version "{\"p_task_id\":\"$RID\",\"p_content\":\"строка1\nСТРОКА2-изменена\nстрока3\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("status","ERR") if isinstance(d,dict) else "ERR")')
echo "статус версии: $ST (ожидаем pending)"

echo "== description НЕ изменился до апрува =="
DESC=$(rpc "$JA" get_tasks "{}" | python3 -c "import sys,json;print(next((r['description'] for r in json.load(sys.stdin) if r['id']=='$RID'),''))")
echo "description сейчас: [$DESC] (ожидаем 'строка1\\nстрока2')"

echo "== вторая правка при наличии pending -> tz_pending_exists =="
ERR=$(rpc "$JA" propose_tz_version "{\"p_task_id\":\"$RID\",\"p_content\":\"ещё\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("message",d.get("code","")) if isinstance(d,dict) else "")')
echo "ошибка второй pending: $ERR (ожидаем содержит tz_pending_exists)"

echo "== предложивший (A) НЕ может апрувить свою версию =="
VID=$(rpc "$JA" get_task_versions "{\"p_task_id\":\"$RID\"}" \
  | python3 -c "import sys,json;print(next((v['id'] for v in json.load(sys.stdin) if v['status']=='pending'),''))")
SELF=$(rpc "$JA" approve_tz_version "{\"p_version_id\":\"$VID\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("message",d.get("code","")) if isinstance(d,dict) else "")')
echo "A апрувит свою: $SELF (ожидаем proposer_cannot_approve)"

echo "== противоположная сторона (B) апрувит -> approved + description обновлён =="
APP=$(rpc "$JB" approve_tz_version "{\"p_version_id\":\"$VID\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("status","ERR") if isinstance(d,dict) else "ERR")')
echo "статус после апрува B: $APP (ожидаем approved)"
DESC2=$(rpc "$JA" get_tasks "{}" | python3 -c "import sys,json;print(next((r['description'] for r in json.load(sys.stdin) if r['id']=='$RID'),''))")
echo "description после апрува: [$DESC2] (ожидаем содержит 'СТРОКА2-изменена')"

echo "== reject: A предлагает снова, B отклоняет -> rejected, description НЕ меняется =="
rpc "$JA" propose_tz_version "{\"p_task_id\":\"$RID\",\"p_content\":\"отклоняемая\"}" >/dev/null
VID2=$(rpc "$JA" get_task_versions "{\"p_task_id\":\"$RID\"}" \
  | python3 -c "import sys,json;print(next((v['id'] for v in json.load(sys.stdin) if v['status']=='pending'),''))")
REJ=$(rpc "$JB" reject_tz_version "{\"p_version_id\":\"$VID2\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("status","ERR") if isinstance(d,dict) else "ERR")')
echo "статус reject: $REJ (ожидаем rejected)"
DESC3=$(rpc "$JA" get_tasks "{}" | python3 -c "import sys,json;print(next((r['description'] for r in json.load(sys.stdin) if r['id']=='$RID'),''))")
echo "description после reject: [$DESC3] (ожидаем как после апрува, 'СТРОКА2-изменена')"

echo "== прямой INSERT в task_tz_versions под JWT запрещён (только через RPC) =="
DIRECT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$REST/task_tz_versions" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JA" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$RID\",\"version_no\":99,\"content\":\"hack\",\"status\":\"approved\",\"proposed_by\":\"$A\"}")
echo "прямой POST в task_tz_versions: HTTP $DIRECT (ожидаем 401/403/4xx, НЕ 201)"

echo "== видимость под посторонним C недоступна; берём третьего approved или anon =="
# посторонний: используем anon-токен (нет auth.uid()) — get_task_versions должна вернуть access_denied
OUT=$(rpc "$ANON" get_task_versions "{\"p_task_id\":\"$RID\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("message",d.get("code","")) if isinstance(d,dict) else "LIST")')
echo "anon видит версии: $OUT (ожидаем access_denied, НЕ список)"

echo "== обсуждение: B добавляет вопрос, A резолвит =="
CID=$(curl -s -X POST "$REST/task_comments" -H "apikey: $ANON" -H "Authorization: Bearer $JB" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"task_id\":\"$RID\",\"author_id\":\"$B\",\"body\":\"есть вопрос?\",\"is_question\":true}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if isinstance(d,list) and d else "")')
echo "comment id=$CID"
RES=$(rpc "$JA" resolve_question "{\"p_comment_id\":\"$CID\",\"p_resolved\":true}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("resolved","ERR") if isinstance(d,dict) else "ERR")')
echo "вопрос резолвнут A: $RES (ожидаем True/t)"

echo "== set_task_status 'Готово': исполнитель B запрещён, автор A разрешён =="
BST=$(rpc "$JB" set_task_status "{\"p_task_id\":\"$RID\",\"p_status\":\"Готово\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("message",d.get("code","")) if isinstance(d,dict) else d.get("status",""))')
echo "B -> Готово: $BST (ожидаем only_author_can_complete)"
AST=$(rpc "$JA" set_task_status "{\"p_task_id\":\"$RID\",\"p_status\":\"Готово\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("status","ERR") if isinstance(d,dict) else "ERR")')
echo "A -> Готово: $AST (ожидаем Готово)"

echo "== cleanup =="
curl -s -X DELETE "$REST/project_tasks?id=eq.$RID" -H "apikey: $ANON" -H "Authorization: Bearer $JA" -o /dev/null -w "delete: %{http_code}\n"
[ "$SEEN" = "0" ] && [ "$SEENA" = "1" ] && echo "RLS_OK" || { echo "RLS_FAIL"; exit 1; }
