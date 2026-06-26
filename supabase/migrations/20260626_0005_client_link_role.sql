-- 20260626_0005: Ф3 — увязка «заказчик»: роль client производна от привязки clients.user_id.
-- Грилинг 2026-06-26. Единый источник истины: заказчик = аккаунт, привязанный к записи в clients.

-- 1. set_client_user: привязка/отвязка управляет ролью client + одобрением + заявкой.
create or replace function public.set_client_user(p_client_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_user uuid;
begin
  if not exists (
    select 1 from public.clients
    where id = p_client_id and (owner_id = auth.uid() or public.is_admin())
  ) then
    raise exception 'not_client_owner';
  end if;

  select user_id into v_old_user from public.clients where id = p_client_id;
  update public.clients set user_id = p_user_id where id = p_client_id;

  -- Привязка аккаунта → активировать как заказчика: роль client + approved + закрыть заявку.
  if p_user_id is not null then
    insert into public.user_roles (user_id, role) values (p_user_id, 'client')
      on conflict do nothing;
    update public.profiles
       set approved = true, access_requested = false
     where id = p_user_id;
  end if;

  -- Старый аккаунт, если больше нигде не привязан как заказчик → снять роль client.
  if v_old_user is not null and v_old_user is distinct from p_user_id
     and not exists (select 1 from public.clients where user_id = v_old_user) then
    delete from public.user_roles where user_id = v_old_user and role = 'client';
  end if;
end; $$;
grant execute on function public.set_client_user(uuid, uuid) to authenticated;

-- 2. set_user_roles больше НЕ управляет ролью client (она — только от привязки заказчика).
--    Чекбоксы админки задают employee/visitor; client защищён на уровне БД от случайного стирания.
create or replace function public.set_user_roles(p_user_id uuid, p_roles text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if exists (select 1 from unnest(p_roles) r where r not in ('employee','client','visitor')) then
    raise exception 'bad_role';
  end if;
  delete from public.user_roles where user_id = p_user_id and role <> 'client';
  insert into public.user_roles (user_id, role)
    select p_user_id, r from unnest(p_roles) r where r <> 'client'
    on conflict do nothing;
  update public.profiles set access_requested = false where id = p_user_id;  -- заявка закрыта
end; $$;
grant execute on function public.set_user_roles(uuid, text[]) to authenticated;

-- 3. Синхронизация: убрать «битые» роли client без привязки к записи заказчика.
delete from public.user_roles ur
 where ur.role = 'client'
   and not exists (select 1 from public.clients c where c.user_id = ur.user_id);
