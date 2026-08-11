import { describe, expect, it } from "vitest";
import { protectedResourceMetadata } from "../src/oauth-metadata.js";

describe("OAuth protected resource metadata", () => {
  it("публикует канонический MCP resource и Supabase authorization server", () => {
    expect(protectedResourceMetadata({
      publicMcpUrl: "https://example.test/mcp",
      oauthIssuer: "https://example.test/auth/v1",
    })).toEqual({
      resource: "https://example.test/mcp",
      authorization_servers: ["https://example.test/auth/v1"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "email", "profile", "offline_access"],
    });
  });
});
