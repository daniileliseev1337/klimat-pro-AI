# Web Push уведомления для daniil-dashboard v3.0. Дизайн

> Дата: 2026-06-06. Статус: согласован с владельцем (brainstorm), готов к плану.
> Заменяет заблокированный Telegram-канал (egress на api.telegram.org закрыт у
> провайдера и с VPS — см. отмену плана 3 в 6.4b). Внутри-приложенческие
> уведомления уже даёт Realtime; Web Push добавляет доставку, когда вкладка
> закрыта/в фоне, на десктоп, Android и iOS.

## 1. Цель и решения

Доставлять уведомления о событиях приложения системными push-уведомлениями ОС
через стандарт Web Push (VAPID, RFC 8291/8292), self-hosted, без сторонних
облаков (FCM/OneSignal не нужны — VAPID работает напрямую с push-сервисами
браузеров).

**Зафиксированные решения владельца:**
- **Платформы:** Desktop-браузеры + Android + **iOS**. iOS 16.4+ отдаёт Web Push
  только установленной PWA → в объём входит PWA (manifest + иконки + install-подсказка).
- **События:** все типы, включая legacy, **плюс новый broadcast** «проект выложен
  в поиск исполнителя».
- **Дедупликация:** push шлём **всегда**, независимо от присутствия пользователя в
  приложении (без presence-трекинга; при открытой вкладке возможен и Realtime-тост,
  и системное уведомление — это допустимо).
- **Гибкость настроек:** не один рубильник, а транспортный тумблер на устройство +
  per-тип галочки (какие типы пользователь хочет/не хочет).

## 2. Инструменты (harvest 2026-06-06)

| Назначение | Инструмент | Метрики | Почему |
|---|---|---|---|
| PWA + Service Worker для Vite | **vite-plugin-pwa** | 4182★, MIT, 2026-05 | Стандарт; режим `injectManifest` для кастомного push-SW |
| Web Push транспорт в Deno edge | **@negrel/webpush** (jsr) | 35★, MIT, 2025-06 | RFC 8291/8292 на Web Crypto; **проверен в Supabase Edge** (наш рантайм) |
| Планировщик deadline | **pg_cron + pg_net** | штатные Supabase | cron в Postgres → HTTP POST к edge на `kong:8000` |
| Fallback транспорта | @pushforge/builder | 44★, MIT, 2026-04 | если negrel не заведётся в edge |

Отброшено: `web-push` (npm) — Node-only crypto/https, не работает в edge;
`web-push-neo` — нет чёткой лицензии (NOASSERTION).

## 3. Архитектура (8 компонентов)

1. **PWA-оболочка** — `manifest.webmanifest` + иконки 192/512 + iOS install-подсказка.
2. **Service Worker** `src/sw.js` (injectManifest) — `push` → `showNotification`;
   `notificationclick` → фокус/открытие задачи/проекта; precache app-shell.
3. **Таблица `push_subscriptions`** + RLS.
4. **Фронт-модуль `src/lib/push.js`** — permission, subscribe/unsubscribe, сохранение.
5. **Edge-функция `web-push-notify`** — резолв получателей + отправка (по образцу `telegram-notify`).
6. **VAPID-ключи** — public во фронт (env), private в `config.json` edge (не в git).
7. **Интеграция в точках событий** — обёртка `sendPush` вместо `sendTelegramNotify`.
8. **Deadline-cron** — pg_cron + pg_net.

**Поток подписки:** тумблер → SW зарегистрирован → `Notification.requestPermission()` →
`pushManager.subscribe({applicationServerKey: VAPID_PUBLIC})` → upsert в
`push_subscriptions` под RLS.

**Поток отправки:** событие → фронт `invoke('web-push-notify', {type,…})` → edge
резолвит получателей (`profiles` + флаг `notif_*`, минус инициатор) → берёт их
подписки → `webpush.send` зашифрованного payload на каждую → браузер → SW `push` →
`showNotification`. На `404/410` подписка удаляется.

**Поток deadline:** pg_cron (раз в день) → `net.http_post(kong:8000/functions/v1/web-push-notify, {type:'deadline'})` → edge находит задачи с дедлайном ~24ч → push автору+исполнителю.

