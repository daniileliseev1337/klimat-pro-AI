import { describe, expect, it } from "vitest";
import { createSupabaseGateway } from "../src/supabase-gateway.js";
import { fakeSupabase } from "./helpers/fake-supabase.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";

describe("createSupabaseGateway", () => {
  it("builds user context from the RLS-visible profile and roles", async () => {
    const client = fakeSupabase([
      { data: { id: USER_ID, email: "owner@example.test", name: "Даниил", role: "admin", approved: true }, error: null },
      { data: [{ role: "admin" }, { role: "employee" }], error: null },
    ]);
    const gateway = createSupabaseGateway(client);

    const context = await gateway.getContext({ id: USER_ID, email: "owner@example.test" });

    expect(context).toEqual({
      user: { id: USER_ID, email: "owner@example.test" },
      profile: { id: USER_ID, email: "owner@example.test", name: "Даниил", role: "admin", approved: true },
      roles: ["admin", "employee"],
    });
  });

  it("queries only the mapped projects table and enforces the normalized limit", async () => {
    const client = fakeSupabase([
      { data: { role: "user" }, error: null },
      { data: [{ role: "employee" }], error: null },
      { data: [{ id: PROJECT_ID, name: "ОВ" }], error: null },
    ]);
    const gateway = createSupabaseGateway(client);

    const rows = await gateway.query({ entity: "projects", limit: 100 }, { id: USER_ID });

    expect(rows).toEqual([{ id: PROJECT_ID, name: "ОВ" }]);
    expect(client.calls[2]).toEqual({
      kind: "table",
      table: "projects",
      methods: [
        ["select", "*"],
        ["order", "created_at", { ascending: false }],
        ["limit", 100],
      ],
    });
  });

  it("routes a client-only account through safe portal projections", async () => {
    const client = fakeSupabase([
      { data: { role: "user" }, error: null },
      { data: [{ role: "client" }], error: null },
      { data: [{ id: PROJECT_ID, name: "Мой заказ" }], error: null },
    ]);
    const gateway = createSupabaseGateway(client);

    const rows = await gateway.query({ entity: "projects", limit: 50 }, { id: USER_ID });

    expect(rows).toEqual([{ id: PROJECT_ID, name: "Мой заказ" }]);
    expect(client.calls[2]).toEqual({ kind: "rpc", name: "get_my_client_projects", args: {} });
  });

  it("does not expose team-only projections to a client-only account", async () => {
    const client = fakeSupabase([
      { data: { role: "user" }, error: null },
      { data: [{ role: "client" }], error: null },
    ]);
    const gateway = createSupabaseGateway(client);

    await expect(gateway.query({ entity: "project_members", projectId: PROJECT_ID, limit: 50 }, { id: USER_ID }))
      .rejects.toThrow("недоступна в режиме заказчика");
    expect(client.calls.some(call => call.name === "get_project_members")).toBe(false);
  });

  it("sets project ownership from the authenticated identity", async () => {
    const client = fakeSupabase([{ data: { id: PROJECT_ID, name: "ОВ" }, error: null }]);
    const gateway = createSupabaseGateway(client);

    const created = await gateway.execute("project.create", { name: "ОВ", contractSum: 0 }, { id: USER_ID });

    expect(created).toEqual({ id: PROJECT_ID, name: "ОВ" });
    expect(client.calls[0].methods[0]).toEqual(["insert", {
      name: "ОВ",
      contract_sum: 0,
      owner_id: USER_ID,
    }]);
  });

  it("replaces project payments through the established atomic RPC", async () => {
    const client = fakeSupabase([{ data: null, error: null }]);
    const gateway = createSupabaseGateway(client);

    await gateway.execute("project.payments.set", {
      projectId: PROJECT_ID,
      rows: [{ amount: 12500, paidOn: "2026-08-11", note: "Аванс" }],
    }, { id: USER_ID });

    expect(client.calls[0]).toEqual({
      kind: "rpc",
      name: "set_project_payments",
      args: { p_project_id: PROJECT_ID, p_rows: [{ amount: 12500, paid_on: "2026-08-11", note: "Аванс" }] },
    });
  });

  it("rejects an update that RLS changed in zero rows", async () => {
    const client = fakeSupabase([{ data: null, error: null }]);
    const gateway = createSupabaseGateway(client);

    await expect(gateway.execute("project.update", { id: PROJECT_ID, patch: { name: "Новое" } }, { id: USER_ID }))
      .rejects.toThrow("не изменён");
    expect(client.calls[0].methods[0]).toEqual(["update", { name: "Новое" }]);
  });

  it("uses the established task status RPC with exact arguments", async () => {
    const client = fakeSupabase([
      { data: { role: "user" }, error: null },
      { data: [{ role: "employee" }], error: null },
      { data: { id: TASK_ID, status: "Готово" }, error: null },
    ]);
    const gateway = createSupabaseGateway(client);

    await gateway.execute("task.set_status", { id: TASK_ID, status: "Готово" }, { id: USER_ID });

    expect(client.calls[2]).toEqual({
      kind: "rpc",
      name: "set_task_status",
      args: { p_task_id: TASK_ID, p_status: "Готово" },
    });
  });

  it("uses the constrained client status RPC for a client-only account", async () => {
    const client = fakeSupabase([
      { data: { role: "user" }, error: null },
      { data: [{ role: "client" }], error: null },
      { data: null, error: null },
    ]);
    const gateway = createSupabaseGateway(client);

    await gateway.execute("task.set_status", { id: TASK_ID, status: "Готово" }, { id: USER_ID });

    expect(client.calls[2]).toEqual({
      kind: "rpc",
      name: "client_set_task_status",
      args: { p_task_id: TASK_ID, p_status: "Готово" },
    });
  });

  it("deletes project files through the existing Nextcloud Edge Function", async () => {
    const client = fakeSupabase([{ data: { ok: true }, error: null }]);
    const gateway = createSupabaseGateway(client);

    await gateway.execute("file.delete", { fileId: PROJECT_ID }, { id: USER_ID });

    expect(client.calls[0]).toEqual({
      kind: "function",
      name: "nextcloud",
      options: { body: { action: "delete", id: PROJECT_ID } },
    });
  });

  it("keeps task deletion authoritative when best-effort photo cleanup fails", async () => {
    const client = fakeSupabase([
      { data: null, error: { message: "Nextcloud unavailable" } },
      { data: { id: TASK_ID }, error: null },
    ]);
    const gateway = createSupabaseGateway(client);

    await expect(gateway.execute("task.delete", { id: TASK_ID }, { id: USER_ID })).resolves.toEqual({ id: TASK_ID });
    expect(client.calls.map(call => call.kind)).toEqual(["function", "table"]);
  });
});
