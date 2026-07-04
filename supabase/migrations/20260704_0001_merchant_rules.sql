-- 20260704_0001: merchant_rules — выученные категории мерчантов (банк v2).
-- Личная таблица владельца: RLS строго owner_id = auth.uid().
-- Применение к живой БД — по явному «го» владельца, не автоматически.

create table if not exists public.merchant_rules (
  owner_id     uuid not null references auth.users(id) on delete cascade,
  merchant_key text not null,
  category     text not null,
  updated_at   timestamptz not null default now(),
  primary key (owner_id, merchant_key)
);

alter table public.merchant_rules enable row level security;

-- Единая политика: владелец видит и пишет только свои строки.
create policy merchant_rules_owner_all on public.merchant_rules
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Чтение своих правил (PostgREST RPC).
create or replace function public.get_merchant_rules()
returns setof public.merchant_rules
language sql security definer set search_path = public, pg_temp
as $$ select * from public.merchant_rules where owner_id = auth.uid() $$;

-- Upsert одного правила (обучение при правке категории в review).
create or replace function public.upsert_merchant_rule(p_merchant_key text, p_category text)
returns void
language sql security definer set search_path = public, pg_temp
as $$
  insert into public.merchant_rules (owner_id, merchant_key, category)
  values (auth.uid(), p_merchant_key, p_category)
  on conflict (owner_id, merchant_key)
  do update set category = excluded.category, updated_at = now();
$$;

grant execute on function public.get_merchant_rules() to authenticated;
grant execute on function public.upsert_merchant_rule(text, text) to authenticated;
