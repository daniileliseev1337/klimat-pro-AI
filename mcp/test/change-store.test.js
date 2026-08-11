import { describe, expect, it } from "vitest";
import { createChangeStore } from "../src/change-store.js";

describe("createChangeStore", () => {
  it("issues a five-minute single-use confirmation", () => {
    let now = 1_000;
    const store = createChangeStore({
      clock: () => now,
      randomUUID: () => "11111111-2222-4333-8444-55555555abcd",
    });

    const pending = store.create({ userId: "user-a", action: "project.delete", payload: { id: "p1" } });

    expect(pending.confirmationToken).toBe("11111111-2222-4333-8444-55555555abcd");
    expect(pending.confirmation).toBe("ПОДТВЕРЖДАЮ 5555abcd");
    expect(pending.expiresAt).toBe(301_000);
    expect(store.consume(pending.confirmationToken, "user-a", pending.confirmation).action).toBe("project.delete");
    expect(() => store.consume(pending.confirmationToken, "user-a", pending.confirmation)).toThrow("не найден");
  });

  it("invalidates the token after a wrong phrase and after expiry", () => {
    let now = 1_000;
    let serial = 0;
    const store = createChangeStore({ clock: () => now, randomUUID: () => `00000000-0000-4000-8000-00000000000${++serial}` });
    const wrong = store.create({ userId: "user-a", action: "task.delete", payload: {} });
    expect(() => store.consume(wrong.confirmationToken, "user-a", "да")).toThrow("не совпадает");
    expect(() => store.consume(wrong.confirmationToken, "user-a", wrong.confirmation)).toThrow("не найден");

    const expired = store.create({ userId: "user-a", action: "task.delete", payload: {} });
    now += 300_001;
    expect(() => store.consume(expired.confirmationToken, "user-a", expired.confirmation)).toThrow("истёк");
  });

  it("does not let another authenticated user consume or cancel a change", () => {
    const store = createChangeStore({ randomUUID: () => "11111111-2222-4333-8444-55555555abcd" });
    const pending = store.create({ userId: "user-a", action: "client.delete", payload: {} });

    expect(() => store.cancel(pending.confirmationToken, "user-b")).toThrow("другому пользователю");
    expect(() => store.consume(pending.confirmationToken, "user-b", pending.confirmation)).toThrow("другому пользователю");
    expect(store.consume(pending.confirmationToken, "user-a", pending.confirmation).action).toBe("client.delete");
  });

  it("bounds pending previews per authenticated user", () => {
    let serial = 0;
    const store = createChangeStore({
      maxPerUser: 2,
      randomUUID: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
    });
    store.create({ userId: "user-a", action: "task.create", payload: {} });
    store.create({ userId: "user-a", action: "task.create", payload: {} });
    expect(() => store.create({ userId: "user-a", action: "task.create", payload: {} }))
      .toThrow("Слишком много");
    expect(() => store.create({ userId: "user-b", action: "task.create", payload: {} })).not.toThrow();
  });
});
