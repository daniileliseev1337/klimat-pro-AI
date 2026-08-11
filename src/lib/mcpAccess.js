export const MCP_ACCESS_LEVELS = ["none", "read", "write"];

export function normalizeMcpAccessRow(row) {
  return row?.access_level === "read" || row?.access_level === "write"
    ? row.access_level
    : "none";
}

export function mcpAccessLabel(level) {
  return ({ none: "Нет доступа", read: "Только чтение", write: "Чтение и изменение" })[level] || "Нет доступа";
}

export async function loadMcpAccessMap(client) {
  const { data, error } = await client.from("mcp_user_access").select("user_id, access_level, updated_at");
  if (error) throw error;
  return Object.fromEntries((data || []).map(row => [row.user_id, normalizeMcpAccessRow(row)]));
}

export async function loadMyMcpAccess(client, userId) {
  const { data, error } = await client.from("mcp_user_access")
    .select("access_level")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return normalizeMcpAccessRow(data);
}

export async function adminSetMcpAccess(client, userId, accessLevel) {
  const level = MCP_ACCESS_LEVELS.includes(accessLevel) ? accessLevel : "none";
  const { error } = await client.rpc("admin_set_mcp_access", {
    p_user_id: userId,
    p_access_level: level,
  });
  if (error) throw error;
}
