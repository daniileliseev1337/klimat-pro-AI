-- Этап 6.4b: RLS версий ТЗ и комментариев. Idempotent.

-- task_tz_versions: только SELECT через can_access_task.
-- INSERT/UPDATE/DELETE — без политик (default-deny), мутации только через SECURITY DEFINER RPC.
DROP POLICY IF EXISTS tz_versions_select ON public.task_tz_versions;
CREATE POLICY tz_versions_select ON public.task_tz_versions FOR SELECT USING (
  public.can_access_task(task_id)
);

-- task_comments: SELECT через can_access_task; INSERT под RLS; UPDATE/DELETE без политик.
DROP POLICY IF EXISTS task_comments_select ON public.task_comments;
CREATE POLICY task_comments_select ON public.task_comments FOR SELECT USING (
  public.can_access_task(task_id)
);

DROP POLICY IF EXISTS task_comments_insert ON public.task_comments;
CREATE POLICY task_comments_insert ON public.task_comments FOR INSERT WITH CHECK (
  public.is_approved()
  AND author_id = auth.uid()
  AND public.can_access_task(task_id)
);
