-- 20260729_0001: account-synchronised UI appearance preferences.
-- Repository migration only. Applying it to the live database requires a separate
-- explicit owner approval and RLS verification.

create table if not exists public.user_appearance_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  global_skin_id text not null default 'classic',
  global_effect_id text not null default 'none',
  panel_overrides jsonb not null default '{}'::jsonb,
  self_transfer_names jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_appearance_preferences_self_transfer_names_array_check
    check (jsonb_typeof(self_transfer_names) = 'array')
);

alter table public.user_appearance_preferences enable row level security;

do $$
begin
  create policy user_appearance_preferences_owner_all
    on public.user_appearance_preferences
    for all
    using (user_id = auth.uid())
    with check (user_id = auth.uid());
exception
  when duplicate_object then null;
end $$;