## 4. Данные (БД)

**Таблица `push_subscriptions`:**
| Поле | Тип | Назначение |
|---|---|---|
| id | uuid PK `gen_random_uuid()` | — |
| user_id | uuid NOT NULL → auth.users(id) ON DELETE CASCADE | владелец |
| endpoint | text NOT NULL **UNIQUE** | URL push-сервиса |
| p256dh | text NOT NULL | публичный ключ подписки |
| auth | text NOT NULL | auth-секрет подписки |
| user_agent | text NULL | «какое устройство» |
| created_at | timestamptz DEFAULT now() | — |

Один user → несколько строк (разные устройства). Подписка браузера —
`upsert on conflict (endpoint)`.

**RLS:** `select/insert/delete` своих (`user_id = auth.uid()`); `update` не нужен.
Edge читает подписки получателей под `service_role` (минуя RLS).

**Самоочистка:** push-ответ `404/410` → edge удаляет подписку.

**Новая колонка** `profiles.notif_new_project boolean DEFAULT true` — флаг broadcast'а.
Прочие `notif_*` уже существуют.

## 5. Маппинг событий и фильтры

| type | получатели | флаг | источник вызова |
|---|---|---|---|
| task_assigned | assigned_to | notif_task | App.jsx sendTaskNotify |
| task_status | author_id, assigned_to | notif_task | смена статуса задачи |
| task_created | участники проекта + owner − assigned_to | notif_task | создание задачи |
| project_taken | recipientId (owner, явный) | notif_project_taken | App.jsx ~2629 |
| team_invite | recipientId (приглашённый, явный) | notif_team_invite | App.jsx ~2309,4917 |
| comment | author + assigned_to + участники проекта − initiator | notif_comment | App.jsx ~4332 (сейчас recipientId=null → нужен резолвер) |
| project_published | все `approved` − owner (**broadcast**) | notif_new_project | перевод проекта в стадию «Поиск исполнителя» |
| deadline | задачи с дедлайном ~24ч: author + assigned_to | notif_deadline | pg_cron |

Push доходит ⟺ (есть подписка на устройстве) И (флаг типа включён) И (получатель ≠ инициатор).

## 6. Service Worker + PWA

- `src/sw.js` (injectManifest): `precacheAndRoute(self.__WB_MANIFEST)`; `push` →
  `e.data.json()` → `showNotification(title,{body,icon,badge,tag,data:{url}})`;
  `notificationclick` → закрыть, найти открытую вкладку и навигировать на `url`,
  иначе `clients.openWindow(url)`.
- vite-plugin-pwa: `strategies:'injectManifest'`, `srcDir:'src'`, `filename:'sw.js'`,
  `registerType:'autoUpdate'`, `manifestFilename:'manifest.webmanifest'`, `scope:'/'`.
- `manifest.webmanifest`: name/short_name (КЛИМАТ-ПРО), icons 192/512, `start_url:'/'`,
  `display:'standalone'`, theme/background в тон сайта.
- `index.html`: `<link rel=manifest>`, `apple-touch-icon`, `apple-mobile-web-app-capable`.
- Иконки 192/512 генерируются программно (простой логотип/буква на фоне).
- iOS install-баннер: компонент, показывается при `navigator.standalone===false` на
  iOS Safari — «Добавьте на экран „Домой" для уведомлений».
- Деплой: `deploy-web.sh` копирует `dist/` целиком → sw.js+manifest едут автоматически.

## 7. Фронт

- Регистрация SW — хук `useRegisterSW` из `virtual:pwa-register/react`, один раз при старте.
- `src/lib/push.js`: `isPushSupported()`, `enablePush()` (permission → subscribe →
  upsert в `push_subscriptions` с user_agent), `disablePush()` (unsubscribe + delete),
  `getPushState()`.
