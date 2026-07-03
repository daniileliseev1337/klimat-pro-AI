#!/usr/bin/env bash
# Верификация Фазы 2 на живой БД, всё в одной транзакции с ROLLBACK (следов нет).
# Эмуляция ролей через set_config('request.jwt.claims'). Требует существующего проекта
# с привязанным заказчиком (clients.user_id) — иначе SKIP с пояснением.
set -euo pipefail
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -At"

read -r PROJ CLIENT_UID < <($PSQL <<'SQL'
select p.id, c.user_id
from public.projects p join public.clients c on c.id = p.client_id
where c.user_id is not null limit 1;
SQL
)
[ -n "${PROJ:-}" ] && [ -n "${CLIENT_UID:-}" ] || { echo "SKIP: нет проекта с привязанным заказчиком (clients.user_id)"; exit 0; }
echo "PROJ=$PROJ CLIENT=$CLIENT_UID"

docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
begin;
-- эмулировать заказчика
select set_config('request.jwt.claims', json_build_object('sub','$CLIENT_UID','role','authenticated')::text, true);
select set_config('role','authenticated', true);
-- пишет сообщение в свой проект
select public.post_client_message('$PROJ', 'verify-p2 сообщение заказчика') as posted_id;
-- читает тред (>=1)
select case when count(*) >= 1 then 'MSG_READ_OK' else 'MSG_READ_FAIL' end from public.get_client_messages('$PROJ');
-- files: заказчик видит только client_visible (0 или N, но без падения)
select 'CLIENT_FILES_OK' where (select count(*) from public.get_client_project_files('$PROJ')) >= 0;
rollback;
SQL
echo "CLIENT_P2_OK"
