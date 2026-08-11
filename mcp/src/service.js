import { createHash } from "node:crypto";
import { describeCapabilities, normalizeAction, normalizeQuery } from "./catalog.js";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function requiresExisting(action) {
  return ![
    "project.create", "task.create", "tz.propose", "project_comment.add",
    "task_comment.add", "client.create", "transaction.create", "member.add",
    "request.create", "client_message.send",
  ].includes(action);
}

function afterPreview(action, payload, before) {
  if (action.endsWith(".delete") || action === "member.remove") return null;
  if (action.endsWith(".update")) return { mode: "patch", patch: payload.patch };
  if (action === "task.set_status") return { ...(before || {}), status: payload.status };
  if (action === "member.update_role") return { ...(before || {}), role: payload.role };
  if (action === "file.set_client_visible") return { ...(before || {}), client_visible: payload.visible };
  if (action === "project_comment.resolve" || action === "task_comment.resolve") return { ...(before || {}), resolved: payload.resolved };
  return payload;
}

export function createKlimatService({ gateway, changeStore, getIdentity }) {
  async function identity() {
    const value = await getIdentity();
    if (!value?.id) throw new Error("Не удалось определить пользователя MCP");
    return value;
  }

  async function getContext() {
    const user = await identity();
    return { ...(await gateway.getContext(user)), mcpAccessLevel: user.accessLevel || "write", ...describeCapabilities() };
  }

  async function query(input) {
    const user = await identity();
    return gateway.query(normalizeQuery(input), user);
  }

  async function prepareChange(action, rawPayload) {
    const user = await identity();
    if (user.accessLevel === "read") throw new Error("MCP-доступ разрешает только чтение");
    const payload = normalizeAction(action, rawPayload);
    const before = await gateway.snapshot(action, payload);
    if (requiresExisting(action) && before == null) {
      throw new Error("Целевая запись не найдена или недоступна текущему пользователю");
    }
    const preview = {
      action,
      before,
      after: afterPreview(action, payload, before),
      payload,
    };
    const issued = changeStore.create({
      userId: user.id,
      action,
      payload,
      beforeFingerprint: fingerprint(before),
      preview,
    });
    return { ...issued, preview };
  }

  async function confirmChange(confirmationToken, confirmation) {
    const user = await identity();
    if (user.accessLevel === "read") throw new Error("MCP-доступ разрешает только чтение");
    const pending = changeStore.consume(confirmationToken, user.id, confirmation);
    const current = await gateway.snapshot(pending.action, pending.payload);
    if (fingerprint(current) !== pending.beforeFingerprint) {
      throw new Error("Данные изменились после preview; выполнение отменено, сформируйте новый preview");
    }
    const result = await gateway.execute(pending.action, pending.payload, user);
    await gateway.audit(pending.action, pending.payload, result, user);
    return result;
  }

  async function cancelChange(confirmationToken) {
    const user = await identity();
    if (user.accessLevel === "read") throw new Error("MCP-доступ разрешает только чтение");
    return { cancelled: changeStore.cancel(confirmationToken, user.id) };
  }

  return { getContext, query, prepareChange, confirmChange, cancelChange };
}

export const __test = { canonical, fingerprint };
