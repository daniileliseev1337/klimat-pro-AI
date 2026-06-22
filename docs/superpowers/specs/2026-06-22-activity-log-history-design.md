# №10 «История действий» (audit-лента) — дизайн

Дата: 2026-06-22. Стадия: дизайн (brainstorm завершён, одобрен владельцем).
Метод: superpowers:brainstorming (clarifying по одному → подходы → дизайн по секциям → approval).
Следующий шаг: writing-plans → реализация.

## 1. Контекст и проблема

Замечание №10 из эксплуатации: нужна «история действий» — кто что менял.

**Что уже есть в системе** (разведка кода + живой БД):
- Таблица `public.activity_log`: `id, actor_id (FK auth.users ON DELETE SET NULL), actor_email,
  action, target_id, target_email, details jsonb, created_at`; индекс `created_at DESC`;
  RLS — только `SELECT` для `authenticated USING (is_admin())`; **INSERT-политики нет**
  (пишется лишь через SECURITY DEFINER).
- Функция `public.log_activity(p_action text, p_target_id uuid, p_target_email text, p_details jsonb)`
  → uuid, SECURITY DEFINER: `actor_id := auth.uid()`, `actor_email` из `profiles`, INSERT в `activity_log`.
- Фронт: `adminFetchActivityLog()` (App.jsx:651) + админ-вкладка **«Журнал»** (App.jsx:7324),
  словарь лейблов `user_approved / user_revoked / user_deleted / role_changed`.
- **Сейчас логируются ТОЛЬКО админ-действия над учётками** (+ `password_reset_by_admin`).
  Действий над проектами/задачами/деньгами в журнале нет.

**Важно:** `activity_log` и `log_activity` живут только в живой БД, **отсутствуют в репо-миграциях**
(числятся техдолгом «забрать живые-только-в-БД функции в репо»).

Таким образом №10 = расширение существующего аудита на бизнес-действия + UI истории по проекту,
а не строительство с нуля. Паттерн (таблица + RLS + RPC SECURITY DEFINER + UI-лента) уже есть.

## 2. Решения владельца (из brainstorm)

