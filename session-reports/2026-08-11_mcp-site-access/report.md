# Отчёт: MCP-доступ к «КЛИМАТ-ПРО»

**Дата:** 2026-08-11
**Ветка:** `codex/mcp-site-access`
**Прод / живая БД:** не изменялись

## Результат

Реализован отдельный пакет `mcp/` с двумя транспортами: локальный stdio и
аутентифицированный Streamable HTTP. Сервер использует anon key + пользовательскую
Supabase-сессию, поэтому существующие RLS/RPC остаются единственным контуром прав.

LLM получает карту сущностей и JSON Schema разрешённых действий, может читать
рабочие данные и готовить изменения. Любая запись выполняется только отдельным
confirm-вызовом с одноразовой фразой, TTL 5 минут, привязкой к пользователю и
повторной fingerprint-проверкой исходной записи.

## Безопасность

- `service_role`, raw SQL, произвольные таблицы/колонки отсутствуют;
- caller не может подменить `owner_id`/`author_id`;
- stdio-сессия хранится локально и gitignored, пароль вводится скрыто;
- HTTP требует Bearer JWT, exact Host/Origin allowlist и body limit;
- исправлены схемы по фактическим enum живой БД (`clients`, `projects.visibility`,
  legacy profile role и functional roles);
- зависимости обновлены до версий без известных `npm audit` уязвимостей.

## Верификация

- MCP Vitest: 48/48 PASS;
- реальный дочерний stdio-процесс: initialize + tools/list PASS;
- локальный Streamable HTTP SDK client: Bearer initialize + tools/list PASS;
- `npm audit --audit-level=low`: 0 vulnerabilities.
- frontend regression: 161/161 PASS;
- production build: PASS (`index-CYD0ep63.js`, существующее предупреждение о чанке >500 kB).
- `git diff --check`: PASS.

## Owner-gated продолжение

Для использования в production остаются отдельные решения владельца: merge ветки
в `main`; настройка MCP-клиента; при необходимости — публикация HTTP endpoint через
HTTPS reverse proxy. Новая миграция БД этой реализации не требуется.
