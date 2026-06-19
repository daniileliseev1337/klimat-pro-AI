-- 20260619_0001_take_project_executors.sql
-- M2-путь2 / замечание C-путь2: исполнитель, берущий проект с маркетплейса САМ
-- (кнопка «Взять в работу»), должен попадать в команду и в список исполнителей
-- так же, как при назначении владельцем.
--
-- Контекст: RPC take_project существовал ТОЛЬКО в живой БД (вне репо-миграций —
-- долг невоспроизводимости). Прежнее определение уже ставило taken_by/stage и
-- добавляло вызывающего в project_members(editor), НО не трогало executors jsonb.
-- Следствие бага: клиент писал лишь текстовый projects.executor; при следующем
-- сохранении формы владельцем projectJsToDb пересобирал executor из ПУСТОГО
-- executors → имя взявшего слетало.
--
-- Эта миграция фиксирует ПОЛНОЕ актуальное определение take_project в репо и
-- расширяет его: атомарно (в одной транзакции функции) заполняет executors jsonb
-- + executor, добавляет в команду editor'ом. Заодно — SET search_path (I-2 hardening).

CREATE OR REPLACE FUNCTION public.take_project(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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
$function$;