1. **Назначение:** и история по проекту (вкладка в карточке), и расширенный админ-журнал.
2. **Охват событий:** проект целиком + события задач (создание/смена статуса/назначение).
3. **Видимость + приватность:** нефинансовые события видит вся команда проекта; денежные
   (платежи, доли, сумма договора) — **только владелец + админ** (сохраняет приватность долей,
   построенную в кластере #1/#2: `get_my_shares`/RLS `project_shares` прячут чужие доли).
4. **Механизм записи:** A — БД-триггеры (нельзя забыть/обойти, ловит все пути, фронт-монолит
   по записи не трогаем, заодно закрывает техдолг).
5. **UI истории проекта:** 5-я вкладка 🕘 «История» в `ProjectForm` (форма уже во вкладках после #7).

## 3. Охват и категории событий

| Сущность | Событие (`action`) | Категория |
|---|---|---|
| projects | `project_created` / `project_renamed` / `project_deleted` | нефинанс |
| projects | `project_stage_changed` (from→to) | нефинанс |
| projects | `project_client_changed` / `project_deadline_changed` / `project_visibility_changed` / `project_executors_changed` | нефинанс |
| projects | `project_contract_changed` (сумма договора, from→to) | **финанс** |
| project_payments | `payment_added` / `payment_removed` (по дельте набора) | **финанс** |
| project_shares | `share_added` / `share_changed` / `share_removed` | **финанс** |
| project_members | `member_added` / `member_removed` / `member_role_changed` | нефинанс |
| project_tasks | `task_created` / `task_status_changed` / `task_assigned` / `task_deleted` | нефинанс |

**НЕ логируем (YAGNI / у них своя история):**
- версии ТЗ задач и комментарии (есть встроенный построчный diff + переписка);
- производные поля: `paid_amount` (триггерное, от платежей — дубль с платёжным событием),
  `executor` text (производное от `executors` jsonb — логируем именно `executors`).

Конкретный финальный список action-кодов и точные тексты лейблов уточняются на этапе плана
(могут добавиться/слиться при реализации триггеров), но категория финанс/нефинанс фиксирована.

## 4. Схема БД

Расширяем существующую `public.activity_log` (не пересоздаём — данные admin-журнала сохраняются):

```sql
alter table public.activity_log
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists is_financial boolean not null default false;

create index if not exists idx_activity_log_project_created
  on public.activity_log (project_id, created_at desc)
  where project_id is not null;
```

- `project_id` — привязка к проекту для ленты карточки; у admin-событий учёток = null.
  `ON DELETE SET NULL`: при удалении проекта запись `project_deleted` остаётся в админ-журнале
  (имя проекта — в `details`), `project_id` обнуляется (лента карточки этого проекта уже недоступна).
- `is_financial` — флаг приватности. Существующие строки → `false` (корректно, это нефинанс-учётки).

## 5. Механизм записи

### 5.1 Триггеры (projects / project_members / project_tasks)

`AFTER INSERT/UPDATE/DELETE`, SECURITY-контекст вызывающего запроса:
- actor = `auth.uid()` + email из `profiles` (как в `log_activity`); при прямом SQL/деплое
  (миграции, service_role) `auth.uid()` = null → actor null/«система». Это допустимо.
- **`projects` UPDATE** — пофайловый diff: для каждого значимого поля `IF OLD.x IS DISTINCT FROM NEW.x`
  пишется отдельная запись с `details = {from, to}`. **Исключить** `paid_amount` и `executor` (производные).
  `contract_sum` → `is_financial = true`; остальные поля → false.
  Ловит и форму (`updateProject`), и quick-edit карточки (прямой `.from("projects").update`).
- **`project_members`** — INSERT → `member_added` (role + имя/email участника); DELETE → `member_removed`;
  UPDATE role → `member_role_changed` {from,to}. Нефинанс.
- **`project_tasks`** — INSERT → `task_created` (title); UPDATE status → `task_status_changed` {from,to,title};
  UPDATE `assigned_to` → `task_assigned`; DELETE → `task_deleted`. `project_id` берётся из задачи
  (может быть null для личной задачи без проекта — тогда событие только в админ-журнал). Нефинанс.

### 5.2 Логирование внутри денежных RPC (ловушка replace-all)

`set_project_payments` и `set_project_shares` — **replace-all** (полный `delete ... where project_id`
+ `insert ... select`), вызываются при КАЖДОМ сохранении формы и quick-edit платежа. Триггер на
строки `project_payments`/`project_shares` сгенерил бы ложные «удалён/добавлен» ×N на каждое сохранение.

Поэтому деньги логируем **внутри самих RPC** (SECURITY DEFINER, уже существуют — правим SQL-функцию,
не фронт): функция перед replace-all читает текущее состояние, после — сравнивает и пишет
финанс-событие **только при реальной дельте**:
- payments: вычислить добавленные/удалённые строки (по amount+paid_on) → `payment_added`/`payment_removed`
  (details {amount, paid_on}); при равенстве наборов — не писать ничего (критерий §9.3 — нет шума
  при сохранении без денежных изменений).
- shares: аналогичный diff набора долей → `share_added`/`share_changed`/`share_removed`.
- `is_financial = true`, `project_id = p_project_id`, actor = `auth.uid()`.

### 5.3 Запись через хелпер

Триггеры и RPC пишут через **внутренний хелпер** `log_activity_ext(p_action, p_project_id,
p_is_financial, p_target_id, p_target_email, p_details)` (SECURITY DEFINER, actor = `auth.uid()` +
email из `profiles` — единая actor-логика, без дублирования). Нужен потому, что новые колонки
`project_id`/`is_financial` отсутствуют в сигнатуре `log_activity`. Существующую `log_activity`
(4 арг.) оставляем **без изменений** для admin-функций (обратная совместимость; добавление параметров
с DEFAULT создало бы overload-конфликт — урок из `update_notification_settings`).

## 6. Доступ, RLS, приватность

- **Админ-журнал** — без изменений: RLS `activity_log_select = is_admin()`, `adminFetchActivityLog`
  работает как есть. На фронте — только новые лейблы.
- **История проекта** — новый RPC `get_project_activity(p_project_id uuid, p_limit int default 100)`
  (SECURITY DEFINER, `set search_path = public, pg_temp`):
  1. **Гейт доступа**: вызывающий имеет доступ к проекту — владелец `OR is_admin() OR` член команды
     (`project_members`) `OR` исполнитель/взявший. Переиспользует существующую логику видимости проекта
     (сверить с актуальной RLS `projects_select`, миграция 20260611_0002). Нет доступа → пустой результат.
  2. **Фильтр приватности**: строки `is_financial = true` возвращаются **только** если вызывающий —
     владелец проекта `OR is_admin()`. Не-владелец получает лишь `is_financial = false`.
  3. Сортировка `created_at DESC`, лимит `p_limit`.
  GRANT execute to authenticated.

## 7. Фронт (минимум правок монолита App.jsx)

- Админ-вкладка «Журнал» (App.jsx:7332) — дополнить словарь `labels` новыми action (иконка/цвет/текст)
  и рендер `details` (было→стало, суммы ₽). Лента уже стилизована — переиспользуем.
- Обёртка `fetchProjectActivity(client, projectId)` → `rpc('get_project_activity', {...})`.
- Компонент-лента истории проекта (переиспользует визуал админ-журнала) на **5-й вкладке 🕘 «История»**
  в `ProjectForm` (tab-conditional-обёртка `{activeTab==='history' && ...}`, как в #7).
  Грузим при открытии вкладки (без realtime — YAGNI).
- По записи фронт НЕ трогаем (вся запись в БД).

## 8. Техдолг (закрываем заодно)

Миграция фиксирует в репо ранее «живые-только-в-БД» объекты этой области:
`CREATE TABLE IF NOT EXISTS activity_log` (как в живой БД) + `CREATE OR REPLACE FUNCTION log_activity`
(как в живой БД) + новые колонки + триггеры + хелпер + `get_project_activity`. Эта часть среды
становится воспроизводимой с нуля. (Прочие живые-только-в-БД функции — `is_admin/is_approved/
handle_new_user/admin_*` — вне scope этой задачи, остаются отдельным техдолгом.)

## 9. Критерии верификации (до старта реализации)

На живой локальной БД (транзакции `BEGIN…ROLLBACK`, боевые данные не трогать; паттерн verify-rls.sh):
1. Смена стадии/дедлайна проекта → нефинанс-запись с `details.from/to`, `is_financial=false`, верный actor.
2. Изменение `contract_sum` и платежа → финанс-запись `is_financial=true`.
3. **Сохранение формы БЕЗ изменения денег НЕ создаёт** payment/share-событий (защита от replace-all шума).
4. quick-edit стадии на карточке (прямой UPDATE) — тоже логируется (триггер ловит все пути).
5. `get_project_activity` под не-владельцем (член команды) НЕ возвращает финанс-строки; под владельцем —
   возвращает; без доступа к проекту — пусто.
6. admin-журнал учёток цел (старые action читаются, RLS is_admin работает).
7. `task_created`/`task_status_changed` пишутся; ТЗ-версии/комментарии задач — НЕ пишутся.

## 10. Вне scope (YAGNI)

- Realtime-лента истории (грузим при открытии).
- Авточистка/ретеншн записей (объём мал — личный дашборд; хранить бессрочно).
- Undo/откат действий из ленты.
- Логирование версий ТЗ и комментариев задач (своя встроенная история).
- Фильтры/поиск по админ-журналу (можно позже).
- Перенос прочих живых-только-в-БД функций в репо (отдельный техдолг).

## 11. Риски и ловушки

- **replace-all шум** (payments/shares) — закрыт логированием diff внутри RPC (§5.2); критерий §9.3.
- **Дубль исполнитель↔команда**: назначение исполнителя пишет `executors` (триггер projects) И,
  best-effort, `addProjectMember` (триггер members) → возможны 2 записи на одно действие. Приемлемо
  (разные факты); при желании — дедуп на этапе плана.
- **Объём админ-журнала** вырастет (проектные события) — для личного дашборда некритично; фильтры — позже.
- **Гейт доступа в get_project_activity** должен совпадать с актуальной RLS `projects_select`
  (20260611_0002) — сверить при реализации, иначе лента покажет/скроет не то.
- **Среда:** БД-деплой — миграция F:→`C:\temp` (кириллица «Сайт» в bash-аргументе бьётся) +
  `docker exec -i supabase-db psql`; git только с Windows-стороны (`-c core.fsyncMethod=writeout-only`
  + ретраи); деплой только по явному слову «деплой».
