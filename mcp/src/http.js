#!/usr/bin/env node
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createChangeStore } from "./change-store.js";
import { extractBearerToken, readJsonBody, validateHttpRequest } from "./http-security.js";
import { createKlimatMcpServer } from "./mcp-server.js";
import { createHttpService, loadRuntimeConfig } from "./runtime.js";
import { protectedResourceMetadata, protectedResourceMetadataUrl } from "./oauth-metadata.js";

function sendJson(response, status, body, extraHeaders = {}) {
  if (response.headersSent) return;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function rpcError(response, status, message, extraHeaders) {
  sendJson(response, status, {
    jsonrpc: "2.0",
    error: { code: status === 401 ? -32001 : -32600, message },
    id: null,
  }, extraHeaders);
}

export function createHttpHandler({ config, changeStore = createChangeStore(), createService = createHttpService } = {}) {
  return async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      return sendJson(response, 200, { ok: true, service: "klimat-pro-mcp" });
    }
    if (request.method === "GET" && ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(request.url)) {
      return sendJson(response, 200, protectedResourceMetadata(config));
    }
    if (request.url !== "/mcp") {
      return rpcError(response, 404, "Not found");
    }

    const validation = validateHttpRequest(request, config);
    if (!validation.ok) return rpcError(response, validation.status, validation.message);

    const accessToken = extractBearerToken(request.headers.authorization);
    if (!accessToken) {
      return rpcError(response, 401, "Требуется Authorization: Bearer <Supabase access JWT>", {
        "www-authenticate": `Bearer realm="klimat-pro", resource_metadata="${protectedResourceMetadataUrl(config)}"`,
      });
    }

    let body;
    try {
      body = await readJsonBody(request, config.bodyLimitBytes);
    } catch (error) {
      return rpcError(response, error.status || 400, error.message);
    }

    let server;
    let transport;
    try {
      const service = await createService(config, accessToken, changeStore);
      server = createKlimatMcpServer({ service });
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.setHeader("cache-control", "no-store");
      response.setHeader("x-content-type-options", "nosniff");
      response.once("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      await Promise.allSettled([transport?.close(), server?.close()]);
      const message = error?.message || "Internal MCP error";
      const status = /сесс|token|JWT|auth|user|issuer|client_id|аккаунт MCP не одобрен|MCP-доступ не выдан/i.test(message) ? 401 : 500;
      return rpcError(response, status, status === 401 ? "Supabase Bearer JWT недействителен или истёк" : "Internal MCP error",
        status === 401 ? { "www-authenticate": `Bearer realm="klimat-pro", error="invalid_token", resource_metadata="${protectedResourceMetadataUrl(config)}"` } : undefined);
    }
  };
}

async function main() {
  const config = loadRuntimeConfig();
  const httpServer = createServer(createHttpHandler({ config }));
  httpServer.listen(config.httpPort, config.httpHost, () => {
    process.stderr.write(`КЛИМАТ-ПРО MCP HTTP: http://${config.httpHost}:${config.httpPort}/mcp\n`);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => {
    process.stderr.write(`Ошибка MCP HTTP: ${error?.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
