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

## Дальше (этап 6.2)

Миграция реальной схемы и данных с облачного Supabase на локальный.
Потребуется доступ к облачному проекту (`pzdzyaswjlqiifmacygr.supabase.co`).
После миграции — переключить фронт на `https://193-124-130-236.sslip.io`.
