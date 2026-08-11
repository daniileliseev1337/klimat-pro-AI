import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(import.meta.dirname, "../../supabase/migrations/20260811_0001_remote_mcp_access.sql");

describe("remote MCP access migration", () => {
  it("создаёт default-deny RLS и admin-only RPC", () => {
    const sql = readFileSync(migrationPath, "utf8").toLowerCase();
    expect(sql).toContain("create table if not exists public.mcp_user_access");
    expect(sql).toContain("check (access_level in ('read', 'write'))");
    expect(sql).toContain("alter table public.mcp_user_access enable row level security");
    expect(sql).toContain("using ((select auth.uid()) = user_id or public.is_admin())");
    expect(sql).toContain("create or replace function public.admin_set_mcp_access");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public, pg_temp");
    expect(sql).toContain("if not public.is_admin()");
    expect(sql).toContain("revoke all on function public.admin_set_mcp_access(uuid, text) from public, anon");
    expect(sql).toContain("grant execute on function public.admin_set_mcp_access(uuid, text) to authenticated");
  });
});
