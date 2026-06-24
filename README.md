# klimat-pro-AI

Личный рабочий центр: проекты, финансы, задачи, команда и аналитика в одном
React-приложении. Работает на **собственной инфраструктуре** (self-hosted Supabase
за туннелем), доступен с любого устройства, ставится как приложение (PWA).

## Что внутри

Разделы приложения: **Дашборд · Проекты · Финансы · Аналитика · Задачи**. Плюс
админ-панель, управление командой проекта, клиентская база и права/бейджи (v1.5).

- Импорт банковских выписок: CSV (Тинькофф / Сбер / Альфа / Яндекс) и PDF (Яндекс Банк),
  автокатегоризация транзакций.
- Экспорт отчётов печатью в PDF.
- Слой задач: список с фильтрами, доска с drag-and-drop, задачи проекта, уведомления.
- PWA: устанавливается на телефон/десктоп, работает офлайн (service worker, push-уведомления).

## Стек

React 18 + Vite 5 · Tailwind CSS 3 · Supabase (self-hosted) · framer-motion · recharts ·
lucide-react · vite-plugin-pwa. Тесты — Vitest.

## Структура проекта

```
klimat-pro-AI/
├── index.html              # Точка входа
├── package.json            # Зависимости и команды
├── vite.config.js          # Сборщик (Vite + PWA)
├── tailwind.config.js      # Tailwind
├── postcss.config.js       # PostCSS
├── .env / .env.production  # Переменные окружения (НЕ в git)
├── src/
│   ├── main.jsx            # Старт приложения
│   ├── App.jsx             # Основной код (~8400 строк)
│   ├── index.css           # Глобальные стили (включая тему и режим контрастности)
│   ├── sw.js               # Service worker (PWA/офлайн)
│   ├── components/         # BackgroundCanvas, CommandPalette, MagneticButton, NotificationBell
│   └── lib/                # supabase, dashboardMetrics, notifications, push, taskUi, lineDiff (+ тесты)
├── public/                 # Статика и иконки PWA
├── scripts/                # gen-icons.mjs, gen-vapid-node.mjs
├── supabase/               # Миграции БД
├── deploy/                 # Инфраструктура: docker-compose, nginx, скрипты деплоя, Nextcloud, задачи
│   ├── README.md           # Состав инфраструктуры
│   └── INFRASTRUCTURE.md   # Карта развёрнутого стека (топология, автозапуск, деплой)
├── docs/                   # BACKLOG.md, ТЗ
└── apartment-tracker/      # Отдельный вложенный подпроект
```

## Локальная разработка

```bash
# Установка зависимостей (один раз)
npm install

# Переменные окружения: создай .env с ключами Supabase
#   VITE_SUPABASE_URL=...
#   VITE_SUPABASE_KEY=...
# (значения для прода — в .env.production, в git не попадают)

# Запуск дев-сервера
npm run dev          # http://localhost:5173

# Тесты
npm test             # vitest run
```

Изменения в коде применяются мгновенно (HMR), без перезагрузки страницы.

## Сборка и деплой

Проект задеплоен на **собственной инфраструктуре** (не Vercel). Полная карта —
[deploy/INFRASTRUCTURE.md](deploy/INFRASTRUCTURE.md).

```bash
# 1. Сборка на Windows (node_modules — Windows-нативные)
npm run build                          # → dist/

# 2. Раскладка собранного фронта на сервер (внутри WSL Ubuntu)
bash deploy/nextcloud/deploy-web.sh    # dist → /srv/daniil-deploy/web (bind-mount nginx)
```

Скрипт чистит **содержимое** каталога `web`, не пересоздавая его (каталог — источник
bind-mount для nginx-контейнера). После раскладки сайт обновляется на nginx `:8080`.

### Как это опубликовано

```
[Интернет] → VPS (Москва, Caddy :443, TLS) → frp-туннель → домашний ПК (WSL2 Docker)
              ├─ /rest,/auth,/realtime,/storage,/functions → Supabase :8000 (Kong)
              └─ всё остальное → nginx :8080 (этот фронт)
```

Публичный адрес: **https://193-124-130-236.sslip.io**. Supabase развёрнут self-hosted
в WSL2 (13 контейнеров), наружу выведены только web `:8080` и Kong `:8000` — через туннель.
Секреты (`.env` Supabase, токены туннеля) на серверах и **никогда не коммитятся**.

## PWA на телефон

1. Открой публичный адрес в браузере (на iPhone — именно в Safari).
2. Кнопка «Поделиться» → «На экран „Домой"».
3. Иконка появится на главном экране; приложение открывается во весь экран, без адресной строки.

## Если что-то не работает

- **Сайт не открывается / 502** — обычно туннель отвалился из-за idle-shutdown WSL.
  Стек поднимается сам после `wsl --shutdown`; «якорь» от простоя — VBS-автозапуск
  (`sleep infinity`). Проверка статуса — в [deploy/INFRASTRUCTURE.md](deploy/INFRASTRUCTURE.md) («Управление»).
- **«Load failed» при входе** — неверный ключ Supabase в `.env` / `.env.production`.
- **«Аккаунт ожидает одобрения»** — email не подтверждён: в Supabase Studio (локально)
  → Auth → Users → Confirm email вручную.
- **Build failed (Tailwind/PostCSS)** — проверь, что `tailwind.config.js` и
  `postcss.config.js` на месте и `npm install` отработал.

---

> Инфраструктура — v3.0 (этапы 6.1–6.4a развёрнуты). Приложение — v1.5.0.
> Подробности и долги: [docs/BACKLOG.md](docs/BACKLOG.md), [deploy/INFRASTRUCTURE.md](deploy/INFRASTRUCTURE.md).
