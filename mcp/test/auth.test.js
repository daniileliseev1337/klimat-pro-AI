import { describe, expect, it } from "vitest";
import { normalizeLoginId, requireIdentity, requireOAuthIdentity } from "../src/auth.js";

function jwt(payload) {
  return `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
}

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

  it("принимает OAuth JWT только с client_id и admin-грантом", async () => {
    const responses = {
      profiles: { data: { approved: true }, error: null },
      mcp_user_access: { data: { access_level: "write" }, error: null },
    };
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "u1", email: "u@example.test" } }, error: null }) },
      from: table => ({ select: () => ({ eq: () => ({ maybeSingle: async () => responses[table] }) }) }),
    };
    const token = jwt({ iss: "https://example.test/auth/v1", client_id: "client-1" });
    await expect(requireOAuthIdentity(client, token, { oauthIssuer: "https://example.test/auth/v1" }))
      .resolves.toEqual({ id: "u1", email: "u@example.test", accessLevel: "write", clientId: "client-1" });
  });

  it("отклоняет обычную web-сессию и пользователя без MCP-гранта", async () => {
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
      from: table => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "profiles" ? { approved: true } : null, error: null }) }) }) }),
    };
    await expect(requireOAuthIdentity(client, jwt({ iss: "https://example.test/auth/v1" }), { oauthIssuer: "https://example.test/auth/v1" }))
      .rejects.toThrow("OAuth client_id");
    await expect(requireOAuthIdentity(client, jwt({ iss: "https://example.test/auth/v1", client_id: "c1" }), { oauthIssuer: "https://example.test/auth/v1" }))
      .rejects.toThrow("не выдан");
  });
});
