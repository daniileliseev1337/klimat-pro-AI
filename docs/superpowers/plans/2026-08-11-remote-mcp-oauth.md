# Remote MCP OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать любому одобренному администратором пользователю возможность подключить Claude, ChatGPT, Codex или другой совместимый клиент к публичному MCP URL без репозитория и локальной установки.

**Architecture:** Self-hosted Supabase Auth v2.195.0 выступает OAuth 2.1 authorization server с PKCE, refresh token и dynamic client registration. Публичный Node MCP остаётся resource server: проверяет Supabase OAuth JWT, наличие `client_id`, одобрение профиля и отдельный уровень `read`/`write`, после чего выполняет запросы тем же JWT через существующие RLS/RPC. Nginx проксирует `/mcp` и OAuth discovery к внутренним сервисам, а Caddy/frp продолжают использовать существующие 8080/8000 без нового публичного порта.

**Tech Stack:** React 18, Supabase JS 2.112.3, Supabase Auth/GoTrue 2.195.0, PostgreSQL RLS/RPC, Node.js 22, MCP SDK 1.30, nginx, Docker Compose, Caddy, Vitest.

## Global Constraints

- Канонический MCP resource: `https://193-124-130-236.sslip.io/mcp`.
- OAuth issuer: `https://193-124-130-236.sslip.io/auth/v1`.
- Доступ по умолчанию запрещён; Admin выбирает `none`, `read` или `write` для каждого пользователя.
- `read` разрешает только контекст/запросы; `write` дополнительно разрешает prepare/confirm/cancel, но не обходит обычные роли/RLS.
- Любая запись сохраняет существующий двухфазный preview/confirmation flow.
- Dynamic registration включается для совместимости с неизвестными MCP-клиентами; пользователь всё равно обязан войти, увидеть consent и иметь admin-грант.
- Публичный endpoint не принимает query-string tokens, anon/service keys или обычные web-сессии без OAuth `client_id`.
- Root `main`, живая БД, Auth-контейнер и production не изменяются до отдельного адресного `го` владельца.

---

### Task 1: Database access gate

**Files:**
- Create: `supabase/migrations/20260811_0001_remote_mcp_access.sql`
- Create: `deploy/mcp/verify-remote-mcp-rls.sh`

**Interfaces:**
- Produces table `public.mcp_user_access(user_id, access_level, updated_at, updated_by)`.
- Produces RPC `public.admin_set_mcp_access(p_user_id uuid, p_access_level text)`.
- Consumed by frontend Admin and `mcp/src/auth.js`.

- [x] **Step 1: Write the failing structural test**

Create `mcp/test/migration.test.js` that reads the migration and asserts: RLS enabled; default-deny `none`; level check constraint; indexed `updated_by`; own/admin SELECT policy; SECURITY DEFINER RPC with `is_admin()` and fixed `search_path`; no grants to `anon` for mutation.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm --prefix mcp test -- migration.test.js`
Expected: FAIL because the migration is absent.

- [x] **Step 3: Implement the migration**

Use a primary-key FK to `auth.users(id)`, `access_level text check (access_level in ('read','write'))`, explicit RLS and an admin-only upsert/delete RPC. Log changes through `public.log_activity('mcp_access_changed', ...)`.

- [x] **Step 4: Add transaction-based RLS verification**

The script must prove: no row means denied; owner can read only their grant; another user cannot read it; non-admin cannot mutate; admin can set/read/revoke; revocation is visible immediately.

- [x] **Step 5: Run tests and commit**

Run: `npm --prefix mcp test -- migration.test.js`
Expected: PASS.

---

### Task 2: Admin grant controls and OAuth consent page

**Files:**
- Create: `src/lib/mcpAccess.js`
- Create: `src/lib/mcpAccess.test.js`
- Create: `src/components/OAuthConsentPage.jsx`
- Create: `src/components/McpAccessControl.jsx`
- Modify: `src/main.jsx`
- Modify: `src/App.jsx`
- Modify: `src/lib/helpContent.js`
- Modify: `src/lib/helpContent.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- `normalizeMcpAccessRow(row) -> 'none'|'read'|'write'`.
- `loadMyMcpAccess(client, userId) -> accessLevel`.
- `adminSetMcpAccess(client, userId, accessLevel) -> void`.
- `/oauth/consent?authorization_id=...` renders OAuth login/consent independently of the normal dashboard.

