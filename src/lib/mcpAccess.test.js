import { describe, expect, it, vi } from "vitest";
import { adminSetMcpAccess, mcpAccessLabel, normalizeMcpAccessRow } from "./mcpAccess.js";

describe("mcpAccess", () => {
  it("неизвестное или отсутствующее значение превращает в none", () => {
    expect(normalizeMcpAccessRow(null)).toBe("none");
    expect(normalizeMcpAccessRow({ access_level: "owner" })).toBe("none");
  });

  it("сохраняет только read/write и даёт русские подписи", () => {
    expect(normalizeMcpAccessRow({ access_level: "read" })).toBe("read");
    expect(normalizeMcpAccessRow({ access_level: "write" })).toBe("write");
    expect(mcpAccessLabel("none")).toBe("Нет доступа");
    expect(mcpAccessLabel("read")).toBe("Только чтение");
    expect(mcpAccessLabel("write")).toBe("Чтение и изменение");
  });

  it("передаёт admin RPC точный user id и уровень", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await adminSetMcpAccess({ rpc }, "00000000-0000-4000-8000-000000000001", "write");
    expect(rpc).toHaveBeenCalledWith("admin_set_mcp_access", {
      p_user_id: "00000000-0000-4000-8000-000000000001",
      p_access_level: "write",
    });
  });
});
