-- 20260630_0010: фоллбэк имени исполнителя — у сотрудников без profiles.name
-- в select заказчика были пустые пункты. Возвращаем name → username → email.
create or replace function public.list_available_executors()
returns table(id uuid, name text, "position" text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id,
         coalesce(nullif(p.name, ''), nullif(p.username, ''), p.email) as name,
         p.position
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id and ur.role = 'employee'
  where p.approved = true and p.id <> auth.uid()
  order by 2;
$$;
grant execute on function public.list_available_executors() to authenticated;
