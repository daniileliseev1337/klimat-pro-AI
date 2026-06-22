# №10 «История действий» (audit-лента) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Расширить существующий `activity_log` на бизнес-события (проекты/задачи/деньги) через БД-триггеры
и diff-логирование в денежных RPC; показать историю по проекту (5-я вкладка) с приватностью денег и
расширить админ-журнал.

**Architecture:** Вся запись событий — в БД (триггеры на `projects`/`project_members`/`project_tasks`
+ diff внутри `set_project_payments`/`set_project_shares`), фронт по записи не трогаем. Единый
SECURITY DEFINER хелпер `log_activity_ext` пишет в `activity_log` (обходит RLS). Чтение истории проекта —
SECURITY DEFINER RPC `get_project_activity` с гейтом доступа и скрытием финанс-событий от не-владельца.
Заодно `activity_log`/`log_activity` фиксируются в репо-миграции (техдолг).

**Tech Stack:** PostgreSQL (plpgsql, триггеры, RLS), Supabase self-hosted, React (src/App.jsx монолит), Vite.

**Спек:** `docs/superpowers/specs/2026-06-22-activity-log-history-design.md`.

## Global Constraints

- Все SECURITY DEFINER функции: `set search_path = public, pg_temp` (verbatim).
- Существующую `log_activity(p_action, p_target_id, p_target_email, p_details)` (4 арг.) **НЕ менять**
  (обратная совместимость admin-функций; новые параметры с DEFAULT создали бы overload-конфликт).
- В триггере `projects` **НЕ логировать** производные поля `paid_amount` и `executor` (text).
- Приватность: `is_financial=true` события (`project_contract_changed`, `payment_*`, `share_*`) видны в
  ленте проекта только владельцу и админу.
- Финальный список `action`-кодов (фиксирован):
  projects → `project_created` / `project_renamed` / `project_stage_changed` / `project_client_changed` /
  `project_deadline_changed` / `project_visibility_changed` / `project_executors_changed` /
  `project_contract_changed`(fin) / `project_deleted`;
  payments → `payment_added`(fin) / `payment_removed`(fin);
  shares → `share_added`(fin) / `share_changed`(fin) / `share_removed`(fin);
  members → `member_added` / `member_removed` / `member_role_changed`;
  tasks → `task_created` / `task_status_changed` / `task_assigned` / `task_deleted`.
- **Среда (грабли):** БД-деплой — файл миграции F:→`C:\temp` (кириллица «Сайт» в bash-аргументе бьётся),
  применять `wsl -d Ubuntu -u root -- docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /mnt/c/temp/файл.sql`.
  git только с Windows-стороны (`-c safe.directory=* -c core.fsyncMethod=writeout-only`, ретраи).
  **Применение миграций к живой БД и web-деплой — ТОЛЬКО по явному слову владельца «деплой».** До этого —
  тестируем транзакционно (BEGIN … ROLLBACK: transactional DDL, прод не меняется).
- **localhost dev = prod** (self-hosted на ПК владельца) — постоянное применение миграции есть изменение прода.

## File Structure

**Создаём (миграции):**
- `supabase/migrations/20260622_0001_activity_log_schema.sql` — таблица+log_activity в репо, +колонки, индекс, `log_activity_ext`.
- `supabase/migrations/20260622_0002_trg_projects_activity.sql` — триггер на `projects`.
- `supabase/migrations/20260622_0003_trg_members_activity.sql` — триггер на `project_members`.
- `supabase/migrations/20260622_0004_trg_tasks_activity.sql` — триггер на `project_tasks`.
- `supabase/migrations/20260622_0005_money_rpc_activity.sql` — diff-лог в `set_project_payments`/`set_project_shares`.
- `supabase/migrations/20260622_0006_get_project_activity.sql` — RPC чтения истории проекта.

**Создаём (деплой/верификация):**
- `deploy/activity-log/apply-migrations.sh` — постоянное применение (фаза деплоя).
- `deploy/activity-log/verify-activity.sql` — транзакционный E2E (BEGIN…ROLLBACK), запускается в процессе.
- `deploy/activity-log/verify-activity.sh` — обёртка-запуск verify-activity.sql.

**Модифицируем:**
- `src/App.jsx` — словарь лейблов админ-журнала (≈7333), обёртка `fetchProjectActivity` (рядом с
  `adminFetchActivityLog`, ≈651), компонент-лента `ActivityFeed`, 5-я вкладка «История» в `ProjectForm`.

---

## Task 1: Схема `activity_log` в репо + расширение + `log_activity_ext`

**Files:**
- Create: `supabase/migrations/20260622_0001_activity_log_schema.sql`

**Interfaces:**
- Produces: таблица `public.activity_log(id, actor_id, actor_email, action, target_id, target_email,
  details jsonb, created_at, project_id uuid, is_financial boolean)`; функция
  `public.log_activity_ext(p_action text, p_project_id uuid, p_is_financial boolean,
  p_target_id uuid default null, p_target_email text default null, p_details jsonb default null) returns uuid`
  (SECURITY DEFINER). Существующая `log_activity` (4 арг.) — фиксируется в репо без изменений.

