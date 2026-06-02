-- Этап 6.4b: версия №1 approved при создании НОВОЙ задачи с непустым description.
-- Закрывает спек §2 для новых задач (backfill 20260602_0006 покрывал только существующие).
-- SECURITY DEFINER обязателен: у task_tz_versions нет INSERT-политики (default-deny),
-- под обычным пользователем вставка иначе не пройдёт.
CREATE OR REPLACE FUNCTION public.tz_create_v1_on_task_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP TRIGGER IF EXISTS trg_tz_v1_on_task_insert ON public.project_tasks;
CREATE TRIGGER trg_tz_v1_on_task_insert
  AFTER INSERT ON public.project_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tz_create_v1_on_task_insert();
