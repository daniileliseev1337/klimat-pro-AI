# STATUS — живой статус klimat-pro-AI

> Единственный источник правды о состоянии проекта. Обновляется в конце каждой рабочей сессии.
> Правило: не верь датам в других доках — этот файл главнее; расхождение = обнови этот файл.

**Обновлено: 2026-07-29** (`main` = `2e3d2d1`: account appearance, доводка банка v2 и UX; `npm test` = 157/157, `npm run build` = PASS. ✅ Миграция применена к живой БД, RLS policy структурно проверена; `origin/main` и production обновлены, asset `index-FdBhWjDr.js` подтверждён снаружи.)

## Готово — персонализируемый UI

- В `codex/personalized-ui` добавлены 15 скинов и 15 эффектов с ограниченной compatibility matrix, отдельный режим настройки из профиля и 14 индивидуально настраиваемых рабочих зон внутри Дашборда, Проектов, Финансов и Задач.
- Предпочтения, включая варианты имени для распознавания переводов себе, хранятся в новой owner-only таблице `user_appearance_preferences`; миграция `20260729_0001` применена. RLS включён, policy разрешает доступ только при `user_id = auth.uid()`; обычное сохранение профиля остаётся независимым.
- Банк v2: исправлен ключ мерчанта для префикса «Оплата товаров и услуг», сохранено чтение legacy merchant rule `оплата`, добавлены regression tests многострочного формата; review на телефоне переключается в карточки.
- Закрыты: «Помощь» в профиле и ложная подпись `Supabase (Frankfurt)`. Реальная авторизованная visual QA ожидает пользовательскую сессию.

## Прод
- **29.07.2026:** `main`/`origin/main` = `2e3d2d1` (`feat: add account appearance preferences`). Миграция `20260729_0001` применена к `supabase-db`: RLS=true, policy `user_appearance_preferences_owner_all` использует и проверяет `user_id = auth.uid()`. Фронтенд задеплоен; `dist`, nginx и внешний HTTPS отдают один asset `assets/index-FdBhWjDr.js`, HTTPS=200. Авторизованная visual QA остаётся отдельной проверкой с пользовательской сессией.
- Живой: https://193-124-130-236.sslip.io — **HTTP 200 снаружи** и на nginx :8080 (frp-туннель восстановлен после
  возврата VPN Direct-правила `193.124.130.236/32` — инцидент 502 при деплое банка закрыт).
- Прод-код: **26e0b86** (банк v2 — умный импорт выписки; asset `index-CRXk9JKF.js`, задеплоен 04.07,
  **сверено dist=nginx:8080=снаружи HTTP 200**). Предыдущий прод — `CG_qyP3W` (follow-up Фазы 3).
  ⚠️ Банк НЕ прогнан на реальной выписке (эвристики проверены синтетикой) — проверить первый реальный импорт выписки.
- Тесты: 111/111 зелёные. Build зелёный (чанк 1.24 MB).
- Edge `web-push-notify` — dual-гейт (verify `PUSH_GATE_OK`) + типы Фазы 3 (`client_message`/`client_new_file`/`client_stage_changed`); `telegram-notify` удалена.
- БД: миграция `20260703_0003` применена (client_messages + client_visible + RPC), verify `MESSAGES_OK`+`FILES_OK`.
- БД: миграция `20260704_0001_merchant_rules` **применена к живой БД** 04.07 (таблица + RLS=true owner-only +
  RPC `get_merchant_rules`/`upsert_merchant_rule` + policy `merchant_rules_owner_all` — верифицировано).
- ⚠ Условие живости: VPN Happ должен держать Direct-правило `193.124.130.236/32` (см. CLAUDE.md, грабли).

