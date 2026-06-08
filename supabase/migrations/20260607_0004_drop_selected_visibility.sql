-- Убрано задвоение доступа: режим видимости 'selected' («Избранные») дублировал
-- «Команду проекта» (project_members) — оба давали пользователю видеть проект.
-- Оставляем единый механизм точечного доступа — project_members.
--
-- Таблица project_visibility пуста (0 строк) — доступ никому не выдавался через selected,
-- поэтому смена selected → private безопасна (поведение не меняется).
-- Таблицу project_visibility и RPC set/get_project_visibility_users НЕ удаляем — оставляем
-- мёртвыми (UI их больше не вызывает) на случай отката.

update public.projects set visibility = 'private' where visibility = 'selected';
