import { z } from "zod";

export const QUERY_ENTITIES = Object.freeze([
  "projects", "tasks", "tz_versions", "project_comments", "task_comments",
  "client_messages", "clients", "transactions", "project_files", "project_members",
  "project_payments", "project_shares", "project_requests", "activity", "users",
]);

const QUERY_GUIDANCE = Object.freeze({
  projects: { page: "Проекты / Дашборд", filters: ["id", "search", "cursor"] },
  tasks: { page: "Задачи", filters: ["id", "projectId", "status", "search"] },
  tz_versions: { page: "Задача → ТЗ", required: ["taskId"] },
  project_comments: { page: "Проект → Обсуждение", required: ["projectId"], teamOnly: true },
  task_comments: { page: "Задача → Обсуждение", required: ["taskId"] },
  client_messages: { page: "Проект → Переписка с заказчиком", required: ["projectId"] },
  clients: { page: "Заказчики", filters: ["id", "search"] },
  transactions: { page: "Финансы", filters: ["id", "cursor"] },
  project_files: { page: "Проект → Файлы", required: ["projectId"], clientProjection: "Только client_visible и без внутренних путей" },
  project_members: { page: "Проект → Команда", required: ["projectId"], teamOnly: true },
  project_payments: { page: "Проект → Платежи", required: ["projectId"], clientProjection: "Только платежи своих заказов" },
  project_shares: { page: "Проект → Доли", required: ["projectId"], teamOnly: true },
  project_requests: { page: "Заявки", filters: ["id", "status"] },
  activity: { page: "История / Admin", filters: ["projectId"], teamOnly: true },
  users: { page: "Admin → Пользователи", adminOnly: true },
});

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ожидается дата YYYY-MM-DD");
const optionalText = z.string().trim().max(20_000).nullable().optional();
const nonEmptyText = z.string().trim().min(1).max(20_000);
const projectStage = z.enum(["Поиск исполнителя", "В работе", "Сдан заказчику", "Оплачен", "Архив"]);
const projectType = z.enum(["ОВиК", "Слаботочка", "BIM", "Исполнительная документация", "Электрика", "ВК", "Прочее"]);
const projectVisibility = z.enum(["private", "team", "selected", "marketplace"]);
const taskStatus = z.enum(["Новая", "В работе", "На проверке", "Готово", "Отменена"]);
const taskPriority = z.enum(["Низкий", "Обычный", "Высокий"]);
const memberRole = z.enum(["viewer", "editor"]);
const profileRole = z.enum(["admin", "user"]);
const assignableRole = z.enum(["employee", "visitor"]);
const clientMessageBody = z.string().trim().min(1).max(4_000);

const link = z.object({ title: z.string().trim().max(200).optional(), url: z.string().trim().url() });
const executor = z.object({ name: z.string().trim().min(1).max(200), userId: uuid.nullable().optional() });

const projectFields = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  client: z.string().trim().max(300).nullable().optional(),
  executors: z.array(executor).max(100).optional(),
  type: projectType.nullable().optional(),
  stage: projectStage.optional(),
  startDate: date.nullable().optional(),
  deadline: date.nullable().optional(),
  contractSum: z.coerce.number().finite().min(0).optional(),
  notes: optionalText,
  visibility: projectVisibility.optional(),
  links: z.array(link).max(100).optional(),
  clientPhone: z.string().trim().max(100).nullable().optional(),
  clientEmail: z.string().trim().email().max(300).nullable().optional(),
  clientTelegram: z.string().trim().max(100).nullable().optional(),
  clientId: uuid.nullable().optional(),
});

const taskFields = z.object({
  projectId: uuid.nullable().optional(),
  assignedTo: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(500).optional(),
  description: optionalText,
  status: taskStatus.optional(),
  priority: taskPriority.optional(),
  dueDate: date.nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

const clientFields = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  phone: z.string().trim().max(100).nullable().optional(),
  email: z.string().trim().email().max(300).nullable().optional(),
  telegram: z.string().trim().max(100).nullable().optional(),
  clientType: z.enum(["individual", "legal", "state"]).optional(),
  category: z.enum(["regular", "one-time", "potential", "archived"]).optional(),
  legalName: z.string().trim().max(500).nullable().optional(),
  inn: z.string().trim().regex(/^\d{0,12}$/).nullable().optional(),
  address: z.string().trim().max(1000).nullable().optional(),
  city: z.string().trim().max(200).nullable().optional(),
  notes: optionalText,
});

