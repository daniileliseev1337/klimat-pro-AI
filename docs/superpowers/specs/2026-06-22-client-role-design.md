# D «Роль заказчика» (доступ заказчика к своим проектам) — дизайн

Дата: 2026-06-22. Стадия: дизайн (brainstorm завершён, одобрен владельцем).
Метод: superpowers:brainstorming (6 уточняющих вопросов → подходы → дизайн по секциям → approval).
Следующий шаг: writing-plans → реализация по фазам.

## 1. Контекст и проблема

Замечание D из эксплуатации: дать заказчику доступ в систему, чтобы он видел свои проекты и получал
отдельные уведомления. Один конкретный заказчик точно будет пользоваться сайтом.

**Текущее состояние (разведка кода + живой БД):**
- `clients` — справочник заказчиков-**контактов** (id, owner_id=сотрудник-автор, name, phone, email, telegram,
  client_type, category, legal_name, inn, address, city, notes). RLS: видит только owner + admin.
  **НЕ связан с auth-аккаунтом самого заказчика** — записная книжка сотрудника. «Заказчик — неживая функция».
- `projects.client_id` → FK `clients` (какой заказчик у проекта). На существующих заказчиках уже есть проекты.
- `profiles` — сотрудники, `role` CHECK строго `('admin','user')`, `role==='admin'` используется в коде ~24 раза.
- `project_comments` — внутренние комментарии команды (RLS `can_access_project_comments`); триггер
  `notify_comment_telegram` (legacy). `project_files` — файлы (RLS `can_access_project_comments`), edge `nextcloud`
  для upload/download. Регистрация: autoconfirm + админ `approved`.
- Главное меню `TABS` (App.jsx): dashboard / projects / … / clients.

## 2. Решения владельца (brainstorm)

1. **Сценарий:** портал + взаимодействие (заказчик видит свои проекты + комментирует/вопросы + видит файлы).
2. **Связь:** через справочник `clients` — привязка `clients.user_id` к аккаунту (а не попроектное членство).
3. **Роль НЕ взаимоисключающая:** один человек может быть И заказчиком, И исполнителем. Поэтому НЕ вводим
   `profiles.role='client'` (ломала бы совмещение и 24 места `role==='admin'`) — заказчик это обычный аккаунт + привязка.
4. **Видимость денег:** заказчик видит сумму договора и сколько оплачено (его деньги), стадию/сроки/статус;
   **НЕ видит** доли исполнителей и внутренние заметки (`notes`).
5. **Взаимодействие — отдельный канал:** «переписка с заказчиком» (новая сущность) + файлы, помеченные
   «для заказчика». Внутренние комментарии и рабочие файлы команды заказчику не видны.
6. **Онбординг:** заказчик регистрируется сам (autoconfirm) → сотрудник/админ привязывает его аккаунт к записи
   на вкладке «Заказчики» (autocomplete по approved-пользователям).
7. **UI:** отдельный раздел «Мои заказы» (таб, виден только у привязанного заказчика) — урезанный клиентский взгляд.

## 3. Подход к доступу (выбран C — гибрид)

Заказчик не должен читать приватные колонки (`notes`, доли) и внутренние комментарии.
- A. Всё через RPC-проекции — безопасно, но много RPC.
- B. RLS-ветки + прятать поля на фронте — ❌ небезопасно (заказчик через прямой API прочитает скрытые колонки).
- **C (выбран):** `projects` (есть приватные колонки) → RPC-проекция безопасных полей; новые «чистые» сущности
  заказчика (`client_messages`, флаг `client_visible` на файлах) проектируем без приватных полей → им хватает RLS
  с гейтом «привязанный заказчик».

## 4. Модель данных

- `clients.user_id uuid` (nullable, FK `auth.users ON DELETE SET NULL`), индекс по `user_id where user_id is not null`.
  Привязка аккаунта к записи заказчика. Один аккаунт может стоять на нескольких записях.
- Хелпер `is_project_client(p_project_id uuid) → boolean` (STABLE SECURITY DEFINER, `set search_path=public,pg_temp`):
  `EXISTS (projects p JOIN clients c ON c.id=p.client_id WHERE p.id=p_project_id AND c.user_id=auth.uid())`.
  Переиспользуется в RLS `client_messages`/`project_files`.
- **Роль не вводим.**

## 5. Доступ к проектам-заказам (read)

- RPC `get_my_client_projects()` (SECURITY DEFINER, `set search_path=public,pg_temp`) → returns table безопасных полей:
  `id, name, stage, start_date, deadline, contract_sum, paid_amount, executor` (текстовые имена исполнителей).
  Источник: `projects p JOIN clients c ON c.id=p.client_id WHERE c.user_id=auth.uid()`. **БЕЗ** `notes`, `owner_id`,
  без `project_shares`. GRANT authenticated.
- Деталь одного заказа — та же проекция (одна строка) + (фаза 2) список `client_visible` файлов и переписка.
- UI: раздел «Мои заказы» (новый таб). **Критерий видимости таба** (однозначно): аккаунт привязан хотя бы к одной
  записи `clients` (`exists clients where user_id=auth.uid()`) — отдельный лёгкий флаг `hasClientRole`, грузится при
  старте (чтобы таб был виден и когда заказов пока 0 — покажем «заказов нет»). → список карточек-заказов → карточка
  (стадия/сроки/договор/оплачено; фаза 2 — файлы+переписка).