- [x] **Step 1: Write failing unit tests**

Tests assert level normalization, denial for missing grants, Russian labels, admin RPC payload, and that the help text names only the public URL—not a repository path.

- [x] **Step 2: Verify RED**

Run: `npm test -- --run src/lib/mcpAccess.test.js src/lib/helpContent.test.js`
Expected: FAIL because helpers/copy are absent.

- [x] **Step 3: Upgrade Supabase JS and implement helpers**

Upgrade root `@supabase/supabase-js` to `2.112.3`. Keep the existing singleton and session storage behavior. Add only the three access levels.

- [x] **Step 4: Implement consent UI**

The page must preserve `authorization_id`, authenticate with existing email/username logic, call `auth.oauth.getAuthorizationDetails`, show client name/scopes and access level, deny when access is absent, and call approve/deny APIs only after an explicit click.

- [x] **Step 5: Add Admin controls**

Admin users list gets a compact selector `MCP: нет / чтение / изменение` for every account, including the administrator. Changing it calls the RPC, refreshes the map and shows a toast. Revocation is explicit and auditable.

- [x] **Step 6: Verify GREEN and build**

Run: `npm test` and `npm run build`.
Expected: all tests PASS; Vite build PASS.

---

### Task 3: OAuth-aware remote MCP resource server

**Files:**
- Create: `mcp/src/oauth-metadata.js`
- Create: `mcp/test/oauth-metadata.test.js`
- Modify: `mcp/src/auth.js`
- Modify: `mcp/src/config.js`
- Modify: `mcp/src/http-security.js`
- Modify: `mcp/src/http.js`
- Modify: `mcp/src/runtime.js`
- Modify: `mcp/src/service.js`
- Modify: `mcp/test/auth.test.js`
- Modify: `mcp/test/config.test.js`
- Modify: `mcp/test/http-security.test.js`
- Modify: `mcp/test/http.test.js`
- Modify: `mcp/test/service.test.js`

**Interfaces:**
- `protectedResourceMetadata(config)` returns RFC 9728 JSON.
- `requireOAuthIdentity(client, token, config)` returns `{id,email,accessLevel,clientId}`.
- HTTP serves `/mcp` plus `/.well-known/oauth-protected-resource` and path-specific PRM.

- [x] **Step 1: Write failing OAuth boundary tests**

Assert 401 includes `resource_metadata`; PRM lists canonical resource, authorization server and `openid email profile offline_access`; missing `client_id`, unapproved profile, missing grant and revoked grant are rejected; read grant rejects prepare/confirm; write grant passes.

- [x] **Step 2: Verify RED**

Run: `npm --prefix mcp test -- oauth-metadata.test.js auth.test.js http.test.js service.test.js`
Expected: FAIL on missing metadata/access behavior.

- [x] **Step 3: Implement metadata and OAuth identity validation**

Use `auth.getUser(token)` as the signature/session validation boundary, decode claims only after validation, require issuer and `client_id`, then read `mcp_user_access` with the same JWT. Do not introduce `service_role` or JWT-secret signing.

- [x] **Step 4: Enforce read/write levels**

`getContext` reports the level. `query` works for read/write. `prepareChange`, `confirmChange` and `cancelChange` require write. Existing role/RLS checks remain the final authority.

- [x] **Step 5: Implement Streamable HTTP methods safely**

POST handles JSON-RPC. GET/DELETE are delegated to the SDK transport or return protocol-correct method responses. OPTIONS is narrowly allowed for configured origins. Body limit, Host/Origin allowlists and no-store headers remain.

- [x] **Step 6: Verify GREEN**