## Готово (крупное, хронология свежего)
- ✅ **Портал заказчика Фазы 2-3 — ПЕРЕПИСКА + ФАЙЛЫ + УВЕДОМЛЕНИЯ (внедрено 03.07 глубокой ночью)**:
  - **Фаза 2 (БД применена к живой):** таблица `client_messages` (RLS `is_project_client OR can_access_project_comments`)
    + `project_files.client_visible` (расширен `files_select`) + 4 RPC (`get_client_messages`, `post_client_message`,
    `get_client_project_files`, `set_file_client_visible`) + аддитив `get_project_files`. Миграция `20260703_0003`.
    Verify `deploy/client-phase2/verify-phase2.sh` = **MESSAGES_OK + FILES_OK** (самодостаточный E2E в транзакции:
    заказчик пишет/читает свой тред, команда видит тот же, посторонний — нет; не-`client_visible` скрыт, после
    пометки виден, заказчик сам пометить не может). Edge `nextcloud` НЕ трогали (download под JWT+RLS — находка).
  - **Фаза 2 (фронт):** у заказчика вкладки Задачи/Сообщения/Файлы в `ClientProjectTasksModal` (`ClientChat`+
    `ClientFilesList`); у команды секция «Переписка с заказчиком» (золотая рамка) + галочка «показать заказчику»
    на файле в `ProjectFiles`.
  - **Фаза 3 (edge задеплоена):** типы `client_message` (двусторонний), `client_new_file`, `client_stage_changed`
    в `web-push-notify` (резолв заказчика по `clients.user_id`); точки вызова из `postClientMessage`/`setFileClientVisible`.
    Смоук: 3 типа → 200 `{ok:true}`, bad-uuid → 400. Гейт цел (**PUSH_GATE_OK** после редеплоя).
  - Дизайн: `specs/2026-07-03-client-phase23-design.md`, план: `plans/2026-07-03-client-phase23.md`. Ревью PASSED.
  - ✅ `client_stage_changed` закрыт: **QEStage** (ручная смена стадии в карточке) уже шлёт — коммит `af638e9`, **в проде** (STATUS ранее ошибочно писал «точка не найдена» — сверка с кодом опровергла); **форма редактирования проекта** (`updateProject`) — push добавлен ЭТОЙ сессией с гвардом `form.stage !== modal.stage` (**в проде** — a0c8542, asset `CG_qyP3W`, 04.07). Marketplace-точки (take/release/revoke) не трогали — edge отфильтрует по пустому `client_id`, у них свои push.
- ✅ **Edge-гейт web-push-notify + снос telegram-notify — ВНЕДРЕНО 03.07 глубокой ночью** (остаток SQL-пакета):
  dual-гейт в функции — валидный user-JWT (через GoTrue `/auth/v1/user`) ИЛИ заголовок `X-Push-Secret`
  из config.json; секрет в vault `web_push_secret`, cron-джоб пересоздан с заголовком (миграция
  `20260703_0002`, секрета в репо НЕТ). Verify `deploy/web-push/verify-secret-gate.sh` = **PUSH_GATE_OK**
  (401 no-auth/anon-JWT, 200 secret/реальный user-JWT, cron header ✓; прогнан дважды — и после рестарта edge).
  telegram-notify удалена с хоста и из репо (m7), INFRASTRUCTURE.md актуализирован. Фронт не трогали
  (supabase-js уже шлёт JWT) — asset прежний, прод снаружи 200. План: docs/superpowers/plans/2026-07-03-web-push-secret-gate.md.
- ✅ **Онбординг Этап 2 (тур) — В ПРОДЕ** (merge 6c28b4c, asset index-CLg-ZLpJ.js, HTTP 200 снаружи).
  Слайд-тур при 1-м входе (localStorage kp-tour-seen) + «Пройти тур» в «Помощи»; контент по роли (реюз
  helpContent/helpSectionsFor, §1 наследуется). shouldAutoStartTour (TDD) + TourModal.jsx + интеграция App.
  3 задачи subagent-driven, финальный opus-review = Ready to merge: Yes. Тесты 111 passed. Наблюдение
  (не баг): клик по фону во время тура = «пройден», повторно доступен из «Помощи».
- ✅ **Онбординг Этап 1 (Помощь + Cmd+K) — В ПРОДЕ** (merge c2ef665). Раздел «Помощь» по роли (§1 сквозняком)
  + команда в палитре (helpContent.js/HelpModal.jsx). Follow-up: пункт «Помощь» в ProfileModal.
- ✅ Модель доступа заказчика 3.0 — 4 вкладки со своей видимостью, §1 подтверждён (БД-гейты + RLS-E2E). В проде.
- ✅ Admin создаёт пользователя — форма + Edge Function + RPC, verify ADMIN_CREATE_USER_OK. В проде.
- ✅ 03.07 днём: аудит кодовой базы (4 агента, отчёт в IDEAS «Обновление 2026-07-03»); инцидент туннеля
  решён (VPN Direct-правило); прод редеплоен до b2536f5; ветки вычищены (−14 local, −8 remote). Хвосты A/B закрыты.
