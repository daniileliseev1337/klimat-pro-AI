# Ф3 — Посетитель + демо-режим — дизайн (2026-06-26)

Дата: 2026-06-26. Стадия: дизайн (brainstorm с владельцем завершён, одобрен «да»).
Метод: brainstorming (развилки → решения → дизайн → approval).
Реализует `2026-06-25-roles-system-design.md` §5 (доступ visitor), §7 (регистрация + одобрение), §8 (фаза Ф3).

## 1. Контекст (что уже в проде)

- **Ф1** (`20260625_0001_user_roles.sql`): таблица `user_roles` (мультироль employee/client/visitor),
  `has_role`/`get_my_roles`/`set_user_roles`, чекбоксы ролей в админке, тумблер «Кабинет ↔ Портал»
  (`viewMode` work|client). `admin` вне `user_roles` (остаётся `profiles.role='admin'`/`is_admin()`).
- **Ф2** (`20260625_0002_username.sql`): вход по `username` без почты (вариант А, синтетический
  `<username>@klimat.local`). Наш триггер `handle_new_user_meta()` (AFTER INSERT на `auth.users`,
  срабатывает ПОСЛЕ baseline `on_auth_user_created`) дописывает `username`/`name` из `raw_user_meta_data`.
- Сейчас новые аккаунты → `approved=false` (ставит baseline `handle_new_user`, тело только в живой БД).
  Вход блокируется на `!profile.approved` (`AuthScreen`, App.jsx ~1606).

**Ловушки БД (контекст):** функции `handle_new_user()` и `admin_list_users()` живут ТОЛЬКО в живой БД
(baseline до миграций), тел в репозитории нет — НЕ переписываем, расширяем аддитивно.
`has_role()` создан в Ф1, но **в RLS-политиках нигде не используется** (проверено grep по миграциям) —
значит запись роли в `user_roles` сама по себе доступа к данным не даёт.

## 2. Решения владельца (brainstorm 2026-06-26)

1. Демо-витрина visitor = **пустые вкладки + помощник**: реальный UI без данных (RPC не зовём),
   на каждой вкладке гид объясняет, что здесь и зачем. Снимает риск §11 «мок ≠ UI» (UI реальный).
2. Помощник = **пошаговый тур с подсветкой** (coach-marks). Делаем переиспользуемым — ляжет под
   будущий «навигатор для пользователей» (отдельная задача).
3. Заявленная роль employee/client при реге → **подсказка админу** (`profiles.requested_role`).
   Роль в `user_roles` по-прежнему пишет только админ (Ф1).
4. Авто-approve visitor — **через расширение нашего триггера** `handle_new_user_meta` (не RPC).
5. Подсветка тура — **своя лёгкая реализация без новых npm-зависимостей** (корп-прокси на `npm install`).

## 3. БД — одна аддитивная миграция

`supabase/migrations/20260626_0001_visitor.sql` + `deploy/visitor/apply-migrations.sh` (конвенция Ф2).

1. `alter table public.profiles add column if not exists requested_role text;` — заявленная роль.
2. **Расширить тело `handle_new_user_meta()`** (CREATE OR REPLACE, baseline `handle_new_user` не трогаем):
   - дописать `requested_role = coalesce(new.raw_user_meta_data->>'role', requested_role)`;
   - **если `new.raw_user_meta_data->>'role' = 'visitor'`**:
     - `update public.profiles set approved = true where id = new.id;`
     - `insert into public.user_roles(user_id, role) values (new.id,'visitor') on conflict do nothing;`
   - employee/client: `approved` не трогаем (остаётся false), в `user_roles` не пишем.
3. Новый RPC не вводим — авто-approve целиком в триггере; `set_user_roles` (Ф1) остаётся каналом админа.

**Безопасность:** подделка `role=employee` в meta бесполезна — триггер одобряет только visitor;
employee/client всё равно `approved=false` (вход блокируется). visitor видит только демо (см. §4 гейт).

**Развилка (зафиксирована):** авто-approve через триггер (выбран: аддитивно, 0 round-trip, атомарно)
vs отдельный SECURITY DEFINER RPC после signUp (лишний вызов + защита от самоназначения роли).

## 4. Фронт — режим visitor (оболочка App.jsx)

- **Определение:** `isVisitor = roles.includes('visitor') && !roles.includes('employee') && !roles.includes('client')`.
  Чистый visitor → демо-режим; смешанные роли → обычная оболочка Ф1 (тумблер work/client), visitor-роль игнорируется.
  Роли берём существующим `get_my_roles` (Ф1).
- **Третий режим оболочки** рядом с `viewMode` (work|client). `TABS` для visitor — обзорный набор:
  dashboard, projects, tasks, clients, finance, analytics (без admin, без myorders).