- [ ] **Step 1: Написать миграцию**

```sql
-- 20260622_0001: фиксируем activity_log + log_activity в репо (были только в живой БД — техдолг),
-- расширяем колонками project_id/is_financial и добавляем хелпер log_activity_ext.

-- Таблица (как в живой БД; IF NOT EXISTS — не тронет существующую, но делает среду воспроизводимой).
create table if not exists public.activity_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references auth.users(id) on delete set null,
  actor_email  text,
  action       text not null,
  target_id    uuid,
  target_email text,
  details      jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists idx_activity_log_created_at on public.activity_log (created_at desc);

alter table public.activity_log enable row level security;
drop policy if exists activity_log_select on public.activity_log;
create policy activity_log_select on public.activity_log
  for select to authenticated using (public.is_admin());
-- INSERT-политики НЕТ: пишется только через SECURITY DEFINER (log_activity / log_activity_ext).

-- Существующая log_activity (4 арг.) — фиксируем в репо БЕЗ изменений сигнатуры.
create or replace function public.log_activity(
  p_action text, p_target_id uuid default null, p_target_email text default null, p_details jsonb default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor_id uuid; v_actor_email text; v_log_id uuid;
begin
  v_actor_id := auth.uid();
  select email into v_actor_email from public.profiles where id = v_actor_id;
  insert into public.activity_log (actor_id, actor_email, action, target_id, target_email, details)
  values (v_actor_id, v_actor_email, p_action, p_target_id, p_target_email, p_details)
  returning id into v_log_id;
  return v_log_id;
end; $$;

-- Новые колонки.
alter table public.activity_log
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists is_financial boolean not null default false;

create index if not exists idx_activity_log_project_created
  on public.activity_log (project_id, created_at desc) where project_id is not null;

-- Расширенный хелпер: пишет project_id/is_financial, единая actor-логика.
create or replace function public.log_activity_ext(
  p_action text, p_project_id uuid, p_is_financial boolean,
  p_target_id uuid default null, p_target_email text default null, p_details jsonb default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid; v_email text; v_id uuid;
begin
  v_actor := auth.uid();
  select email into v_email from public.profiles where id = v_actor;
  insert into public.activity_log
    (actor_id, actor_email, action, project_id, is_financial, target_id, target_email, details)
  values
    (v_actor, v_email, p_action, p_project_id, coalesce(p_is_financial,false), p_target_id, p_target_email, p_details)
  returning id into v_id;
  return v_id;
end; $$;
```

- [ ] **Step 2: Тест (транзакционный, без изменения прода)**

Скопировать миграцию F:→C: и прогнать в транзакции с откатом; проверить, что колонки и хелпер появились:

```bash
# копия (кириллица в пути не пройдёт в bash-аргумент → через C:\temp в PowerShell заранее)
# затем:
wsl -d Ubuntu -u root -- docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
begin;
\i /mnt/c/temp/20260622_0001_activity_log_schema.sql
-- хелпер существует и пишет строку
select public.log_activity_ext('selftest', null, true, null, null, '{"k":1}'::jsonb) is not null as helper_ok;
-- колонки на месте
select count(*) filter (where column_name in ('project_id','is_financial')) as new_cols
  from information_schema.columns where table_schema='public' and table_name='activity_log';
rollback;
SQL
```

- [ ] **Step 3: Запустить тест — до написания файла FAIL (`\i` не найдёт файл / objects missing), после — PASS**

Expected после Step 1: `helper_ok = t`, `new_cols = 2`, транзакция откатилась (прод не изменён).

