-- 20260701_0002: финализация созданного админом пользователя.
-- Вызывается Edge Function admin-create-user ПОД JWT админа после GoTrue-создания.
-- Гейт is_admin(); ставит approved+имя+единственную роль; аудит без пароля.
create or replace function public.admin_finalize_new_user(p_user_id uuid, p_role text, p_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_role not in ('client','employee') then raise exception 'bad_role'; end if;
  if p_user_id is null then raise exception 'no_user'; end if;

  update public.profiles
     set approved = true,
         name = coalesce(nullif(p_name, ''), name)
   where id = p_user_id;
  if not found then raise exception 'profile_not_found'; end if;

  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles (user_id, role) values (p_user_id, p_role);

  select email into v_email from public.profiles where id = p_user_id;
  perform public.log_activity('user_created_by_admin', p_user_id, v_email, null);
end $$;
grant execute on function public.admin_finalize_new_user(uuid, text, text) to authenticated;
