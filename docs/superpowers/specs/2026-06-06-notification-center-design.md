# Центр уведомлений (in-app inbox) — дизайн

**Дата:** 2026-06-06
**Проект:** daniil-dashboard v3.0 (React + Vite + self-hosted Supabase)
**Статус:** утверждён, готов к writing-plans

## Проблема

Web Push эфемерен: пропустил системное уведомление — в приложении следа нет.
Нужен in-app inbox, который **дополняет** push (не заменяет): durable-лента всех
событий с отметкой прочитанного и badge непрочитанных, обновляемая в реальном времени.

## Ключевые решения (из brainstorming)

1. **Inbox ловит всё всегда.** Строка `notifications` пишется каждому релевантному
   получателю независимо от флагов `notif_*`. Флаги `notif_*` управляют **только** push.
   Это и есть страховка от эфемерности.
2. **Read поэлементно + «прочитать всё».** Клик по строке → read; кнопка «Прочитать всё».
   Badge = число непрочитанных.
3. **Хранить готовые `title`/`body`/`url`** (как в push payload). Плюс лёгкая колонка
   `type` — только для выбора иконки категории на фронте (не для генерации текста).
4. **Retention:** cron удаляет **только прочитанные** старше 7 дней. Непрочитанные не
   трогаем никогда (иначе теряется страховка).
5. **UI:** dropdown-панель ~360px под колокольчиком в правой части top-bar.
6. **Запись строк — подход A:** inline в существующей edge `web-push-notify`, единый
   источник правды по получателям.

## Архитектура

### 1. Таблица `notifications`

```sql
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,                 -- task_assigned | task_status | task_created
                                            -- | deadline | project_taken | team_invite
                                            -- | comment | project_published
  title      text not null,
  body       text not null,
  url        text not null default '/',
  read       boolean not null default false,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_unread_idx
  on public.notifications (user_id, read, created_at desc);
```

Без `related_id` (сознательно — текст хранится готовым). `type` — только ярлык
категории для иконки.

### 2. RLS и Realtime

```sql
alter table public.notifications enable row level security;

-- читать только свои
create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid());

-- помечать прочитанным только свои
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- INSERT клиентам НЕ разрешён (нет policy) → строки пишет только edge через
--   service_role (обходит RLS). Пользователь не может подделать уведомление.

alter publication supabase_realtime add table public.notifications;
```

- Realtime уважает RLS — клиент получает postgres_changes только по своим строкам.
- DELETE клиентам не даём (чистка — cron). «Удалить вручную» — будущая опция, вне скоупа.

### 3. Изменения edge `web-push-notify` (подход A)

Файл: `deploy/web-push/functions/web-push-notify/index.ts`
(прод правится через `volumes/functions/web-push-notify/` + `docker restart supabase-edge-functions`).

Рефактор разделяет два множества получателей:

1. **`baseRecipients`** — кому событие релевантно (минус инициатор `initiatorId`),
   **без** флаг-фильтра.
2. Один батч-`POST /rest/v1/notifications` (массив строк, заголовок `Prefer: return=minimal`,
   service_role) — пишем `{user_id, type, title, body, url}` **всем** из `baseRecipients`.
3. **Push-ветка** (как сейчас): фильтруем `baseRecipients` по флагу `notif_*` + наличию
   подписки → web-push. Флаги влияют **только** сюда.

Правила:
- **Порядок: сначала INSERT (durable), потом push.** Сбой INSERT логируется, не блокирует push.
- Обработка мёртвых подписок (удаление по 410/404) не меняется.
- Broadcast `project_published`: база = все approved минус владелец; push-фильтр = `notif_new_project`.
- deadline-cron: база = author_id + assigned_to по задачам с due_date в ближайшие 24ч;
  push-фильтр = `notif_deadline`.

Точки по типам (база → push-флаг):

| type              | baseRecipients                                    | push-флаг            |
|-------------------|---------------------------------------------------|----------------------|
| task_assigned     | assigned_to                                       | notif_task           |
| task_status       | author_id, assigned_to                            | notif_task           |
| task_created      | участники проекта минус assigned_to               | notif_task           |
| deadline          | author_id, assigned_to                            | notif_deadline       |
| project_taken     | recipientId (владелец)                            | notif_project_taken  |
| team_invite       | recipientId                                       | notif_team_invite    |
| comment           | author, assignee, участники проекта               | notif_comment        |
| project_published | все approved минус владелец                       | notif_new_project    |

