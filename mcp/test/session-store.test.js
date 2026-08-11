import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileStorage } from "../src/session-store.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("createFileStorage", () => {
  it("persists rotated Supabase session values without logging secrets", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kp-mcp-session-"));
    tempDirs.push(dir);
    const file = path.join(dir, "nested", "session.json");
    const storage = createFileStorage(file);

    await storage.setItem("supabase.auth.token", "refresh-secret-v2");

    expect(await storage.getItem("supabase.auth.token")).toBe("refresh-secret-v2");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      "supabase.auth.token": "refresh-secret-v2",
    });
  });

  it("removes only the requested session key", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kp-mcp-session-"));
    tempDirs.push(dir);
    const storage = createFileStorage(path.join(dir, "session.json"));
    await storage.setItem("one", "1");
    await storage.setItem("two", "2");

    await storage.removeItem("one");

    expect(await storage.getItem("one")).toBeNull();
    expect(await storage.getItem("two")).toBe("2");
  });
});
