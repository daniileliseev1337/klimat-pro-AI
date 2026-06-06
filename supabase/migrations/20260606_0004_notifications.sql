-- Центр уведомлений: durable in-app inbox, дополняет Web Push.
-- Строки пишет edge web-push-notify через service_role (обходит RLS);
-- клиентам INSERT не разрешён (нет insert-политики) — нельзя подделать уведомление.
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,                 -- task_assigned | task_status | task_created
                                            -- | deadline | project_taken | team_invite
                                            -- | comment | project_published
  title      text not null,
  body       text not null,
  url        text not null default '/',
  read       boolean not null default false,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read, created_at desc);

alter table public.notifications enable row level security;

-- читать только свои
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid());

-- помечать прочитанным только свои (insert/delete клиентам не даём)
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Realtime (idempotent guard — повторное применение не упадёт)
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