const transactionFields = z.object({
  date: date.optional(),
  type: z.enum(["income", "expense"]).optional(),
  category: z.string().trim().min(1).max(200).optional(),
  amount: z.coerce.number().finite().min(0).optional(),
  description: optionalText,
});

const paymentRow = z.object({
  amount: z.coerce.number().finite().positive().max(1_000_000_000_000),
  paidOn: date,
  note: z.string().trim().max(1_000).nullable().optional(),
});

const shareRow = z.object({
  participantUserId: uuid.nullable().optional(),
  participantClientId: uuid.nullable().optional(),
  participantName: z.string().trim().min(1).max(300).nullable().optional(),
  participantLabel: z.string().trim().max(300).nullable().optional(),
  shareKind: z.enum(["percent", "amount"]),
  shareValue: z.coerce.number().finite().positive().max(1_000_000_000_000),
}).refine(value => [value.participantUserId, value.participantClientId, value.participantName].filter(Boolean).length === 1,
  "Укажите ровно одного участника: participantUserId, participantClientId или participantName");

function nonEmptyPatch(schema) {
  return schema.refine(value => Object.keys(value).length > 0, "Укажите хотя бы одно поле patch");
}

const ACTION_DEFINITIONS = {
  "project.create": {
    schema: projectFields.extend({ name: z.string().trim().min(1).max(300) }),
    required: ["name"], description: "Создать проект",
  },
  "project.update": {
    schema: z.object({ id: uuid, patch: nonEmptyPatch(projectFields) }),
    required: ["id", "patch"], description: "Изменить доступные поля проекта",
  },
  "project.delete": { schema: z.object({ id: uuid }), required: ["id"], description: "Удалить проект и зависимые записи" },
  "project.take": { schema: z.object({ id: uuid }), required: ["id"], description: "Взять проект из маркетплейса" },
  "project.release": { schema: z.object({ id: uuid }), required: ["id"], description: "Освободить взятый проект" },
  "project.revoke": { schema: z.object({ id: uuid }), required: ["id"], description: "Отозвать проект у исполнителя" },
  "project.payments.set": { schema: z.object({ projectId: uuid, rows: z.array(paymentRow).max(500) }), required: ["projectId", "rows"], description: "Атомарно заменить весь список платежей проекта" },
  "project.shares.set": { schema: z.object({ projectId: uuid, rows: z.array(shareRow).max(500) }), required: ["projectId", "rows"], description: "Атомарно заменить весь список долей проекта" },

  "task.create": {
    schema: taskFields.extend({ title: z.string().trim().min(1).max(500) }),
    required: ["title"], description: "Создать задачу",
  },
  "task.update": { schema: z.object({ id: uuid, patch: nonEmptyPatch(taskFields) }), required: ["id", "patch"], description: "Изменить задачу" },
  "task.delete": { schema: z.object({ id: uuid }), required: ["id"], description: "Удалить задачу" },
  "task.set_status": { schema: z.object({ id: uuid, status: taskStatus }), required: ["id", "status"], description: "Сменить статус задачи" },

  "tz.propose": { schema: z.object({ taskId: uuid, content: nonEmptyText }), required: ["taskId", "content"], description: "Предложить новую версию ТЗ" },
  "tz.approve": { schema: z.object({ versionId: uuid }), required: ["versionId"], description: "Подтвердить версию ТЗ" },
  "tz.reject": { schema: z.object({ versionId: uuid }), required: ["versionId"], description: "Отклонить версию ТЗ" },

  "project_comment.add": { schema: z.object({ projectId: uuid, content: nonEmptyText }), required: ["projectId", "content"], description: "Добавить комментарий к проекту" },
  "project_comment.resolve": { schema: z.object({ commentId: uuid, resolved: z.boolean() }), required: ["commentId", "resolved"], description: "Решить или переоткрыть комментарий проекта" },
  "project_comment.delete": { schema: z.object({ commentId: uuid }), required: ["commentId"], description: "Удалить комментарий проекта" },
  "task_comment.add": { schema: z.object({ taskId: uuid, body: nonEmptyText, isQuestion: z.boolean().default(false) }), required: ["taskId", "body"], description: "Добавить комментарий или вопрос к задаче" },
  "task_comment.resolve": { schema: z.object({ commentId: uuid, resolved: z.boolean() }), required: ["commentId", "resolved"], description: "Решить или переоткрыть вопрос задачи" },

  "client.create": { schema: clientFields.extend({ name: z.string().trim().min(1).max(300) }), required: ["name"], description: "Создать клиента" },
  "client.update": { schema: z.object({ id: uuid, patch: nonEmptyPatch(clientFields) }), required: ["id", "patch"], description: "Изменить клиента" },
  "client.delete": { schema: z.object({ id: uuid }), required: ["id"], description: "Удалить клиента" },

  "transaction.create": {
    schema: transactionFields.extend({ date, type: z.enum(["income", "expense"]), category: nonEmptyText, amount: z.coerce.number().finite().min(0) }),
    required: ["date", "type", "category", "amount"], description: "Создать финансовую операцию",
  },
  "transaction.update": { schema: z.object({ id: uuid, patch: nonEmptyPatch(transactionFields) }), required: ["id", "patch"], description: "Изменить финансовую операцию" },
  "transaction.delete": { schema: z.object({ id: uuid }), required: ["id"], description: "Удалить финансовую операцию" },

  "member.add": { schema: z.object({ projectId: uuid, userId: uuid, role: memberRole.default("viewer") }), required: ["projectId", "userId"], description: "Добавить участника проекта" },
  "member.update_role": { schema: z.object({ projectId: uuid, userId: uuid, role: memberRole }), required: ["projectId", "userId", "role"], description: "Изменить роль участника" },
  "member.remove": { schema: z.object({ projectId: uuid, userId: uuid }), required: ["projectId", "userId"], description: "Удалить участника проекта" },

  "request.create": {
    schema: z.object({ name: nonEmptyText, description: optionalText, deadline: date.nullable().optional(), mode: z.enum(["quick", "detailed"]).default("quick"), assignmentMode: z.enum(["marketplace", "assignee"]).default("marketplace"), desiredExecutorId: uuid.nullable().optional() }),
    required: ["name"], description: "Создать заявку заказчика",
  },
  "request.accept": { schema: z.object({ requestId: uuid }), required: ["requestId"], description: "Принять заявку" },
  "request.reject": { schema: z.object({ requestId: uuid, reason: optionalText }), required: ["requestId"], description: "Отклонить заявку" },
  "client_message.send": { schema: z.object({ projectId: uuid, body: clientMessageBody }), required: ["projectId", "body"], description: "Отправить сообщение заказчику или команде" },
  "file.set_client_visible": { schema: z.object({ fileId: uuid, visible: z.boolean() }), required: ["fileId", "visible"], description: "Изменить видимость файла заказчику" },
  "file.delete": { schema: z.object({ fileId: uuid }), required: ["fileId"], description: "Удалить файл проекта через Nextcloud Edge Function" },

  "admin.user.update": { schema: z.object({ userId: uuid, approved: z.boolean(), role: profileRole, name: z.string().trim().min(1).max(300) }), required: ["userId", "approved", "role", "name"], description: "Изменить пользователя (только admin)" },
  "admin.roles.set": { schema: z.object({ userId: uuid, roles: z.array(assignableRole).max(2) }), required: ["userId", "roles"], description: "Заменить employee/visitor роли; client управляется привязкой заказчика (только admin)" },
  "admin.user.delete": { schema: z.object({ userId: uuid }), required: ["userId"], description: "Удалить пользователя (только admin)" },
};