Во всех случаях вычитается `initiatorId`.

### 4. Фронтенд

**`src/lib/notifications.js`** (по образцу `src/lib/push.js`):

- `fetchNotifications(limit = 30)` — свои, `order created_at desc`, лимит.
- `getUnreadCount()` — `select('id', { count: 'exact', head: true }).eq('read', false)`.
- `markRead(id)` — update `read = true, read_at = now()`.
- `markAllRead()` — update всех непрочитанных в read.
- `subscribeNotifications(onInsert, onUpdate)` — channel `notifications`, postgres_changes
  (паттерн как у `project_tasks`, `App.jsx:3542`). Возвращает cleanup (`removeChannel`).

**Компонент `NotificationBell`** — в правой части top-bar перед кнопкой «Отчёт»
(`App.jsx` ~6990):

- Иконка `Bell` (lucide-react) + красный badge с числом непрочитанных (`99+` при переполнении).
- Клик → dropdown-панель ~360px, прижата вправо, тёмная тема (`#0a0a0a` / золото `#d4af37`),
  анимация Framer Motion (fade + scale).
- Шапка панели: «Уведомления» + кнопка «Прочитать всё».
- Скролл-лента (лимит ~30): иконка по `type`, **жирный** `title`, `body`, относительное время;
  непрочитанные — точка/подсветка слева.
- Клик по строке → `markRead(id)` + навигация по `url` (если url указывает на таб — переключаем
  активный таб; сейчас push-url в основном `/`, поэтому в основном mark-read + закрытие;
  deep-link на задачу — forward-compat через хранимый `url`).
- Клик вне панели → закрыть. Пустое состояние — «Нет уведомлений».
- Badge: count-запрос при монтировании + инкремент по Realtime INSERT; при reconnect Realtime —
  refetch (чтобы не потерять строки за разрыв соединения).

### 5. Retention (cron)

Отдельная миграция, pg_cron, чистый SQL (без вызова edge):

```sql
select cron.schedule('notifications-prune', '30 3 * * *',
  $$ delete from public.notifications
     where read = true and created_at < now() - interval '7 days' $$);
```

Удаляются **только прочитанные** старше 7 дней. Непрочитанные сохраняются бессрочно.

### 6. Обработка ошибок

- **Edge:** сбой INSERT логируется, не блокирует push; обработка мёртвых подписок не меняется.
- **Фронт:** сбой fetch/markRead → существующий `Toast`; Realtime reconnect автоматический
  у supabase-js, после reconnect — refetch для устранения пропусков.

## Критерии верификации

- **RLS:** юзер A не видит строки B; клиент **не может** INSERT (только service_role);
  юзер обновляет только свой `read`.
- **Edge:** на каждый тип — N строк для base-получателей (включая тех, у кого флаг push
  выключен); push ушёл только подписанным с включённым флагом.
- **Фронт E2E** (Windows + iPhone PWA, как push): badge растёт по Realtime INSERT;
  клик → read, badge падает; «прочитать всё» обнуляет; **переживает перезагрузку**
  (отличие от эфемерного push); синхронизация badge между устройствами.
- **Retention:** старая read-строка удаляется прунингом; старая непрочитанная выживает.

## Вне скоупа (YAGNI)

- Ручное удаление уведомлений пользователем (чистит cron).
- Раздельные флаги `notif_*_inbox` (inbox всегда ловит всё).
- `related_id` / группировка / дедуп строк (каждое событие = одна строка).
- Deep-link на конкретный объект (url хранится для forward-compat, но навигация пока
  ограничена табами).

## Грабли среды (для реализации)

- git только с Windows: `git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=*`.
- push с обходом прокси: `$env:HTTPS_PROXY=""` + `git -c http.proxy=""`.
- НЕ делать `wsl --shutdown` без перезапуска VBS-держателя (иначе прод 502).
- edge правится через `volumes/functions/<fn>/` + `docker restart supabase-edge-functions`.
- Миграции в `supabase/migrations/`, нумерация `YYYYMMDD_NNNN_*.sql`
  (следующая после `20260606_0003`).
