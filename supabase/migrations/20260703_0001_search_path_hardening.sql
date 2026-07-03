-- 20260703_0001: SET search_path на старые SECURITY DEFINER функции (I-2 hardening)
-- Аудит 2026-07-03: 7 функций из миграций 20260601-20260602 созданы до policy 20260611
-- и не имеют фиксированного search_path. Не дыра (public-объекты), но выравниваем
-- под стандарт: search_path = public, pg_temp. ALTER не трогает тела функций.

ALTER FUNCTION public.update_notification_settings(boolean, boolean, boolean, boolean, boolean)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_task_versions(uuid)      SET search_path = public, pg_temp;
ALTER FUNCTION public.approve_tz_version(uuid)     SET search_path = public, pg_temp;
ALTER FUNCTION public.reject_tz_version(uuid)      SET search_path = public, pg_temp;

ALTER FUNCTION public.get_task_comments(uuid)      SET search_path = public, pg_temp;
ALTER FUNCTION public.resolve_question(uuid, boolean) SET search_path = public, pg_temp;
ALTER FUNCTION public.set_task_status(uuid, text)  SET search_path = public, pg_temp;

