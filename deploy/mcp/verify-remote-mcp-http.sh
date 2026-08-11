#!/usr/bin/env bash
set -euo pipefail
BASE=https://193-124-130-236.sslip.io

test "$(curl -sS -o /tmp/kp-mcp-prm.json -w '%{http_code}' "$BASE/.well-known/oauth-protected-resource")" = 200
grep -q '"resource":"https://193-124-130-236.sslip.io/mcp"' /tmp/kp-mcp-prm.json
test "$(curl -sS -o /tmp/kp-oauth-meta.json -w '%{http_code}' "$BASE/.well-known/oauth-authorization-server/auth/v1")" = 200
grep -q 'authorization_endpoint' /tmp/kp-oauth-meta.json
test "$(curl -sS -o /tmp/kp-mcp-401.json -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' "$BASE/mcp")" = 401
echo REMOTE_MCP_HTTP_OK