Run: `npm run mcp:test` and `npm --prefix mcp audit --audit-level=low`.
Expected: all MCP tests PASS; 0 vulnerabilities.

---

### Task 4: Production container and OAuth routing

**Files:**
- Create: `mcp/Dockerfile`
- Create: `mcp/.dockerignore`
- Create: `deploy/nginx.default.conf`
- Create: `deploy/mcp/deploy-remote-mcp.sh`
- Create: `deploy/mcp/verify-remote-mcp-http.sh`
- Create: `deploy/mcp/rollback-remote-mcp.sh`
- Modify: `deploy/docker-compose.web.yml`
- Modify: `deploy/INFRASTRUCTURE.md`

**Interfaces:**
- Docker service `mcp` listens only inside the compose network on `8788`.
- nginx proxies `/mcp` and PRM to `mcp:8788`, OAuth endpoints to `auth:9999`, and SPA paths to `index.html`.
- Existing public `:8080` tunnel remains the only MCP ingress.

- [x] **Step 1: Write failing configuration tests**

Create `mcp/test/deploy-config.test.js` asserting: MCP has no host port; web/MCP join `supabase_default`; secrets are compose substitutions, not literals; nginx exact OAuth routes precede SPA fallback; deploy script backs up compose/nginx/Auth files and includes rollback.

- [x] **Step 2: Verify RED**

Run: `npm --prefix mcp test -- deploy-config.test.js`
Expected: FAIL because deploy files are absent.

- [x] **Step 3: Implement image/compose/nginx**

Build an unprivileged Node 22 image, copy only production package/source, add a health endpoint, no source bind mount and no host port. Use `${ANON_KEY}` only in the MCP container.

- [x] **Step 4: Implement guarded deployment**

The script verifies fixed paths, creates timestamped backups, updates GoTrue to `supabase/gotrue:v2.195.0`, adds OAuth env flags, validates compose/config syntax, pulls/builds images, restarts only Auth/web/MCP, performs health checks and restores backups on failure.

- [x] **Step 5: Implement public routing update**

Caddy routes OAuth discovery and `/auth/v1/oauth/*` through nginx before generic `/auth/*`; no new VPS port is opened. Script validates Caddy before reload and restores the previous file if external verification fails.

- [x] **Step 6: Verify GREEN**

Run config tests, `docker compose config` against non-secret fixture values, `nginx -t` in an ephemeral container, and shell syntax checks.

---

### Task 5: User-facing instructions and release verification

**Files:**
- Modify: `README.md`
- Modify: `mcp/README.md`
- Modify: `docs/STATUS.md`
- Modify: `docs/IDEAS.md`
- Create: `session-reports/2026-08-11_remote-mcp-oauth/report.md`

**Interfaces:**
- Users receive only `https://193-124-130-236.sslip.io/mcp` plus client-specific UI steps.
- Admin instructions explain access grant/revoke and the maximum one-hour residual JWT window only if live verification proves it; otherwise document immediate server-side grant check.

- [x] **Step 1: Replace local-only guidance**

Document ChatGPT/Claude/Codex generic connection: add remote MCP URL, browser login, consent, successful tool scan. Keep local stdio as an optional developer mode.

- [x] **Step 2: Run complete local verification**

Run frontend/MCP tests, audits, production build, secret scan, JSON/TOML parsing, Dockerfile/compose/nginx/shell checks and `git diff --check`.

- [x] **Step 3: Stop at owner gates**

Present exact live operations: DB migration, Auth image/config upgrade, main merge/push, VPS Caddy reload and production deploy. Do not execute until the owner sends an addressable `го` for these operations.

- [ ] **Step 4: After owner approval, execute live E2E**

Verify: unauthenticated `/mcp` = 401 + PRM; OAuth discovery/DCR/PKCE/refresh; denied user blocked; read user can query but not prepare; write user completes preview/confirm; revoked user is blocked on next MCP request; `dist`/nginx/external assets match; rollback artifacts exist.
