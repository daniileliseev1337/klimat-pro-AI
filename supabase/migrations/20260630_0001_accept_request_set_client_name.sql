-- 20260630_0001: фикс — accept_project_request заполняет денормализованное текстовое
-- поле projects.client (имя заказчика, которое показывает карточка проекта). Раньше
-- ставился только client_id → в карточке поле «заказчик» оставалось пустым.
-- + бэкфилл уже материализованных из заявок проектов.

create or replace function public.accept_project_request(p_request_id uuid)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  r public.project_requests%ROWTYPE;
  v_pid uuid;
  v_exec_name text;
  v_client_name text;
begin
  if not (public.is_employee() or public.is_admin()) then raise exception 'forbidden'; end if;
  select * into r from public.project_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.status <> 'Новая' then raise exception 'already_processed'; end if;

  select name into v_client_name from public.clients where id = r.client_id;

  if r.assignment_mode = 'marketplace' then
    insert into public.projects (owner_id, client_id, client, name, stage, visibility)
    values (auth.uid(), r.client_id, coalesce(v_client_name,''), r.name, 'Поиск исполнителя', 'marketplace')
    returning id into v_pid;
  else
    -- assignee: проект + исполнитель в команду и executors (паттерн take_project, но НЕ вызов).
    insert into public.projects (owner_id, client_id, client, name, stage, visibility)
    values (auth.uid(), r.client_id, coalesce(v_client_name,''), r.name, 'В работе', 'team')
    returning id into v_pid;

    select coalesce(nullif(name,''), email) into v_exec_name
    from public.profiles where id = r.desired_executor_id;

    update public.projects
    set executors = jsonb_build_array(jsonb_build_object('name', coalesce(v_exec_name,''),
                                                         'userId', r.desired_executor_id::text)),
        executor  = coalesce(v_exec_name,'')
    where id = v_pid;

    insert into public.project_members (project_id, user_id, role)
    values (v_pid, r.desired_executor_id, 'editor')
    on conflict (project_id, user_id) do update set role = 'editor';
  end if;

  update public.project_requests
  set status = 'Принята', accepted_project_id = v_pid where id = p_request_id;

  -- уведомить заказчика
  insert into public.notifications (user_id, type, title, body, url)
  values (r.created_by, 'project_request', 'Заявка принята', r.name, '/orders');

  return v_pid;
end $$;
grant execute on function public.accept_project_request(uuid) to authenticated;

-- Бэкфилл: проекты с проставленным client_id, но пустым текстовым client (созданные
-- из заявок до этого фикса). Только дополняет — ручные проекты уже несут client.
update public.projects p
set client = c.name
from public.clients c
where p.client_id = c.id
  and (p.client is null or p.client = '');
