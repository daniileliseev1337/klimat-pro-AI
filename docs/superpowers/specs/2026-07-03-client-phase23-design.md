# Портал заказчика Фазы 2-3 (переписка + файлы + уведомления) — дизайн

Дата: 2026-07-03. Стадия: дизайн (brainstorm завершён, одобрен владельцем «всё чётко»).
Метод: superpowers:brainstorming (4 развилки → находка по edge из кода → дизайн по секциям → approval).
Продолжает: `2026-06-22-client-role-design.md` (Фаза 1 — ядро роли заказчика, реализована и в проде).
Следующий шаг: writing-plans → отдельные планы Фаза 2, затем Фаза 3.

## 1. Контекст (сверено с кодом 2026-07-03)

Фаза 1 роли заказчика реализована и **разрослась** за рамки старой спеки: система ролей
(`user_roles`, `myRoles`, переключатель вида) + портал заказчика с вкладками Дашборд/Проекты/Задачи/Финансы.
Готовая инфраструктура, на которую опираемся:
- Хелпер `is_project_client(p_project_id) → boolean` (SECURITY DEFINER, `search_path=public,pg_temp`) — уже в БД,
  гейт «привязанный заказчик проекта». Хелпер `can_access_project_comments(p_project_id)` — гейт команды.
- `is_approved()`, `is_admin()`, `is_project_owner(pid)` — существующие хелперы.
- Заказчик открывает проект через модалку `ClientProjectTasksModal` (App.jsx:7290) — сейчас только задачи.
- Команда: карточка проекта имеет `CommentsSection` (App.jsx:6120, внутренние комментарии) и `ProjectFiles`
  (App.jsx:6338, файлы; флаг `is_public`+`public_url`+edge-action `toggle-public` = публичная ссылка наружу).
- Edge `nextcloud` (deploy/nextcloud/functions/nextcloud/index.ts): upload (стрим, insert под RLS),
  download (**читает метаданные `project_files` под JWT пользователя → RLS**, байты через WebDAV под service).

**В коде отсутствует (0 совпадений грепом):** `client_messages`, `client_visible`.

## 2. Решения владельца (brainstorm 2026-07-03)

1. **Файлы «для заказчика» — новый флаг `client_visible`** (НЕ переиспускать `is_public`): «виден в портале
   привязанному заказчику» ≠ «доступен по публичной ссылке любому». `is_public` остаётся своей функцией.
2. **UI заказчика — вкладки в модалке проекта** (`ClientProjectTasksModal`): Задачи / Сообщения / Файлы.
   Минимальное касание структуры портала, контекст проекта не теряется.
3. **UI команды — новая секция «Переписка с заказчиком»** рядом с `CommentsSection` (визуально отделена от
   внутренних комментариев) + галочка «показать заказчику» на каждом файле в `ProjectFiles`.
4. **Scope — обе фазы в одном спеке, реализация поэтапно:** Фаза 2 (переписка+файлы) сначала (её можно
   выкатить и пользоваться), Фаза 3 (уведомления) — отдельным планом после.
5. **Realtime — вне scope** (принято по умолчанию): переписка обновляется refetch'ем (паттерн приложения —
   reload после мутации), без Realtime-подписки для MVP.

## 3. Находка по edge (проверено по коду, не гипотеза)

Download-ветка edge `nextcloud` (index.ts:213-222) читает метаданные `project_files` через `rest(..., authHeader)`
— **под JWT пользователя, RLS применяется** («select под RLS — вернёт строку только при наличии доступа»).
Следствие: после расширения RLS `files_select` веткой `client_visible AND is_project_client` заказчик под своим
JWT качает `client_visible`-файл; не-`client_visible` / чужой файл → RLS вернёт пусто → edge отдаст 403 сам.
**Edge-функцию `nextcloud` менять НЕ нужно.** Старая спека (2026-06-22, разделы 6 и 12) предлагала
дублирующую проверку `client_visible AND is_project_client` в edge — по факту она избыточна (edge безопасен
по построению: JWT+RLS на метаданных). Упрощение против прежнего плана.

## 4. Модель данных (Фаза 2)

