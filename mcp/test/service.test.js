import { describe, expect, it } from "vitest";
import { createChangeStore } from "../src/change-store.js";
import { createKlimatService } from "../src/service.js";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.test" };
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

function setup({ before = { id: PROJECT_ID, name: "Старое" }, current = before, user = USER } = {}) {
  const calls = [];
  const gateway = {
    async getContext(identity) { return { user: identity, profile: { name: "Owner" }, roles: ["admin"] }; },
    async query(input) { calls.push(["query", input]); return [{ id: PROJECT_ID }]; },
    async snapshot() { return calls.some(item => item[0] === "execute") ? current : before; },
    async execute(action, payload, identity) { calls.push(["execute", action, payload, identity]); return { id: payload.id, deleted: true }; },
    async audit(action) { calls.push(["audit", action]); },
  };
  const store = createChangeStore({ randomUUID: () => "11111111-2222-4333-8444-55555555abcd" });
  const service = createKlimatService({ gateway, changeStore: store, getIdentity: async () => user });
  return { service, calls, gateway };
}

describe("createKlimatService", () => {
  it("returns orientation context and normalized read results", async () => {
    const { service, calls } = setup();
    const context = await service.getContext();
    const rows = await service.query({ entity: "projects", limit: 999 });

    expect(context.safety).toMatchObject({ serviceRole: false, confirmationRequired: true });
    expect(rows).toEqual([{ id: PROJECT_ID }]);
    expect(calls[0]).toEqual(["query", { entity: "projects", limit: 100 }]);
  });

  it("разрешает чтение, но запрещает mutation flow для read-гранта", async () => {
    const { service } = setup({ user: { ...USER, accessLevel: "read" } });
    await expect(service.query({ entity: "projects" })).resolves.toHaveLength(1);
    await expect(service.prepareChange("project.delete", { id: PROJECT_ID })).rejects.toThrow("только чтение");
  });

  it("previews and executes a confirmed action exactly once", async () => {
    const { service, calls } = setup();
    const pending = await service.prepareChange("project.delete", { id: PROJECT_ID });

    expect(pending.preview.before).toEqual({ id: PROJECT_ID, name: "Старое" });
    expect(calls).toHaveLength(0);

    const result = await service.confirmChange(pending.confirmationToken, pending.confirmation);
    expect(result).toEqual({ id: PROJECT_ID, deleted: true });
    expect(calls.map(call => call[0])).toEqual(["execute", "audit"]);
    await expect(service.confirmChange(pending.confirmationToken, pending.confirmation)).rejects.toThrow("не найден");
  });

  it("refuses execution when the record changed after preview", async () => {
    const { service, gateway } = setup({ current: { id: PROJECT_ID, name: "Кто-то изменил" } });
    let reads = 0;
    gateway.snapshot = async () => (++reads === 1
      ? { id: PROJECT_ID, name: "Старое" }
      : { id: PROJECT_ID, name: "Кто-то изменил" });
    const pending = await service.prepareChange("project.delete", { id: PROJECT_ID });

    await expect(service.confirmChange(pending.confirmationToken, pending.confirmation))
      .rejects.toThrow("изменились после preview");
  });

  it("cancels a prepared change without executing it", async () => {
    const { service, calls } = setup();
    const pending = await service.prepareChange("project.delete", { id: PROJECT_ID });

    expect(await service.cancelChange(pending.confirmationToken)).toEqual({ cancelled: true });
    expect(calls).toEqual([]);
  });
});
