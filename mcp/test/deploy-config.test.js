import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = path => readFileSync(resolve(root, path), "utf8");

describe("remote MCP deployment configuration", () => {
  it("не публикует порт MCP и подключает web к Supabase network", () => {
    const compose = read("deploy/docker-compose.web.yml");
    expect(compose).toContain("mcp:");
    expect(compose).toContain("KP_SUPABASE_ANON_KEY: ${ANON_KEY}");
    expect(compose).not.toMatch(/8788:8788/);
    expect(compose).toContain("supabase_default:");
  });

  it("проксирует MCP/OAuth до SPA fallback", () => {
    const nginx = read("deploy/nginx.default.conf");
    expect(nginx.indexOf("location = /mcp")).toBeLessThan(nginx.indexOf("location /"));
    expect(nginx).toContain("proxy_pass http://mcp:8788/mcp");
    expect(nginx).toContain("proxy_pass http://auth:9999/oauth/");
    expect(nginx).toContain("try_files $uri $uri/ /index.html");
  });

  it("имеет backup, rollback и Auth 2.195.0 gate", () => {
    const deploy = read("deploy/mcp/deploy-remote-mcp.sh");
    const rollback = read("deploy/mcp/rollback-remote-mcp.sh");
    expect(deploy).toContain("supabase/gotrue:v2.195.0");
    expect(deploy).toContain("backup");
    expect(deploy).toContain("rollback");
    expect(deploy).toContain("GOTRUE_OAUTH_SERVER_ENABLED");
    expect(deploy).toContain("API_EXTERNAL_URL");
    expect(deploy).toContain("SITE_URL");
    expect(deploy).toContain('docker compose -f "$WEB/docker-compose.web.yml"');
    expect(rollback).toContain("auth-schema.sql");
    expect(rollback).toContain("mcp-table-preexisting.flag");
    expect(rollback).not.toContain('< "$BACKUP/auth-schema.sql"');
  });

  it("собирает MCP на поддерживаемой Supabase SDK версии Node", () => {
    const dockerfile = read("mcp/Dockerfile");
    const pkg = JSON.parse(read("mcp/package.json"));
    expect(dockerfile.match(/FROM node:22-alpine/g)).toHaveLength(2);
    expect(dockerfile).toContain("ENV KP_HTTP_HOST=0.0.0.0");
    expect(dockerfile.match(/--chown=mcp:mcp/g)).toHaveLength(3);
    expect(pkg.engines.node).toBe(">=22");
  });
});