**4.1. Таблица `client_messages`** — переписка заказчик↔команда по проекту:
```sql
create table public.client_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id  uuid not null references auth.users(id)   on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index idx_client_messages_project on public.client_messages(project_id, created_at);
alter table public.client_messages enable row level security;
```
RLS:
- **select** `client_messages_select`: `is_project_client(project_id) OR can_access_project_comments(project_id)`.
- **insert** `client_messages_insert` (with check): `author_id = auth.uid() AND is_approved()
  AND (is_project_client(project_id) OR can_access_project_comments(project_id))`.
- **update/delete** — политик НЕ создаём (сообщения неизменны; правка/удаление — при явном запросе, YAGNI).

**4.2. Колонка `project_files.client_visible`**:
```sql
alter table public.project_files add column if not exists client_visible boolean not null default false;
```
Расширить политику `files_select` (пересоздать), добавив ветку заказчика:
`can_access_project_comments(project_id) OR (client_visible AND is_project_client(project_id))`.
Остальные политики `project_files` (insert/update/delete) — без изменений.

## 5. RPC (единообразно с проектом — паттерн `get_tasks` / `get_project_files`)

Все — `LANGUAGE plpgsql SECURITY DEFINER`, `set search_path = public, pg_temp`, GRANT execute to authenticated.

- **`get_client_messages(p_project_id uuid)`** → `table(id uuid, author_id uuid, author_name text,
  is_mine boolean, body text, created_at timestamptz)`. Гейт: `IF NOT (is_project_client(p_project_id)
  OR can_access_project_comments(p_project_id)) THEN RETURN; END IF;`. `author_name` = `COALESCE(p.name, p.email,
  'Пользователь')` из join `profiles` (заказчику `profiles` напрямую не открываем); `is_mine = (author_id = auth.uid())`.
  Порядок `created_at ASC`.
- **`post_client_message(p_project_id uuid, p_body text)`** → `uuid`. Гейт тот же + `is_approved()`.
  `p_body := btrim(p_body); IF length(p_body) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION ...`.
  `INSERT ... (project_id, author_id=auth.uid(), body=p_body) RETURNING id`.
- **`get_client_project_files(p_project_id uuid)`** → `table(id uuid, filename text, file_size bigint,
  mime_type text, uploader_name text, created_at timestamptz)`. Гейт: `IF NOT is_project_client(p_project_id)
  THEN RETURN; END IF;`. `WHERE project_id = p_project_id AND client_visible = true`. **Без** `disk_path`,
  `owner_id`, `is_public`, `public_url`. `uploader_name` из join `profiles`. Порядок `created_at DESC`.
- **`set_file_client_visible(p_file_id uuid, p_visible boolean)`** → `void`. Гейт: загрузивший файл
  (`owner_id=auth.uid()`) OR owner проекта файла (`is_project_owner(project_id)`) OR `is_admin()`; иначе
  `RAISE EXCEPTION 'access denied'`. `UPDATE project_files SET client_visible = p_visible WHERE id = p_file_id`.

## 6. Edge `nextcloud` (без изменений)

Не трогаем (см. §3). Download заказчиком `client_visible`-файла работает через существующую ветку `action=download`
(select под JWT+RLS → байты под service). Защита не-`client_visible`/чужого — та же RLS `files_select`.

## 7. Фронт заказчика — вкладки в `ClientProjectTasksModal`

Переключатель вкладок **Задачи / Сообщения / Файлы** (локальный `useState`, стиль существующих табов):
- **Задачи** — текущий код без изменений.
- **Сообщения** — тред из `get_client_messages` (пузыри свой/чужой по `is_mine`, имя автора, время), поле ввода
  + кнопка «Отправить» (`post_client_message`), refetch после отправки. Пустой тред → `Empty`.
- **Файлы** — список из `get_client_project_files` (имя, размер, дата, загрузивший) + кнопка «Скачать»
  (`downloadProjectFile` — уже есть). Заказчик файлы НЕ загружает (вне scope). Пусто → «Файлов для вас пока нет».

