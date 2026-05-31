# Инфраструктура v3.0 — этап 6.1 (развёрнуто 2026-05-31)

Карта развёрнутой инфраструктуры. **Секретов здесь нет** (токены/пароли — только
на серверах). Документ для преемственности между сессиями и этапами.

## Топология

```
[Интернет] --HTTPS--> [VPS 193.124.130.236, Москва, VDSina, Ubuntu 26.04]
                        Caddy :443  (TLS Let's Encrypt по 193-124-130-236.sslip.io)
                          ├─ /rest,/auth,/realtime,/storage,/functions,/graphql → :8000
                          └─ всё остальное → :8080
                        frps :7000 (приём туннеля, auth по токену, proxyBindAddr=127.0.0.1)
                          ▲ исходящий туннель (TCP, стабильно внутри РФ)
                          │
[Домашний ПК, Windows 11] WSL2 Ubuntu, Docker (systemd, без Docker Desktop)
                        frpc → пробрасывает 127.0.0.1:8080 и :8000 на VPS
                        ├─ daniil-web (nginx, заглушка) :8080
                        └─ Supabase (13 контейнеров) :8000 (Kong API gateway)
```

**Публичный адрес:** https://193-124-130-236.sslip.io

## VPS (193.124.130.236)

- Роль: тонкий форвардер. Данные не хранит.
- Сервисы (systemd, автозапуск): `frps`, `caddy`.
- Конфиги: `/etc/frp/frps.toml`, `/etc/frp/token`, `/etc/caddy/Caddyfile`.
- Firewall (ufw): открыты только 22, 80, 443, 7000.
- SSH: только по ключу (парольный вход отключён, `00-hardening.conf`).
- Доступ: `ssh root@193.124.130.236` с ключом `/root/.ssh/id_ed25519` (в WSL ПК).

## Домашний ПК (WSL2 Ubuntu)

- Docker Engine (не Desktop), systemd включён (`/etc/wsl.conf`).
- Supabase: `/srv/supabase-src/docker` (`.env` с секретами — НЕ в git).
- Web/заглушка: `/srv/daniil-deploy` (исходник — `deploy/` в репо).
- frpc: `/usr/local/bin/frpc`, конфиг `/etc/frp/frpc.toml` (с токеном — НЕ в git).
- Сервисы systemd (автозапуск): `docker`, `frpc`. Контейнеры — `restart: unless-stopped`.

## Nextcloud (этап 6.3 — файловое хранилище, заменяет Yandex Disk)

- Стек: `/srv/nextcloud` (`docker-compose.yml` + `.env` с секретами — НЕ в git).
  Исходник compose/скрипты — `deploy/nextcloud/` в репо.
- 3 контейнера (`restart: unless-stopped`): `app` (nextcloud:stable, v33),
  `db` (postgres:16-alpine), `redis`.
- **Размещение данных:** БД/Redis/код NC — в ext4 docker-volume; пользовательские
  файлы — bind-mount на **`F:\nextcloud-data`** (`/mnt/f/nextcloud-data`).
  На drvfs `chmod` не действует → в конфиг добавлен `check_data_directory_permissions=false`
  (`config/drvfs.config.php`). Postgres НЕ на drvfs (иначе ломается).
- **Наружу НЕ выставлен.** Веб-UI/админка — только локально `127.0.0.1:8081`.
  В общей docker-сети `supabase_default` под алиасом `nextcloud` (его видит edge-runtime).
- Техюзер приложения `dashboard` (пароль в `/srv/nextcloud/.env`), файлы в `/projects/<project_id>/`.
- `trusted_domains`: `localhost`, `nextcloud`, `localhost:8081`.
- Доступ из приложения — через Edge Function `nextcloud` (см. ниже), не напрямую из браузера.

## Edge Function `nextcloud` (локальный Supabase)

- Код: `deploy/nextcloud/functions/nextcloud/index.ts` → деплоится в
  `/srv/supabase-src/docker/volumes/functions/nextcloud/`. Креды NC — в `config.json`
  рядом (на сервере, не в git). Сброс кэша — `docker restart supabase-edge-functions`.
- Actions: `upload` | `download` | `delete` | `toggle-public`. Чистый `fetch`
  (без supabase-js): метаданные пишутся/читаются через PostgREST **под JWT
  пользователя** (срабатывает RLS `project_files`), байты — по WebDAV под техюзером.
- `is_public`: при внутреннем NC прямой внешней ссылки нет (`public_url=null`);
  скачивание всегда через эту функцию с проверкой прав.

## Автозапуск

- VPS: `frps`, `caddy` — systemd enabled, переживают перезагрузку VPS.
- ПК: автозагрузка + KEEP-ALIVE WSL — VBS в папке Startup
  (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\daniil-dashboard-autostart.vbs`)
  запускает `wsl -d Ubuntu -u root -- /usr/bin/sleep infinity` (скрыто).
  Этот долгоживущий процесс — «якорь» со стороны Windows: без него WSL2 гасит
  виртуалку по простою (и туннель отваливается → 502). systemd в WSL поднимает
  docker + frpc, контейнеры — сами.
- ВАЖНО: systemd+frpc ВНУТРИ WSL не держат VM от idle-shutdown — нужен именно
  внешний Windows-процесс-якорь (sleep infinity). Это решено VBS-держателем.
- Проверено: после `wsl --shutdown` весь стек поднимается автоматически, HTTPS = 200.
- Ограничение: VBS срабатывает при ВХОДЕ пользователя. Для старта ДО входа нужна
  задача Планировщика с правами администратора (TODO, опционально).

## Управление (шпаргалка, в WSL Ubuntu)

```bash
# статус
systemctl status docker frpc
cd /srv/supabase-src/docker && docker compose ps
# перезапуск Supabase
cd /srv/supabase-src/docker && docker compose restart
# перезапуск туннеля
systemctl restart frpc
# логи туннеля
journalctl -u frpc -n 50
```

## Деплой фронта

`bash deploy/nextcloud/deploy-web.sh` — собранный `dist` → `/srv/daniil-deploy/web`.
Сборка: `npm run build` на Windows (node_modules — Windows-нативные). Скрипт чистит
**содержимое** каталога, не пересоздаёт его (каталог — источник bind-mount nginx).

## Дальше (этап 6.4)

Слой задач (таск-панель) как самостоятельная сущность над проектами (раздел 4.2 ТЗ).
Этапы 6.1 (инфра), 6.2 (миграция БД), 6.3 (Nextcloud) — завершены.
