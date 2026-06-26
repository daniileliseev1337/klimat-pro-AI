-- 20260626_0003: Ф3 — заявка посетителя с выбором роли + уведомление админам + список заявок + авто-закрытие.
-- Спек: docs/superpowers/specs/2026-06-26-visitor-demo-design.md §7 (доработка по фидбэку владельца).
-- Заменяет request_full_access() (без арг, из 0002) на версию с ролью employee/client.

drop function if exists public.request_full_access();

-- Посетитель шлёт заявку: ставит access_requested + requested_role и уведомляет ВСЕХ админов (in-app inbox).
-- SECURITY DEFINER → правит свою строку и пишет notifications (клиентам INSERT туда закрыт).
create or replace function public.request_full_access(p_role text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_role not in ('employee','client') then
    raise exception 'bad_role';
  end if;
  update public.profiles
     set access_requested = true, requested_role = p_role
   where id = auth.uid();
  insert into public.notifications (user_id, type, title, body, url)
    select a.id, 'access_request', 'Заявка на доступ',
           coalesce((select name from public.profiles where id = auth.uid()), 'Посетитель')
             || ' просит доступ как ' || case p_role when 'employee' then 'сотрудник' else 'заказчик' end,
           '/'
      from public.profiles a
     where a.role = 'admin';
end;
$$;
grant execute on function public.request_full_access(text) to authenticated;

-- Список активных заявок для админки (только админу; иначе 0 строк).
create or replace function public.admin_list_access_requests()
returns table (user_id uuid, name text, requested_role text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select id, name, requested_role
    from public.profiles
   where access_requested = true and public.is_admin();
$$;
grant execute on function public.admin_list_access_requests() to authenticated;

-- Ф1 set_user_roles + закрытие заявки: когда админ назначил роли — заявка обработана.
create or replace function public.set_user_roles(p_user_id uuid, p_roles text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if exists (select 1 from unnest(p_roles) r where r not in ('employee','client','visitor')) then
    raise exception 'bad_role';
  end if;
  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles (user_id, role)
    select p_user_id, r from unnest(p_roles) r;
  update public.profiles set access_requested = false where id = p_user_id;  -- заявка закрыта
end; $$;
grant execute on function public.set_user_roles(uuid, text[]) to authenticated;