Новые API-обёртки в App.jsx: `fetchClientMessages(client, projectId)`, `postClientMessage(client, projectId, body)`,
`fetchClientVisibleFiles(client, projectId)`. `downloadProjectFile` переиспользуем.

## 8. Фронт команды — карточка проекта сотрудника

- **Секция «Переписка с заказчиком»** рядом с `CommentsSection`: те же `get_client_messages`/`post_client_message`
  (обе стороны — один тред, один RPC-гейт). Визуально отделить от внутренних комментариев (иная рамка/подпись
  «виден заказчику»), чтобы команда не спутала внутреннее с клиентским. Если у проекта нет привязанного
  заказчика — секцию показывать, но с пометкой «у проекта нет привязанного заказчика» (сообщения увидит только команда).
- **`ProjectFiles`**: на каждом файле тоггл «показать заказчику» (`set_file_client_visible`) + индикатор текущего
  `client_visible`. `get_project_files` (командный список) дополнить возвратом `client_visible` (добавить колонку
  в RETURNS TABLE и SELECT — обратносовместимо для остальных потребителей, читают по имени поля).

## 9. Уведомления (Фаза 3 — отдельный план)

Надстройка над `web-push-notify` (edge) + `notifications` (inbox). Новые типы:
- **`client_message`** — двусторонний: заказчик написал → адресат команда (owner проекта + project_members);
  команда написала → адресат привязанный заказчик (`clients.user_id` по `projects.client_id`). Инициатор исключён.
- **`client_new_file`** — файл помечен `client_visible=true` → адресат заказчик.
- **`client_stage_changed`** — сменилась `projects.stage` → адресат заказчик.

Резолв адресатов — новые ветки в edge (по `projects.client_id → clients.user_id` для заказчика; owner+members
для команды). Управление — существующие флаги `notif_*` (заказчик — обычный пользователь). Требует edge-деплоя
(`cp`, как обычно). Избегать дубля для заказчика-он-же-исполнителя на одном проекте (дедуп по user_id).
Направления/тексты/точки вызова (после `post_client_message` / `set_file_client_visible` / смены стадии) —
детализируются в плане Фазы 3.

## 10. Критерии верификации (живая БД: BEGIN…ROLLBACK, эмуляция через `request.jwt.claims`)

Фаза 2:
1. Привязанный заказчик: `post_client_message`/`get_client_messages` своего проекта — ок; НЕ привязанный /
   чужой проект — пусто (get) и exception (post).
2. Заказчик НЕ видит `project_comments` (внутренние) — регрессия отдельного канала.
3. `get_client_project_files` заказчику отдаёт только `client_visible=true`; edge `download` `client_visible`-файла
   → 200; не-`client_visible` / чужого → 403 (RLS).
4. `set_file_client_visible` под не-owner-файла/не-owner-проекта/не-admin → exception; под owner/admin → флаг меняется.
5. Команда (`can_access_project_comments`) видит и пишет `client_messages`; заказчик и команда — один тред.
6. Совмещение ролей: заказчик-он-же-исполнитель на другом проекте видит его как раньше (регрессия `projects`/`files` RLS).

Фаза 3 (в своём плане): адресаты каждого типа корректны; инициатор/дубли исключены; `notif_*` фильтруют push.

## 11. Вне scope (YAGNI)

- Realtime-подписка переписки (MVP — refetch); загрузка файлов заказчиком из портала; правка/удаление сообщений;
  вложения в сообщениях; статус «прочитано»; треды/ответы. Публичная ссылка (`is_public`) не меняется.

## 12. Ловушки среды (из CLAUDE.md / прошлых сессий)

- Миграции тестировать транзакционно (BEGIN…ROLLBACK) на живой БД через `docker exec -i supabase-db psql`
  (кириллица в пути → stdin/файл, не инлайн); применение к БД — только по слову «деплой».
- `App.jsx` — монолит: править точечно, новые компоненты — по возможности отдельными функциями в файле.
- Диск F: fsync-сбои — git `-c core.fsyncMethod=writeout-only`; edge-деплой (Фаза 3) — только `cp` с /mnt/f.
- `get_project_files` меняем аддитивно (новая колонка в конце RETURNS TABLE) — не сломать существующий фронт.
