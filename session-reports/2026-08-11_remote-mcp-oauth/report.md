# Удалённый MCP OAuth — checkpoint 2026-08-11

## Результат

Подготовлен удалённый MCP, не требующий от пользователя репозитория, Node.js или
доступа к компьютеру владельца. Канонический URL:
`https://193-124-130-236.sslip.io/mcp`.

Admin выдаёт каждому одобренному аккаунту `read` либо `write`; отсутствие гранта
означает deny. OAuth-токен используется для обращения к Supabase от имени самого
пользователя, поэтому существующие роли, RLS и RPC не обходятся. Запись по-прежнему
проходит prepare → отдельное подтверждение → confirm.

## Реализовано локально

- `mcp_user_access` + admin-only RPC и RLS;
- Admin selector и `/oauth/consent`;
- OAuth protected-resource metadata и Bearer challenge;
- проверка Auth-сессии, issuer, OAuth `client_id`, approved profile и живого гранта;
- Node 22 MCP container без публичного порта;
- nginx/Caddy routing через существующий `:8080` tunnel;
- guarded deploy с backup и rollback Auth schema/config, web и Caddy;
- русские инструкции в README, MCP README и встроенной помощи.

## Проверено

- frontend: 165 тестов PASS;
- MCP: 58 тестов PASS;
- Vite production build PASS;
- production dependency audits: 0 vulnerabilities;
- Docker build на Node 22 PASS;
- контейнерные `/healthz` и RFC 9728 metadata PASS;
- `docker compose config`, `nginx -t` и bash syntax PASS.

## Не выполнено без гейта владельца

- живая миграция `20260811_0001_remote_mcp_access.sql`;
- изменение `API_EXTERNAL_URL`/`SITE_URL` и Auth 2.186.0 → 2.195.0;
- merge в `main`, push и production deploy;
- реальный DCR + PKCE + refresh и denied/read/write/revoke E2E.

Точный следующий запуск: после адресного разрешения выполнить deploy-пакет,
остановиться на первом фактическом разрыве, затем сверить внешний asset и все OAuth
границы. Любой FAIL активирует rollback к конкретному timestamp backup.