- VAPID public — `VITE_VAPID_PUBLIC_KEY` в `.env.production`.
- Настройки (`SettingsView`), блок «Уведомления»:
  - Транспортный тумблер «Push на этом устройстве» (вкл/выкл подписку; отдельная
    обработка `permission==='denied'`).
  - Per-тип галочки: Задачи (notif_task), Проект взят (notif_project_taken),
    Приглашение в команду (notif_team_invite), Комментарии/вопросы (notif_comment),
    Дедлайны (notif_deadline), Новые проекты (notif_new_project). Часть уже в UI —
    упорядочить в единый блок, добавить notif_new_project.
- Галочки управляют **push**. Живой Realtime-апдейт списка/доски не трогаем.

## 8. Edge-функция `web-push-notify`

- Структура по образцу `telegram-notify`: `Deno.serve`, CORS, PostgREST под
  service_role через `SUPABASE_URL=http://kong:8000`.
- Транспорт `@negrel/webpush`: `ApplicationServer` из VAPID (private из `config.json`),
  `send` на каждую подписку получателя; `404/410` → `DELETE push_subscriptions` по endpoint.
- Резолверы по таблице §5; payload `{title, body, url, tag}`; тексты как в Telegram.
- Тип `deadline`: edge сам находит задачи с `due` в ближайшие 24ч (и не уведомлённые
  повторно за этот период).

## 9. Deadline-cron

- pg_cron job (напр. `0 9 * * *`) → `net.http_post('http://kong:8000/functions/v1/web-push-notify',
  headers: Authorization Bearer service_role, body {type:'deadline'}, timeout 30000)`.
- **Грабля self-hosted** (supabase#44907): только внутренний `kong:8000`, НЕ cloud-URL
  и НЕ localhost; cron заводить SQL'ом, а не через Studio-UI (UI генерирует битый URL,
  фейл молчаливый — проверять `net._http_response`).
- Пред-условие: `CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net;`
  в PG17-compose (проверить, что доступны).

## 10. Секреты и деплой

- VAPID пара — один раз скриптом `@negrel/webpush` (generate-vapid-keys). Public →
  `.env.production`; private (JWK) → `volumes/functions/web-push-notify/config.json`
  (не в git); `subject: mailto:<контакт>`.
- Фронт: `vite build` → `deploy-web.sh`.
- Edge: скрипт по образцу `deploy-edge-function.sh` (cp в volumes + restart edge-runtime);
  config.json — на сервер вручную.
- БД: миграция (`push_subscriptions` + RLS + `notif_new_project` + pg_cron job),
  применить `docker exec psql`.

## 11. Критерии приёмки

1. БД: `push_subscriptions` + RLS (`verify-rls.sh` → RLS_OK под двумя юзерами);
   `notif_new_project` есть; pg_cron job зарегистрирован.
2. Фронт: тумблер → permission → подписка сохраняется (своя строка под RLS).
3. E2E по каждому типу (task_assigned/status/created, project_taken, team_invite,
   comment, project_published, deadline): получатель с подпиской+флагом получает
   уведомление; снятый флаг → не получает; инициатор → не получает.
4. `notificationclick` открывает нужную задачу/проект.
5. Протухшая подписка (410) удаляется автоматически.
6. iOS: установленная PWA получает push; не-PWA видит install-баннер.
7. `npm run build` зелёный; прод 200; свежий ассет.
8. deadline: ручной вызов edge `{type:'deadline'}` шлёт корректно; pg_cron job
   срабатывает (`cron.job_run_details` + `net._http_response` без ошибок).

## 12. Риски и проверки на этапе реализации

- `pg_cron`/`pg_net` включены в наш PG17-compose? (если нет — добавить расширения).
- `@negrel/webpush` стартует в нашем edge-runtime — smoke-тест до полной интеграции;
  при провале — fallback `@pushforge/builder`.
- iOS push проверяется только на реальном устройстве с установленной PWA.
- `comment`-резолвер: убедиться, что список участников задачи берётся из 6.4b-модели
  (`can_access_task` / участники проекта), не из пустого `project_members`.

## 13. Что НЕ входит (YAGNI)

- Менеджер устройств (список/отписка чужих подписок) — только тумблер на текущее.
- Presence-трекинг (дедуп с Realtime) — шлём всегда.
- Удаление мёртвой `telegram-notify` — отдельный мелкий долг.
- Реальный SMTP/email-канал — вне объёма.
