-- 20260622_0006: лента истории проекта.
-- Гейт = точное зеркало projects_select (20260611_0002): owner / admin / (team И член) / (marketplace И approved).
-- НЕ используем can_access_project_comments — оно шире (team = любой approved) и дало бы утечку истории
-- team-проекта посторонним. Финанс-события (is_financial) — только владельцу/админу.
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
    return;  -- нет доступа к проекту → пустой результат
  end if;
  return query
    select a.* from public.activity_log a
    where a.project_id = p_project_id
      and (a.is_financial = false or coalesce(v_is_owner, false) or public.is_admin())
    order by a.created_at desc
    limit p_limit;
end; $$;
grant execute on function public.get_project_activity(uuid, int) to authenticated;