- [ ] **Step 4: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only add supabase/migrations/20260622_0001_activity_log_schema.sql
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only commit -m "feat(activity): схема activity_log в репо + project_id/is_financial + log_activity_ext"
```

---

## Task 2: Триггер на `projects` (создание/правка/удаление с пофайловым diff)

**Files:**
- Create: `supabase/migrations/20260622_0002_trg_projects_activity.sql`

**Interfaces:**
- Consumes: `log_activity_ext` (Task 1).
- Produces: триггер `trg_projects_activity` + функция `trg_log_project_activity()`. Ловит и форму
  (`updateProject`), и quick-edit карточки (прямой `update`), и `take_project`.

- [ ] **Step 1: Написать миграцию**

```sql
-- 20260622_0002: аудит изменений проекта. paid_amount и executor (производные) НЕ логируем.
create or replace function public.trg_log_project_activity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity_ext('project_created', new.id, false, new.id, null,
      jsonb_build_object('name', new.name));
    return new;
  elsif tg_op = 'DELETE' then
    -- проект уже удалён → project_id=null (FK), имя в details, target_id=old.id (target_id без FK)
    perform public.log_activity_ext('project_deleted', null, false, old.id, null,
      jsonb_build_object('name', old.name));
    return old;
  else
    if new.name is distinct from old.name then
      perform public.log_activity_ext('project_renamed', new.id, false, new.id, null,
        jsonb_build_object('from', old.name, 'to', new.name)); end if;
    if new.stage is distinct from old.stage then
      perform public.log_activity_ext('project_stage_changed', new.id, false, new.id, null,
        jsonb_build_object('from', old.stage, 'to', new.stage)); end if;
    if new.client is distinct from old.client then
      perform public.log_activity_ext('project_client_changed', new.id, false, new.id, null,
        jsonb_build_object('from', old.client, 'to', new.client)); end if;
    if new.deadline is distinct from old.deadline then
      perform public.log_activity_ext('project_deadline_changed', new.id, false, new.id, null,
        jsonb_build_object('from', old.deadline::text, 'to', new.deadline::text)); end if;
    if new.visibility is distinct from old.visibility then
      perform public.log_activity_ext('project_visibility_changed', new.id, false, new.id, null,
        jsonb_build_object('from', old.visibility, 'to', new.visibility)); end if;
    if new.executors is distinct from old.executors then
      perform public.log_activity_ext('project_executors_changed', new.id, false, new.id, null,
        jsonb_build_object('from', old.executors, 'to', new.executors)); end if;
    if new.contract_sum is distinct from old.contract_sum then
      perform public.log_activity_ext('project_contract_changed', new.id, true, new.id, null,
        jsonb_build_object('from', old.contract_sum, 'to', new.contract_sum)); end if;  -- ФИНАНС
    return new;
  end if;
end; $$;

drop trigger if exists trg_projects_activity on public.projects;
create trigger trg_projects_activity
  after insert or update or delete on public.projects
  for each row execute function public.trg_log_project_activity();
```

- [ ] **Step 2: Тест (транзакционный)**

```sql
begin;
\i /mnt/c/temp/20260622_0001_activity_log_schema.sql
\i /mnt/c/temp/20260622_0002_trg_projects_activity.sql
-- эмулируем владельца
select set_config('request.jwt.claims',
  json_build_object('sub',(select id::text from public.profiles where approved order by created_at limit 1),
                    'role','authenticated')::text, true);
-- INSERT → project_created
insert into public.projects(owner_id,name,visibility,stage,contract_sum)
  values ((select id from public.profiles where approved order by created_at limit 1),'AUDIT TEST','private','В работе',100000)
  returning id \gset
update public.projects set stage='Оплачен' where id=:'id';        -- стадия (нефинанс)
update public.projects set contract_sum=150000 where id=:'id';    -- сумма (финанс)
update public.projects set paid_amount=50000 where id=:'id';      -- производное — НЕ логируем
select action, is_financial from public.activity_log where target_id=:'id' order by created_at;
-- ожидаем: project_created(f=false), project_stage_changed(false), project_contract_changed(true)
-- НЕТ записи про paid_amount
rollback;
```

- [ ] **Step 3: Запустить — PASS:** ровно 3 записи (created/stage/contract), `contract` с `is_financial=t`,
  про `paid_amount` записи нет.

- [ ] **Step 4: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only add supabase/migrations/20260622_0002_trg_projects_activity.sql
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only commit -m "feat(activity): триггер аудита projects (diff полей, deal=fin)"
```

---

## Task 3: Триггер на `project_members`

**Files:**
- Create: `supabase/migrations/20260622_0003_trg_members_activity.sql`

**Interfaces:**
- Consumes: `log_activity_ext` (Task 1).
- Produces: триггер `trg_members_activity` + `trg_log_member_activity()`.

- [ ] **Step 1: Написать миграцию**

```sql
-- 20260622_0003: аудит команды проекта.
create or replace function public.trg_log_member_activity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text;
begin
  if tg_op = 'INSERT' then
    select email into v_email from public.profiles where id = new.user_id;
    perform public.log_activity_ext('member_added', new.project_id, false, new.user_id, v_email,
      jsonb_build_object('role', new.role));
    return new;
  elsif tg_op = 'DELETE' then
    select email into v_email from public.profiles where id = old.user_id;
    perform public.log_activity_ext('member_removed', old.project_id, false, old.user_id, v_email,
      jsonb_build_object('role', old.role));
    return old;
  else
    if new.role is distinct from old.role then
      select email into v_email from public.profiles where id = new.user_id;
      perform public.log_activity_ext('member_role_changed', new.project_id, false, new.user_id, v_email,
        jsonb_build_object('from', old.role, 'to', new.role));
    end if;
    return new;
  end if;
end; $$;

drop trigger if exists trg_members_activity on public.project_members;
create trigger trg_members_activity
  after insert or update or delete on public.project_members
  for each row execute function public.trg_log_member_activity();
```

- [ ] **Step 2: Тест (транзакционный)** — после `\i` 0001+0003: создать проект, `insert project_members`
  (member_added), `update role` (member_role_changed), `delete` (member_removed); проверить 3 записи,
  все `is_financial=false`, `target_email` заполнен.

