import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const resources = [];

afterEach(async () => {
  await Promise.allSettled(resources.splice(0).map(resource => resource.close()));
});

describe("stdio entrypoint", () => {
  it("запускается реальным дочерним процессом и отвечает на MCP initialize/list", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "kp-mcp-stdio-"));
    resources.push({ close: () => rm(temporary, { recursive: true, force: true }) });
    const entrypoint = fileURLToPath(new URL("../src/stdio.js", import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint],
      cwd: temporary,
      stderr: "pipe",
      env: {
        KP_SUPABASE_URL: "https://example.supabase.test",
        KP_SUPABASE_ANON_KEY: "test-anon-key",
        KP_SESSION_FILE: path.join(temporary, "session.json"),
      },
    });
    const client = new Client({ name: "stdio-smoke", version: "1.0.0" });
    resources.push(client);

    await client.connect(transport);
    const listed = await client.listTools();

    expect(listed.tools.map(tool => tool.name)).toContain("kp_get_context");
  });
});
