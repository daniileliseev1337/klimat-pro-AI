#!/usr/bin/env bash
# Функц. проверка Центра уведомлений: edge пишет inbox-строку КАЖДОМУ базовому
# получателю даже при выключенном push-флаге (inbox ловит всё, флаги — только push).
# Самодостаточен: только docker exec psql + host curl, путей репозитория не требует.
set -euo pipefail
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -At"

TASK=$($PSQL -c "select id from public.project_tasks where assigned_to is not null and author_id is not null and assigned_to <> author_id limit 1;")
[ -n "$TASK" ] || { echo "NO_SUITABLE_TASK (нужна задача с разными author/assignee)"; exit 1; }
ASG=$($PSQL -c "select assigned_to from public.project_tasks where id='$TASK';")
ORIG=$($PSQL -c "select notif_task from public.profiles where id='$ASG';")
echo "TASK=$TASK ASG=$ASG notif_task_orig=$ORIG"

BEFORE=$($PSQL -c "select count(*) from public.notifications where user_id='$ASG' and type='task_assigned';")

# выключаем push-флаг назначенному — inbox-строка всё равно должна записаться
$PSQL -c "update public.profiles set notif_task=false where id='$ASG';" >/dev/null

# вызвать edge: task_assigned, без инициатора
curl -s -X POST http://localhost:8000/functions/v1/web-push-notify \
  -H "Content-Type: application/json" -d "{\"type\":\"task_assigned\",\"taskId\":\"$TASK\"}"; echo

AFTER=$($PSQL -c "select count(*) from public.notifications where user_id='$ASG' and type='task_assigned';")
echo "inbox: before=$BEFORE after=$AFTER (ожидаем +1 несмотря на notif_task=false)"

# вернуть исходный флаг и удалить тестовую строку
$PSQL -c "update public.profiles set notif_task='$ORIG' where id='$ASG';" >/dev/null
$PSQL -c "delete from public.notifications where user_id='$ASG' and type='task_assigned' and created_at > now() - interval '2 minutes';" >/dev/null

[ "$AFTER" -gt "$BEFORE" ] && echo "INBOX_INSERT_OK" || { echo "INBOX_INSERT_FAIL"; exit 1; }
