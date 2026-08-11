# Отчёт: MCP-доступ к «КЛИМАТ-ПРО»

**Дата:** 2026-08-11
**Ветка:** `codex/mcp-site-access` → fast-forward в `main`
**Прод / живая БД:** frontend развёрнут; БД не менялась, миграция не требуется

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
- frontend regression: 162/162 PASS;
- production build из `main`: PASS (`index-CgzldX97.js`, существующее предупреждение о чанке >500 kB);
- `dist` = nginx `:8080` = внешний HTTPS: `index-CgzldX97.js` + `index-DegNOVBM.css`, index/assets HTTP 200;
- `main` и `origin/main`: `3ca355d`; глобальный MCP Codex `klimat-pro` зарегистрирован и enabled;
- `git diff --check`: PASS.

## Состояние подключения

Production-доступ реализован в безопасном локальном режиме stdio: после
`npm run mcp:login` сервер обращается к живой Supabase от имени вошедшего
пользователя. Пароль и токены не передавались в сессию разработки; поэтому первый
персональный вход остаётся локальным действием владельца.

Публичный HTTP endpoint не открыт намеренно. Его можно внедрять отдельным этапом
только вместе с OAuth/refresh-потоком пользовательского JWT, HTTPS reverse proxy и
закрытым allowlist; публикация текущего loopback endpoint в интернет небезопасна.
