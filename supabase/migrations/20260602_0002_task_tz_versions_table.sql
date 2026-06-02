-- Этап 6.4b: версии ТЗ задачи (snapshot полного текста description).
CREATE TABLE IF NOT EXISTS public.task_tz_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  version_no  int  NOT NULL,
  content     text NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected')),
  proposed_by uuid NOT NULL REFERENCES public.profiles(id),
  resolved_by uuid REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_task_tz_versions_task        ON public.task_tz_versions(task_id);
CREATE INDEX IF NOT EXISTS idx_task_tz_versions_task_status ON public.task_tz_versions(task_id, status);

-- Одна pending-версия на задачу за раз (блокирующая модель).
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_tz_versions_one_pending
  ON public.task_tz_versions(task_id) WHERE status = 'pending';

ALTER TABLE public.task_tz_versions ENABLE ROW LEVEL SECURITY;
