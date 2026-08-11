# Удалённый MCP OAuth — checkpoint 2026-08-11

## Результат

Развёрнут удалённый MCP, не требующий от пользователя репозитория, Node.js или
доступа к компьютеру владельца. Канонический URL:
`https://193-124-130-236.sslip.io/mcp`.

Admin выдаёт каждому одобренному аккаунту `read` либо `write`; отсутствие гранта
означает deny. OAuth-токен используется для обращения к Supabase от имени самого
пользователя, поэтому существующие роли, RLS и RPC не обходятся. Запись по-прежнему
проходит prepare → отдельное подтверждение → confirm.

## Реализовано и развёрнуто

- `mcp_user_access` + admin-only RPC и RLS;
- Admin selector и `/oauth/consent`;
- OAuth protected-resource metadata и Bearer challenge;
- проверка Auth-сессии, issuer, OAuth `client_id`, approved profile и живого гранта;
- Node 22 MCP container без публичного порта;
- nginx/Caddy routing через существующий `:8080` tunnel;
- guarded deploy с backup и non-destructive rollback Auth/config, web и Caddy;
- русские инструкции в README, MCP README и встроенной помощи.

## Проверено

- frontend: 165 тестов PASS;
- MCP: 59 тестов PASS;
- Vite production build PASS;
- production dependency audits: 0 vulnerabilities;
- Docker build на Node 22 PASS;
- контейнерные `/healthz` и RFC 9728 metadata PASS;
- `docker compose config`, `nginx -t` и bash syntax PASS.

## Live production E2E

- внешний frontend/asset, protected-resource metadata и OAuth discovery: HTTP 200;
- unauthenticated `/mcp`: HTTP 401 + `WWW-Authenticate` с resource metadata;
- DCR + Authorization Code/PKCE + consent: PASS;
- access token + refresh/rotation: PASS;
- MCP initialize и список из 5 tools: PASS;
- грант `read`: чтение PASS, prepare отклонён;
- смена на `write`: реальный create preview → confirm → delete preview → confirm PASS;
- отзыв `none`: тот же свежий OAuth access token немедленно получает HTTP 401;
- временные user/OAuth client/client record после теста: 0/0/0.

## Deployment-инцидент и восстановление

- Первая попытка остановилась на неверном default compose filename. Исправлено на
  явный `-f /srv/daniil-deploy/docker-compose.web.yml`.
- Старый rollback попытался применить clean auth schema dump и остановился на
  внешних FK. До ошибки были сняты 46 auth-индексов и 2 trigger.
- Auth поднят на v2.195.0; pre-upgrade dump восстановлен во временную БД, каталоги
  сравнены, только отсутствующие 46 индексов и 2 trigger возвращены. Проверка:
  missing pre-upgrade indexes=0, Auth healthy. Временная recovery-БД удалена.
- Автоматический schema-restore удалён из rollback; schema dump остаётся только
  аварийным артефактом для контролируемого ручного восстановления.
- Второй дефект — root-owned `0600` source после secure `umask` — закрыт
  `COPY --chown=mcp:mcp`; контейнер теперь запускается non-root user `mcp`.
- Revoke первоначально возвращал 500 вместо 401; добавлен regression-тест и точный
  auth-error mapping. Полный повторный E2E после исправления прошёл.

Backup первой попытки сохранён в
`/srv/daniil-deploy/backups/remote-mcp-20260811T145108Z`. Production работает на
GoTrue v2.195.0 и `daniil-mcp`; ручных релизных действий не осталось.
