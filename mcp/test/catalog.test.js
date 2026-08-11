import { describe, expect, it } from "vitest";
import {
  ACTION_NAMES,
  QUERY_ENTITIES,
  describeCapabilities,
  normalizeAction,
  normalizeQuery,
} from "../src/catalog.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("MCP catalog", () => {
  it("covers every navigable core site entity without arbitrary table access", () => {
    expect(QUERY_ENTITIES).toEqual([
      "projects", "tasks", "tz_versions", "project_comments", "task_comments",
      "client_messages", "clients", "transactions", "project_files", "project_members",
      "project_payments", "project_shares", "project_requests", "activity", "users",
    ]);
    expect(() => normalizeQuery({ entity: "auth.users" })).toThrow();
    expect(normalizeQuery({ entity: "projects", limit: 999 })).toMatchObject({ limit: 100 });
  });

  it("lists the write surface explicitly", () => {
    expect(ACTION_NAMES).toContain("project.create");
    expect(ACTION_NAMES).toContain("task.delete");
    expect(ACTION_NAMES).toContain("tz.approve");
    expect(ACTION_NAMES).toContain("transaction.update");
    expect(ACTION_NAMES).toContain("project.payments.set");
    expect(ACTION_NAMES).toContain("project.shares.set");
    expect(ACTION_NAMES).toContain("admin.user.delete");
    expect(ACTION_NAMES).not.toContain("sql.execute");
  });

  it("validates replace-all project payments and shares", () => {
    expect(normalizeAction("project.payments.set", {
      projectId: UUID_A,
      rows: [{ amount: 12500, paidOn: "2026-08-11", note: "Аванс" }],
    }).rows[0]).toEqual({ amount: 12500, paidOn: "2026-08-11", note: "Аванс" });
    expect(normalizeAction("project.shares.set", {
      projectId: UUID_A,
      rows: [{ participantUserId: UUID_B, participantLabel: "Исполнитель", shareKind: "percent", shareValue: 30 }],
    }).rows[0].shareValue).toBe(30);
    expect(() => normalizeAction("project.shares.set", {
      projectId: UUID_A, rows: [{ shareKind: "percent", shareValue: 30 }],
    })).toThrow("участника");
  });

  it("strips caller-supplied ownership fields from project creation", () => {
    const normalized = normalizeAction("project.create", {
      name: "Новый проект",
      owner_id: UUID_B,
      ownerId: UUID_B,
      stage: "В работе",
    });

    expect(normalized).toEqual({ name: "Новый проект", stage: "В работе" });
  });

  it("rejects empty patches and invalid task enums", () => {
    expect(() => normalizeAction("project.update", { id: UUID_A, patch: {} })).toThrow("поле");
    expect(() => normalizeAction("task.create", { title: "Тест", status: "Любой" })).toThrow();
  });

  it("normalizes safe values while preserving explicit zero amounts", () => {
    expect(normalizeAction("transaction.create", {
      date: "2026-08-11",
      type: "expense",
      category: "Связь",
      amount: 0,
      description: "Корректировка",
      owner_id: UUID_B,
    })).toEqual({
      date: "2026-08-11",
      type: "expense",
      category: "Связь",
      amount: 0,
      description: "Корректировка",
    });
  });

  it("publishes machine-readable action payload schemas for LLM orientation", () => {
    const capabilities = describeCapabilities();
    expect(capabilities.actions["task.set_status"].required).toEqual(["id", "status"]);
    expect(capabilities.actions["task.set_status"].payloadSchema.properties.status.enum).toEqual([
      "Новая", "В работе", "На проверке", "Готово", "Отменена",
    ]);
    expect(capabilities.queries.project_files.clientProjection).toContain("client_visible");
    expect(capabilities.safety).toMatchObject({
      rawSql: false,
      serviceRole: false,
      confirmationRequired: true,
    });
  });

  it("matches live database enums for clients, visibility and user roles", () => {
    expect(normalizeAction("client.create", { name: "ООО Тест", clientType: "legal", category: "potential" }))
      .toMatchObject({ clientType: "legal", category: "potential" });
    expect(normalizeAction("project.update", { id: UUID_A, patch: { visibility: "selected" } }).patch.visibility)
      .toBe("selected");
    expect(normalizeAction("admin.user.update", { userId: UUID_A, approved: true, role: "user", name: "Иван" }).role)
      .toBe("user");
    expect(normalizeAction("admin.roles.set", { userId: UUID_A, roles: ["employee", "visitor"] }).roles)
      .toEqual(["employee", "visitor"]);
    expect(() => normalizeAction("admin.roles.set", { userId: UUID_A, roles: ["admin"] })).toThrow();
    expect(() => normalizeAction("admin.roles.set", { userId: UUID_A, roles: ["client"] })).toThrow();
    expect(normalizeAction("admin.roles.set", { userId: UUID_A, roles: [] }).roles).toEqual([]);
    expect(() => normalizeAction("client_message.send", { projectId: UUID_A, body: "x".repeat(4_001) })).toThrow();
    expect(normalizeAction("request.create", { name: "ОВ", mode: "detailed", assignmentMode: "assignee", desiredExecutorId: UUID_B }))
      .toMatchObject({ mode: "detailed", assignmentMode: "assignee" });
  });
});