- [ ] **Step 3: Запустить — PASS** (3 записи member_added/role_changed/removed).

- [ ] **Step 4: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only add supabase/migrations/20260622_0003_trg_members_activity.sql
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only commit -m "feat(activity): триггер аудита project_members"
```

---

## Task 4: Триггер на `project_tasks`

**Files:**
- Create: `supabase/migrations/20260622_0004_trg_tasks_activity.sql`

**Interfaces:**
- Consumes: `log_activity_ext` (Task 1).
- Produces: триггер `trg_tasks_activity` + `trg_log_task_activity()`. Сосуществует с существующими
  `trg_project_tasks_touch` (BEFORE UPDATE) и `trg_tz_v1_on_task_insert` (AFTER INSERT) — независимы.
  ТЗ-версии/комментарии НЕ логируем (своя история).

- [ ] **Step 1: Написать миграцию**

```sql
-- 20260622_0004: аудит задач (создание/статус/назначение/удаление). project_id может быть null (личная задача).
create or replace function public.trg_log_task_activity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text;
begin
  if tg_op = 'INSERT' then
    perform public.log_activity_ext('task_created', new.project_id, false, new.id, null,
      jsonb_build_object('title', new.title));
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_activity_ext('task_deleted', old.project_id, false, old.id, null,
      jsonb_build_object('title', old.title));
    return old;
  else
    if new.status is distinct from old.status then
      perform public.log_activity_ext('task_status_changed', new.project_id, false, new.id, null,
        jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status));
    end if;
    if new.assigned_to is distinct from old.assigned_to then
      select email into v_email from public.profiles where id = new.assigned_to;
      perform public.log_activity_ext('task_assigned', new.project_id, false, new.id, v_email,
        jsonb_build_object('title', new.title));
    end if;
    return new;
  end if;
end; $$;

drop trigger if exists trg_tasks_activity on public.project_tasks;
create trigger trg_tasks_activity
  after insert or update or delete on public.project_tasks
  for each row execute function public.trg_log_task_activity();
```

- [ ] **Step 2: Тест (транзакционный)** — после `\i` 0001+0004 (+ нужен проект для project_id и author_id):
  insert task (task_created), update status (task_status_changed), update assigned_to (task_assigned),
  delete (task_deleted); проверить 4 записи, все `is_financial=false`.

- [ ] **Step 3: Запустить — PASS** (4 записи).

- [ ] **Step 4: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only add supabase/migrations/20260622_0004_trg_tasks_activity.sql
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only commit -m "feat(activity): триггер аудита project_tasks"
```

---

## Task 5: Diff-логирование в денежных RPC (защита от replace-all шума)

**Files:**
- Create: `supabase/migrations/20260622_0005_money_rpc_activity.sql`

**Interfaces:**
- Consumes: `log_activity_ext` (Task 1).
- Produces: `set_project_payments(uuid,jsonb)` и `set_project_shares(uuid,jsonb)` (CREATE OR REPLACE) —
  сохранён прежний контракт (гейт владельца, replace-all), добавлен diff-лог финанс-событий **только при
  реальной дельте**. `set_project_shares` остаётся SECURITY INVOKER; запись идёт через DEFINER-хелпер.

- [ ] **Step 1: Написать миграцию**

