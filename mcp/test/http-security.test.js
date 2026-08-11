import { describe, expect, it } from "vitest";
import { extractBearerToken, validateHttpRequest } from "../src/http-security.js";

const config = {
  allowedHosts: ["127.0.0.1:8788", "mcp.example.test"],
  allowedOrigins: ["https://app.example.test"],
  bodyLimitBytes: 1000,
};

describe("HTTP security", () => {
  it("принимает разрешённый host и отсутствие browser Origin", () => {
    expect(validateHttpRequest({ method: "POST", headers: { host: "127.0.0.1:8788", "content-type": "application/json", "content-length": "200" } }, config)).toEqual({ ok: true });
  });

  it("отклоняет неизвестные Host и Origin", () => {
    expect(validateHttpRequest({ method: "POST", headers: { host: "evil.test", "content-type": "application/json" } }, config)).toMatchObject({ ok: false, status: 403 });
    expect(validateHttpRequest({ method: "POST", headers: { host: "mcp.example.test", origin: "https://evil.test", "content-type": "application/json" } }, config)).toMatchObject({ ok: false, status: 403 });
  });

  it("отклоняет неверный content-type и слишком большое тело", () => {
    expect(validateHttpRequest({ method: "POST", headers: { host: "mcp.example.test", "content-type": "text/plain" } }, config)).toMatchObject({ ok: false, status: 415 });
    expect(validateHttpRequest({ method: "POST", headers: { host: "mcp.example.test", "content-type": "application/json", "content-length": "1001" } }, config)).toMatchObject({ ok: false, status: 413 });
  });

  it("извлекает только Bearer token", () => {
    expect(extractBearerToken("Bearer ey.test.token")).toBe("ey.test.token");
    expect(extractBearerToken("Basic abc")).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });
});
