import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ACTION_NAMES, QUERY_ENTITIES, describeCapabilities } from "./catalog.js";

const queryInput = {
  entity: z.enum(QUERY_ENTITIES).describe("Сущность из каталога klimat://actions"),
  id: z.string().uuid().optional().describe("Точный UUID записи"),
  projectId: z.string().uuid().optional().describe("UUID проекта для вложенных сущностей"),
  taskId: z.string().uuid().optional().describe("UUID задачи для ТЗ/комментариев"),
  status: z.string().trim().max(100).optional().describe("Точный статус задачи или заявки"),
  search: z.string().trim().max(300).optional().describe("Поиск по разрешённым текстовым полям"),
  cursor: z.string().trim().max(300).optional().describe("created_at/date предыдущей страницы"),
  limit: z.coerce.number().int().positive().max(100).optional().describe("От 1 до 100, по умолчанию 50"),
};

function toolResult(data) {
  const structuredContent = { ok: true, data };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function toolError(error) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка MCP";
  const structuredContent = { ok: false, error: message };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function safe(handler) {
  return async args => {
    try {
      return toolResult(await handler(args || {}));
    } catch (error) {
      return toolError(error);
    }
  };
}

export function createKlimatMcpServer({ service }) {
  const server = new McpServer({ name: "klimat-pro", version: "0.1.0" });

  server.registerTool("kp_get_context", {
    title: "Контекст КЛИМАТ-ПРО",
    description: "Показывает текущего пользователя, его роль и доступные сущности/действия.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, safe(() => service.getContext()));

  server.registerTool("kp_query", {
    title: "Чтение данных КЛИМАТ-ПРО",
    description: "Читает только разрешённые текущему пользователю записи через Supabase RLS.",
    inputSchema: queryInput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, safe(args => service.query(args)));

  server.registerTool("kp_prepare_change", {
    title: "Предпросмотр изменения",
    description: "Проверяет действие и формирует preview с одноразовым подтверждением. Данные сайта не меняет.",
    inputSchema: {
      action: z.enum(ACTION_NAMES),
      payload: z.record(z.string(), z.unknown()),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
  }, safe(({ action, payload }) => service.prepareChange(action, payload)));

  server.registerTool("kp_confirm_change", {
    title: "Подтверждение изменения",
    description: "Выполняет ранее подготовленное изменение. Требует одноразовый token и точную confirmationPhrase из preview.",
    inputSchema: {
      confirmationToken: z.string().uuid(),
      confirmation: z.string().min(1).max(100),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, safe(({ confirmationToken, confirmation }) => service.confirmChange(confirmationToken, confirmation)));

  server.registerTool("kp_cancel_change", {
    title: "Отмена подготовленного изменения",
    description: "Отменяет одноразовый token без изменения данных сайта.",
    inputSchema: { confirmationToken: z.string().uuid() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, safe(({ confirmationToken }) => service.cancelChange(confirmationToken)));

  const capabilities = describeCapabilities();
  server.registerResource("klimat-schema", "klimat://schema", {
    title: "Схема MCP КЛИМАТ-ПРО",
    description: "Правила работы с MCP-шлюзом",
    mimeType: "application/json",
  }, async uri => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({
    protocol: "prepare-confirm",
    queryTool: "kp_query",
    mutationFlow: ["kp_prepare_change", "kp_confirm_change"],
    limits: capabilities.safety,
  }, null, 2) }] }));

  server.registerResource("klimat-actions", "klimat://actions", {
    title: "Каталог действий КЛИМАТ-ПРО",
    description: "Разрешённые сущности и операции",
    mimeType: "application/json",
  }, async uri => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(capabilities, null, 2) }] }));

  return server;
}

export const __test = { toolResult, toolError };
