-- 20260630_0002: фикс латентного бага — нельзя было удалить проект с участниками/
-- платежами/долями. При каскадном DELETE проекта триггеры (member_removed/payment_removed/
-- share_removed) вызывают log_activity_ext с project_id уже удаляемого проекта → INSERT в
-- activity_log нарушает FK activity_log_project_id_fkey. Защита: если проект уже не
-- существует, пишем лог без ссылки на проект (project_id := null; колонка nullable, FK = SET NULL).

create or replace function public.log_activity_ext(
  p_action text, p_project_id uuid, p_is_financial boolean,
  p_target_id uuid default null, p_target_email text default null, p_details jsonb default null)
returns uuid language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_actor uuid; v_email text; v_id uuid;
begin
  v_actor := auth.uid();
  select email into v_email from public.profiles where id = v_actor;
  -- проект уже исчезает (каскад) → не ссылаемся на несуществующий id, иначе FK ломает DELETE
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id) then
    p_project_id := null;
  end if;
  insert into public.activity_log
    (actor_id, actor_email, action, project_id, is_financial, target_id, target_email, details)
  values
    (v_actor, v_email, p_action, p_project_id, coalesce(p_is_financial,false), p_target_id, p_target_email, p_details)
  returning id into v_id;
  return v_id;
end; $function$;