```sql
-- 20260622_0005: финанс-аудит payments/shares внутри RPC (replace-all → diff, без шума на пустом сохранении).

-- payments: SECURITY DEFINER (как было). diff набора по (amount, paid_on).
create or replace function public.set_project_payments(p_project_id uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old jsonb; v_new jsonb; r record;
begin
  if not exists (select 1 from public.projects where id = p_project_id and owner_id = auth.uid()) then
    raise exception 'not project owner';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('amount', amount::text, 'paid_on', paid_on::text)), '[]'::jsonb)
    into v_old from public.project_payments where project_id = p_project_id;
  delete from public.project_payments where project_id = p_project_id;
  insert into public.project_payments (project_id, amount, paid_on, note, created_by)
  select p_project_id, (je->>'amount')::numeric, (je->>'paid_on')::date, nullif(je->>'note',''), auth.uid()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) je
  where (je->>'amount') is not null and (je->>'amount')::numeric > 0 and (je->>'paid_on') is not null;
  select coalesce(jsonb_agg(jsonb_build_object('amount', amount::text, 'paid_on', paid_on::text)), '[]'::jsonb)
    into v_new from public.project_payments where project_id = p_project_id;
  -- added = new \ old
  for r in
    select e.value as v from jsonb_array_elements(v_new) e
    except all
    select e.value as v from jsonb_array_elements(v_old) e
  loop
    perform public.log_activity_ext('payment_added', p_project_id, true, null, null, r.v);
  end loop;
  -- removed = old \ new
  for r in
    select e.value as v from jsonb_array_elements(v_old) e
    except all
    select e.value as v from jsonb_array_elements(v_new) e
  loop
    perform public.log_activity_ext('payment_removed', p_project_id, true, null, null, r.v);
  end loop;
end; $$;
grant execute on function public.set_project_payments(uuid, jsonb) to authenticated;

-- shares: SECURITY INVOKER (как было) — запись лога через DEFINER-хелпер. diff по ключу участника.
create or replace function public.set_project_shares(p_project_id uuid, p_rows jsonb)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare r record;
begin
  if not exists (select 1 from public.projects where id = p_project_id and owner_id = auth.uid()) then
    raise exception 'not_project_owner';
  end if;
  drop table if exists _old_shares;
  create temp table _old_shares on commit drop as
    select participant_user_id, participant_client_id, participant_name, participant_label, share_kind, share_value
    from public.project_shares where project_id = p_project_id;

  delete from public.project_shares where project_id = p_project_id;
  insert into public.project_shares
    (project_id, participant_user_id, participant_client_id, participant_name, participant_label, share_kind, share_value)
  select p_project_id,
    nullif(je->>'participant_user_id','')::uuid, nullif(je->>'participant_client_id','')::uuid,
    nullif(je->>'participant_name',''), nullif(je->>'participant_label',''),
    je->>'share_kind', (je->>'share_value')::numeric
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as je;

  -- added: участник появился (ключ = coalesce user/client/name)
  for r in
    select n.participant_label as label, n.share_kind, n.share_value
    from public.project_shares n
    where n.project_id = p_project_id and not exists (
      select 1 from _old_shares o where
        coalesce(o.participant_user_id::text,o.participant_client_id::text,o.participant_name)
      = coalesce(n.participant_user_id::text,n.participant_client_id::text,n.participant_name))
  loop
    perform public.log_activity_ext('share_added', p_project_id, true, null, null,
      jsonb_build_object('label', r.label, 'kind', r.share_kind, 'value', r.share_value));
  end loop;
  -- removed: участник исчез
  for r in
    select o.participant_label as label, o.share_kind, o.share_value
    from _old_shares o where not exists (
      select 1 from public.project_shares n where n.project_id = p_project_id and
        coalesce(n.participant_user_id::text,n.participant_client_id::text,n.participant_name)
      = coalesce(o.participant_user_id::text,o.participant_client_id::text,o.participant_name))
  loop
    perform public.log_activity_ext('share_removed', p_project_id, true, null, null,
      jsonb_build_object('label', r.label, 'kind', r.share_kind, 'value', r.share_value));
  end loop;
  -- changed: тот же участник, но kind/value отличается
  for r in
    select n.participant_label as label, o.share_kind as okind, o.share_value as oval,
           n.share_kind as nkind, n.share_value as nval
    from public.project_shares n join _old_shares o on
        coalesce(n.participant_user_id::text,n.participant_client_id::text,n.participant_name)
      = coalesce(o.participant_user_id::text,o.participant_client_id::text,o.participant_name)
    where n.project_id = p_project_id
      and (n.share_kind is distinct from o.share_kind or n.share_value is distinct from o.share_value)
  loop
    perform public.log_activity_ext('share_changed', p_project_id, true, null, null,
      jsonb_build_object('label', r.label, 'from_kind', r.okind, 'from_value', r.oval,
                         'to_kind', r.nkind, 'to_value', r.nval));
  end loop;
end; $$;
grant execute on function public.set_project_shares(uuid, jsonb) to authenticated;
```

- [ ] **Step 2: Тест (транзакционный)** — после `\i` 0001+0005 (как владелец):
  1. создать проект, вызвать `set_project_payments(pid, '[{"amount":50000,"paid_on":"2026-06-22"}]')`
     → 1 запись `payment_added`;
  2. вызвать **тот же** массив повторно → **0 новых записей** (защита от шума — критерий §9.3 спека);
  3. вызвать с пустым `[]` → 1 запись `payment_removed`;
  4. `set_project_shares` с долей участнику → `share_added`; повтор того же → 0; смена value → `share_changed`.

```sql
-- фрагмент проверки шума:
select count(*) from public.activity_log where action like 'payment_%';  -- после повтора того же набора не растёт
```

- [ ] **Step 3: Запустить — PASS:** повтор идентичного набора НЕ создаёт payment/share-событий;
  реальные изменения создают; все с `is_financial=true`.

