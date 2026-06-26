-- 20260626_0001: Ф3 — посетитель + демо-режим (авто-approve visitor + заявленная роль).
-- Спек: docs/superpowers/specs/2026-06-26-visitor-demo-design.md §3.
-- Аддитивно: расширяем НАШ триггер handle_new_user_meta (Ф2), baseline handle_new_user НЕ трогаем.

-- 1. Заявленная при регистрации роль (подсказка админу; UI-отображение — отдельный инкремент).
alter table public.profiles add column if not exists requested_role text;

-- 2. Расширяем тело handle_new_user_meta():
--    - дописываем requested_role из метаданных signUp;
--    - если роль = 'visitor' → авто-approve + строка user_roles(visitor) (посетитель заходит сам).
--    employee/client: approved остаётся false (ждут админа), роль в user_roles НЕ пишем (назначит админ, Ф1).
--    Безопасность: подделка role=employee в meta бесполезна — одобряется ТОЛЬКО visitor;
--    has_role() в RLS не используется → запись роли сама по себе доступа не даёт.
create or replace function public.handle_new_user_meta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles
     set username       = coalesce(new.raw_user_meta_data->>'username', username),
         name           = coalesce(nullif(new.raw_user_meta_data->>'name', ''), name),
         requested_role = coalesce(new.raw_user_meta_data->>'role', requested_role)
   where id = new.id;

  if new.raw_user_meta_data->>'role' = 'visitor' then
    update public.profiles set approved = true where id = new.id;
    insert into public.user_roles (user_id, role)
      values (new.id, 'visitor')
      on conflict do nothing;
  end if;

  return new;
end;
$$;

-- Триггер on_auth_user_created_meta уже создан в 20260625_0002 и ссылается на эту функцию —
-- CREATE OR REPLACE обновляет тело, пересоздавать триггер не нужно.
