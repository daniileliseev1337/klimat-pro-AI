-- 20260622_0004: аудит задач (создание/статус/назначение/удаление). project_id может быть null (личная задача).
-- ТЗ-версии и комментарии задач НЕ логируем (своя встроенная история). Сосуществует с trg_tz_v1_on_task_insert.
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
