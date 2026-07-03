-- ============================================================================
-- BASELINE: полный snapshot схемы public ЖИВОЙ БД (self-hosted Supabase)
-- Снят: 2026-07-03, pg_dump --schema-only --schema=public --no-owner
-- Зачем: до этого файла ~20 функций и 7 таблиц существовали ТОЛЬКО в живой БД
--        (см. docs/IDEAS.md, аудит 2026-07-03) — БД была невоспроизводима.
-- Восстановление с нуля: применить ЭТОТ файл на пустую БД (после стандартных
--        Supabase-схем auth/storage), затем миграции supabase/migrations/ ПОСЛЕ
--        2026-07-03 (более ранние уже включены в snapshot).
-- НЕ применять как обычную миграцию поверх живой БД (CREATE TABLE без IF NOT EXISTS).
-- ============================================================================

--
-- PostgreSQL database dump
--

\restrict pgUkKqNV96Lgo6dN8nLj87fK2rdPcbZtBw8LnjEJYKNC6JVRqvc7eDb4BQyyXKg

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: accept_project_request(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accept_project_request(p_request_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  r public.project_requests%ROWTYPE;
  v_pid uuid;
  v_exec_name text;
  v_client_name text;
begin
  if not (public.is_employee() or public.is_admin()) then raise exception 'forbidden'; end if;
  select * into r from public.project_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.status <> 'Новая' then raise exception 'already_processed'; end if;

  select name into v_client_name from public.clients where id = r.client_id;

  if r.assignment_mode = 'marketplace' then
    insert into public.projects (owner_id, client_id, client, name, stage, visibility)
    values (auth.uid(), r.client_id, coalesce(v_client_name,''), r.name, 'Поиск исполнителя', 'marketplace')
    returning id into v_pid;
  else
    -- assignee: проект + исполнитель в команду и executors (паттерн take_project, но НЕ вызов).
    insert into public.projects (owner_id, client_id, client, name, stage, visibility)
    values (auth.uid(), r.client_id, coalesce(v_client_name,''), r.name, 'В работе', 'team')
    returning id into v_pid;

    select coalesce(nullif(name,''), email) into v_exec_name
    from public.profiles where id = r.desired_executor_id;

    update public.projects
    set executors = jsonb_build_array(jsonb_build_object('name', coalesce(v_exec_name,''),
                                                         'userId', r.desired_executor_id::text)),
        executor  = coalesce(v_exec_name,'')
    where id = v_pid;

    insert into public.project_members (project_id, user_id, role)
    values (v_pid, r.desired_executor_id, 'editor')
    on conflict (project_id, user_id) do update set role = 'editor';
  end if;

  update public.project_requests
  set status = 'Принята', accepted_project_id = v_pid where id = p_request_id;

  -- уведомить заказчика
  insert into public.notifications (user_id, type, title, body, url)
  values (r.created_by, 'project_request', 'Заявка принята', r.name, '/orders');

  return v_pid;
end $$;


--
-- Name: add_project_file(uuid, uuid, text, text, bigint, text, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_project_file(p_project_id uuid, p_owner_id uuid, p_filename text, p_disk_path text, p_file_size bigint, p_mime_type text, p_is_public boolean, p_public_url text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.project_files
    (project_id, owner_id, filename, disk_path, file_size, mime_type, is_public, public_url)
  VALUES
    (p_project_id, p_owner_id, p_filename, p_disk_path, p_file_size, p_mime_type, p_is_public, p_public_url)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


--
-- Name: admin_delete_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_delete_user(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_target_email TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can delete users';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete yourself';
  END IF;

  SELECT email INTO v_target_email FROM public.profiles WHERE id = p_user_id;

  DELETE FROM public.transactions WHERE owner_id = p_user_id;
  DELETE FROM public.project_members WHERE user_id = p_user_id;
  DELETE FROM public.projects WHERE owner_id = p_user_id;
  DELETE FROM public.profiles WHERE id = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;

  PERFORM public.log_activity('user_deleted', p_user_id, v_target_email, NULL);
END;
$$;


--
-- Name: admin_finalize_new_user(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_finalize_new_user(p_user_id uuid, p_role text, p_name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_email text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_role not in ('client','employee') then raise exception 'bad_role'; end if;
  if p_user_id is null then raise exception 'no_user'; end if;

  update public.profiles
     set approved = true,
         name = coalesce(nullif(p_name, ''), name)
   where id = p_user_id;
  if not found then raise exception 'profile_not_found'; end if;

  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles (user_id, role) values (p_user_id, p_role);

  select email into v_email from public.profiles where id = p_user_id;
  perform public.log_activity('user_created_by_admin', p_user_id, v_email, null);
end $$;


--
-- Name: admin_list_role_requests(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_role_requests() RETURNS TABLE(user_id uuid, requested_role text, is_access_request boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select id, requested_role, access_requested
    from public.profiles
   where requested_role is not null
     and (access_requested = true or coalesce(approved, false) = false)
     and public.is_admin();
$$;


--
-- Name: admin_list_users(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_users() RETURNS TABLE(id uuid, email text, name text, role text, approved boolean, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, projects_count bigint, transactions_count bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can list users';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.name,
    p.role,
    p.approved,
    p.created_at,
    p.last_sign_in_at,
    (SELECT COUNT(*) FROM public.projects WHERE owner_id = p.id) AS projects_count,
    (SELECT COUNT(*) FROM public.transactions WHERE owner_id = p.id) AS transactions_count
  FROM public.profiles p
  ORDER BY p.created_at DESC;
END;
$$;


--
-- Name: admin_reset_password(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_reset_password(p_user_id uuid, p_new_password text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions', 'pg_temp'
    AS $_$
DECLARE
  v_target_email text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can reset passwords';
  END IF;

  IF p_new_password IS NULL OR length(p_new_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  SELECT email INTO v_target_email FROM public.profiles WHERE id = p_user_id;
  IF v_target_email IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- bcrypt ($2a$, cost 10 — как у GoTrue по умолчанию); GoTrue читает любой валидный bcrypt
  UPDATE auth.users
  SET encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
      updated_at = now()
  WHERE id = p_user_id;

  -- В журнал — только факт сброса, без пароля
  PERFORM public.log_activity('password_reset_by_admin', p_user_id, v_target_email, NULL);
END;
$_$;


--
-- Name: admin_system_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_system_stats() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can view system stats';
  END IF;

  SELECT jsonb_build_object(
    'users_total', (SELECT COUNT(*) FROM public.profiles),
    'users_approved', (SELECT COUNT(*) FROM public.profiles WHERE approved = true),
    'users_pending', (SELECT COUNT(*) FROM public.profiles WHERE approved = false),
    'projects_total', (SELECT COUNT(*) FROM public.projects),
    'projects_active', (SELECT COUNT(*) FROM public.projects WHERE stage NOT IN ('Оплачен', 'Архив')),
    'projects_archived', (SELECT COUNT(*) FROM public.projects WHERE stage = 'Архив'),
    'portfolio_total', (SELECT COALESCE(SUM(contract_sum), 0) FROM public.projects WHERE stage != 'Архив'),
    'portfolio_paid', (SELECT COALESCE(SUM(paid_amount), 0) FROM public.projects WHERE stage != 'Архив'),
    'transactions_total', (SELECT COUNT(*) FROM public.transactions),
    'income_total', (SELECT COALESCE(SUM(amount), 0) FROM public.transactions WHERE type = 'income'),
    'expense_total', (SELECT COALESCE(SUM(amount), 0) FROM public.transactions WHERE type = 'expense')
  ) INTO v_result;

  RETURN v_result;
END;
$$;


--
-- Name: admin_update_user(uuid, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_user(p_user_id uuid, p_approved boolean DEFAULT NULL::boolean, p_role text DEFAULT NULL::text, p_name text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_target_email TEXT;
  v_old_approved BOOLEAN;
  v_old_role TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can update users';
  END IF;

  SELECT email, approved, role
    INTO v_target_email, v_old_approved, v_old_role
    FROM public.profiles WHERE id = p_user_id;

  UPDATE public.profiles
  SET
    approved = COALESCE(p_approved, approved),
    role = COALESCE(p_role, role),
    name = COALESCE(p_name, name)
  WHERE id = p_user_id;

  -- Логирование изменений
  IF p_approved IS NOT NULL AND p_approved <> v_old_approved THEN
    PERFORM public.log_activity(
      CASE WHEN p_approved THEN 'user_approved' ELSE 'user_revoked' END,
      p_user_id, v_target_email, NULL
    );
  END IF;

  IF p_role IS NOT NULL AND p_role <> v_old_role THEN
    PERFORM public.log_activity(
      'role_changed',
      p_user_id, v_target_email,
      jsonb_build_object('from', v_old_role, 'to', p_role)
    );
  END IF;
END;
$$;


--
-- Name: am_i_client(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.am_i_client() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (select 1 from public.clients where user_id = auth.uid());
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: task_tz_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_tz_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    version_no integer NOT NULL,
    content text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    proposed_by uuid NOT NULL,
    resolved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT task_tz_versions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: approve_tz_version(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_tz_version(p_version_id uuid) RETURNS public.task_tz_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v        public.task_tz_versions%ROWTYPE;
  t        public.project_tasks%ROWTYPE;
  v_caller uuid := auth.uid();
  v_row    public.task_tz_versions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.task_tz_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'version_not_found'; END IF;
  IF v.status <> 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;

  SELECT * INTO t FROM public.project_tasks WHERE id = v.task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'task_not_found'; END IF;
  IF NOT public.can_access_task(v.task_id) THEN RAISE EXCEPTION 'access_denied'; END IF;

  -- апрувит противоположная сторона: одна из сторон задачи, но НЕ предложивший
  IF v_caller = v.proposed_by THEN RAISE EXCEPTION 'proposer_cannot_approve'; END IF;
  IF NOT (t.author_id = v_caller OR t.assigned_to = v_caller) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.task_tz_versions
     SET status = 'approved', resolved_by = v_caller, resolved_at = now()
   WHERE id = p_version_id
  RETURNING * INTO v_row;

  UPDATE public.project_tasks SET description = (SELECT content FROM public.task_tz_versions WHERE task_id = v_row.task_id AND status='approved' ORDER BY version_no DESC LIMIT 1) WHERE id = v_row.task_id;

  RETURN v_row;
END $$;


--
-- Name: can_access_project_comments(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_project_comments(p_project_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.projects
    where id = p_project_id
      and (
        owner_id = auth.uid()
        or public.is_admin()
        or (visibility = 'team' and public.is_project_member(p_project_id))
        or (visibility = 'marketplace' and public.is_employee())  -- было is_approved()
        or public.is_project_client(p_project_id)
      )
  );
$$;


--
-- Name: can_access_task(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_task(p_task_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_tasks t
    WHERE t.id = p_task_id
      AND (
        (t.project_id IS NOT NULL AND public.can_access_project_comments(t.project_id))
        OR (t.project_id IS NULL AND (t.author_id = auth.uid() OR t.assigned_to = auth.uid() OR public.is_admin()))
      )
  );
$$;


--
-- Name: client_set_task_status(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_set_task_status(p_task_id uuid, p_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  t public.project_tasks%ROWTYPE;
begin
  select * into t from public.project_tasks where id = p_task_id;
  if not found then raise exception 'task_not_found'; end if;
  if t.project_id is null or not public.is_project_client(t.project_id) then
    raise exception 'forbidden';
  end if;
  -- разрешённые переходы приёмки
  if not (
       (t.status = 'На проверке' and p_status in ('Готово','В работе'))
    or (t.status = 'Готово'      and p_status = 'В работе')
  ) then
    raise exception 'illegal_transition: % -> %', t.status, p_status;
  end if;
  update public.project_tasks set status = p_status where id = p_task_id;
end $$;


--
-- Name: client_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_stats(p_client_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_owner UUID;
  v_result JSONB;
BEGIN
  SELECT owner_id INTO v_owner FROM public.clients WHERE id = p_client_id;
  IF v_owner != auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'projects_count', COUNT(*),
    'projects_active', COUNT(*) FILTER (WHERE stage NOT IN ('Оплачен', 'Архив')),
    'total_contract', COALESCE(SUM(contract_sum), 0),
    'total_paid', COALESCE(SUM(paid_amount), 0),
    'last_project_date', MAX(GREATEST(start_date, deadline)::TIMESTAMPTZ)
  ) INTO v_result
  FROM public.projects
  WHERE client_id = p_client_id;

  RETURN v_result;
END;
$$;


--
-- Name: create_project_request(text, text, date, text, text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_project_request(p_name text, p_description text, p_deadline date, p_mode text, p_assignment_mode text, p_desired_executor_id uuid DEFAULT NULL::uuid, p_client_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_client uuid;
  v_req uuid;
begin
  if not public.am_i_client() then raise exception 'not_client'; end if;
  if p_mode not in ('quick','detailed') then raise exception 'bad_mode'; end if;
  if p_assignment_mode not in ('marketplace','assignee') then raise exception 'bad_assignment_mode'; end if;

  -- client_id: переданный (если принадлежит заказчику) или единственная запись заказчика
  v_client := coalesce(
    (select c.id from public.clients c where c.id = p_client_id and c.user_id = auth.uid()),
    (select c.id from public.clients c where c.user_id = auth.uid() order by c.created_at limit 1)
  );
  if v_client is null then raise exception 'no_client_record'; end if;

  -- assignee: исполнитель обязателен и должен быть в списке доступных
  if p_assignment_mode = 'assignee' then
    if p_desired_executor_id is null
       or not exists (select 1 from public.list_available_executors() e where e.id = p_desired_executor_id) then
      raise exception 'invalid_executor';
    end if;
  end if;

  insert into public.project_requests
    (client_id, created_by, name, description, desired_deadline, mode, assignment_mode, desired_executor_id)
  values (v_client, auth.uid(), p_name, p_description, p_deadline, p_mode, p_assignment_mode,
          case when p_assignment_mode='assignee' then p_desired_executor_id else null end)
  returning id into v_req;

  -- in-app уведомление сотрудникам. Схема notifications: user_id/type/title/body/url (все NOT NULL).
  insert into public.notifications (user_id, type, title, body, url)
  select ur.user_id, 'project_request', 'Новая заявка от заказчика', p_name, '/requests'
  from public.user_roles ur where ur.role = 'employee';

  return v_req;
end $$;


--
-- Name: delete_project_comment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_project_comment(p_comment_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM public.project_comments WHERE id = p_comment_id AND author_id = auth.uid())
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Access denied: only comment author or admin can delete';
  END IF;

  DELETE FROM public.project_comments WHERE id = p_comment_id;
END;
$$;


--
-- Name: delete_project_file_record(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_project_file_record(p_file_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_disk_path TEXT;
BEGIN
  SELECT disk_path INTO v_disk_path
  FROM public.project_files WHERE id = p_file_id;

  IF v_disk_path IS NULL THEN
    RAISE EXCEPTION 'File not found';
  END IF;

  -- Проверка прав
  IF NOT (
    EXISTS (SELECT 1 FROM public.project_files
            WHERE id = p_file_id AND owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.project_files f
               JOIN public.projects p ON p.id = f.project_id
               WHERE f.id = p_file_id AND p.owner_id = auth.uid())
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  DELETE FROM public.project_files WHERE id = p_file_id;

  RETURN v_disk_path;
END;
$$;


--
-- Name: generate_telegram_link_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_telegram_link_code() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_code TEXT;
BEGIN
  IF NOT public.is_approved() THEN
    RAISE EXCEPTION 'Only approved users can generate link codes';
  END IF;

  -- Генерируем 8 символов из base64url-алфавита, убираем спецсимволы
  v_code := upper(substring(
    translate(encode(gen_random_bytes(6), 'base64'), '+/=', ''),
    1, 8
  ));

  -- Гарантируем уникальность (крайне маловероятно столкновение, но проверим)
  WHILE EXISTS (SELECT 1 FROM public.telegram_link_codes WHERE code = v_code) LOOP
    v_code := upper(substring(
      translate(encode(gen_random_bytes(6), 'base64'), '+/=', ''),
      1, 8
    ));
  END LOOP;

  -- Вставляем или обновляем (один пользователь — один код)
  INSERT INTO public.telegram_link_codes (user_id, code, expires_at)
  VALUES (auth.uid(), v_code, NOW() + INTERVAL '10 minutes')
  ON CONFLICT (user_id) DO UPDATE
    SET code       = EXCLUDED.code,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW();

  RETURN v_code;
END;
$$;


--
-- Name: get_my_client_projects(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_client_projects() RETURNS TABLE(id uuid, name text, stage text, start_date date, deadline date, contract_sum numeric, paid_amount numeric, executor text, visibility text, open_task_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select p.id, p.name, p.stage, p.start_date, p.deadline,
         p.contract_sum, p.paid_amount, p.executor, p.visibility,
         (select count(*)::int from public.project_tasks t
          where t.project_id = p.id and t.status not in ('Готово','Отменена')) as open_task_count
  from public.projects p
  join public.clients c on c.id = p.client_id
  where c.user_id = auth.uid()
  order by p.created_at desc;
$$;


--
-- Name: get_my_project_payments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_project_payments() RETURNS TABLE(project_id uuid, project_name text, paid_on date, amount numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select pp.project_id, p.name, pp.paid_on, pp.amount
  from public.project_payments pp
  join public.projects p on p.id = pp.project_id
  join public.clients   c on c.id = p.client_id
  where c.user_id = auth.uid()
  order by pp.paid_on desc;
$$;


--
-- Name: get_my_roles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_roles() RETURNS TABLE(role text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select role from public.user_roles where user_id = auth.uid();
$$;


--
-- Name: get_my_shares(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_shares() RETURNS TABLE(project_name text, my_amount numeric, my_received numeric, my_receivable numeric)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    actor_email text,
    action text NOT NULL,
    target_id uuid,
    target_email text,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    project_id uuid,
    is_financial boolean DEFAULT false NOT NULL
);


--
-- Name: get_project_activity(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_project_activity(p_project_id uuid, p_limit integer DEFAULT 100) RETURNS SETOF public.activity_log
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_is_owner boolean; v_can boolean;
begin
  select (owner_id = auth.uid()) into v_is_owner from public.projects where id = p_project_id;
  v_can := coalesce(v_is_owner, false)
    or public.is_admin()
    or exists (select 1 from public.projects p
               where p.id = p_project_id and p.visibility = 'team' and public.is_project_member(p_project_id))
    or exists (select 1 from public.projects p
               where p.id = p_project_id and p.visibility = 'marketplace' and public.is_approved());
  if not v_can then
    return;  -- нет доступа к проекту → пустой результат
  end if;
  return query
    select a.* from public.activity_log a
    where a.project_id = p_project_id
      and (a.is_financial = false or coalesce(v_is_owner, false) or public.is_admin())
    order by a.created_at desc
    limit p_limit;
end; $$;


--
-- Name: get_project_comments(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_project_comments(p_project_id uuid) RETURNS TABLE(id uuid, project_id uuid, author_id uuid, author_name text, author_email text, content text, resolved boolean, resolved_at timestamp with time zone, resolved_by uuid, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN
  -- Проверяем доступ к проекту
  IF NOT public.can_access_project_comments(p_project_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.project_id,
    c.author_id,
    COALESCE(p.name, p.email, 'Пользователь') AS author_name,
    COALESCE(p.email, '')                       AS author_email,
    c.content,
    c.resolved,
    c.resolved_at,
    c.resolved_by,
    c.created_at
  FROM public.project_comments c
  LEFT JOIN public.profiles p ON p.id = c.author_id
  WHERE c.project_id = p_project_id
  ORDER BY c.created_at ASC;
END;
$$;


--
-- Name: get_project_files(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_project_files(p_project_id uuid) RETURNS TABLE(id uuid, project_id uuid, owner_id uuid, uploader_name text, filename text, disk_path text, file_size bigint, mime_type text, is_public boolean, public_url text, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF NOT public.can_access_project_comments(p_project_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    f.id,
    f.project_id,
    f.owner_id,
    COALESCE(p.name, p.email, 'Пользователь') AS uploader_name,
    f.filename,
    f.disk_path,
    f.file_size,
    f.mime_type,
    f.is_public,
    f.public_url,
    f.created_at
  FROM public.project_files f
  LEFT JOIN public.profiles p ON p.id = f.owner_id
  WHERE f.project_id = p_project_id
  ORDER BY f.created_at DESC;
END;
$$;


--
-- Name: get_project_members(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_project_members(p_project_id uuid) RETURNS TABLE(user_id uuid, email text, name text, member_role text, added_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF NOT (
    public.is_project_owner(p_project_id)
    OR public.is_project_member(p_project_id)
    OR public.is_admin()
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    pm.user_id,
    p.email,
    p.name,
    pm.role AS member_role,
    pm.added_at
  FROM public.project_members pm
  LEFT JOIN public.profiles p ON p.id = pm.user_id
  WHERE pm.project_id = p_project_id
  ORDER BY pm.added_at;
END;
$$;


--
-- Name: get_project_storage_used(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_project_storage_used(p_project_id uuid) RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT COALESCE(SUM(file_size), 0)
  FROM public.project_files
  WHERE project_id = p_project_id;
$$;


--
-- Name: get_project_visibility_users(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_project_visibility_users(p_project_id uuid) RETURNS TABLE(user_id uuid, email text, name text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN
  IF NOT (public.is_project_owner(p_project_id) OR public.is_admin()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.email, p.name
  FROM public.project_visibility pv
  JOIN public.profiles p ON p.id = pv.user_id
  WHERE pv.project_id = p_project_id
  ORDER BY pv.added_at;
END;
$$;


--
-- Name: get_task_comments(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_task_comments(p_task_id uuid) RETURNS TABLE(id uuid, task_id uuid, author_id uuid, author_name text, body text, is_question boolean, resolved boolean, resolved_by uuid, resolved_by_name text, resolved_at timestamp with time zone, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.can_access_task(p_task_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  RETURN QUERY
  SELECT c.id, c.task_id, c.author_id, COALESCE(pa.name, pa.email, 'Пользователь'),
         c.body, c.is_question, c.resolved,
         c.resolved_by, COALESCE(pr.name, pr.email),
         c.resolved_at, c.created_at
  FROM public.task_comments c
  LEFT JOIN public.profiles pa ON pa.id = c.author_id
  LEFT JOIN public.profiles pr ON pr.id = c.resolved_by
  WHERE c.task_id = p_task_id
  ORDER BY c.created_at;
END $$;


--
-- Name: get_task_versions(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_task_versions(p_task_id uuid) RETURNS TABLE(id uuid, task_id uuid, version_no integer, content text, status text, proposed_by uuid, proposed_by_name text, resolved_by uuid, resolved_by_name text, created_at timestamp with time zone, resolved_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.can_access_task(p_task_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;
  RETURN QUERY
  SELECT v.id, v.task_id, v.version_no, v.content, v.status,
         v.proposed_by, COALESCE(pp.name, pp.email, 'Пользователь'),
         v.resolved_by, COALESCE(pr.name, pr.email),
         v.created_at, v.resolved_at
  FROM public.task_tz_versions v
  LEFT JOIN public.profiles pp ON pp.id = v.proposed_by
  LEFT JOIN public.profiles pr ON pr.id = v.resolved_by
  WHERE v.task_id = p_task_id
  ORDER BY v.version_no;
END $$;


--
-- Name: get_tasks(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_tasks(p_project_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_assigned_to uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, project_id uuid, project_name text, author_id uuid, author_name text, assigned_to uuid, assignee_name text, title text, description text, status text, priority text, due_date date, sort_order integer, created_at timestamp with time zone, updated_at timestamp with time zone, has_open_question boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.project_id, pr.name,
         t.author_id, COALESCE(pa.name, pa.email, 'Пользователь'),
         t.assigned_to, COALESCE(pas.name, pas.email),
         t.title, t.description, t.status, t.priority,
         t.due_date, t.sort_order, t.created_at, t.updated_at,
         EXISTS (SELECT 1 FROM public.task_comments c
                 WHERE c.task_id = t.id AND c.is_question AND NOT c.resolved)
  FROM public.project_tasks t
  LEFT JOIN public.projects pr  ON pr.id  = t.project_id
  LEFT JOIN public.profiles pa  ON pa.id  = t.author_id
  LEFT JOIN public.profiles pas ON pas.id = t.assigned_to
  WHERE
    (
      (t.project_id IS NOT NULL AND public.can_access_project_comments(t.project_id))
      OR (t.project_id IS NULL AND (t.author_id = auth.uid() OR t.assigned_to = auth.uid() OR public.is_admin()))
    )
    AND (p_project_id  IS NULL OR t.project_id  = p_project_id)
    AND (p_status      IS NULL OR t.status      = p_status)
    AND (p_assigned_to IS NULL OR t.assigned_to = p_assigned_to)
  ORDER BY
    CASE t.status WHEN 'Новая' THEN 1 WHEN 'В работе' THEN 2
                  WHEN 'На проверке' THEN 3 WHEN 'Готово' THEN 4 ELSE 5 END,
    t.sort_order, t.created_at DESC;
END $$;


--
-- Name: get_user_notification_prefs(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_notification_prefs(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'telegram_chat_id',    telegram_chat_id,
    'notif_project_taken', notif_project_taken,
    'notif_team_invite',   notif_team_invite,
    'notif_comment',       notif_comment,
    'notif_deadline',      notif_deadline,
    'name',                COALESCE(name, email)
  ) INTO v_result
  FROM public.profiles
  WHERE id = p_user_id;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  is_first_user boolean;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles LIMIT 1) INTO is_first_user;

  INSERT INTO public.profiles (id, email, role, approved)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN is_first_user THEN 'admin' ELSE 'user' END,
    is_first_user
  );

  RETURN NEW;
END;
$$;


--
-- Name: handle_new_user_meta(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user_meta() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: has_role(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(p_uid uuid, p_role text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (select 1 from public.user_roles where user_id = p_uid and role = p_role);
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND approved = true
  );
$$;


--
-- Name: is_approved(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_approved() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND approved = true
  );
$$;


--
-- Name: is_employee(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_employee() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select public.is_approved()
     and exists (select 1 from public.user_roles
                 where user_id = auth.uid() and role = 'employee');
$$;


--
-- Name: is_in_project_visibility(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_in_project_visibility(p_project_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_visibility
    WHERE project_id = p_project_id AND user_id = auth.uid()
  );
$$;


--
-- Name: is_my_client_record(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_my_client_record(p_client_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (select 1 from public.clients where id = p_client_id and user_id = auth.uid());
$$;


--
-- Name: is_project_client(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_project_client(p_project_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.projects p
    join public.clients c on c.id = p.client_id
    where p.id = p_project_id and c.user_id = auth.uid()
  );
$$;


--
-- Name: is_project_editor(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_project_editor(project_id_to_check uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = project_id_to_check
      AND user_id = auth.uid()
      AND role = 'editor'
  );
$$;


--
-- Name: is_project_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_project_member(project_id_to_check uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = project_id_to_check
      AND user_id = auth.uid()
  );
$$;


--
-- Name: is_project_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_project_owner(project_id_to_check uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = project_id_to_check
      AND owner_id = auth.uid()
  );
$$;


--
-- Name: link_telegram_chat(text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_telegram_chat(p_code text, p_chat_id bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_user_id UUID;
  v_email   TEXT;
BEGIN
  -- Ищем действующий код (не истёкший)
  SELECT user_id INTO v_user_id
  FROM public.telegram_link_codes
  WHERE code = upper(trim(p_code))
    AND expires_at > NOW();

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'invalid_or_expired_code');
  END IF;

  -- Привязываем chat_id
  UPDATE public.profiles
  SET telegram_chat_id = p_chat_id
  WHERE id = v_user_id
  RETURNING email INTO v_email;

  -- Удаляем использованный код
  DELETE FROM public.telegram_link_codes WHERE user_id = v_user_id;

  RETURN jsonb_build_object('ok', TRUE, 'email', v_email);
END;
$$;


--
-- Name: list_available_executors(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_available_executors() RETURNS TABLE(id uuid, name text, "position" text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select p.id,
         coalesce(nullif(p.name, ''), nullif(p.username, ''), p.email) as name,
         p.position
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id and ur.role = 'employee'
  where p.approved = true and p.id <> auth.uid()
  order by 2;
$$;


--
-- Name: log_activity(text, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_activity(p_action text, p_target_id uuid DEFAULT NULL::uuid, p_target_email text DEFAULT NULL::text, p_details jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_actor_id uuid; v_actor_email text; v_log_id uuid;
begin
  v_actor_id := auth.uid();
  select email into v_actor_email from public.profiles where id = v_actor_id;
  insert into public.activity_log (actor_id, actor_email, action, target_id, target_email, details)
  values (v_actor_id, v_actor_email, p_action, p_target_id, p_target_email, p_details)
  returning id into v_log_id;
  return v_log_id;
end; $$;


--
-- Name: log_activity_ext(text, uuid, boolean, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_activity_ext(p_action text, p_project_id uuid, p_is_financial boolean, p_target_id uuid DEFAULT NULL::uuid, p_target_email text DEFAULT NULL::text, p_details jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_actor uuid; v_email text; v_id uuid;
begin
  v_actor := auth.uid();
  select email into v_email from public.profiles where id = v_actor;
  -- проект уже исчезает (каскад) → не ссылаемся на несуществующий id, иначе FK ломает DELETE
  if p_project_id is not null and not exists (select 1 from public.projects where id = p_project_id) then
    p_project_id := null;
  end if;
  insert into public.activity_log
    (actor_id, actor_email, action, project_id, is_financial, target_id, target_email, details)
  values
    (v_actor, v_email, p_action, p_project_id, coalesce(p_is_financial,false), p_target_id, p_target_email, p_details)
  returning id into v_id;
  return v_id;
end; $$;


--
-- Name: notify_comment_telegram(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_comment_telegram() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- TODO (сессия 4): вызвать Edge Function с уведомлением в Telegram
  -- Здесь будет: PERFORM net.http_post(...) или pg_net вызов
  RETURN NEW;
END;
$$;


--
-- Name: propose_tz_version(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.propose_tz_version(p_task_id uuid, p_content text) RETURNS public.task_tz_versions
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  t public.project_tasks%ROWTYPE;
  v_caller uuid := auth.uid();
  v_is_party boolean; v_can_edit boolean;
  v_next_no int; v_status text; v_resolved uuid; v_resolved_at timestamptz;
  v_row public.task_tz_versions%ROWTYPE;
begin
  if not public.is_approved() then raise exception 'not_approved'; end if;
  select * into t from public.project_tasks where id = p_task_id;
  if not found then raise exception 'task_not_found'; end if;
  if not public.can_access_task(p_task_id) then raise exception 'access_denied'; end if;

  v_is_party := (t.author_id = v_caller or t.assigned_to = v_caller);
  v_can_edit := public.is_admin()
                or (t.project_id is not null and public.is_project_editor(t.project_id))
                or (t.project_id is not null and public.is_project_client(t.project_id)); -- B-1

  if not (v_is_party or v_can_edit) then raise exception 'forbidden'; end if;

  if exists (select 1 from public.task_tz_versions where task_id = p_task_id and status = 'pending') then
    raise exception 'tz_pending_exists';
  end if;

  if t.assigned_to is not null and v_is_party then
    v_status := 'pending'; v_resolved := null; v_resolved_at := null;
  else
    v_status := 'approved'; v_resolved := v_caller; v_resolved_at := now();
  end if;

  select coalesce(max(version_no),0)+1 into v_next_no from public.task_tz_versions where task_id = p_task_id;
  insert into public.task_tz_versions (task_id, version_no, content, status, proposed_by, resolved_by, resolved_at)
  values (p_task_id, v_next_no, p_content, v_status, v_caller, v_resolved, v_resolved_at)
  returning * into v_row;
  if v_status = 'approved' then
    update public.project_tasks set description = p_content where id = p_task_id;
  end if;
  return v_row;
end $$;


--
-- Name: recalc_project_paid_amount(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recalc_project_paid_amount() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare pid uuid;
begin
  pid := coalesce(new.project_id, old.project_id);
  update public.projects
     set paid_amount = (select coalesce(sum(amount), 0) from public.project_payments where project_id = pid)
   where id = pid;
  -- UPDATE мог сменить project_id — пересчитать и прежний проект
  if (tg_op = 'UPDATE' and new.project_id is distinct from old.project_id) then
    update public.projects
       set paid_amount = (select coalesce(sum(amount), 0) from public.project_payments where project_id = old.project_id)
     where id = old.project_id;
  end if;
  return null;
end; $$;


--
-- Name: reject_project_request(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_project_request(p_request_id uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare r public.project_requests%ROWTYPE;
begin
  if not (public.is_employee() or public.is_admin()) then raise exception 'forbidden'; end if;
  select * into r from public.project_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if r.status <> 'Новая' then raise exception 'already_processed'; end if;
  update public.project_requests set status = 'Отклонена' where id = p_request_id;
  insert into public.notifications (user_id, type, title, body, url)
  values (r.created_by, 'project_request', 'Заявка отклонена', coalesce(p_reason, r.name), '/orders');
end $$;


--
-- Name: reject_tz_version(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_tz_version(p_version_id uuid) RETURNS public.task_tz_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v        public.task_tz_versions%ROWTYPE;
  t        public.project_tasks%ROWTYPE;
  v_caller uuid := auth.uid();
  v_row    public.task_tz_versions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.task_tz_versions WHERE id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'version_not_found'; END IF;
  IF v.status <> 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;

  SELECT * INTO t FROM public.project_tasks WHERE id = v.task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'task_not_found'; END IF;
  IF NOT public.can_access_task(v.task_id) THEN RAISE EXCEPTION 'access_denied'; END IF;

  IF v_caller = v.proposed_by THEN RAISE EXCEPTION 'proposer_cannot_reject'; END IF;
  IF NOT (t.author_id = v_caller OR t.assigned_to = v_caller) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.task_tz_versions
     SET status = 'rejected', resolved_by = v_caller, resolved_at = now()
   WHERE id = p_version_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;


--
-- Name: release_project(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_project(p_project_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_rows_updated INTEGER;
BEGIN
  UPDATE public.projects
  SET taken_by = NULL,
      stage    = 'Поиск исполнителя'
  WHERE id       = p_project_id
    AND taken_by = auth.uid();

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION 'You are not the executor of this project';
  END IF;

  -- Убираем исполнителя из команды
  DELETE FROM public.project_members
  WHERE project_id = p_project_id AND user_id = auth.uid();
END;
$$;


--
-- Name: request_full_access(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_full_access(p_role text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if p_role not in ('employee','client') then
    raise exception 'bad_role';
  end if;
  update public.profiles
     set access_requested = true, requested_role = p_role
   where id = auth.uid();
  insert into public.notifications (user_id, type, title, body, url)
    select a.id, 'access_request', 'Заявка на доступ',
           coalesce((select name from public.profiles where id = auth.uid()), 'Посетитель')
             || ' просит доступ как ' || case p_role when 'employee' then 'сотрудник' else 'заказчик' end,
           '/'
      from public.profiles a
     where a.role = 'admin';
end;
$$;


--
-- Name: resolve_project_comment(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_project_comment(p_comment_id uuid, p_resolved boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_project_id UUID;
BEGIN
  SELECT project_id INTO v_project_id
  FROM public.project_comments WHERE id = p_comment_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Comment not found';
  END IF;

  -- Только автор, владелец проекта или admin
  IF NOT (
    EXISTS (SELECT 1 FROM public.project_comments WHERE id = p_comment_id AND author_id = auth.uid())
    OR public.is_project_owner(v_project_id)
    OR public.is_admin()
  ) THEN
    RAISE EXCEPTION 'Access denied: only comment author, project owner or admin can resolve';
  END IF;

  UPDATE public.project_comments
  SET
    resolved    = p_resolved,
    resolved_at = CASE WHEN p_resolved THEN NOW() ELSE NULL END,
    resolved_by = CASE WHEN p_resolved THEN auth.uid() ELSE NULL END
  WHERE id = p_comment_id;
END;
$$;


--
-- Name: task_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    is_question boolean DEFAULT false NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: resolve_question(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_question(p_comment_id uuid, p_resolved boolean) RETURNS public.task_comments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  c        public.task_comments%ROWTYPE;
  t        public.project_tasks%ROWTYPE;
  v_caller uuid := auth.uid();
  v_row    public.task_comments%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.task_comments WHERE id = p_comment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'comment_not_found'; END IF;
  IF NOT c.is_question THEN RAISE EXCEPTION 'not_a_question'; END IF;

  SELECT * INTO t FROM public.project_tasks WHERE id = c.task_id;
  IF NOT public.can_access_task(c.task_id) THEN RAISE EXCEPTION 'access_denied'; END IF;

  IF NOT (t.author_id = v_caller OR t.assigned_to = v_caller OR public.is_admin()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.task_comments
     SET resolved    = p_resolved,
         resolved_by = CASE WHEN p_resolved THEN v_caller ELSE NULL END,
         resolved_at = CASE WHEN p_resolved THEN now()    ELSE NULL END
   WHERE id = p_comment_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;


--
-- Name: revoke_project(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_project(p_project_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_taken_by     UUID;
  v_rows_updated INTEGER;
BEGIN
  IF NOT (public.is_project_owner(p_project_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Only the project owner or admin can revoke';
  END IF;

  SELECT taken_by INTO v_taken_by
  FROM public.projects WHERE id = p_project_id;

  IF v_taken_by IS NULL THEN
    RAISE EXCEPTION 'Project has no executor';
  END IF;

  UPDATE public.projects
  SET taken_by = NULL,
      stage    = 'Поиск исполнителя'
  WHERE id = p_project_id;

  -- Убираем бывшего исполнителя из команды
  DELETE FROM public.project_members
  WHERE project_id = p_project_id AND user_id = v_taken_by;
END;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: search_approved_users(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_approved_users(p_query text) RETURNS TABLE(id uuid, email text, name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT id, email, name
  FROM public.profiles
  WHERE approved = true
    AND id != auth.uid()
    AND (
      p_query IS NULL OR p_query = ''
      OR email ILIKE '%' || p_query || '%'
      OR COALESCE(name, '') ILIKE '%' || p_query || '%'
    )
  ORDER BY name NULLS LAST, email
  LIMIT 20;
$$;


--
-- Name: search_clients(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_clients(p_query text) RETURNS TABLE(id uuid, name text, phone text, email text, telegram text, client_type text, legal_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT id, name, phone, email, telegram, client_type, legal_name
  FROM public.clients
  WHERE owner_id = auth.uid()
    AND (
      p_query IS NULL OR p_query = ''
      OR name ILIKE '%' || p_query || '%'
      OR COALESCE(legal_name, '') ILIKE '%' || p_query || '%'
    )
  ORDER BY name
  LIMIT 10;
$$;


--
-- Name: set_client_user(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_client_user(p_client_id uuid, p_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: set_project_payments(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_project_payments(p_project_id uuid, p_rows jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_old jsonb; v_new jsonb; r record;
begin
  if not exists (select 1 from public.projects where id = p_project_id and owner_id = auth.uid()) then
    raise exception 'not project owner';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('amount', amount::text, 'paid_on', paid_on::text)), '[]'::jsonb)
    into v_old from public.project_payments where project_id = p_project_id;
  delete from public.project_payments where project_id = p_project_id;
  insert into public.project_payments (project_id, amount, paid_on, note, created_by)
  select p_project_id, (je->>'amount')::numeric, (je->>'paid_on')::date, nullif(je->>'note',''), auth.uid()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) je
  where (je->>'amount') is not null and (je->>'amount')::numeric > 0 and (je->>'paid_on') is not null;
  select coalesce(jsonb_agg(jsonb_build_object('amount', amount::text, 'paid_on', paid_on::text)), '[]'::jsonb)
    into v_new from public.project_payments where project_id = p_project_id;
  -- added = new \ old
  for r in
    select e.value as v from jsonb_array_elements(v_new) e
    except all
    select e.value as v from jsonb_array_elements(v_old) e
  loop
    perform public.log_activity_ext('payment_added', p_project_id, true, null, null, r.v);
  end loop;
  -- removed = old \ new
  for r in
    select e.value as v from jsonb_array_elements(v_old) e
    except all
    select e.value as v from jsonb_array_elements(v_new) e
  loop
    perform public.log_activity_ext('payment_removed', p_project_id, true, null, null, r.v);
  end loop;
end; $$;


--
-- Name: set_project_shares(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_project_shares(p_project_id uuid, p_rows jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare r record;
begin
  if not exists (select 1 from public.projects where id = p_project_id and owner_id = auth.uid()) then
    raise exception 'not_project_owner';
  end if;
  drop table if exists _old_shares;
  create temp table _old_shares on commit drop as
    select participant_user_id, participant_client_id, participant_name, participant_label, share_kind, share_value
    from public.project_shares where project_id = p_project_id;

  delete from public.project_shares where project_id = p_project_id;
  insert into public.project_shares
    (project_id, participant_user_id, participant_client_id, participant_name, participant_label, share_kind, share_value)
  select p_project_id,
    nullif(je->>'participant_user_id','')::uuid, nullif(je->>'participant_client_id','')::uuid,
    nullif(je->>'participant_name',''), nullif(je->>'participant_label',''),
    je->>'share_kind', (je->>'share_value')::numeric
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as je;

  -- added: участник появился (ключ = coalesce user/client/name)
  for r in
    select n.participant_label as label, n.share_kind, n.share_value
    from public.project_shares n
    where n.project_id = p_project_id and not exists (
      select 1 from _old_shares o where
        coalesce(o.participant_user_id::text,o.participant_client_id::text,o.participant_name)
      = coalesce(n.participant_user_id::text,n.participant_client_id::text,n.participant_name))
  loop
    perform public.log_activity_ext('share_added', p_project_id, true, null, null,
      jsonb_build_object('label', r.label, 'kind', r.share_kind, 'value', r.share_value));
  end loop;
  -- removed: участник исчез
  for r in
    select o.participant_label as label, o.share_kind, o.share_value
    from _old_shares o where not exists (
      select 1 from public.project_shares n where n.project_id = p_project_id and
        coalesce(n.participant_user_id::text,n.participant_client_id::text,n.participant_name)
      = coalesce(o.participant_user_id::text,o.participant_client_id::text,o.participant_name))
  loop
    perform public.log_activity_ext('share_removed', p_project_id, true, null, null,
      jsonb_build_object('label', r.label, 'kind', r.share_kind, 'value', r.share_value));
  end loop;
  -- changed: тот же участник, но kind/value отличается
  for r in
    select n.participant_label as label, o.share_kind as okind, o.share_value as oval,
           n.share_kind as nkind, n.share_value as nval
    from public.project_shares n join _old_shares o on
        coalesce(n.participant_user_id::text,n.participant_client_id::text,n.participant_name)
      = coalesce(o.participant_user_id::text,o.participant_client_id::text,o.participant_name)
    where n.project_id = p_project_id
      and (n.share_kind is distinct from o.share_kind or n.share_value is distinct from o.share_value)
  loop
    perform public.log_activity_ext('share_changed', p_project_id, true, null, null,
      jsonb_build_object('label', r.label, 'from_kind', r.okind, 'from_value', r.oval,
                         'to_kind', r.nkind, 'to_value', r.nval));
  end loop;
end; $$;


--
-- Name: set_project_visibility_users(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_project_visibility_users(p_project_id uuid, p_user_ids uuid[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF NOT (public.is_project_owner(p_project_id) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Only the owner can manage visibility';
  END IF;

  DELETE FROM public.project_visibility WHERE project_id = p_project_id;

  IF p_user_ids IS NOT NULL AND array_length(p_user_ids, 1) > 0 THEN
    INSERT INTO public.project_visibility(project_id, user_id)
    SELECT p_project_id, u
    FROM unnest(p_user_ids) AS u
    WHERE u IS NOT NULL;
  END IF;
END;
$$;


--
-- Name: project_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid,
    author_id uuid NOT NULL,
    assigned_to uuid,
    title text NOT NULL,
    description text,
    status text DEFAULT 'Новая'::text NOT NULL,
    priority text DEFAULT 'Обычный'::text NOT NULL,
    due_date date,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_tasks_priority_check CHECK ((priority = ANY (ARRAY['Низкий'::text, 'Обычный'::text, 'Высокий'::text]))),
    CONSTRAINT project_tasks_status_check CHECK ((status = ANY (ARRAY['Новая'::text, 'В работе'::text, 'На проверке'::text, 'Готово'::text, 'Отменена'::text])))
);


--
-- Name: set_task_status(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_task_status(p_task_id uuid, p_status text) RETURNS public.project_tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  t        public.project_tasks%ROWTYPE;
  v_caller uuid := auth.uid();
  v_row    public.project_tasks%ROWTYPE;
BEGIN
  IF p_status NOT IN ('Новая','В работе','На проверке','Готово','Отменена') THEN
    RAISE EXCEPTION 'bad_status';
  END IF;

  SELECT * INTO t FROM public.project_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'task_not_found'; END IF;
  IF NOT public.can_access_task(p_task_id) THEN RAISE EXCEPTION 'access_denied'; END IF;

  -- общее право на смену статуса = как UPDATE-политика project_tasks (6.4a)
  IF NOT (t.author_id = v_caller OR t.assigned_to = v_caller OR public.is_admin()
          OR (t.project_id IS NOT NULL AND public.is_project_editor(t.project_id))) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- переход в 'Готово' — только автор задачи
  IF p_status = 'Готово' AND t.author_id <> v_caller THEN
    RAISE EXCEPTION 'only_author_can_complete';
  END IF;

  UPDATE public.project_tasks SET status = p_status WHERE id = p_task_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;


--
-- Name: set_user_roles(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_user_roles(p_user_id uuid, p_roles text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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


--
-- Name: take_project(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.take_project(p_project_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_rows_updated INTEGER;
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  IF NOT public.is_approved() THEN
    RAISE EXCEPTION 'Only approved users can take projects';
  END IF;

  -- Отображаемое имя взявшего (как в клиентском fallback: имя, иначе e-mail)
  SELECT COALESCE(NULLIF(name, ''), email) INTO v_name
  FROM public.profiles WHERE id = v_uid;

  -- Проверка доступности и захват в одном UPDATE (атомарно против race condition).
  -- Назначаем взявшего исполнителем: добавляем в executors jsonb, если его там ещё нет.
  UPDATE public.projects
  SET taken_by  = v_uid,
      stage     = 'В работе',
      executors = CASE
                    WHEN executors @> jsonb_build_array(jsonb_build_object('userId', v_uid::text))
                      THEN executors
                    ELSE COALESCE(executors, '[]'::jsonb)
                         || jsonb_build_array(jsonb_build_object('name', COALESCE(v_name, ''), 'userId', v_uid::text))
                  END
  WHERE id          = p_project_id
    AND visibility  = 'marketplace'
    AND taken_by    IS NULL
    AND stage       = 'Поиск исполнителя'
    AND owner_id   != v_uid; -- нельзя взять собственный проект

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    RAISE EXCEPTION 'Project is not available: already taken, not in marketplace, wrong stage, or you are the owner';
  END IF;

  -- Текстовый executor — производная строка имён из executors (как в projectJsToDb)
  UPDATE public.projects
  SET executor = (
        SELECT NULLIF(string_agg(e->>'name', ', '), '')
        FROM jsonb_array_elements(executors) e
      )
  WHERE id = p_project_id;

  -- Добавляем исполнителя в команду как editor (идемпотентно)
  INSERT INTO public.project_members(project_id, user_id, role)
  VALUES (p_project_id, v_uid, 'editor')
  ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'editor';
END;
$$;


--
-- Name: top_clients(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.top_clients(p_limit integer DEFAULT 5) RETURNS TABLE(client_id uuid, client_name text, total_sum numeric, projects_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT
    c.id AS client_id,
    c.name AS client_name,
    COALESCE(SUM(p.contract_sum), 0) AS total_sum,
    COUNT(p.id) AS projects_count
  FROM public.clients c
  LEFT JOIN public.projects p ON p.client_id = c.id
  WHERE c.owner_id = auth.uid()
  GROUP BY c.id, c.name
  HAVING COALESCE(SUM(p.contract_sum), 0) > 0
  ORDER BY total_sum DESC
  LIMIT p_limit;
$$;


--
-- Name: touch_clients_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_clients_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


--
-- Name: trg_log_member_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_log_member_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_email text;
begin
  if tg_op = 'INSERT' then
    select email into v_email from public.profiles where id = new.user_id;
    perform public.log_activity_ext('member_added', new.project_id, false, new.user_id, v_email,
      jsonb_build_object('role', new.role));
    return new;
  elsif tg_op = 'DELETE' then
    select email into v_email from public.profiles where id = old.user_id;
    perform public.log_activity_ext('member_removed', old.project_id, false, old.user_id, v_email,
      jsonb_build_object('role', old.role));
    return old;
  else
    if new.role is distinct from old.role then
      select email into v_email from public.profiles where id = new.user_id;
      perform public.log_activity_ext('member_role_changed', new.project_id, false, new.user_id, v_email,
        jsonb_build_object('from', old.role, 'to', new.role));
    end if;
    return new;
  end if;
end; $$;


--
-- Name: trg_log_project_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_log_project_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  if tg_op = 'INSERT' then
    perform public.log_activity_ext('project_created', new.id, false, new.id, null,
      jsonb_build_object('name', new.name));
    return new;
  elsif tg_op = 'DELETE' then
    -- проект уже удалён → project_id=null (FK on delete set null), имя в details, target_id=old.id (без FK)
    perform public.log_activity_ext('project_deleted', null, false, old.id, null,
      jsonb_build_object('name', old.name));
    return old;
  else
    if new.name is distinct from old.name then
      perform public.log_activity_ext('project_renamed', new.id, false, new.id, null,
        jsonb_build_object('from', old.name, 'to', new.name)); end if;
    if new.stage is distinct from old.stage then
      perform public.log_activity_ext('project_stage_changed', new.id, false, new.id, null,
        jsonb_build_object('from', old.stage, 'to', new.stage)); end if;
    if new.client is distinct from old.client then
      perform public.log_activity_ext('project_client_changed', new.id, false, new.id, null,
        jsonb_build_object('from', old.client, 'to', new.client)); end if;
    if new.deadline is distinct from old.deadline then
      perform public.log_activity_ext('project_deadline_changed', new.id, false, new.id, null,
        jsonb_build_object('from', old.deadline::text, 'to', new.deadline::text)); end if;
    if new.visibility is distinct from old.visibility then
      perform public.log_activity_ext('project_visibility_changed', new.id, false, new.id, null,
        jsonb_build_object('from', old.visibility, 'to', new.visibility)); end if;
    if new.executors is distinct from old.executors then
      perform public.log_activity_ext('project_executors_changed', new.id, false, new.id, null,
        jsonb_build_object('from', old.executors, 'to', new.executors)); end if;
    if new.contract_sum is distinct from old.contract_sum then
      perform public.log_activity_ext('project_contract_changed', new.id, true, new.id, null,
        jsonb_build_object('from', old.contract_sum, 'to', new.contract_sum)); end if;  -- ФИНАНС
    return new;
  end if;
end; $$;


--
-- Name: trg_log_task_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_log_task_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_email text;
begin
  if tg_op = 'INSERT' then
    perform public.log_activity_ext('task_created', new.project_id, false, new.id, null,
      jsonb_build_object('title', new.title));
    return new;
  elsif tg_op = 'DELETE' then
    perform public.log_activity_ext('task_deleted', old.project_id, false, old.id, null,
      jsonb_build_object('title', old.title));
    return old;
  else
    if new.status is distinct from old.status then
      perform public.log_activity_ext('task_status_changed', new.project_id, false, new.id, null,
        jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status));
    end if;
    if new.assigned_to is distinct from old.assigned_to then
      select email into v_email from public.profiles where id = new.assigned_to;
      perform public.log_activity_ext('task_assigned', new.project_id, false, new.id, v_email,
        jsonb_build_object('title', new.title));
    end if;
    return new;
  end if;
end; $$;


--
-- Name: tz_create_v1_on_task_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tz_create_v1_on_task_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF btrim(COALESCE(NEW.description, '')) <> ''
     AND NOT EXISTS (SELECT 1 FROM public.task_tz_versions WHERE task_id = NEW.id) THEN
    INSERT INTO public.task_tz_versions
      (task_id, version_no, content, status, proposed_by, resolved_by, created_at, resolved_at)
    VALUES
      (NEW.id, 1, NEW.description, 'approved', NEW.author_id, NEW.author_id, NEW.created_at, NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: unlink_telegram(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unlink_telegram() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.profiles
  SET telegram_chat_id = NULL
  WHERE id = auth.uid();

  DELETE FROM public.telegram_link_codes WHERE user_id = auth.uid();
END;
$$;


--
-- Name: update_file_public_status(uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_file_public_status(p_file_id uuid, p_is_public boolean, p_public_url text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.project_files
  SET is_public  = p_is_public,
      public_url = p_public_url
  WHERE id = p_file_id;
END;
$$;


--
-- Name: update_notification_settings(boolean, boolean, boolean, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_notification_settings(p_project_taken boolean, p_team_invite boolean, p_comment boolean, p_deadline boolean, p_notif_task boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.profiles
  SET
    notif_project_taken = p_project_taken,
    notif_team_invite   = p_team_invite,
    notif_comment       = p_comment,
    notif_deadline      = p_deadline,
    notif_task          = p_notif_task
  WHERE id = auth.uid();
END $$;


--
-- Name: validate_client_task_assignee(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_client_task_assignee() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  -- срабатывает только если автор — заказчик данного проекта и НЕ сотрудник
  if NEW.project_id is not null
     and public.is_project_client(NEW.project_id)
     and not public.is_employee()
     and NEW.assigned_to is not null then
    if not exists (
      select 1 from public.projects p,
             jsonb_array_elements(coalesce(p.executors,'[]'::jsonb)) e
      where p.id = NEW.project_id
        and (e->>'userId') = NEW.assigned_to::text
    ) then
      raise exception 'assignee_not_in_executors';
    end if;
  end if;
  return NEW;
end $$;


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    telegram text,
    client_type text DEFAULT 'individual'::text,
    category text DEFAULT 'regular'::text,
    legal_name text,
    inn text,
    address text,
    city text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    CONSTRAINT clients_category_check CHECK ((category = ANY (ARRAY['regular'::text, 'one-time'::text, 'potential'::text, 'archived'::text]))),
    CONSTRAINT clients_client_type_check CHECK ((client_type = ANY (ARRAY['individual'::text, 'legal'::text, 'state'::text])))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    url text DEFAULT '/'::text NOT NULL,
    read boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    name text,
    role text DEFAULT 'user'::text NOT NULL,
    approved boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sign_in_at timestamp with time zone,
    telegram_chat_id bigint,
    notif_project_taken boolean DEFAULT true NOT NULL,
    notif_team_invite boolean DEFAULT true NOT NULL,
    notif_comment boolean DEFAULT true NOT NULL,
    notif_deadline boolean DEFAULT true NOT NULL,
    notif_task boolean DEFAULT true NOT NULL,
    notif_new_project boolean DEFAULT true NOT NULL,
    "position" text,
    username text,
    requested_role text,
    access_requested boolean DEFAULT false NOT NULL,
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'user'::text])))
);


--
-- Name: project_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    author_id uuid NOT NULL,
    content text NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_comments_content_check CHECK (((char_length(content) > 0) AND (char_length(content) <= 4000)))
);


--
-- Name: project_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    filename text NOT NULL,
    disk_path text NOT NULL,
    file_size bigint DEFAULT 0 NOT NULL,
    mime_type text,
    is_public boolean DEFAULT false NOT NULL,
    public_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_members (
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'viewer'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_members_role_check CHECK ((role = ANY (ARRAY['editor'::text, 'viewer'::text])))
);


--
-- Name: project_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    amount numeric NOT NULL,
    paid_on date NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    CONSTRAINT project_payments_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: project_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    created_by uuid NOT NULL,
    name text NOT NULL,
    description text,
    desired_deadline date,
    mode text DEFAULT 'quick'::text NOT NULL,
    assignment_mode text DEFAULT 'marketplace'::text NOT NULL,
    desired_executor_id uuid,
    status text DEFAULT 'Новая'::text NOT NULL,
    accepted_project_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_requests_assignment_mode_check CHECK ((assignment_mode = ANY (ARRAY['marketplace'::text, 'assignee'::text]))),
    CONSTRAINT project_requests_mode_check CHECK ((mode = ANY (ARRAY['quick'::text, 'detailed'::text]))),
    CONSTRAINT project_requests_status_check CHECK ((status = ANY (ARRAY['Новая'::text, 'Принята'::text, 'Отклонена'::text])))
);


--
-- Name: project_shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_shares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    participant_user_id uuid,
    participant_client_id uuid,
    participant_name text,
    share_kind text NOT NULL,
    share_value numeric NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    participant_label text,
    CONSTRAINT project_shares_one_participant CHECK ((((((participant_user_id IS NOT NULL))::integer + ((participant_client_id IS NOT NULL))::integer) + ((participant_name IS NOT NULL))::integer) = 1)),
    CONSTRAINT project_shares_share_kind_check CHECK ((share_kind = ANY (ARRAY['percent'::text, 'amount'::text]))),
    CONSTRAINT project_shares_share_value_check CHECK ((share_value >= (0)::numeric))
);


--
-- Name: project_visibility; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_visibility (
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    name text NOT NULL,
    client text,
    executor text,
    type text,
    stage text DEFAULT 'В работе'::text NOT NULL,
    start_date date,
    deadline date,
    contract_sum numeric(14,2) DEFAULT 0,
    paid_amount numeric(14,2) DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    links jsonb DEFAULT '[]'::jsonb,
    client_phone text,
    client_email text,
    client_telegram text,
    client_id uuid,
    taken_by uuid,
    executors jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT projects_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'team'::text, 'selected'::text, 'marketplace'::text])))
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: task_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id uuid NOT NULL,
    file_path text NOT NULL,
    file_name text NOT NULL,
    file_size integer NOT NULL,
    uploaded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: telegram_link_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_link_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    code text NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:10:00'::interval) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    date date NOT NULL,
    type text NOT NULL,
    category text NOT NULL,
    amount numeric(14,2) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transactions_type_check CHECK ((type = ANY (ARRAY['income'::text, 'expense'::text])))
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_roles_role_check CHECK ((role = ANY (ARRAY['employee'::text, 'client'::text, 'visitor'::text])))
);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: project_comments project_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_comments
    ADD CONSTRAINT project_comments_pkey PRIMARY KEY (id);


--
-- Name: project_files project_files_disk_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_files
    ADD CONSTRAINT project_files_disk_path_key UNIQUE (disk_path);


--
-- Name: project_files project_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_files
    ADD CONSTRAINT project_files_pkey PRIMARY KEY (id);


--
-- Name: project_members project_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (project_id, user_id);


--
-- Name: project_payments project_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_payments
    ADD CONSTRAINT project_payments_pkey PRIMARY KEY (id);


--
-- Name: project_requests project_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_requests
    ADD CONSTRAINT project_requests_pkey PRIMARY KEY (id);


--
-- Name: project_shares project_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_shares
    ADD CONSTRAINT project_shares_pkey PRIMARY KEY (id);


--
-- Name: project_tasks project_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_tasks
    ADD CONSTRAINT project_tasks_pkey PRIMARY KEY (id);


--
-- Name: project_visibility project_visibility_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_visibility
    ADD CONSTRAINT project_visibility_pkey PRIMARY KEY (project_id, user_id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: task_comments task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_pkey PRIMARY KEY (id);


--
-- Name: task_photos task_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_photos
    ADD CONSTRAINT task_photos_pkey PRIMARY KEY (id);


--
-- Name: task_tz_versions task_tz_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tz_versions
    ADD CONSTRAINT task_tz_versions_pkey PRIMARY KEY (id);


--
-- Name: telegram_link_codes telegram_link_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_link_codes
    ADD CONSTRAINT telegram_link_codes_code_key UNIQUE (code);


--
-- Name: telegram_link_codes telegram_link_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_link_codes
    ADD CONSTRAINT telegram_link_codes_pkey PRIMARY KEY (id);


--
-- Name: telegram_link_codes telegram_link_codes_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_link_codes
    ADD CONSTRAINT telegram_link_codes_user_id_key UNIQUE (user_id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role);


--
-- Name: idx_activity_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_log_created_at ON public.activity_log USING btree (created_at DESC);


--
-- Name: idx_activity_log_project_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_log_project_created ON public.activity_log USING btree (project_id, created_at DESC) WHERE (project_id IS NOT NULL);


--
-- Name: idx_clients_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_name ON public.clients USING btree (name);


--
-- Name: idx_clients_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_owner ON public.clients USING btree (owner_id);


--
-- Name: idx_clients_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_user_id ON public.clients USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_comments_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_author ON public.project_comments USING btree (author_id);


--
-- Name: idx_comments_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_project ON public.project_comments USING btree (project_id, created_at);


--
-- Name: idx_preq_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_preq_created_by ON public.project_requests USING btree (created_by);


--
-- Name: idx_preq_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_preq_status ON public.project_requests USING btree (status);


--
-- Name: idx_project_files_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_files_owner ON public.project_files USING btree (owner_id);


--
-- Name: idx_project_files_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_files_project ON public.project_files USING btree (project_id);


--
-- Name: idx_project_tasks_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_tasks_assignee ON public.project_tasks USING btree (assigned_to);


--
-- Name: idx_project_tasks_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_tasks_due ON public.project_tasks USING btree (due_date);


--
-- Name: idx_project_tasks_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_tasks_project ON public.project_tasks USING btree (project_id);


--
-- Name: idx_project_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_tasks_status ON public.project_tasks USING btree (status);


--
-- Name: idx_project_visibility_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_visibility_user ON public.project_visibility USING btree (user_id);


--
-- Name: idx_projects_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_client ON public.projects USING btree (client_id);


--
-- Name: idx_projects_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_deadline ON public.projects USING btree (deadline);


--
-- Name: idx_projects_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_owner ON public.projects USING btree (owner_id);


--
-- Name: idx_projects_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_stage ON public.projects USING btree (stage);


--
-- Name: idx_projects_taken_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_taken_by ON public.projects USING btree (taken_by) WHERE (taken_by IS NOT NULL);


--
-- Name: idx_task_comments_open_q; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_open_q ON public.task_comments USING btree (task_id, is_question, resolved);


--
-- Name: idx_task_comments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_task ON public.task_comments USING btree (task_id);


--
-- Name: idx_task_photos_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_photos_task ON public.task_photos USING btree (task_id);


--
-- Name: idx_task_tz_versions_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_tz_versions_task ON public.task_tz_versions USING btree (task_id);


--
-- Name: idx_task_tz_versions_task_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_tz_versions_task_status ON public.task_tz_versions USING btree (task_id, status);


--
-- Name: idx_tlc_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tlc_code ON public.telegram_link_codes USING btree (code);


--
-- Name: idx_tlc_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tlc_expires ON public.telegram_link_codes USING btree (expires_at);


--
-- Name: idx_transactions_owner_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_owner_date ON public.transactions USING btree (owner_id, date DESC);


--
-- Name: idx_user_roles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_user ON public.user_roles USING btree (user_id);


--
-- Name: notifications_user_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_unread_idx ON public.notifications USING btree (user_id, read, created_at DESC);


--
-- Name: profiles_username_lower_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_username_lower_uidx ON public.profiles USING btree (lower(username)) WHERE (username IS NOT NULL);


--
-- Name: project_payments_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_payments_project_id_idx ON public.project_payments USING btree (project_id);


--
-- Name: project_shares_participant_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_shares_participant_user_idx ON public.project_shares USING btree (participant_user_id) WHERE (participant_user_id IS NOT NULL);


--
-- Name: project_shares_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX project_shares_project_id_idx ON public.project_shares USING btree (project_id);


--
-- Name: push_subscriptions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_user_id_idx ON public.push_subscriptions USING btree (user_id);


--
-- Name: uq_task_tz_versions_one_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_task_tz_versions_one_pending ON public.task_tz_versions USING btree (task_id) WHERE (status = 'pending'::text);


--
-- Name: clients clients_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.touch_clients_updated_at();


--
-- Name: project_comments on_comment_created; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_comment_created AFTER INSERT ON public.project_comments FOR EACH ROW EXECUTE FUNCTION public.notify_comment_telegram();


--
-- Name: projects projects_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER projects_touch_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: project_members trg_members_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_members_activity AFTER INSERT OR DELETE OR UPDATE ON public.project_members FOR EACH ROW EXECUTE FUNCTION public.trg_log_member_activity();


--
-- Name: project_tasks trg_project_tasks_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_project_tasks_touch BEFORE UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: projects trg_projects_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_projects_activity AFTER INSERT OR DELETE OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.trg_log_project_activity();


--
-- Name: project_payments trg_recalc_paid_amount; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_recalc_paid_amount AFTER INSERT OR DELETE OR UPDATE ON public.project_payments FOR EACH ROW EXECUTE FUNCTION public.recalc_project_paid_amount();


--
-- Name: project_tasks trg_tasks_activity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tasks_activity AFTER INSERT OR DELETE OR UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION public.trg_log_task_activity();


--
-- Name: project_tasks trg_tz_v1_on_task_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tz_v1_on_task_insert AFTER INSERT ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION public.tz_create_v1_on_task_insert();


--
-- Name: project_tasks trg_validate_assigned_to; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_assigned_to BEFORE INSERT OR UPDATE OF assigned_to ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION public.validate_client_task_assignee();


--
-- Name: activity_log activity_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: activity_log activity_log_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: clients clients_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: clients clients_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: project_comments project_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_comments
    ADD CONSTRAINT project_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: project_comments project_comments_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_comments
    ADD CONSTRAINT project_comments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_comments project_comments_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_comments
    ADD CONSTRAINT project_comments_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: project_files project_files_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_files
    ADD CONSTRAINT project_files_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: project_files project_files_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_files
    ADD CONSTRAINT project_files_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: project_payments project_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_payments
    ADD CONSTRAINT project_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: project_payments project_payments_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_payments
    ADD CONSTRAINT project_payments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_requests project_requests_accepted_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_requests
    ADD CONSTRAINT project_requests_accepted_project_id_fkey FOREIGN KEY (accepted_project_id) REFERENCES public.projects(id);


--
-- Name: project_requests project_requests_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_requests
    ADD CONSTRAINT project_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: project_requests project_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_requests
    ADD CONSTRAINT project_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: project_requests project_requests_desired_executor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_requests
    ADD CONSTRAINT project_requests_desired_executor_id_fkey FOREIGN KEY (desired_executor_id) REFERENCES public.profiles(id);


--
-- Name: project_shares project_shares_participant_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_shares
    ADD CONSTRAINT project_shares_participant_client_id_fkey FOREIGN KEY (participant_client_id) REFERENCES public.clients(id);


--
-- Name: project_shares project_shares_participant_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_shares
    ADD CONSTRAINT project_shares_participant_user_id_fkey FOREIGN KEY (participant_user_id) REFERENCES auth.users(id);


--
-- Name: project_shares project_shares_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_shares
    ADD CONSTRAINT project_shares_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_tasks project_tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_tasks
    ADD CONSTRAINT project_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id);


--
-- Name: project_tasks project_tasks_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_tasks
    ADD CONSTRAINT project_tasks_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id);


--
-- Name: project_tasks project_tasks_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_tasks
    ADD CONSTRAINT project_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: project_visibility project_visibility_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_visibility
    ADD CONSTRAINT project_visibility_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_visibility project_visibility_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_visibility
    ADD CONSTRAINT project_visibility_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: projects projects_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: projects projects_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: projects projects_taken_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_taken_by_fkey FOREIGN KEY (taken_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: task_comments task_comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id);


--
-- Name: task_comments task_comments_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id);


--
-- Name: task_comments task_comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.project_tasks(id) ON DELETE CASCADE;


--
-- Name: task_photos task_photos_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_photos
    ADD CONSTRAINT task_photos_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.project_tasks(id) ON DELETE CASCADE;


--
-- Name: task_photos task_photos_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_photos
    ADD CONSTRAINT task_photos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id);


--
-- Name: task_tz_versions task_tz_versions_proposed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tz_versions
    ADD CONSTRAINT task_tz_versions_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES public.profiles(id);


--
-- Name: task_tz_versions task_tz_versions_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tz_versions
    ADD CONSTRAINT task_tz_versions_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.profiles(id);


--
-- Name: task_tz_versions task_tz_versions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_tz_versions
    ADD CONSTRAINT task_tz_versions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.project_tasks(id) ON DELETE CASCADE;


--
-- Name: telegram_link_codes telegram_link_codes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_link_codes
    ADD CONSTRAINT telegram_link_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_log activity_log_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY activity_log_select ON public.activity_log FOR SELECT TO authenticated USING (public.is_admin());


--
-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--
-- Name: clients clients_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_delete ON public.clients FOR DELETE TO authenticated USING (((owner_id = auth.uid()) OR public.is_admin()));


--
-- Name: clients clients_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_insert ON public.clients FOR INSERT TO authenticated WITH CHECK (((owner_id = auth.uid()) AND public.is_approved()));


--
-- Name: clients clients_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_select ON public.clients FOR SELECT TO authenticated USING (((owner_id = auth.uid()) OR public.is_admin()));


--
-- Name: clients clients_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_update ON public.clients FOR UPDATE TO authenticated USING (((owner_id = auth.uid()) OR public.is_admin())) WITH CHECK (((owner_id = auth.uid()) OR public.is_admin()));


--
-- Name: project_comments comments_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comments_delete ON public.project_comments FOR DELETE TO authenticated USING (((author_id = auth.uid()) OR public.is_admin()));


--
-- Name: project_comments comments_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comments_insert ON public.project_comments FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND public.is_approved() AND public.can_access_project_comments(project_id)));


--
-- Name: project_comments comments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comments_select ON public.project_comments FOR SELECT TO authenticated USING (public.can_access_project_comments(project_id));


--
-- Name: project_comments comments_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY comments_update ON public.project_comments FOR UPDATE TO authenticated USING (((author_id = auth.uid()) OR public.is_project_owner(project_id) OR public.is_admin()));


--
-- Name: project_files files_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY files_delete ON public.project_files FOR DELETE TO authenticated USING (((owner_id = auth.uid()) OR public.is_project_owner(project_id) OR public.is_admin()));


--
-- Name: project_files files_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY files_insert ON public.project_files FOR INSERT TO authenticated WITH CHECK (((owner_id = auth.uid()) AND public.is_approved() AND public.can_access_project_comments(project_id)));


--
-- Name: project_files files_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY files_select ON public.project_files FOR SELECT TO authenticated USING (public.can_access_project_comments(project_id));


--
-- Name: project_files files_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY files_update ON public.project_files FOR UPDATE TO authenticated USING (((owner_id = auth.uid()) OR public.is_admin())) WITH CHECK (((owner_id = auth.uid()) OR public.is_admin()));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_select_own ON public.notifications FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: notifications notifications_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: project_requests preq_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preq_delete_admin ON public.project_requests FOR DELETE TO authenticated USING (public.is_admin());


--
-- Name: project_requests preq_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preq_insert ON public.project_requests FOR INSERT TO authenticated WITH CHECK ((public.am_i_client() AND (created_by = auth.uid()) AND public.is_my_client_record(client_id)));


--
-- Name: project_requests preq_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preq_select ON public.project_requests FOR SELECT TO authenticated USING (((created_by = auth.uid()) OR public.is_employee() OR public.is_admin()));


--
-- Name: project_requests preq_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preq_update_admin ON public.project_requests FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles: read own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles: read own" ON public.profiles FOR SELECT USING (((id = auth.uid()) OR public.is_admin()));


--
-- Name: profiles profiles: update own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles: update own" ON public.profiles FOR UPDATE USING (((id = auth.uid()) OR public.is_admin())) WITH CHECK (((id = auth.uid()) OR public.is_admin()));


--
-- Name: project_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: project_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;

--
-- Name: project_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

--
-- Name: project_members project_members_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_members_delete ON public.project_members FOR DELETE TO authenticated USING (((user_id = auth.uid()) OR public.is_project_owner(project_id) OR public.is_admin()));


--
-- Name: project_members project_members_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_members_insert ON public.project_members FOR INSERT TO authenticated WITH CHECK ((public.is_project_owner(project_id) OR public.is_admin()));


--
-- Name: project_members project_members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_members_select ON public.project_members FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_project_owner(project_id) OR public.is_admin()));


--
-- Name: project_members project_members_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_members_update ON public.project_members FOR UPDATE TO authenticated USING ((public.is_project_owner(project_id) OR public.is_admin())) WITH CHECK ((public.is_project_owner(project_id) OR public.is_admin()));


--
-- Name: project_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: project_payments project_payments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_payments_select ON public.project_payments FOR SELECT USING ((public.is_project_owner(project_id) OR public.is_project_editor(project_id) OR public.is_admin()));


--
-- Name: project_payments project_payments_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_payments_write ON public.project_payments USING ((public.is_project_owner(project_id) OR public.is_project_editor(project_id) OR public.is_admin())) WITH CHECK ((public.is_project_owner(project_id) OR public.is_project_editor(project_id) OR public.is_admin()));


--
-- Name: project_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: project_shares; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_shares ENABLE ROW LEVEL SECURITY;

--
-- Name: project_shares project_shares_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_shares_select ON public.project_shares FOR SELECT USING ((public.is_project_owner(project_id) OR (participant_user_id = auth.uid()) OR public.is_project_editor(project_id) OR public.is_admin()));


--
-- Name: project_shares project_shares_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY project_shares_write ON public.project_shares USING ((public.is_project_owner(project_id) OR public.is_project_editor(project_id) OR public.is_admin())) WITH CHECK ((public.is_project_owner(project_id) OR public.is_project_editor(project_id) OR public.is_admin()));


--
-- Name: project_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: project_visibility; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_visibility ENABLE ROW LEVEL SECURITY;

--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: projects projects_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_delete ON public.projects FOR DELETE TO authenticated USING (((owner_id = auth.uid()) OR public.is_admin()));


--
-- Name: projects projects_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_insert ON public.projects FOR INSERT TO authenticated WITH CHECK (((owner_id = auth.uid()) AND public.is_approved()));


--
-- Name: projects projects_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_select ON public.projects FOR SELECT TO authenticated USING (((owner_id = auth.uid()) OR public.is_admin() OR ((visibility = 'team'::text) AND public.is_project_member(id)) OR ((visibility = 'marketplace'::text) AND public.is_employee())));


--
-- Name: projects projects_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY projects_update ON public.projects FOR UPDATE TO authenticated USING (((owner_id = auth.uid()) OR public.is_project_editor(id) OR public.is_admin())) WITH CHECK (((owner_id = auth.uid()) OR public.is_project_editor(id) OR public.is_admin()));


--
-- Name: push_subscriptions push_sub_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_sub_delete_own ON public.push_subscriptions FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: push_subscriptions push_sub_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_sub_insert_own ON public.push_subscriptions FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: push_subscriptions push_sub_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_sub_select_own ON public.push_subscriptions FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: project_visibility pv_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pv_delete ON public.project_visibility FOR DELETE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.projects
  WHERE ((projects.id = project_visibility.project_id) AND (projects.owner_id = auth.uid())))) OR public.is_admin()));


--
-- Name: project_visibility pv_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pv_insert ON public.project_visibility FOR INSERT TO authenticated WITH CHECK (((EXISTS ( SELECT 1
   FROM public.projects
  WHERE ((projects.id = project_visibility.project_id) AND (projects.owner_id = auth.uid())))) OR public.is_admin()));


--
-- Name: project_visibility pv_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pv_select ON public.project_visibility FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.projects
  WHERE ((projects.id = project_visibility.project_id) AND (projects.owner_id = auth.uid())))) OR (user_id = auth.uid()) OR public.is_admin()));


--
-- Name: task_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: task_comments task_comments_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_comments_insert ON public.task_comments FOR INSERT WITH CHECK ((public.is_approved() AND (author_id = auth.uid()) AND public.can_access_task(task_id)));


--
-- Name: task_comments task_comments_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_comments_select ON public.task_comments FOR SELECT USING (public.can_access_task(task_id));


--
-- Name: task_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: task_photos task_photos_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_photos_delete ON public.task_photos FOR DELETE TO authenticated USING ((uploaded_by = auth.uid()));


--
-- Name: task_photos task_photos_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_photos_insert ON public.task_photos FOR INSERT TO authenticated WITH CHECK (((uploaded_by = auth.uid()) AND public.can_access_task(task_id)));


--
-- Name: task_photos task_photos_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_photos_select ON public.task_photos FOR SELECT TO authenticated USING (public.can_access_task(task_id));


--
-- Name: task_tz_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_tz_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: project_tasks tasks_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_delete ON public.project_tasks FOR DELETE USING (((author_id = auth.uid()) OR public.is_admin() OR ((project_id IS NOT NULL) AND public.is_project_owner(project_id))));


--
-- Name: project_tasks tasks_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_insert ON public.project_tasks FOR INSERT WITH CHECK ((public.is_approved() AND (author_id = auth.uid()) AND ((project_id IS NULL) OR public.can_access_project_comments(project_id))));


--
-- Name: project_tasks tasks_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_select ON public.project_tasks FOR SELECT USING ((((project_id IS NOT NULL) AND public.can_access_project_comments(project_id)) OR ((project_id IS NULL) AND ((author_id = auth.uid()) OR (assigned_to = auth.uid()) OR public.is_admin()))));


--
-- Name: project_tasks tasks_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_update ON public.project_tasks FOR UPDATE USING (((author_id = auth.uid()) OR (assigned_to = auth.uid()) OR public.is_admin() OR ((project_id IS NOT NULL) AND public.is_project_editor(project_id)))) WITH CHECK ((((author_id = auth.uid()) OR (assigned_to = auth.uid()) OR public.is_admin() OR ((project_id IS NOT NULL) AND public.is_project_editor(project_id))) AND ((project_id IS NULL) OR public.can_access_project_comments(project_id))));


--
-- Name: telegram_link_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: telegram_link_codes tlc_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tlc_select ON public.telegram_link_codes FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions tx: delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tx: delete" ON public.transactions FOR DELETE USING ((owner_id = auth.uid()));


--
-- Name: transactions tx: insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tx: insert" ON public.transactions FOR INSERT WITH CHECK (((owner_id = auth.uid()) AND public.is_approved()));


--
-- Name: transactions tx: read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tx: read" ON public.transactions FOR SELECT USING ((owner_id = auth.uid()));


--
-- Name: transactions tx: update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tx: update" ON public.transactions FOR UPDATE USING ((owner_id = auth.uid())) WITH CHECK ((owner_id = auth.uid()));


--
-- Name: task_tz_versions tz_versions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tz_versions_select ON public.task_tz_versions FOR SELECT USING (public.can_access_task(task_id));


--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles user_roles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_roles_select ON public.user_roles FOR SELECT USING (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION accept_project_request(p_request_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.accept_project_request(p_request_id uuid) TO anon;
GRANT ALL ON FUNCTION public.accept_project_request(p_request_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.accept_project_request(p_request_id uuid) TO service_role;


--
-- Name: FUNCTION add_project_file(p_project_id uuid, p_owner_id uuid, p_filename text, p_disk_path text, p_file_size bigint, p_mime_type text, p_is_public boolean, p_public_url text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.add_project_file(p_project_id uuid, p_owner_id uuid, p_filename text, p_disk_path text, p_file_size bigint, p_mime_type text, p_is_public boolean, p_public_url text) TO anon;
GRANT ALL ON FUNCTION public.add_project_file(p_project_id uuid, p_owner_id uuid, p_filename text, p_disk_path text, p_file_size bigint, p_mime_type text, p_is_public boolean, p_public_url text) TO authenticated;
GRANT ALL ON FUNCTION public.add_project_file(p_project_id uuid, p_owner_id uuid, p_filename text, p_disk_path text, p_file_size bigint, p_mime_type text, p_is_public boolean, p_public_url text) TO service_role;


--
-- Name: FUNCTION admin_delete_user(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_delete_user(p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.admin_delete_user(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_delete_user(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION admin_finalize_new_user(p_user_id uuid, p_role text, p_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_finalize_new_user(p_user_id uuid, p_role text, p_name text) TO anon;
GRANT ALL ON FUNCTION public.admin_finalize_new_user(p_user_id uuid, p_role text, p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_finalize_new_user(p_user_id uuid, p_role text, p_name text) TO service_role;


--
-- Name: FUNCTION admin_list_role_requests(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_list_role_requests() TO anon;
GRANT ALL ON FUNCTION public.admin_list_role_requests() TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_role_requests() TO service_role;


--
-- Name: FUNCTION admin_list_users(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_list_users() TO anon;
GRANT ALL ON FUNCTION public.admin_list_users() TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_users() TO service_role;


--
-- Name: FUNCTION admin_reset_password(p_user_id uuid, p_new_password text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_reset_password(p_user_id uuid, p_new_password text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_reset_password(p_user_id uuid, p_new_password text) TO anon;
GRANT ALL ON FUNCTION public.admin_reset_password(p_user_id uuid, p_new_password text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_reset_password(p_user_id uuid, p_new_password text) TO service_role;


--
-- Name: FUNCTION admin_system_stats(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_system_stats() TO anon;
GRANT ALL ON FUNCTION public.admin_system_stats() TO authenticated;
GRANT ALL ON FUNCTION public.admin_system_stats() TO service_role;


--
-- Name: FUNCTION admin_update_user(p_user_id uuid, p_approved boolean, p_role text, p_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_update_user(p_user_id uuid, p_approved boolean, p_role text, p_name text) TO anon;
GRANT ALL ON FUNCTION public.admin_update_user(p_user_id uuid, p_approved boolean, p_role text, p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_update_user(p_user_id uuid, p_approved boolean, p_role text, p_name text) TO service_role;


--
-- Name: FUNCTION am_i_client(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.am_i_client() TO anon;
GRANT ALL ON FUNCTION public.am_i_client() TO authenticated;
GRANT ALL ON FUNCTION public.am_i_client() TO service_role;


--
-- Name: TABLE task_tz_versions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_tz_versions TO anon;
GRANT ALL ON TABLE public.task_tz_versions TO authenticated;
GRANT ALL ON TABLE public.task_tz_versions TO service_role;


--
-- Name: FUNCTION approve_tz_version(p_version_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.approve_tz_version(p_version_id uuid) TO anon;
GRANT ALL ON FUNCTION public.approve_tz_version(p_version_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.approve_tz_version(p_version_id uuid) TO service_role;


--
-- Name: FUNCTION can_access_project_comments(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_access_project_comments(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_access_project_comments(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_project_comments(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION can_access_task(p_task_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_access_task(p_task_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_access_task(p_task_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_task(p_task_id uuid) TO service_role;


--
-- Name: FUNCTION client_set_task_status(p_task_id uuid, p_status text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_set_task_status(p_task_id uuid, p_status text) TO anon;
GRANT ALL ON FUNCTION public.client_set_task_status(p_task_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.client_set_task_status(p_task_id uuid, p_status text) TO service_role;


--
-- Name: FUNCTION client_stats(p_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_stats(p_client_id uuid) TO anon;
GRANT ALL ON FUNCTION public.client_stats(p_client_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.client_stats(p_client_id uuid) TO service_role;


--
-- Name: FUNCTION create_project_request(p_name text, p_description text, p_deadline date, p_mode text, p_assignment_mode text, p_desired_executor_id uuid, p_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_project_request(p_name text, p_description text, p_deadline date, p_mode text, p_assignment_mode text, p_desired_executor_id uuid, p_client_id uuid) TO anon;
GRANT ALL ON FUNCTION public.create_project_request(p_name text, p_description text, p_deadline date, p_mode text, p_assignment_mode text, p_desired_executor_id uuid, p_client_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.create_project_request(p_name text, p_description text, p_deadline date, p_mode text, p_assignment_mode text, p_desired_executor_id uuid, p_client_id uuid) TO service_role;


--
-- Name: FUNCTION delete_project_comment(p_comment_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.delete_project_comment(p_comment_id uuid) TO anon;
GRANT ALL ON FUNCTION public.delete_project_comment(p_comment_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_project_comment(p_comment_id uuid) TO service_role;


--
-- Name: FUNCTION delete_project_file_record(p_file_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.delete_project_file_record(p_file_id uuid) TO anon;
GRANT ALL ON FUNCTION public.delete_project_file_record(p_file_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_project_file_record(p_file_id uuid) TO service_role;


--
-- Name: FUNCTION generate_telegram_link_code(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.generate_telegram_link_code() TO anon;
GRANT ALL ON FUNCTION public.generate_telegram_link_code() TO authenticated;
GRANT ALL ON FUNCTION public.generate_telegram_link_code() TO service_role;


--
-- Name: FUNCTION get_my_client_projects(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_my_client_projects() TO anon;
GRANT ALL ON FUNCTION public.get_my_client_projects() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_client_projects() TO service_role;


--
-- Name: FUNCTION get_my_project_payments(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_my_project_payments() TO anon;
GRANT ALL ON FUNCTION public.get_my_project_payments() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_project_payments() TO service_role;


--
-- Name: FUNCTION get_my_roles(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_my_roles() TO anon;
GRANT ALL ON FUNCTION public.get_my_roles() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_roles() TO service_role;


--
-- Name: FUNCTION get_my_shares(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_my_shares() TO anon;
GRANT ALL ON FUNCTION public.get_my_shares() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_shares() TO service_role;


--
-- Name: TABLE activity_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.activity_log TO anon;
GRANT ALL ON TABLE public.activity_log TO authenticated;
GRANT ALL ON TABLE public.activity_log TO service_role;


--
-- Name: FUNCTION get_project_activity(p_project_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_project_activity(p_project_id uuid, p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.get_project_activity(p_project_id uuid, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_project_activity(p_project_id uuid, p_limit integer) TO service_role;


--
-- Name: FUNCTION get_project_comments(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_project_comments(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_project_comments(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_project_comments(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION get_project_files(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_project_files(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_project_files(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_project_files(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION get_project_members(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_project_members(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_project_members(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_project_members(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION get_project_storage_used(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_project_storage_used(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_project_storage_used(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_project_storage_used(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION get_project_visibility_users(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_project_visibility_users(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_project_visibility_users(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_project_visibility_users(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION get_task_comments(p_task_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_task_comments(p_task_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_task_comments(p_task_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_task_comments(p_task_id uuid) TO service_role;


--
-- Name: FUNCTION get_task_versions(p_task_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_task_versions(p_task_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_task_versions(p_task_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_task_versions(p_task_id uuid) TO service_role;


--
-- Name: FUNCTION get_tasks(p_project_id uuid, p_status text, p_assigned_to uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_tasks(p_project_id uuid, p_status text, p_assigned_to uuid) TO anon;
GRANT ALL ON FUNCTION public.get_tasks(p_project_id uuid, p_status text, p_assigned_to uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_tasks(p_project_id uuid, p_status text, p_assigned_to uuid) TO service_role;


--
-- Name: FUNCTION get_user_notification_prefs(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_user_notification_prefs(p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_user_notification_prefs(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_user_notification_prefs(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION handle_new_user_meta(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user_meta() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user_meta() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user_meta() TO service_role;


--
-- Name: FUNCTION has_role(p_uid uuid, p_role text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.has_role(p_uid uuid, p_role text) TO anon;
GRANT ALL ON FUNCTION public.has_role(p_uid uuid, p_role text) TO authenticated;
GRANT ALL ON FUNCTION public.has_role(p_uid uuid, p_role text) TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_approved(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_approved() TO anon;
GRANT ALL ON FUNCTION public.is_approved() TO authenticated;
GRANT ALL ON FUNCTION public.is_approved() TO service_role;


--
-- Name: FUNCTION is_employee(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_employee() TO anon;
GRANT ALL ON FUNCTION public.is_employee() TO authenticated;
GRANT ALL ON FUNCTION public.is_employee() TO service_role;


--
-- Name: FUNCTION is_in_project_visibility(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_in_project_visibility(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_in_project_visibility(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_in_project_visibility(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION is_my_client_record(p_client_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_my_client_record(p_client_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_my_client_record(p_client_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_my_client_record(p_client_id uuid) TO service_role;


--
-- Name: FUNCTION is_project_client(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_project_client(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_project_client(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_project_client(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION is_project_editor(project_id_to_check uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_project_editor(project_id_to_check uuid) TO anon;
GRANT ALL ON FUNCTION public.is_project_editor(project_id_to_check uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_project_editor(project_id_to_check uuid) TO service_role;


--
-- Name: FUNCTION is_project_member(project_id_to_check uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_project_member(project_id_to_check uuid) TO anon;
GRANT ALL ON FUNCTION public.is_project_member(project_id_to_check uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_project_member(project_id_to_check uuid) TO service_role;


--
-- Name: FUNCTION is_project_owner(project_id_to_check uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_project_owner(project_id_to_check uuid) TO anon;
GRANT ALL ON FUNCTION public.is_project_owner(project_id_to_check uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_project_owner(project_id_to_check uuid) TO service_role;


--
-- Name: FUNCTION link_telegram_chat(p_code text, p_chat_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.link_telegram_chat(p_code text, p_chat_id bigint) TO anon;
GRANT ALL ON FUNCTION public.link_telegram_chat(p_code text, p_chat_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.link_telegram_chat(p_code text, p_chat_id bigint) TO service_role;


--
-- Name: FUNCTION list_available_executors(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.list_available_executors() TO anon;
GRANT ALL ON FUNCTION public.list_available_executors() TO authenticated;
GRANT ALL ON FUNCTION public.list_available_executors() TO service_role;


--
-- Name: FUNCTION log_activity(p_action text, p_target_id uuid, p_target_email text, p_details jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.log_activity(p_action text, p_target_id uuid, p_target_email text, p_details jsonb) TO anon;
GRANT ALL ON FUNCTION public.log_activity(p_action text, p_target_id uuid, p_target_email text, p_details jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.log_activity(p_action text, p_target_id uuid, p_target_email text, p_details jsonb) TO service_role;


--
-- Name: FUNCTION log_activity_ext(p_action text, p_project_id uuid, p_is_financial boolean, p_target_id uuid, p_target_email text, p_details jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.log_activity_ext(p_action text, p_project_id uuid, p_is_financial boolean, p_target_id uuid, p_target_email text, p_details jsonb) TO anon;
GRANT ALL ON FUNCTION public.log_activity_ext(p_action text, p_project_id uuid, p_is_financial boolean, p_target_id uuid, p_target_email text, p_details jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.log_activity_ext(p_action text, p_project_id uuid, p_is_financial boolean, p_target_id uuid, p_target_email text, p_details jsonb) TO service_role;


--
-- Name: FUNCTION notify_comment_telegram(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_comment_telegram() TO anon;
GRANT ALL ON FUNCTION public.notify_comment_telegram() TO authenticated;
GRANT ALL ON FUNCTION public.notify_comment_telegram() TO service_role;


--
-- Name: FUNCTION propose_tz_version(p_task_id uuid, p_content text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.propose_tz_version(p_task_id uuid, p_content text) TO anon;
GRANT ALL ON FUNCTION public.propose_tz_version(p_task_id uuid, p_content text) TO authenticated;
GRANT ALL ON FUNCTION public.propose_tz_version(p_task_id uuid, p_content text) TO service_role;


--
-- Name: FUNCTION recalc_project_paid_amount(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.recalc_project_paid_amount() TO anon;
GRANT ALL ON FUNCTION public.recalc_project_paid_amount() TO authenticated;
GRANT ALL ON FUNCTION public.recalc_project_paid_amount() TO service_role;


--
-- Name: FUNCTION reject_project_request(p_request_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.reject_project_request(p_request_id uuid, p_reason text) TO anon;
GRANT ALL ON FUNCTION public.reject_project_request(p_request_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.reject_project_request(p_request_id uuid, p_reason text) TO service_role;


--
-- Name: FUNCTION reject_tz_version(p_version_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.reject_tz_version(p_version_id uuid) TO anon;
GRANT ALL ON FUNCTION public.reject_tz_version(p_version_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reject_tz_version(p_version_id uuid) TO service_role;


--
-- Name: FUNCTION release_project(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.release_project(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.release_project(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.release_project(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION request_full_access(p_role text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.request_full_access(p_role text) TO anon;
GRANT ALL ON FUNCTION public.request_full_access(p_role text) TO authenticated;
GRANT ALL ON FUNCTION public.request_full_access(p_role text) TO service_role;


--
-- Name: FUNCTION resolve_project_comment(p_comment_id uuid, p_resolved boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.resolve_project_comment(p_comment_id uuid, p_resolved boolean) TO anon;
GRANT ALL ON FUNCTION public.resolve_project_comment(p_comment_id uuid, p_resolved boolean) TO authenticated;
GRANT ALL ON FUNCTION public.resolve_project_comment(p_comment_id uuid, p_resolved boolean) TO service_role;


--
-- Name: TABLE task_comments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_comments TO anon;
GRANT ALL ON TABLE public.task_comments TO authenticated;
GRANT ALL ON TABLE public.task_comments TO service_role;


--
-- Name: FUNCTION resolve_question(p_comment_id uuid, p_resolved boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.resolve_question(p_comment_id uuid, p_resolved boolean) TO anon;
GRANT ALL ON FUNCTION public.resolve_question(p_comment_id uuid, p_resolved boolean) TO authenticated;
GRANT ALL ON FUNCTION public.resolve_question(p_comment_id uuid, p_resolved boolean) TO service_role;


--
-- Name: FUNCTION revoke_project(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.revoke_project(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.revoke_project(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.revoke_project(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;


--
-- Name: FUNCTION search_approved_users(p_query text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.search_approved_users(p_query text) TO anon;
GRANT ALL ON FUNCTION public.search_approved_users(p_query text) TO authenticated;
GRANT ALL ON FUNCTION public.search_approved_users(p_query text) TO service_role;


--
-- Name: FUNCTION search_clients(p_query text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.search_clients(p_query text) TO anon;
GRANT ALL ON FUNCTION public.search_clients(p_query text) TO authenticated;
GRANT ALL ON FUNCTION public.search_clients(p_query text) TO service_role;


--
-- Name: FUNCTION set_client_user(p_client_id uuid, p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_client_user(p_client_id uuid, p_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.set_client_user(p_client_id uuid, p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.set_client_user(p_client_id uuid, p_user_id uuid) TO service_role;


--
-- Name: FUNCTION set_project_payments(p_project_id uuid, p_rows jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_project_payments(p_project_id uuid, p_rows jsonb) TO anon;
GRANT ALL ON FUNCTION public.set_project_payments(p_project_id uuid, p_rows jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.set_project_payments(p_project_id uuid, p_rows jsonb) TO service_role;


--
-- Name: FUNCTION set_project_shares(p_project_id uuid, p_rows jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_project_shares(p_project_id uuid, p_rows jsonb) TO anon;
GRANT ALL ON FUNCTION public.set_project_shares(p_project_id uuid, p_rows jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.set_project_shares(p_project_id uuid, p_rows jsonb) TO service_role;


--
-- Name: FUNCTION set_project_visibility_users(p_project_id uuid, p_user_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_project_visibility_users(p_project_id uuid, p_user_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.set_project_visibility_users(p_project_id uuid, p_user_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.set_project_visibility_users(p_project_id uuid, p_user_ids uuid[]) TO service_role;


--
-- Name: TABLE project_tasks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_tasks TO anon;
GRANT ALL ON TABLE public.project_tasks TO authenticated;
GRANT ALL ON TABLE public.project_tasks TO service_role;


--
-- Name: FUNCTION set_task_status(p_task_id uuid, p_status text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_task_status(p_task_id uuid, p_status text) TO anon;
GRANT ALL ON FUNCTION public.set_task_status(p_task_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.set_task_status(p_task_id uuid, p_status text) TO service_role;


--
-- Name: FUNCTION set_user_roles(p_user_id uuid, p_roles text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_user_roles(p_user_id uuid, p_roles text[]) TO anon;
GRANT ALL ON FUNCTION public.set_user_roles(p_user_id uuid, p_roles text[]) TO authenticated;
GRANT ALL ON FUNCTION public.set_user_roles(p_user_id uuid, p_roles text[]) TO service_role;


--
-- Name: FUNCTION take_project(p_project_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.take_project(p_project_id uuid) TO anon;
GRANT ALL ON FUNCTION public.take_project(p_project_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.take_project(p_project_id uuid) TO service_role;


--
-- Name: FUNCTION top_clients(p_limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.top_clients(p_limit integer) TO anon;
GRANT ALL ON FUNCTION public.top_clients(p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.top_clients(p_limit integer) TO service_role;


--
-- Name: FUNCTION touch_clients_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_clients_updated_at() TO anon;
GRANT ALL ON FUNCTION public.touch_clients_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.touch_clients_updated_at() TO service_role;


--
-- Name: FUNCTION touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_updated_at() TO anon;
GRANT ALL ON FUNCTION public.touch_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.touch_updated_at() TO service_role;


--
-- Name: FUNCTION trg_log_member_activity(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_log_member_activity() TO anon;
GRANT ALL ON FUNCTION public.trg_log_member_activity() TO authenticated;
GRANT ALL ON FUNCTION public.trg_log_member_activity() TO service_role;


--
-- Name: FUNCTION trg_log_project_activity(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_log_project_activity() TO anon;
GRANT ALL ON FUNCTION public.trg_log_project_activity() TO authenticated;
GRANT ALL ON FUNCTION public.trg_log_project_activity() TO service_role;


--
-- Name: FUNCTION trg_log_task_activity(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trg_log_task_activity() TO anon;
GRANT ALL ON FUNCTION public.trg_log_task_activity() TO authenticated;
GRANT ALL ON FUNCTION public.trg_log_task_activity() TO service_role;


--
-- Name: FUNCTION tz_create_v1_on_task_insert(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tz_create_v1_on_task_insert() TO anon;
GRANT ALL ON FUNCTION public.tz_create_v1_on_task_insert() TO authenticated;
GRANT ALL ON FUNCTION public.tz_create_v1_on_task_insert() TO service_role;


--
-- Name: FUNCTION unlink_telegram(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.unlink_telegram() TO anon;
GRANT ALL ON FUNCTION public.unlink_telegram() TO authenticated;
GRANT ALL ON FUNCTION public.unlink_telegram() TO service_role;


--
-- Name: FUNCTION update_file_public_status(p_file_id uuid, p_is_public boolean, p_public_url text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_file_public_status(p_file_id uuid, p_is_public boolean, p_public_url text) TO anon;
GRANT ALL ON FUNCTION public.update_file_public_status(p_file_id uuid, p_is_public boolean, p_public_url text) TO authenticated;
GRANT ALL ON FUNCTION public.update_file_public_status(p_file_id uuid, p_is_public boolean, p_public_url text) TO service_role;


--
-- Name: FUNCTION update_notification_settings(p_project_taken boolean, p_team_invite boolean, p_comment boolean, p_deadline boolean, p_notif_task boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_notification_settings(p_project_taken boolean, p_team_invite boolean, p_comment boolean, p_deadline boolean, p_notif_task boolean) TO anon;
GRANT ALL ON FUNCTION public.update_notification_settings(p_project_taken boolean, p_team_invite boolean, p_comment boolean, p_deadline boolean, p_notif_task boolean) TO authenticated;
GRANT ALL ON FUNCTION public.update_notification_settings(p_project_taken boolean, p_team_invite boolean, p_comment boolean, p_deadline boolean, p_notif_task boolean) TO service_role;


--
-- Name: FUNCTION validate_client_task_assignee(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validate_client_task_assignee() TO anon;
GRANT ALL ON FUNCTION public.validate_client_task_assignee() TO authenticated;
GRANT ALL ON FUNCTION public.validate_client_task_assignee() TO service_role;


--
-- Name: TABLE clients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.clients TO anon;
GRANT ALL ON TABLE public.clients TO authenticated;
GRANT ALL ON TABLE public.clients TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE project_comments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_comments TO anon;
GRANT ALL ON TABLE public.project_comments TO authenticated;
GRANT ALL ON TABLE public.project_comments TO service_role;


--
-- Name: TABLE project_files; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_files TO anon;
GRANT ALL ON TABLE public.project_files TO authenticated;
GRANT ALL ON TABLE public.project_files TO service_role;


--
-- Name: TABLE project_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_members TO anon;
GRANT ALL ON TABLE public.project_members TO authenticated;
GRANT ALL ON TABLE public.project_members TO service_role;


--
-- Name: TABLE project_payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_payments TO anon;
GRANT ALL ON TABLE public.project_payments TO authenticated;
GRANT ALL ON TABLE public.project_payments TO service_role;


--
-- Name: TABLE project_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_requests TO anon;
GRANT ALL ON TABLE public.project_requests TO authenticated;
GRANT ALL ON TABLE public.project_requests TO service_role;


--
-- Name: TABLE project_shares; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_shares TO anon;
GRANT ALL ON TABLE public.project_shares TO authenticated;
GRANT ALL ON TABLE public.project_shares TO service_role;


--
-- Name: TABLE project_visibility; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.project_visibility TO anon;
GRANT ALL ON TABLE public.project_visibility TO authenticated;
GRANT ALL ON TABLE public.project_visibility TO service_role;


--
-- Name: TABLE projects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.projects TO anon;
GRANT ALL ON TABLE public.projects TO authenticated;
GRANT ALL ON TABLE public.projects TO service_role;


--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_subscriptions TO anon;
GRANT ALL ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;


--
-- Name: TABLE task_photos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_photos TO anon;
GRANT ALL ON TABLE public.task_photos TO authenticated;
GRANT ALL ON TABLE public.task_photos TO service_role;


--
-- Name: TABLE telegram_link_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.telegram_link_codes TO anon;
GRANT ALL ON TABLE public.telegram_link_codes TO authenticated;
GRANT ALL ON TABLE public.telegram_link_codes TO service_role;


--
-- Name: TABLE transactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.transactions TO anon;
GRANT ALL ON TABLE public.transactions TO authenticated;
GRANT ALL ON TABLE public.transactions TO service_role;


--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_roles TO anon;
GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict pgUkKqNV96Lgo6dN8nLj87fK2rdPcbZtBw8LnjEJYKNC6JVRqvc7eDb4BQyyXKg


-- ============================================================================
-- Триггеры на auth.users (в дамп схемы public не входят, сняты отдельно):
-- ============================================================================
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER on_auth_user_created_meta AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user_meta();
