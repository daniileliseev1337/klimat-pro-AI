-- 20260622_0007: D роль заказчика, Фаза 1 — привязка аккаунта + просмотр своих проектов.

-- 1. Привязка аккаунта к записи заказчика.
alter table public.clients
  add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists idx_clients_user_id on public.clients(user_id) where user_id is not null;

-- 2. Хелпер: вызывающий привязан как заказчик этого проекта (для RLS фазы 2 и проверок).
create or replace function public.is_project_client(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.projects p
    join public.clients c on c.id = p.client_id
    where p.id = p_project_id and c.user_id = auth.uid()
  );
$$;
grant execute on function public.is_project_client(uuid) to authenticated;

-- 3. Привязан ли вызывающий хотя бы к одной записи-заказчику (для таба «Мои заказы»).
create or replace function public.am_i_client()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.clients where user_id = auth.uid());
$$;
grant execute on function public.am_i_client() to authenticated;

-- 4. Проекты-заказы вызывающего — БЕЗОПАСНАЯ проекция (без notes, долей, owner_id).
create or replace function public.get_my_client_projects()
returns table (
  id uuid, name text, stage text, start_date date, deadline date,
  contract_sum numeric, paid_amount numeric, executor text
)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.name, p.stage, p.start_date, p.deadline,
         p.contract_sum, p.paid_amount, p.executor
  from public.projects p
  join public.clients c on c.id = p.client_id
  where c.user_id = auth.uid()
  order by p.created_at desc;
$$;
grant execute on function public.get_my_client_projects() to authenticated;

-- 5. Привязка аккаунта к записи (гейт: владелец записи или админ). p_user_id NULL = отвязать.
create or replace function public.set_client_user(p_client_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from public.clients
    where id = p_client_id and (owner_id = auth.uid() or public.is_admin())
  ) then
    raise exception 'not_client_owner';
  end if;
  update public.clients set user_id = p_user_id where id = p_client_id;
end; $$;
grant execute on function public.set_client_user(uuid, uuid) to authenticated;
