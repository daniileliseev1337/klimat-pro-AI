-- Заход №2 редизайна задач: фото-отчёты. Метаданные файлов в Nextcloud (tasks/<task_id>/).
-- Видимость — стороны задачи (can_access_task, SECURITY DEFINER из 20260602_0004/20260611_0001).
CREATE TABLE IF NOT EXISTS public.task_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  file_path   text NOT NULL,           -- путь в Nextcloud: tasks/<task_id>/<uuid>__<имя>
  file_name   text NOT NULL,
  file_size   int  NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_photos_task ON public.task_photos(task_id);

ALTER TABLE public.task_photos ENABLE ROW LEVEL SECURITY;

-- читают стороны задачи (автор/исполнитель/админ/участники проекта — предикат can_access_task)
DROP POLICY IF EXISTS task_photos_select ON public.task_photos;
CREATE POLICY task_photos_select ON public.task_photos
  FOR SELECT TO authenticated
  USING (public.can_access_task(task_id));

-- грузит любая сторона задачи, авторство фиксируется за собой
DROP POLICY IF EXISTS task_photos_insert ON public.task_photos;
CREATE POLICY task_photos_insert ON public.task_photos
  FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND public.can_access_task(task_id));

-- удаляет только загрузивший
DROP POLICY IF EXISTS task_photos_delete ON public.task_photos;
CREATE POLICY task_photos_delete ON public.task_photos
  FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.task_photos TO authenticated;