- **Гейт RPC (ядро «ноль утечки»):** при `isVisitor` загрузчики данных (projects/tasks/clients/finance/…)
  НЕ вызываются — состояния остаются пустыми массивами `[]`, вкладки рендерят штатные «пустые состояния».
  Полагаемся на код-гейт во фронте, а не на RLS.
- **Шапка:** бейдж «Демо-режим» + кнопка «Запросить полный доступ» → выход на экран входа.

## 5. Тур-помощник — переиспользуемый компонент

- Новый `<GuidedTour steps onClose />` — **без новых npm-зависимостей**: framer-motion (есть)
  + box-shadow spotlight + атрибуты `data-tour="<id>"` на ключевых элементах вкладок.
- **Механика:** затемнённый оверлей с «вырезом» (spotlight) вокруг target-элемента по его bounding rect +
  карточка-тултип рядом (заголовок, текст, «Назад / Далее / Пропустить», прогресс N/M).
  Шаг умеет `setTab(...)` — тур проводит посетителя по вкладкам.
- **Конфиг шагов** `VISITOR_TOUR_STEPS` — массив `{ tab, target, title, body }`, отдельно от механики
  → тот же `<GuidedTour>` ляжет под будущий навигатор для обычных юзеров.
- **Запуск:** авто при первом входе visitor (флаг в localStorage `kp-visitor-tour-done`) +
  кнопка «Показать тур заново» в шапке демо-режима.

**Развилка (зафиксирована):** своя подсветка (выбрана: 0 новых пакетов, безопасно за корп-прокси)
vs библиотека (react-joyride/driver.js — быстрее, но `npm install` за прокси = риск + зависимость).

## 6. Регистрация — селектор роли (AuthScreen)

- В форму регистрации (сейчас Имя + Логин + Пароль) добавить **селектор роли**: 3 варианта
  (Сотрудник / Заказчик / Посетитель) — сегмент-контрол с краткими подписями. По умолчанию — Сотрудник.
- `signUpWithPassword(client, email, password, { username, name, role })` → `options.data` → триггер.
- **Ветка после signup:**
  - `role === 'visitor'` → автологин (`signInWithPassword`) → `onAuthenticated` → демо-режим
    (минуя экран «Заявка отправлена»);
  - employee/client → как сейчас, экран «Заявка отправлена».

## 7. Админка — подсказка заявки

- В списке пользователей у pending-заявки показать `requested_role` («хочет: Заказчик»).
  Чекбоксы ролей у админа уже есть (Ф1) — добавляется только read-only лейбл рядом с заявкой.

## 8. Верификация

- **Живая БД** (BEGIN…ROLLBACK на проде, эмуляция через `request.jwt.claims`):
  - рега visitor → `profiles.approved=true`, `requested_role='visitor'`, `user_roles` содержит visitor;
  - рега employee → `approved=false`, `requested_role='employee'`, `user_roles` пусто.
- **Регрессия:** baseline `handle_new_user` цел; существующий email-вход работает; `is_admin()`/~24 места целы;
  username-вход (Ф2) не сломан.
- **UI/прод:** visitor видит пустые вкладки + тур; реальные RPC не зовутся (код-гейт — проверить
  по network/коду); кнопка «Запросить полный доступ» выводит на вход; авто-запуск тура один раз.

## 9. Вне scope (YAGNI)

- Полноценный навигатор-онбординг для всех ролей (тур-компонент `<GuidedTour>` станет его основой) — отдельная задача.
- Самовосстановление пароля, биллинг, соцвход, email-уведомления (уже вне scope, §10 roles-system-design).

## 10. Риски и ловушки

- **Яндекс.Диск forced-fsync** ломает запись больших файлов (Edit/Write на `App.jsx` падает `EIO/EUNKNOWN fsync`).
  Обход: пауза синка, либо temp-файл + `Move-Item`, либо `git -c core.fsync=none`.
- **baseline-функции** (`handle_new_user`, `admin_list_users`) — только аддитивно, не переписывать.
- **Гейт RPC** — единственная защита от утечки данных visitor; проверить, что ВСЕ загрузчики
  под `isVisitor` отключены (не только основные projects/tasks).
- **Рассинхрон демо vs UI** — снят выбором «пустые вкладки» (UI реальный), но `VISITOR_TOUR_STEPS`
  ссылается на `data-tour` элементы — при переименовании/удалении элементов сверять шаги тура.
- **Синтетический email** (Ф2) — уникальность username, валидация латиницы — без изменений.
- **Edge мультироль** visitor+employee — приоритет обычной оболочки (visitor-роль игнорируется).
