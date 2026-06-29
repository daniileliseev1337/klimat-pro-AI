-- 20260629_0004: заказчик-автор не может назначить assigned_to вне executors проекта (B-3).
create or replace function public.validate_client_task_assignee()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  -- срабатывает только если автор — заказчик данного проекта и НЕ сотрудник
  if NEW.project_id is not null
     and public.is_project_client(NEW.project_id)
     and not public.is_employee()
     and NEW.assigned_to is not null then
    if not exists (
      select 1 from public.projects p,
             jsonb_array_elements(coalesce(p.executors,'[]'::jsonb)) e
      where p.id = NEW.project_id
        and (e->>'userId') = NEW.assigned_to::text
    ) then
      raise exception 'assignee_not_in_executors';
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_validate_assigned_to on public.project_tasks;
create trigger trg_validate_assigned_to
  before insert or update of assigned_to on public.project_tasks
  for each row execute function public.validate_client_task_assignee();
