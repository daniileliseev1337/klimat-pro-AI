-- 20260629_0003: узкий RPC приёмки. Заказчик двигает только статус приёмки своих задач.
create or replace function public.client_set_task_status(p_task_id uuid, p_status text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  t public.project_tasks%ROWTYPE;
begin
  select * into t from public.project_tasks where id = p_task_id;
  if not found then raise exception 'task_not_found'; end if;
  if t.project_id is null or not public.is_project_client(t.project_id) then
    raise exception 'forbidden';
  end if;
  -- разрешённые переходы приёмки
  if not (
       (t.status = 'На проверке' and p_status in ('Готово','В работе'))
    or (t.status = 'Готово'      and p_status = 'В работе')
  ) then
    raise exception 'illegal_transition: % -> %', t.status, p_status;
  end if;
  update public.project_tasks set status = p_status where id = p_task_id;
end $$;
grant execute on function public.client_set_task_status(uuid, text) to authenticated;
