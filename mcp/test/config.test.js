import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("accepts the public Supabase URL and anon key used by the site", () => {
    const config = loadConfig({
      env: {
        VITE_SUPABASE_URL: "https://dashboard.example.test",
        VITE_SUPABASE_KEY: "anon-public-key",
        KP_PUBLIC_MCP_URL: "https://dashboard.example.test/mcp",
      },
      cwd: "C:/project/mcp",
    });

    expect(config.supabaseUrl).toBe("https://dashboard.example.test");
    expect(config.supabaseAnonKey).toBe("anon-public-key");
    expect(config.sessionFile.replaceAll("\\", "/")).toBe("C:/project/mcp/.local/session.json");
    expect(config.httpHost).toBe("127.0.0.1");
    expect(config.oauthIssuer).toBe("https://dashboard.example.test/auth/v1");
  });

  it("fails closed when required public configuration is missing", () => {
    expect(() => loadConfig({ env: {}, cwd: "C:/project/mcp" }))
      .toThrow("KP_SUPABASE_URL");
  });

  it("rejects service-role configuration instead of bypassing RLS", () => {
    expect(() => loadConfig({
      env: {
        KP_SUPABASE_URL: "https://dashboard.example.test",
        KP_SUPABASE_ANON_KEY: "anon-public-key",
        SUPABASE_SERVICE_ROLE_KEY: "must-not-be-used",
      },
      cwd: "C:/project/mcp",
    })).toThrow("service_role");
  });

  it("rejects an invalid HTTP body limit instead of silently disabling it", () => {
    expect(() => loadConfig({
      env: {
        KP_SUPABASE_URL: "https://dashboard.example.test",
        KP_SUPABASE_ANON_KEY: "anon-public-key",
        KP_HTTP_BODY_LIMIT: "not-a-number",
      },
      cwd: "C:/project/mcp",
    })).toThrow("KP_HTTP_BODY_LIMIT");
  });
});