export const ACTION_NAMES = Object.freeze(Object.keys(ACTION_DEFINITIONS));

const querySchema = z.object({
  entity: z.enum(QUERY_ENTITIES),
  id: uuid.optional(),
  projectId: uuid.optional(),
  taskId: uuid.optional(),
  status: z.string().trim().max(100).optional(),
  search: z.string().trim().max(300).optional(),
  cursor: z.string().trim().max(300).optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export function normalizeQuery(input) {
  const value = querySchema.parse(input);
  return { ...value, limit: Math.min(value.limit || 50, 100) };
}

export function normalizeAction(action, payload) {
  const definition = ACTION_DEFINITIONS[action];
  if (!definition) throw new Error(`Неизвестное MCP-действие: ${action}`);
  return definition.schema.parse(payload);
}

export function describeCapabilities() {
  return {
    entities: [...QUERY_ENTITIES],
    queries: QUERY_GUIDANCE,
    actions: Object.fromEntries(Object.entries(ACTION_DEFINITIONS).map(([name, value]) => [name, {
      description: value.description,
      required: [...value.required],
      payloadSchema: z.toJSONSchema(value.schema, { io: "input" }),
    }])),
    safety: {
      rawSql: false,
      serviceRole: false,
      confirmationRequired: true,
      confirmationTtlSeconds: 300,
      roleProjection: "employee/admin получают командный контур; client-only получает безопасные проекции портала заказчика",
    },
  };
}
