-- Этап 6.4a: таблица задач. Значения status/priority — русские строки (как projects.stage).
CREATE TABLE IF NOT EXISTS public.project_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  author_id   uuid NOT NULL REFERENCES public.profiles(id),
  assigned_to uuid REFERENCES public.profiles(id),
  title       text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'Новая'
              CHECK (status IN ('Новая','В работе','На проверке','Готово','Отменена')),
  priority    text NOT NULL DEFAULT 'Обычный'
              CHECK (priority IN ('Низкий','Обычный','Высокий')),
  due_date    date,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_tasks_project  ON public.project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee ON public.project_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_project_tasks_status   ON public.project_tasks(status);
CREATE INDEX IF NOT EXISTS idx_project_tasks_due      ON public.project_tasks(due_date);

DROP TRIGGER IF EXISTS trg_project_tasks_touch ON public.project_tasks;
CREATE TRIGGER trg_project_tasks_touch
  BEFORE UPDATE ON public.project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Realtime-готовность (idempotent guard — повторное применение не упадёт)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='project_tasks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.project_tasks;
  END IF;
END $$;

ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;
