-- 20260629_0001: is_employee() — одобренный аккаунт с ролью employee в user_roles.
-- НЕ "approved AND NOT am_i_client": аккаунт бывает гибридом {client,employee} — он сотрудник.
create or replace function public.is_employee()
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select public.is_approved()
     and exists (select 1 from public.user_roles
                 where user_id = auth.uid() and role = 'employee');
$$;
grant execute on function public.is_employee() to authenticated;