- [ ] **Step 4: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only add supabase/migrations/20260622_0005_money_rpc_activity.sql
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only commit -m "feat(activity): diff-лог платежей/долей в RPC (без replace-all шума)"
```

---

## Task 6: RPC `get_project_activity` (чтение истории проекта + приватность)

**Files:**
- Create: `supabase/migrations/20260622_0006_get_project_activity.sql`

**Interfaces:**
- Consumes: таблица `activity_log` (Task 1), `is_project_member`, `is_approved`, `is_admin` (существуют).
- Produces: `get_project_activity(p_project_id uuid, p_limit int default 100) returns setof activity_log`.
  Фронт зовёт через `rpc('get_project_activity', { p_project_id, p_limit })`.

ВАЖНО (выявлено при реализации): гейт = **точное зеркало `projects_select`** (20260611_0002), НЕ
`can_access_project_comments` — последнее для `team`-проекта пускает любого approved (шире, чем
видимость проекта) и дало бы утечку истории team-проекта посторонним.

- [ ] **Step 1: Написать миграцию**

```sql
-- 20260622_0006: лента истории проекта. Гейт = зеркало projects_select (owner/admin/team-член/marketplace-approved).
-- Финанс-события (is_financial) — только владельцу/админу.
create or replace function public.get_project_activity(p_project_id uuid, p_limit int default 100)
returns setof public.activity_log
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_is_owner boolean; v_can boolean;
begin
  select (owner_id = auth.uid()) into v_is_owner from public.projects where id = p_project_id;
  v_can := coalesce(v_is_owner, false)
    or public.is_admin()
    or exists (select 1 from public.projects p
               where p.id = p_project_id and p.visibility = 'team' and public.is_project_member(p_project_id))
    or exists (select 1 from public.projects p
               where p.id = p_project_id and p.visibility = 'marketplace' and public.is_approved());
  if not v_can then
    return;
  end if;
  return query
    select a.* from public.activity_log a
    where a.project_id = p_project_id
      and (a.is_financial = false or coalesce(v_is_owner, false) or public.is_admin())
    order by a.created_at desc
    limit p_limit;
end; $$;
grant execute on function public.get_project_activity(uuid, int) to authenticated;
```

- [ ] **Step 2: Тест (транзакционный, два пользователя через set_config jwt)** — после `\i` 0001+0002+0005+0006:
  владелец A создаёт проект, меняет стадию (нефинанс) и сумму договора (финанс), даёт долю участнику B;
  1. под A: `get_project_activity(pid)` → видит и нефинанс, и финанс (contract/share);
  2. под B (член команды; добавить B в project_members): видит нефинанс (stage), НЕ видит финанс (contract/share);
  3. под C (без доступа): пустой результат.

```sql
-- под B (только нефинанс):
select set_config('request.jwt.claims', json_build_object('sub', :'B','role','authenticated')::text, true);
select count(*) filter (where is_financial) as fin_seen_by_member  -- ожидаем 0
  from public.get_project_activity(:'pid', 100);
```

- [ ] **Step 3: Запустить — PASS:** A видит финанс, B (член команды) `fin_seen_by_member=0`, C — пусто.

- [ ] **Step 4: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only add supabase/migrations/20260622_0006_get_project_activity.sql
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only commit -m "feat(activity): RPC get_project_activity (гейт доступа + приватность денег)"
```

---

## Task 7: Скрипты деплоя и верификации

**Files:**
- Create: `deploy/activity-log/apply-migrations.sh`
- Create: `deploy/activity-log/verify-activity.sql`
- Create: `deploy/activity-log/verify-activity.sh`

**Interfaces:**
- Consumes: миграции 0001–0006.
- Produces: `apply-migrations.sh` (постоянное применение — фаза деплоя); `verify-activity.{sql,sh}`
  (транзакционный E2E, печатает `ACTIVITY_OK`/`ACTIVITY_FAIL`).

