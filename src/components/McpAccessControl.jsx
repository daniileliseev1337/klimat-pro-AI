import { useState } from "react";
import { adminSetMcpAccess, mcpAccessLabel } from "../lib/mcpAccess.js";

export default function McpAccessControl({ client, userId, value = "none", disabled, onChanged, showToast }) {
  const [saving, setSaving] = useState(false);

  const change = async (event) => {
    const next = event.target.value;
    setSaving(true);
    try {
      await adminSetMcpAccess(client, userId, next);
      onChanged?.(next);
      showToast?.(next === "none" ? "MCP-доступ отозван" : `MCP: ${mcpAccessLabel(next)}`);
    } catch (error) {
      showToast?.(`Ошибка MCP-доступа: ${error.message || error}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--text-tertiary)" }}>
      MCP
      <select
        aria-label="Уровень MCP-доступа"
        value={value}
        onChange={change}
        disabled={disabled || saving}
        style={{
          background: "#0f1010", color: value === "none" ? "#9a9a95" : "#d4af37",
          border: "1px solid rgba(212,175,55,0.25)", borderRadius: 6,
          padding: "3px 6px", font: "inherit", cursor: "pointer",
          opacity: disabled || saving ? 0.6 : 1,
        }}
      >
        <option value="none">Нет</option>
        <option value="read">Чтение</option>
        <option value="write">Изменение</option>
      </select>
    </label>
  );
}
