-- Флаг broadcast-уведомления о новых проектах в поиске исполнителя.
-- Фронт пишет его прямым update profiles под RLS (RPC update_notification_settings
-- живёт только в живой БД и в репо-миграциях отсутствует — не трогаем здесь).
alter table public.profiles
  add column if not exists notif_new_project boolean not null default true;