- ✅ 03.07 вечером, SQL-пакет (часть):
  - **search_path-хардненинг ПРИМЕНЁН к живой БД** (7 функций, verify 7/7 `search_path=public, pg_temp`),
    миграция в репо: `supabase/migrations/20260703_0001_search_path_hardening.sql`.
  - **Baseline-снапшот живой БД в репо**: `supabase/baseline/2026-07-03_live_public_schema.sql`
    (80 функций / 21 таблица / 55 RLS-политик / 304 гранта + 2 триггера auth.users). БД теперь
    воспроизводима с нуля: baseline + миграции ПОСЛЕ 2026-07-03. Закрыт крупнейший техдолг аудита.
- ✅ Структура контекста: CLAUDE.md проекта + этот STATUS.md (коммит b38cc1f).

## Дальше (бэклог приоритетный — порядок за владельцем)
- 🟢 **Умный импорт выписки Яндекс Банка v2 — РЕАЛИЗОВАН, в main `cbc0687` (НЕ в проде)**. Модуль
  `src/lib/bankParsers.js` (чистые функции, 34 теста): `parseYandexRows` + `classifyOperation` (оплата/перевод-себе/
  физлицу, обезличивание ПДн) + категоризатор-цепочка (выученное→MCC→словарь-границы-слов→[LLM-заглушка]→ручной
  review) + `dedupe`. Review-UI в `CsvImportModal` (бейджи типов, source-метка, self_transfer-skip). Миграция
  `merchant_rules` (RLS owner-only + search_path) — в репо, **НЕ применена**. 15 коммитов subagent-driven (D1-D5 +
  фиксы; финальный opus-review поймал регрессию guard «Прочий доход»×expense — исправлена). Spec/план:
  `specs`/`plans/2026-07-04-bank-import-v2*`. **Ждёт (по «го»):** (1) прогон на РЕАЛЬНОЙ обезличенной выписке
  (minX-эвристика/парсинг/дедуп проверены только синтетикой); (2) deploy фронта; (3) применение миграции к живой БД.
  Отложено (вне scope): self_names UI, LLM-слой [4], парсеры Сбер/Альфа/Тинькофф (не тронуты, рабочие).
  Гейты: миграция `merchant_rules` + деплой — по «го». Вне scope: LLM-слой (только интерфейс), Сбер/Альфа/Тинькофф.
- 6.7 MCP-слой для Claude (последний этап ТЗ v3.0) — СВЯЗАН с «ИИ-модуль» (brainstorm ИИ-модуля до старта 6.7).
- Владелец сам: `chkdsk F:` (диск сбоит!), смена паролей VPS-root/БД, выбор из 7 логотипов в Claude Design.
- Мелочь: «Supabase (Frankfurt)» на экране входа — ложь (self-hosted), поправить при случае.
- Полный список — docs/IDEAS.md.

## Режим репо (важно)
- Push готовых коммитов в origin/main — АВТОМАТ, без спроса (личный дашборд; решение владельца 03.07).
  merge/деплой/живая БД — по-прежнему явное «го». origin = github.com/daniileliseev1337/klimat-pro-AI
  (это и есть «тот самый репо», не отдельный — про него раньше забывали пушить).

## Уроки последней сессии
- **Деплой из worktree — грабля:** `npm run build` в worktree кладёт `dist` в САМ worktree, а
  `deploy/nextcloud/deploy-web.sh` хардкодит основной `/mnt/f/Сайт/redesign-v2-fresh/dist`. Деплой из worktree
  БЕЗ merge отправит старый бандл основного репо (no-op). Правильный порядок: merge в main → build в ОСНОВНОМ
  репо → deploy-web. Проверка: сверять asset-хеш dist/index.html vs прод снаружи (совпал со старым = не задеплоилось).
- Git Bash (Bash-тул) манглит абсолютные WSL-пути (`/srv/...` → `C:/Program Files/Git/srv/...`, MSYS) —
  host-команды wsl гонять через PowerShell-тул; docker-команды без путей не страдают.
- Порядок внедрения секрет-гейта БЕЗ окна поломки: (1) секрет в vault + config.json → (2) cron-джоб
  с заголовком (старая функция его игнорирует) → (3) деплой гейченной функции. Обратный порядок = 401 у cron.
- Секрет-«настройка при применении»: vault (`vault.create_secret`/`vault.decrypted_secrets`) — cron-команда
  читает секрет при каждом запуске, в репо и в `cron.job.command` секрета нет.
- push-сеть капризна (зависит от VPN-состояния): пробуй ОБА варианта — дефолт `git push` И обход прокси (`-c http.proxy="" -c https.proxy=""` + unset HTTPS_PROXY). К концу 03.07 сработал именно обход прокси, дефолт падал connect-timeout.
- pg_dump из docker supabase-db → /tmp → cp на /mnt/f — рабочий путь для файлов БД→репо.
