# MCP Site Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready MCP server that lets authenticated LLM clients read and safely mutate KЛИМАТ-ПРО data through existing Supabase RLS/RPC contracts.

**Architecture:** A separate `mcp/` Node.js package exposes a small tool surface over a transport-independent service. `stdio` uses a persisted local Supabase session; stateless Streamable HTTP accepts a per-request Supabase access JWT. All writes use a prepare/confirm state machine with one-time tokens and stale-preview protection.

**Tech Stack:** Node.js ESM, `@modelcontextprotocol/sdk@1.30.0`, Zod 4, `@supabase/supabase-js`, Vitest, existing Supabase/PostgREST/RPC/Edge Functions.

## Global Constraints

- Never use or accept a Supabase `service_role` key.
- Never expose raw SQL, arbitrary table names, arbitrary columns or wildcard delete/update.
- Every database call must run with the authenticated user's JWT so live RLS/RPC remains authoritative.
- Every mutation requires prepare + separate exact confirmation; tokens expire after 5 minutes and are single-use.
- The HTTP server binds to `127.0.0.1` by default and requires Bearer JWT plus host/origin validation.
- Binary file transfer and password-bearing admin operations are not part of this JSON MCP version.
- Do not apply live DB changes, merge to `main` or deploy without a separate explicit owner instruction.

---

### Task 1: Package, configuration and authentication

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/.gitignore`
- Create: `mcp/src/config.js`
- Create: `mcp/src/session-store.js`
- Create: `mcp/src/auth.js`
- Create: `mcp/src/login.js`
- Test: `mcp/test/config.test.js`
- Test: `mcp/test/session-store.test.js`

**Interfaces:**
- Produces: `loadConfig(overrides)`, `createStdioSupabase(config)`, `createHttpSupabase(config, accessToken)`, `requireIdentity(client)`, and a Supabase-compatible persistent storage adapter.

- [x] Write failing tests that reject missing URL/anon key, reject any service-role configuration, never print tokens, and persist rotated sessions atomically.
- [x] Run `npm test -- config session-store` and verify RED because the modules do not exist.
- [x] Implement the minimal configuration/session/auth modules and interactive `login.js`.
- [x] Run the focused tests and verify GREEN.

### Task 2: Safe entity/action catalog

**Files:**
- Create: `mcp/src/catalog.js`
- Test: `mcp/test/catalog.test.js`

**Interfaces:**
- Produces: `QUERY_ENTITIES`, `ACTION_SCHEMAS`, `normalizeAction(action, payload)`, `describeCapabilities()`.
- Normalized actions never contain caller-provided ownership/author fields.

- [x] Write failing tests for every query entity and action family, unknown fields, enum validation, UUID/date/amount rules and ownership-field stripping.
- [x] Run `npm test -- catalog` and verify RED.
- [x] Implement Zod schemas plus explicit JS-to-DB field maps for projects, tasks, clients and transactions.
- [x] Run the focused tests and verify GREEN.

### Task 3: Supabase gateway over existing RLS/RPC

**Files:**
- Create: `mcp/src/supabase-gateway.js`
- Test: `mcp/test/supabase-gateway.test.js`

**Interfaces:**
- Consumes: normalized entity filters/actions from `catalog.js`.
- Produces: `createSupabaseGateway(client)` with `getContext()`, `query()`, `snapshot()`, `execute()` and `audit()`.

- [x] Write failing tests using a deterministic fake PostgREST/RPC client for safe selects, per-entity filters, max limit 100, zero-row write rejection and exact RPC arguments.
- [x] Run the focused test and verify RED.
- [x] Implement entity queries by reusing the same tables/RPCs as `src/App.jsx`.
- [x] Implement all action handlers without `service_role` or ownership override.
- [x] Run the focused tests and verify GREEN.

### Task 4: Confirmation state machine and service

**Files:**
- Create: `mcp/src/change-store.js`
- Create: `mcp/src/service.js`
- Test: `mcp/test/change-store.test.js`
- Test: `mcp/test/service.test.js`

**Interfaces:**
- Produces: `createChangeStore({ clock, randomUUID, ttlMs })` and `createKlimatService({ gateway, changeStore })`.
- `prepareChange()` returns preview/token/phrase; `confirmChange()` consumes once and rechecks fingerprint.

- [x] Write failing tests for expiry, one-time use, wrong user, wrong phrase, stale snapshot, cancel and successful execution.
- [x] Run focused tests and verify RED.
- [x] Implement deterministic fingerprints and the prepare/confirm/cancel service.
- [x] Run focused tests and verify GREEN.

### Task 5: MCP tools/resources and stdio transport

**Files:**
- Create: `mcp/src/mcp-server.js`
- Create: `mcp/src/stdio.js`
- Test: `mcp/test/mcp-server.test.js`

**Interfaces:**
- Consumes: `createKlimatService()`.
- Produces: `createMcpServer({ service })` and the executable stdio entrypoint.

- [x] Write an in-memory SDK client test for initialize, resources/list, resources/read, tools/list and each tool-call class.
- [x] Run the focused test and verify RED.
- [x] Register `kp_get_context`, `kp_query`, `kp_prepare_change`, `kp_confirm_change`, `kp_cancel_change` and static catalog/schema resources.
- [x] Add correct `readOnlyHint`, `destructiveHint`, `idempotentHint` and structured content.
- [x] Run the focused test and verify GREEN.

### Task 6: Authenticated Streamable HTTP transport

**Files:**
- Create: `mcp/src/http.js`
- Test: `mcp/test/http.test.js`

**Interfaces:**
- Produces: loopback HTTP entrypoint and pure `validateHttpRequest()` helper.

- [x] Write failing tests for missing/malformed Bearer token, body limit, method, host/origin allowlist and valid loopback request.
- [x] Run focused tests and verify RED.
- [x] Implement stateless Streamable HTTP with a fresh user-scoped Supabase client/server per request.
- [x] Run the focused test and verify GREEN.

### Task 7: Operator documentation and end-to-end verification

**Files:**
- Create: `mcp/README.md`
- Create: `mcp/examples/claude-desktop.json`
- Create: `mcp/examples/codex.toml`
- Modify: `docs/IDEAS.md`
- Modify: `docs/STATUS.md`
- Create: `session-reports/2026-08-11_mcp-site-access/report.md`

**Interfaces:**
- Documents login, stdio configuration, HTTP Bearer mode, confirmation workflow, supported operations and owner-gated deployment.

- [x] Install the pinned dependencies and retain `mcp/package-lock.json`.
- [x] Run `npm test` inside `mcp/` and verify all MCP tests pass.
- [x] Run the repository `npm test -- --run` and `npm run build` to prove frontend non-regression.
- [x] Run a local SDK smoke over stdio with a fake/in-memory gateway; do not use live credentials.
- [x] Run `git diff --check` and secret-pattern scan.
- [x] Update STATUS/IDEAS/report with verified facts and remaining live deployment gates.