- [ ] **Step 1: `apply-migrations.sh`** (паттерн как `deploy/tasks/apply-migrations.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail
DIR=$(ls -d /mnt/f/*/redesign-v2-fresh/supabase/migrations)
for f in $(ls "$DIR"/20260622_*.sql 2>/dev/null | sort); do
  echo "== applying $(basename "$f") =="
  docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done
echo "MIGRATIONS_DONE"
```

- [ ] **Step 2: `verify-activity.sql`** — единый транзакционный E2E (BEGIN…ROLLBACK), объединяет проверки
  Task 2–6 (триггеры пишут; шум payments/shares отсутствует; приватность get_project_activity для члена
  команды; admin-журнал цел). Применяет миграции через `\i` относительно `/mnt/c/temp` или абсолютного
  пути контейнера. Завершить:

```sql
-- в конце харнесса:
\if :passed
  \echo ACTIVITY_OK
\else
  \echo ACTIVITY_FAIL
\endif
rollback;
```

(Точные assert-блоки переносятся из Step 2 задач 2–6; харнесс не коммитит — прод не меняется.)

- [ ] **Step 3: `verify-activity.sh`** — копирует миграции и `verify-activity.sql` в `/mnt/c/temp`,
  запускает `docker exec -i supabase-db psql … < verify-activity.sql`, grep `ACTIVITY_OK`.

- [ ] **Step 4: Прогнать `verify-activity.sh` — Expected `ACTIVITY_OK`.**

- [ ] **Step 5: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only add deploy/activity-log/
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only commit -m "feat(activity): apply + transactional verify scripts"
```

---

## Task 8: Фронт — лейблы админ-журнала + 5-я вкладка «История» в ProjectForm

**Files:**
- Modify: `src/App.jsx` — обёртка `fetchProjectActivity` (рядом с `adminFetchActivityLog`, ≈651);
  словарь `labels` в админ-вкладке «Журнал» (≈7333); компонент `ActivityFeed`; 5-я вкладка в `ProjectForm`.

**Interfaces:**
- Consumes: `get_project_activity` (Task 6), стиль ленты из админ-журнала (≈7341–7366).
- Produces: общий рендер строки события (переиспользуется админ-журналом и историей проекта).

ВАЖНО (грабли среды): App.jsx — монолит ~8000 строк, правит **контроллер сам**, не субагент. Перед серией
Edit делать Read участка непосредственно перед правкой (фоновый вотчер даёт «modified since read»).

- [ ] **Step 1: Расширить словарь лейблов**

В админ-вкладке (≈7333) словарь `labels` дополнить (иконки — из `lucide-react`; убедиться, что импортированы
`FolderPlus, Pencil, Tag, Calendar, Eye, Users, Banknote, CheckSquare` — добавить недостающие в общий импорт
lucide вверху файла). Полный объект (русские подписи; цвета в палитре сайта):

```js
const labels = {
  // учётки (существующие — НЕ удалять)
  user_approved: { label: "Пользователь одобрен", color: "#6ee7a8", Icon: UserCheck },
  user_revoked:  { label: "Доступ отозван",       color: "#f3d77b", Icon: UserMinus },
  user_deleted:  { label: "Пользователь удалён",  color: "#f8a3a3", Icon: Trash2 },
  role_changed:  { label: "Изменена роль",        color: "#d4af37", Icon: ShieldCheck },
  password_reset_by_admin: { label: "Сброс пароля админом", color: "#f3d77b", Icon: ShieldCheck },
  // проект
  project_created:           { label: "Проект создан",        color: "#6ee7a8", Icon: FolderPlus },
  project_renamed:          { label: "Проект переименован",  color: "#a8a8a3", Icon: Pencil },
  project_stage_changed:    { label: "Стадия изменена",      color: "#d4af37", Icon: Tag },
  project_client_changed:   { label: "Заказчик изменён",     color: "#a8a8a3", Icon: Pencil },
  project_deadline_changed: { label: "Дедлайн изменён",      color: "#f3d77b", Icon: Calendar },
  project_visibility_changed:{ label: "Видимость изменена",  color: "#a8a8a3", Icon: Eye },
  project_executors_changed:{ label: "Исполнители изменены", color: "#a8a8a3", Icon: Users },
  project_contract_changed: { label: "Сумма договора",       color: "#2dd4bf", Icon: Banknote },
  project_deleted:          { label: "Проект удалён",        color: "#f8a3a3", Icon: Trash2 },
  // деньги
  payment_added:   { label: "Платёж добавлен", color: "#6ee7a8", Icon: Banknote },
  payment_removed: { label: "Платёж удалён",   color: "#f8a3a3", Icon: Banknote },
  share_added:     { label: "Доля добавлена",  color: "#6ee7a8", Icon: Banknote },
  share_changed:   { label: "Доля изменена",   color: "#d4af37", Icon: Banknote },
  share_removed:   { label: "Доля удалена",    color: "#f8a3a3", Icon: Banknote },
  // команда
  member_added:        { label: "Участник добавлен", color: "#6ee7a8", Icon: Users },
  member_removed:      { label: "Участник удалён",   color: "#f8a3a3", Icon: Users },
  member_role_changed: { label: "Роль участника",    color: "#d4af37", Icon: ShieldCheck },
  // задачи
  task_created:        { label: "Задача создана",   color: "#6ee7a8", Icon: CheckSquare },
  task_status_changed: { label: "Статус задачи",    color: "#d4af37", Icon: CheckSquare },
  task_assigned:       { label: "Задача назначена", color: "#a8a8a3", Icon: CheckSquare },
  task_deleted:        { label: "Задача удалена",   color: "#f8a3a3", Icon: Trash2 },
};
```

- [ ] **Step 2: Вынести строку события в общий компонент `ActivityFeed`**

Извлечь существующий рендер строки (App.jsx ≈7341–7366) в presentational-компонент, переиспользуемый
админ-журналом и историей проекта. Рендер `details`: для `{from,to}` — `(from → to)`; для платежей
`{amount,paid_on}` — `сумма ₽ · дата`; для долей `{label,...}` — имя участника + значение.

```jsx
function ActivityFeed({ items }) {
  const labels = { /* объект из Step 1 — вынести в module-scope константу ACTIVITY_LABELS */ };
  if (!items?.length) return <Empty text="Журнал пуст" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map(a => {
        const cfg = ACTIVITY_LABELS[a.action] || { label: a.action, color: "#a8a8a3", Icon: Activity };
        const d = a.details || {};
        let detail = null;
        if (d.from !== undefined && d.to !== undefined) detail = `${d.from ?? "—"} → ${d.to ?? "—"}`;
        else if (d.amount) detail = `${Number(d.amount).toLocaleString("ru-RU")} ₽ · ${d.paid_on ?? ""}`;
        else if (d.label) detail = `${d.label}${d.value ? " · " + d.value : ""}`;
        else if (d.name) detail = d.name;
        else if (d.title) detail = d.title;
        return (
          <div key={a.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"8px 14px",
            borderRadius:10, background:"#141414", border:"1px solid rgba(255,255,255,0.04)" }}>
            <span style={{ width:28, height:28, borderRadius:6, display:"inline-flex",
              alignItems:"center", justifyContent:"center",
              background:`${cfg.color}1a`, color:cfg.color, flexShrink:0 }}>
              <cfg.Icon size={13} strokeWidth={2.2} />
            </span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, color:"#fafaf7" }}>
                <span style={{ fontWeight:500 }}>{cfg.label}</span>
                {detail && <span style={{ color:"#6b6b67" }}> · {detail}</span>}
              </div>
              <div style={{ fontSize:10, color:"#6b6b67", marginTop:2 }}>
                {(a.actor_email || "—")} · {new Date(a.created_at).toLocaleString("ru-RU")}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

Заменить тело админ-вкладки «Журнал» (≈7330–7370) на `<ActivityFeed items={activity} />` (loading/empty
обернуть как было). Вынести `ACTIVITY_LABELS` в module-scope (DRY между админом и историей проекта).

- [ ] **Step 3: Обёртка `fetchProjectActivity`** (рядом с `adminFetchActivityLog`, ≈651)

```js
async function fetchProjectActivity(client, projectId, limit = 100) {
  const { data, error } = await client.rpc("get_project_activity",
    { p_project_id: projectId, p_limit: limit });
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 4: 5-я вкладка «История» в `ProjectForm`**

Найти Grep'ом таб-структуру формы (`activeTab` + список «📋 Главное / 💰 Финансы / 👥 Команда / 💬 Детали»,
введена в #7). Добавить таб `{ id:'history', label:'🕘 История' }` и tab-conditional-блок (паттерн
`{activeTab==='history' && (<>…</>)}`, как остальные вкладки, БЕЗ переупорядочивания). Блок: `useState`
`projActivity`/`actLoading`; `useEffect` грузит `fetchProjectActivity(supabase, project.id)` при
`activeTab==='history' && project?.id` (только для существующего проекта — у нового истории нет); рендер
`<ActivityFeed items={projActivity} />` + состояние загрузки. Без realtime.

- [ ] **Step 5: Сборка**

Run: `wsl -d Ubuntu -u root -- bash -c "cd /mnt/f/*/redesign-v2-fresh && npm run build"`
Expected: сборка зелёная, без ошибок (особенно проверить, что все иконки lucide импортированы — иначе
`ReferenceError`/build fail).

- [ ] **Step 6: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only add src/App.jsx
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c core.fsyncMethod=writeout-only commit -m "feat(activity): лейблы журнала + вкладка История в проекте"
```

---

## Фаза деплоя (ТОЛЬКО по явному слову владельца «деплой»)

Не выполнять без команды. По «деплой»:
1. Скопировать `supabase/migrations/20260622_*.sql` F:→`C:\temp`, применить постоянно через
   `deploy/activity-log/apply-migrations.sh` (`wsl … bash /mnt/f/*/.../apply-migrations.sh`) → `MIGRATIONS_DONE`.
2. Прогнать `deploy/activity-log/verify-activity.sh` на уже применённой БД → `ACTIVITY_OK`.
3. Web: `npm run build` → `deploy/nextcloud/deploy-web.sh` (новый бандл).
4. git push `feature/activity-log-history` (обход прокси: `$env:HTTPS_PROXY=""` + `-c http.proxy=""`),
   затем merge в `main` по решению владельца.
5. Сброс PWA-кэша на устройстве владельца для живой проверки.
6. Живая проверка владельцем: вкладка «История» в проекте (владелец видит деньги, член команды — нет);
   админ-журнал показывает проектные события; смена стадии/оплаты/долей пишет записи; сохранение формы
   без денежных изменений НЕ плодит payment/share-событий.

---

## Self-Review (заполняется автором плана)

**Spec coverage:** §3 охват → Tasks 2–5; §4 схема → Task 1; §5 механизм (триггеры + RPC diff) → Tasks 2–5;
§6 доступ/приватность → Task 6; §7 фронт → Task 8; §8 техдолг (activity_log/log_activity в репо) → Task 1;
§9 критерии верификации → Tasks 2–6 (per-task) + Task 7 (E2E); §10 вне scope — не реализуется (ок);
§11 ловушки (replace-all → Task 5; дубль исполнитель↔команда — принят; гейт=зеркало projects_select → Task 6).
**Placeholder scan:** код миграций полный; фронт-интеграция вкладки описана через якоря + полный код
компонента/обёртки/лейблов (точная вставка — по Grep таб-структуры на исполнении). **Type consistency:**
`log_activity_ext` сигнатура единая во всех задачах; `get_project_activity(uuid,int)`; `fetchProjectActivity`
↔ `rpc('get_project_activity',{p_project_id,p_limit})`; `ACTIVITY_LABELS` ключи = action-коды из Global Constraints.
