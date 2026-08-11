import { describe, expect, it } from "vitest";
import { normalizeLoginId, requireIdentity } from "../src/auth.js";

describe("MCP authentication", () => {
  it("поддерживает тот же username-вход, что и сайт", () => {
    expect(normalizeLoginId(" Daniil_1 ")).toBe("daniil_1@klimat.local");
    expect(normalizeLoginId("Owner@Example.COM")).toBe("owner@example.com");
  });

  it("принимает только одобренный профиль", async () => {
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "u1", email: "u@example.test" } }, error: null }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { approved: true }, error: null }) }) }) }),
    };
    await expect(requireIdentity(client)).resolves.toEqual({ id: "u1", email: "u@example.test" });
  });

  it("отклоняет не одобренный аккаунт", async () => {
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { approved: false }, error: null }) }) }) }),
    };
    await expect(requireIdentity(client)).rejects.toThrow("не одобрен");
  });
});
