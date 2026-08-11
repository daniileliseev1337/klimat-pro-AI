-- Удалённый MCP: владелец/Admin явно выдаёт пользователю read или write.
-- Отсутствие строки означает полный запрет. Токены и секреты в таблице не хранятся.

create table if not exists public.mcp_user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_level text not null check (access_level in ('read', 'write')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists mcp_user_access_updated_by_idx
  on public.mcp_user_access (updated_by);

alter table public.mcp_user_access enable row level security;

drop policy if exists mcp_user_access_select_own_or_admin on public.mcp_user_access;
create policy mcp_user_access_select_own_or_admin
  on public.mcp_user_access
  for select
  to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());

revoke all on table public.mcp_user_access from public, anon;
grant select on table public.mcp_user_access to authenticated;

create or replace function public.admin_set_mcp_access(
  p_user_id uuid,
  p_access_level text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_level text := lower(coalesce(p_access_level, 'none'));
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  if v_level not in ('none', 'read', 'write') then
    raise exception 'bad_mcp_access_level';
  end if;

  select email into v_email
  from public.profiles
  where id = p_user_id and approved = true;

  if not found and v_level <> 'none' then
    raise exception 'target_user_not_approved';
  end if;

  if v_level = 'none' then
    delete from public.mcp_user_access where user_id = p_user_id;
  else
    insert into public.mcp_user_access (user_id, access_level, updated_at, updated_by)
    values (p_user_id, v_level, now(), auth.uid())
    on conflict (user_id) do update
      set access_level = excluded.access_level,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by;
  end if;

  perform public.log_activity(
    'mcp_access_changed',
    p_user_id,
    v_email,
    jsonb_build_object('access_level', v_level)
  );
end;
$$;

revoke all on function public.admin_set_mcp_access(uuid, text) from public, anon;
grant execute on function public.admin_set_mcp_access(uuid, text) to authenticated;
