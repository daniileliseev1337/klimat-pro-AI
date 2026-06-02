-- Этап 6.4b: RPC версий ТЗ. Все SECURITY DEFINER, дублируют проверку доступа.

-- 1) get_task_versions: список версий задачи + имена сторон, сортировка по version_no.
CREATE OR REPLACE FUNCTION public.get_task_versions(p_task_id uuid)
RETURNS TABLE (
  id uuid, task_id uuid, version_no int, content text, status text,
  proposed_by uuid, proposed_by_name text,
  resolved_by uuid, resolved_by_name text,
  created_at timestamptz, resolved_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
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

GRANT EXECUTE ON FUNCTION public.get_task_versions(uuid) TO authenticated;

-- 2) propose_tz_version: предложить новую версию ТЗ.
--    Ветки §4: при assigned_to IS NOT NULL и вызывающий = автор ИЛИ исполнитель -> pending.
--    Иначе (нет исполнителя, либо посторонний редактор/админ) -> сразу approved + sync description.
CREATE OR REPLACE FUNCTION public.propose_tz_version(p_task_id uuid, p_content text)
RETURNS public.task_tz_versions
LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
DECLARE
  t            public.project_tasks%ROWTYPE;
  v_caller     uuid := auth.uid();
  v_is_party   boolean;   -- автор или исполнитель задачи
  v_can_edit   boolean;   -- редактор проекта или админ
  v_next_no    int;
  v_status     text;
  v_resolved   uuid;
  v_resolved_at timestamptz;
  v_row        public.task_tz_versions%ROWTYPE;
BEGIN
  IF NOT public.is_approved() THEN
    RAISE EXCEPTION 'not_approved';
  END IF;

  SELECT * INTO t FROM public.project_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found';
  END IF;
  IF NOT public.can_access_task(p_task_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  v_is_party := (t.author_id = v_caller OR t.assigned_to = v_caller);
  v_can_edit := public.is_admin()
                OR (t.project_id IS NOT NULL AND public.is_project_editor(t.project_id));

  IF NOT (v_is_party OR v_can_edit) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- одна pending за раз
  IF EXISTS (SELECT 1 FROM public.task_tz_versions
             WHERE task_id = p_task_id AND status = 'pending') THEN
    RAISE EXCEPTION 'tz_pending_exists';
  END IF;

  -- решение ветки: автор/исполнитель при наличии исполнителя -> двусторонний апрув (pending)
  IF t.assigned_to IS NOT NULL AND v_is_party THEN
    v_status := 'pending'; v_resolved := NULL; v_resolved_at := NULL;
  ELSE
    v_status := 'approved'; v_resolved := v_caller; v_resolved_at := now();
  END IF;

  SELECT COALESCE(max(version_no), 0) + 1 INTO v_next_no
  FROM public.task_tz_versions WHERE task_id = p_task_id;

  INSERT INTO public.task_tz_versions
    (task_id, version_no, content, status, proposed_by, resolved_by, resolved_at)
  VALUES
    (p_task_id, v_next_no, p_content, v_status, v_caller, v_resolved, v_resolved_at)
  RETURNING * INTO v_row;

  IF v_status = 'approved' THEN
    UPDATE public.project_tasks SET description = p_content WHERE id = p_task_id;
  END IF;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.propose_tz_version(uuid, text) TO authenticated;

-- 3) approve_tz_version: апрувит ПРОТИВОПОЛОЖНАЯ сторона; sync description.
CREATE OR REPLACE FUNCTION public.approve_tz_version(p_version_id uuid)
RETURNS public.task_tz_versions
LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
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

GRANT EXECUTE ON FUNCTION public.approve_tz_version(uuid) TO authenticated;

-- 4) reject_tz_version: отклоняет противоположная сторона; description НЕ меняется.
CREATE OR REPLACE FUNCTION public.reject_tz_version(p_version_id uuid)
RETURNS public.task_tz_versions
LANGUAGE plpgsql VOLATILE SECURITY DEFINER AS $$
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

GRANT EXECUTE ON FUNCTION public.reject_tz_version(uuid) TO authenticated;
