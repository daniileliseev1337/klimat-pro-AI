-- Несколько исполнителей проекта (фидбэк из живой проверки фичи долей).
-- executors jsonb: массив [{ "name": text, "userId": uuid|null }].
-- Поле executor (text) остаётся производной строкой имён (через запятую) — для совместимости
-- с карточкой/фильтрами/отчётами, которые читают projects.executor.

alter table public.projects
  add column if not exists executors jsonb not null default '[]'::jsonb;

-- backfill: существующие проекты с непустым executor → один исполнитель (без привязки к аккаунту).
update public.projects
set executors = jsonb_build_array(jsonb_build_object('name', executor, 'userId', null))
where coalesce(executor, '') <> ''
  and (executors is null or executors = '[]'::jsonb);
