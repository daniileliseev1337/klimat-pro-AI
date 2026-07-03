-- Портал заказчика Фаза 2: переписка client_messages + файлы client_visible.
-- Гейты — существующие хелперы is_project_client / can_access_project_comments.

-- 1) Переписка заказчик↔команда по проекту
create table if not exists public.client_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id  uuid not null references auth.users(id)   on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists idx_client_messages_project on public.client_messages(project_id, created_at);
alter table public.client_messages enable row level security;

drop policy if exists client_messages_select on public.client_messages;
create policy client_messages_select on public.client_messages for select to authenticated
  using (public.is_project_client(project_id) or public.can_access_project_comments(project_id));

drop policy if exists client_messages_insert on public.client_messages;
create policy client_messages_insert on public.client_messages for insert to authenticated
  with check (
    author_id = auth.uid() and public.is_approved()
    and (public.is_project_client(project_id) or public.can_access_project_comments(project_id))
  );
-- update/delete: политик нет (сообщения неизменны)

-- 2) Флаг видимости файла заказчику
alter table public.project_files add column if not exists client_visible boolean not null default false;

-- files_select: пересоздать с веткой заказчика (был только can_access_project_comments)
drop policy if exists files_select on public.project_files;
create policy files_select on public.project_files for select to authenticated
  using (
    public.can_access_project_comments(project_id)
    or (client_visible and public.is_project_client(project_id))
  );

-- 3) RPC переписки
create or replace function public.get_client_messages(p_project_id uuid)
returns table(id uuid, author_id uuid, author_name text, is_mine boolean, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_project_client(p_project_id) or public.can_access_project_comments(p_project_id)) then
    return;
  end if;
  return query
    select m.id, m.author_id,
           coalesce(p.name, p.email, 'Пользователь') as author_name,
           (m.author_id = auth.uid()) as is_mine,
           m.body, m.created_at
    from public.client_messages m
    left join public.profiles p on p.id = m.author_id
    where m.project_id = p_project_id
    order by m.created_at asc;
end; $$;

create or replace function public.post_client_message(p_project_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_body text := btrim(p_body);
begin
  if not public.is_approved() then raise exception 'not approved'; end if;
  if not (public.is_project_client(p_project_id) or public.can_access_project_comments(p_project_id)) then
    raise exception 'access denied';
  end if;
  if length(v_body) not between 1 and 4000 then raise exception 'body length 1..4000'; end if;
  insert into public.client_messages(project_id, author_id, body)
    values (p_project_id, auth.uid(), v_body) returning id into v_id;
  return v_id;
end; $$;

-- 4) RPC файлов заказчика (только client_visible, без приватных полей)
create or replace function public.get_client_project_files(p_project_id uuid)
returns table(id uuid, filename text, file_size bigint, mime_type text, uploader_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_project_client(p_project_id) then return; end if;
  return query
    select f.id, f.filename, f.file_size, f.mime_type,
           coalesce(p.name, p.email, 'Пользователь') as uploader_name, f.created_at
    from public.project_files f
    left join public.profiles p on p.id = f.owner_id
    where f.project_id = p_project_id and f.client_visible = true
    order by f.created_at desc;
end; $$;

-- 5) Тоггл видимости файла (команда): загрузивший / owner проекта / admin
create or replace function public.set_file_client_visible(p_file_id uuid, p_visible boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_project uuid; v_owner uuid;
begin
  select project_id, owner_id into v_project, v_owner from public.project_files where id = p_file_id;
  if v_project is null then raise exception 'file not found'; end if;
  if not (v_owner = auth.uid() or public.is_project_owner(v_project) or public.is_admin()) then
    raise exception 'access denied';
  end if;
  update public.project_files set client_visible = p_visible where id = p_file_id;
end; $$;

-- 6) get_project_files: аддитивно вернуть client_visible (для галочки у команды)
drop function if exists public.get_project_files(uuid);
create function public.get_project_files(p_project_id uuid)
returns table(id uuid, project_id uuid, owner_id uuid, uploader_name text, filename text,
              disk_path text, file_size bigint, mime_type text, is_public boolean, public_url text,
              client_visible boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.can_access_project_comments(p_project_id) then return; end if;
  return query
    select f.id, f.project_id, f.owner_id,
           coalesce(p.name, p.email, 'Пользователь') as uploader_name,
           f.filename, f.disk_path, f.file_size, f.mime_type, f.is_public, f.public_url,
           f.client_visible, f.created_at
    from public.project_files f
    left join public.profiles p on p.id = f.owner_id
    where f.project_id = p_project_id
    order by f.created_at desc;
end; $$;

grant execute on function public.get_client_messages(uuid) to authenticated;
grant execute on function public.post_client_message(uuid, text) to authenticated;
grant execute on function public.get_client_project_files(uuid) to authenticated;
grant execute on function public.set_file_client_visible(uuid, boolean) to authenticated;
grant execute on function public.get_project_files(uuid) to authenticated;
