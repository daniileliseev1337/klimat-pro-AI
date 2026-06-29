-- 20260629_0006: список исполнителей для заказчика (узкая проекция, §5.4).
create or replace function public.list_available_executors()
returns table(id uuid, name text, "position" text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.name, p.position
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id and ur.role = 'employee'
  where p.approved = true and p.id <> auth.uid()
  order by p.name;
$$;
grant execute on function public.list_available_executors() to authenticated;
