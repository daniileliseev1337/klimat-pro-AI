-- Доли оплаты проекта (кластер #1/#2). Спек: docs/superpowers/specs/2026-06-07-payment-shares-design.md
-- Таблица долей: одна строка на участника-получателя доли. Владелец = остаток (строкой не хранится).

create table if not exists public.project_shares (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  -- полиморфный участник: ровно один «адрес» из трёх
  participant_user_id   uuid references auth.users(id),
  participant_client_id uuid references public.clients(id),
  participant_name      text,
  -- размер доли: гибко — % ИЛИ сумма
  share_kind            text    not null check (share_kind in ('percent','amount')),
  share_value           numeric not null check (share_value >= 0),
  note                  text,
  created_at            timestamptz not null default now(),
  constraint project_shares_one_participant check (
    (participant_user_id   is not null)::int
  + (participant_client_id is not null)::int
  + (participant_name      is not null)::int = 1
  )
);

create index if not exists project_shares_project_id_idx
  on public.project_shares(project_id);
create index if not exists project_shares_participant_user_idx
  on public.project_shares(participant_user_id) where participant_user_id is not null;

alter table public.project_shares enable row level security;

-- SELECT: владелец проекта (все доли своего проекта) ИЛИ сам участник (только свою строку)
drop policy if exists project_shares_select on public.project_shares;
create policy project_shares_select on public.project_shares
for select using (
  exists (select 1 from public.projects p
          where p.id = project_shares.project_id and p.owner_id = auth.uid())
  or participant_user_id = auth.uid()
);

-- INSERT/UPDATE/DELETE: только владелец проекта
drop policy if exists project_shares_write on public.project_shares;
create policy project_shares_write on public.project_shares
for all using (
  exists (select 1 from public.projects p
          where p.id = project_shares.project_id and p.owner_id = auth.uid())
) with check (
  exists (select 1 from public.projects p
          where p.id = project_shares.project_id and p.owner_id = auth.uid())
);

-- Приватная проекция доли участнику: только {название, моя доля, получено, остаток}.
create or replace function public.get_my_shares()
returns table (project_name text, my_amount numeric, my_received numeric, my_receivable numeric)
language sql
security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select
      p.name as project_name,
      coalesce(p.contract_sum, 0) as contract_sum,
      coalesce(p.paid_amount, 0)  as paid_amount,
      case when s.share_kind = 'percent'
           then coalesce(p.contract_sum,0) * s.share_value / 100.0
           else s.share_value end as amount
    from public.project_shares s
    join public.projects p on p.id = s.project_id
    where s.participant_user_id = auth.uid()
      and p.owner_id <> auth.uid()
  )
  select
    project_name,
    amount as my_amount,
    case when contract_sum > 0 then paid_amount * amount / contract_sum else 0 end as my_received,
    amount - (case when contract_sum > 0 then paid_amount * amount / contract_sum else 0 end) as my_receivable
  from mine;
$$;

grant execute on function public.get_my_shares() to authenticated;
