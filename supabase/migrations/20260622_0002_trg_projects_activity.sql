-- 20260622_0002: аудит изменений проекта. paid_amount и executor (производные) НЕ логируем.
create or replace function public.trg_log_project_activity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity_ext('project_created', new.id, false, new.id, null,
      jsonb_build_object('name', new.name));
    return new;
  elsif tg_op = 'DELETE' then
    -- проект уже удалён → project_id=null (FK on delete set null), имя в details, target_id=old.id (без FK)
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
