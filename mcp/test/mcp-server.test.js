import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createKlimatMcpServer } from "../src/mcp-server.js";

const openConnections = [];

async function connect(service) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createKlimatMcpServer({ service });
  const client = new Client({ name: "klimat-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  openConnections.push(client, server);
  return client;
}

afterEach(async () => {
  await Promise.allSettled(openConnections.splice(0).map(connection => connection.close()));
});

describe("createKlimatMcpServer", () => {
  it("публикует компактный набор безопасных инструментов", async () => {
    const client = await connect({
      getContext: vi.fn(async () => ({ user: { id: "u1" } })),
      query: vi.fn(), prepareChange: vi.fn(), confirmChange: vi.fn(), cancelChange: vi.fn(),
    });

    const listed = await client.listTools();

    expect(listed.tools.map(tool => tool.name)).toEqual([
      "kp_get_context", "kp_query", "kp_prepare_change", "kp_confirm_change", "kp_cancel_change",
    ]);
    expect(listed.tools.find(tool => tool.name === "kp_confirm_change")?.annotations?.destructiveHint).toBe(true);
  });

  it("возвращает structuredContent и вызывает сервис", async () => {
    const service = {
      getContext: vi.fn(async () => ({ user: { id: "u1" } })),
      query: vi.fn(async input => [{ id: "p1", query: input }]),
      prepareChange: vi.fn(), confirmChange: vi.fn(), cancelChange: vi.fn(),
    };
    const client = await connect(service);

    const result = await client.callTool({ name: "kp_query", arguments: { entity: "projects", limit: 3 } });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ ok: true, data: [{ id: "p1", query: { entity: "projects", limit: 3 } }] });
    expect(service.query).toHaveBeenCalledWith({ entity: "projects", limit: 3 });
  });

  it("маршрутизирует context и весь prepare-confirm-cancel цикл", async () => {
    const token = "11111111-2222-4333-8444-55555555abcd";
    const service = {
      getContext: vi.fn(async () => ({ user: { id: "u1" }, roles: ["employee"] })),
      query: vi.fn(),
      prepareChange: vi.fn(async (action, payload) => ({ confirmationToken: token, confirmation: "ПОДТВЕРЖДАЮ 5555abcd", preview: { action, payload } })),
      confirmChange: vi.fn(async () => ({ id: "changed" })),
      cancelChange: vi.fn(async () => ({ cancelled: true })),
    };
    const client = await connect(service);

    const context = await client.callTool({ name: "kp_get_context", arguments: {} });
    const prepared = await client.callTool({ name: "kp_prepare_change", arguments: { action: "task.create", payload: { title: "Проверка" } } });
    const confirmed = await client.callTool({ name: "kp_confirm_change", arguments: { confirmationToken: token, confirmation: "ПОДТВЕРЖДАЮ 5555abcd" } });
    const cancelled = await client.callTool({ name: "kp_cancel_change", arguments: { confirmationToken: token } });

    expect(context.structuredContent.data.roles).toEqual(["employee"]);
    expect(prepared.structuredContent.data.confirmationToken).toBe(token);
    expect(confirmed.structuredContent.data).toEqual({ id: "changed" });
    expect(cancelled.structuredContent.data).toEqual({ cancelled: true });
    expect(service.prepareChange).toHaveBeenCalledWith("task.create", { title: "Проверка" });
    expect(service.confirmChange).toHaveBeenCalledWith(token, "ПОДТВЕРЖДАЮ 5555abcd");
    expect(service.cancelChange).toHaveBeenCalledWith(token);
  });

  it("не раскрывает stack trace при ошибке инструмента", async () => {
    const service = {
      getContext: vi.fn(),
      query: vi.fn(async () => { throw new Error("Доступ запрещён"); }),
      prepareChange: vi.fn(), confirmChange: vi.fn(), cancelChange: vi.fn(),
    };
    const client = await connect(service);

    const result = await client.callTool({ name: "kp_query", arguments: { entity: "projects" } });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ ok: false, error: "Доступ запрещён" });
    expect(result.content[0].text).not.toContain("at ");
  });

  it("публикует машиночитаемую схему и каталог действий", async () => {
    const client = await connect({
      getContext: vi.fn(), query: vi.fn(), prepareChange: vi.fn(), confirmChange: vi.fn(), cancelChange: vi.fn(),
    });

    const listed = await client.listResources();
    const resource = await client.readResource({ uri: "klimat://actions" });

    expect(listed.resources.map(item => item.uri)).toContain("klimat://actions");
    expect(resource.contents[0].mimeType).toBe("application/json");
    expect(resource.contents[0].text).toContain("project.create");
  });
});
