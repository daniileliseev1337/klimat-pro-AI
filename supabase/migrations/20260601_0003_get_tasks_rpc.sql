CREATE OR REPLACE FUNCTION public.get_tasks(
  p_project_id  uuid DEFAULT NULL,
  p_status      text DEFAULT NULL,
  p_assigned_to uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, project_id uuid, project_name text,
  author_id uuid, author_name text,
  assigned_to uuid, assignee_name text,
  title text, description text, status text, priority text,
  due_date date, sort_order int,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.project_id, pr.name,
         t.author_id, COALESCE(pa.name, pa.email, 'Пользователь'),
         t.assigned_to, COALESCE(pas.name, pas.email),
         t.title, t.description, t.status, t.priority,
         t.due_date, t.sort_order, t.created_at, t.updated_at
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

GRANT EXECUTE ON FUNCTION public.get_tasks(uuid, text, uuid) TO authenticated;
