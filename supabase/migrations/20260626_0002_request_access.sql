-- 20260626_0002: Ф3 — заявка посетителя на полный доступ.
-- Спек: docs/superpowers/specs/2026-06-26-visitor-demo-design.md §7 (доработка по фидбэку).
-- Посетитель (approved=true, роль visitor) из демо-режима шлёт заявку → флаг access_requested.
-- Админ-просмотр заявок в UI — инкремент 2 (вместе с подсказкой requested_role).

alter table public.profiles add column if not exists access_requested boolean not null default false;

-- RPC: текущий пользователь помечает себя «запросил полный доступ».
-- SECURITY DEFINER → UPDATE обходит RLS profiles; правит ТОЛЬКО свою строку (auth.uid()).
create or replace function public.request_full_access()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles set access_requested = true where id = auth.uid();
end;
$$;
grant execute on function public.request_full_access() to authenticated;