## 6. Взаимодействие — отдельный канал (фаза 2)

- Таблица `client_messages (id, project_id FK projects, author_id FK auth.users, body text, created_at)`.
  RLS select/insert: `is_project_client(project_id) OR can_access_project_comments(project_id)` (заказчик ИЛИ команда);
  insert — `author_id=auth.uid() AND is_approved()`. Добавить в `supabase_realtime` (живая переписка — опц.).
- `project_files.client_visible boolean NOT NULL default false`. Заказчик видит/качает только `client_visible`
  файлы своих заказов: RLS-ветка select `files: (can_access_project_comments) OR (client_visible AND is_project_client)`;
  **edge `nextcloud` download** дополнительно проверяет: если запрос от заказчика — файл должен быть `client_visible`
  и `is_project_client`. Команда помечает файл галочкой «показать заказчику» (update `client_visible`, owner/admin).

## 7. Онбординг (привязка) (фаза 1)

- `ClientsPage`, карточка заказчика → «Привязать аккаунт»: autocomplete по approved-пользователям (паттерн
  `searchApprovedUsers`) → запись `clients.user_id`. Доступно владельцу записи + админу. Показ привязанного
  аккаунта + кнопка «Отвязать» (`user_id=null`). Привязка через RPC `set_client_user(p_client_id, p_user_id)`
  (SECURITY DEFINER, гейт owner записи/admin) — чтобы не открывать клиентам прямой update `clients`.
- Заказчик предварительно регистрируется сам (существующий autoconfirm-флоу). До привязки раздел «Мои заказы» пуст/скрыт.

## 8. Уведомления заказчику (фаза 3)

- Переиспользуем push/inbox (`web-push-notify` edge + `notifications`). Новые типы: `client_stage_changed`,
  `client_new_file`, `client_message`. Адресат — привязанный заказчик проекта (`clients.user_id` по `project.client_id`).
  Управление — флаги `notif_*` (заказчик регулирует как обычный пользователь).

## 9. Фазы реализации (один спек, поэтапно)

- **Фаза 1 (ядро):** `clients.user_id` + `is_project_client` + `get_my_client_projects` + RPC `set_client_user` +
  UI привязки на ClientsPage + раздел «Мои заказы» (read-only: стадия/сроки/договор/оплаты).
- **Фаза 2 (взаимодействие):** `client_messages` (+RLS) + `project_files.client_visible` (+RLS +edge-проверка) +
  UI переписки и файлов в карточке заказа + галочка «для заказчика» в команде.
- **Фаза 3 (уведомления):** типы push/inbox заказчику.

## 10. Критерии верификации

На живой БД (транзакции BEGIN…ROLLBACK, эмуляция через `request.jwt.claims`):
1. Привязанный заказчик: `get_my_client_projects()` возвращает его проекты с безопасными полями; `notes`/доли
   отсутствуют в проекции.
2. НЕ привязанный аккаунт: `get_my_client_projects()` пуст.
3. Заказчик НЕ имеет прямого RLS-select на строку `projects` своего заказа (приватные колонки недоступны через API).
4. (Фаза 2) Заказчик видит/пишет `client_messages` своего заказа; НЕ видит `project_comments`; видит только
   `client_visible` файлы; edge-download чужого/не-client_visible файла → отказ.
5. (Фаза 1) Совмещение ролей: тот же аккаунт как исполнитель на другом проекте видит его как раньше (регрессия RLS projects).
6. `set_client_user` под не-владельцем записи (и не админом) → отказ.

## 11. Вне scope (YAGNI)

- Заказчик не редактирует проект, не видит доли/внутренние заметки/внутренние комментарии/чужие проекты.
- Биллинг/онлайн-оплата; мультиязычность; самостоятельное создание проектов заказчиком.
- Авто-создание аккаунта заказчику сотрудником (выбран самостоятельный онбординг).

## 12. Риски и ловушки

- **Приватность колонок:** заказчику НЕЛЬЗЯ давать RLS-select на `projects` (там `notes`, и через джойн —
  доли). Только RPC-проекция. Это причина выбора подхода C.
- **Совмещение ролей:** заказчик может быть исполнителем — нельзя вводить взаимоисключающую `profiles.role`.
  Проверить регрессию `projects_select` (он не меняется; доступ заказчика идёт ОТДЕЛЬНО через RPC, не через RLS projects).
- **edge-файлы:** download заказчиком должен проверять `client_visible AND is_project_client` в edge-функции
  (RLS на метаданные мало — байты идут через WebDAV под service_role в edge).
- **Дубль уведомлений:** заказчик-он-же-исполнитель на одном проекте — избегать двойных уведомлений (фаза 3).
- **Среда:** БД-деплой через `docker exec psql` (кириллица в пути → stdin); git с Windows-стороны
  (`-c core.fsyncMethod=writeout-only` + ретраи); миграции тестировать транзакционно (BEGIN…ROLLBACK);
  применение к БД и web-деплой — только по слову «деплой».
