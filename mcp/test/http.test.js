import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpHandler } from "../src/http.js";

const resources = [];

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  resources.push({ close: () => new Promise(resolve => server.close(resolve)) });
  return server.address().port;
}

afterEach(async () => {
  await Promise.allSettled(resources.splice(0).map(resource => resource.close()));
});

function fakeService() {
  return {
    getContext: vi.fn(async () => ({ user: { id: "u1" } })),
    query: vi.fn(async () => []),
    prepareChange: vi.fn(),
    confirmChange: vi.fn(),
    cancelChange: vi.fn(),
  };
}

describe("MCP Streamable HTTP", () => {
  it("требует Bearer JWT до создания сервиса", async () => {
    const createService = vi.fn();
    const config = { allowedHosts: [], allowedOrigins: [], bodyLimitBytes: 50_000, publicMcpUrl: "https://example.test/mcp", oauthIssuer: "https://example.test/auth/v1" };
    const port = await listen(createHttpHandler({ config, createService }));
    config.allowedHosts.push(`127.0.0.1:${port}`);

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('resource_metadata="https://example.test/.well-known/oauth-protected-resource"');
    expect(createService).not.toHaveBeenCalled();
  });

  it("публикует RFC 9728 metadata без Bearer token", async () => {
    const config = { allowedHosts: [], allowedOrigins: [], bodyLimitBytes: 50_000, publicMcpUrl: "https://example.test/mcp", oauthIssuer: "https://example.test/auth/v1" };
    const port = await listen(createHttpHandler({ config }));
    config.allowedHosts.push(`127.0.0.1:${port}`);
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resource: "https://example.test/mcp", authorization_servers: ["https://example.test/auth/v1"] });
  });

  it("возвращает 401, когда Admin отозвал MCP-грант", async () => {
    const createService = vi.fn(async () => {
      throw new Error("MCP-доступ не выдан администратором или уже отозван");
    });
    const config = { allowedHosts: [], allowedOrigins: [], bodyLimitBytes: 50_000, publicMcpUrl: "https://example.test/mcp", oauthIssuer: "https://example.test/auth/v1" };
    const port = await listen(createHttpHandler({ config, createService }));
    config.allowedHosts.push(`127.0.0.1:${port}`);

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer revoked-user-jwt" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("обслуживает MCP-клиента с валидированным Bearer token", async () => {
    const service = fakeService();
    const createService = vi.fn(async (_config, token) => {
      if (token !== "valid-user-jwt") throw new Error("bad token");
      return service;
    });
    const config = { allowedHosts: [], allowedOrigins: [], bodyLimitBytes: 50_000, publicMcpUrl: "https://example.test/mcp", oauthIssuer: "https://example.test/auth/v1" };
    const port = await listen(createHttpHandler({ config, createService }));
    config.allowedHosts.push(`127.0.0.1:${port}`);
    const client = new Client({ name: "http-test", version: "1.0.0" });
    resources.push(client);

    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer valid-user-jwt" } },
    }));
    const tools = await client.listTools();

    expect(tools.tools.map(tool => tool.name)).toContain("kp_query");
    expect(createService).toHaveBeenCalled();
  });
});
