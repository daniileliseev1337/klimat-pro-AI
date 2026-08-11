#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createKlimatMcpServer } from "./mcp-server.js";
import { createStdioService, loadRuntimeConfig } from "./runtime.js";

async function main() {
  const config = loadRuntimeConfig();
  const service = createStdioService(config);
  const server = createKlimatMcpServer({ service });
  await server.connect(new StdioServerTransport());
  process.stderr.write("КЛИМАТ-ПРО MCP запущен через stdio.\n");
}

main().catch(error => {
  process.stderr.write(`Ошибка MCP: ${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
