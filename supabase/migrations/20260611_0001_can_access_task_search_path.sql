-- I-2 hardening (m4): can_access_task — SECURITY DEFINER без SET search_path.
-- Сейчас не дыра (все идентификаторы квалифицированы public.), но приводим к стандарту
-- остальных SECURITY DEFINER функций. Пересоздаём 1-в-1 с добавлением search_path.
CREATE OR REPLACE FUNCTION public.can_access_task(p_task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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

GRANT EXECUTE ON FUNCTION public.can_access_task(uuid) TO authenticated;
