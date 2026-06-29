-- 20260629_0002: доступ заказчика к задачам/комментариям/ТЗ своих проектов.
-- (§4.1) Централизованный гейт + (B-1) право заказчика предлагать ТЗ к задаче сотрудника.

-- 1. can_access_project_comments: добавить ветку is_project_client.
create or replace function public.can_access_project_comments(p_project_id uuid)
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp' as $$
  select exists (
    select 1 from public.projects
    where id = p_project_id
      and (
        owner_id = auth.uid()
        or public.is_admin()
        or (visibility = 'team' and public.is_project_member(p_project_id))
        or (visibility = 'marketplace' and public.is_approved())
        or public.is_project_client(p_project_id)            -- НОВОЕ: заказчик своего проекта
      )
  );
$$;

-- 2. propose_tz_version: расширить гейт правом заказчика (B-1).
--    Полное переопределение (формат сохранён из живой БД, добавлена ветка is_project_client).
create or replace function public.propose_tz_version(p_task_id uuid, p_content text)
returns task_tz_versions language plpgsql security definer as $function$
declare
  t public.project_tasks%ROWTYPE;
  v_caller uuid := auth.uid();
  v_is_party boolean; v_can_edit boolean;
  v_next_no int; v_status text; v_resolved uuid; v_resolved_at timestamptz;
  v_row public.task_tz_versions%ROWTYPE;
begin
  if not public.is_approved() then raise exception 'not_approved'; end if;
  select * into t from public.project_tasks where id = p_task_id;
  if not found then raise exception 'task_not_found'; end if;
  if not public.can_access_task(p_task_id) then raise exception 'access_denied'; end if;

  v_is_party := (t.author_id = v_caller or t.assigned_to = v_caller);
  v_can_edit := public.is_admin()
                or (t.project_id is not null and public.is_project_editor(t.project_id))
                or (t.project_id is not null and public.is_project_client(t.project_id)); -- B-1

  if not (v_is_party or v_can_edit) then raise exception 'forbidden'; end if;

  if exists (select 1 from public.task_tz_versions where task_id = p_task_id and status = 'pending') then
    raise exception 'tz_pending_exists';
  end if;

  if t.assigned_to is not null and v_is_party then
    v_status := 'pending'; v_resolved := null; v_resolved_at := null;
  else
    v_status := 'approved'; v_resolved := v_caller; v_resolved_at := now();
  end if;

  select coalesce(max(version_no),0)+1 into v_next_no from public.task_tz_versions where task_id = p_task_id;
  insert into public.task_tz_versions (task_id, version_no, content, status, proposed_by, resolved_by, resolved_at)
  values (p_task_id, v_next_no, p_content, v_status, v_caller, v_resolved, v_resolved_at)
  returning * into v_row;
  if v_status = 'approved' then
    update public.project_tasks set description = p_content where id = p_task_id;
  end if;
  return v_row;
end $function$;
