// Edge Function web-push-notify — Web Push уведомления (замена telegram-notify).
// Секрет (VAPID) — в config.json рядом (НЕ в git). PostgREST под service_role
// через SUPABASE_URL=http://kong:8000. Фильтр получателей по profiles.notif_*.
//
// Типы: task_assigned / task_status / task_created / deadline / project_taken /
//       team_invite / comment / project_published.
import cfg from "./config.json" with { type: "json" };
import * as webpush from "jsr:@negrel/webpush";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;        // http://kong:8000
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (b: unknown, s = 200): Response =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function rest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...(init?.headers || {}) },
  });
}

// VAPID application server (один раз на холодный старт isolate)
const vapidKeys = await webpush.importVapidKeys(cfg.vapidKeys);
const appServer = await webpush.ApplicationServer.new({
  contactInformation: cfg.subject,
  vapidKeys,
});

// получатели по id-списку + флагу notif_*, минус инициатор
async function recipients(ids: (string | null | undefined)[], initiator: string | undefined, flag: string): Promise<string[]> {
  const uniq = [...new Set(ids.filter(Boolean).filter((x) => x !== initiator))] as string[];
  if (!uniq.length) return [];
  const inList = uniq.map((x) => `"${x}"`).join(",");
  const r = await rest(`profiles?id=in.(${inList})&${flag}=eq.true&select=id`);
  const rows = await r.json();
  return Array.isArray(rows) ? rows.map((p) => p.id) : [];
}

// все одобренные минус владелец (broadcast)
async function broadcastApproved(ownerId: string | undefined, flag: string): Promise<string[]> {
  const r = await rest(`profiles?approved=eq.true&${flag}=eq.true&select=id`);
  const rows = await r.json();
  return Array.isArray(rows) ? rows.map((p) => p.id).filter((id) => id !== ownerId) : [];
}

// участники проекта (project_members) — может быть пуст в текущей модели
async function projectMembers(projectId: string | null): Promise<string[]> {
  if (!projectId) return [];
  const r = await rest(`project_members?project_id=eq.${projectId}&select=user_id`);
  const rows = await r.json();
  return Array.isArray(rows) ? rows.map((m) => m.user_id) : [];
}

async function projectOwner(projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  const r = await rest(`projects?id=eq.${projectId}&select=owner_id`);
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? rows[0].owner_id : null;
}

// отправка payload всем подпискам перечисленных пользователей; 404/410 → удалить
async function sendToUsers(userIds: string[], payload: object): Promise<number> {
  if (!userIds.length) return 0;
  const inList = userIds.map((x) => `"${x}"`).join(",");
  const r = await rest(`push_subscriptions?user_id=in.(${inList})&select=endpoint,p256dh,auth`);
  const subs = await r.json();
  if (!Array.isArray(subs)) return 0;
  const msg = JSON.stringify(payload);
  let sent = 0;
  for (const s of subs) {
    try {
      const subscriber = appServer.subscribe({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } });
      await subscriber.pushTextMessage(msg, {});
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" });
      } else {
        console.warn("push send error", String(e));
      }
    }
  }
  return sent;
}

// базовый список адресатов БЕЗ флаг-фильтра (для inbox): уникальные, минус инициатор
function baseIds(ids: (string | null | undefined)[], initiator: string | undefined): string[] {
  return [...new Set(ids.filter(Boolean).filter((x) => x !== initiator))] as string[];
}

// все одобренные минус владелец, БЕЗ флаг-фильтра (база broadcast для inbox)
async function baseApproved(ownerId: string | undefined): Promise<string[]> {
  const r = await rest(`profiles?approved=eq.true&select=id`);
  const rows = await r.json();
  return Array.isArray(rows) ? rows.map((p: { id: string }) => p.id).filter((id: string) => id !== ownerId) : [];
}

// inbox: батч-вставка durable-строк всем адресатам. Сбой логируется, push не блокирует.
async function insertInbox(userIds: string[], n: { type: string; title: string; body: string; url: string }): Promise<number> {
  if (!userIds.length) return 0;
  const rows = userIds.map((uid) => ({ user_id: uid, type: n.type, title: n.title, body: n.body, url: n.url }));
  try {
    const r = await rest("notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    });
    if (!r.ok) console.warn("inbox insert failed", r.status, await r.text());
  } catch (e) {
    console.warn("inbox insert error", String(e));
  }
  return rows.length;
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

async function loadTask(taskId: string) {
  const tr = await rest(`project_tasks?id=eq.${taskId}&select=title,project_id,author_id,assigned_to,status,due_date`);
  const rows = await tr.json();
  return Array.isArray(rows) ? rows[0] : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const type = b.type as string | undefined;
  const initiator = b.initiatorId as string | undefined;
  try {
    // --- task-события ---
    if (type === "task_assigned" || type === "task_status" || type === "task_created") {
      const taskId = b.taskId as string | undefined;
      if (!taskId || !UUID.test(taskId)) return j({ error: "valid taskId (uuid) required" }, 400);
      const task = await loadTask(taskId);
      if (!task) return j({ ok: true, note: "task not found" });
      let base: string[] = [];
      let body = "";
      if (type === "task_assigned") {
        base = baseIds([task.assigned_to], initiator);
        body = `📌 Вам назначена задача: ${task.title}`;
      } else if (type === "task_status") {
        base = baseIds([task.author_id, task.assigned_to], initiator);
        body = `🔄 Задача «${task.title}» → ${task.status}`;
      } else {
        const members = await projectMembers(task.project_id);
        const owner = await projectOwner(task.project_id);
        base = baseIds([...members, owner].filter((x) => x !== task.assigned_to), initiator);
        body = `🆕 Новая задача в проекте: ${task.title}`;
      }
      await insertInbox(base, { type, title: "КЛИМАТ-ПРО", body, url: "/" });
      const ids = await recipients(base, undefined, "notif_task");
      const sent = await sendToUsers(ids, { title: "КЛИМАТ-ПРО", body, url: "/", tag: `task-${taskId}` });
      return j({ ok: true, sent, inbox: base.length });
    }

    // --- deadline (cron): задачи с due_date в ближайшие сутки, не финальные ---
    if (type === "deadline") {
      const tr = await rest(
        `project_tasks?select=id,title,author_id,assigned_to,due_date,status` +
          `&due_date=gte.${new Date().toISOString().slice(0, 10)}` +
          `&due_date=lte.${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}` +
          `&status=not.in.(%22Готово%22,%22Отменена%22)`
      );
      const tasks = await tr.json();
      if (!Array.isArray(tasks)) return j({ ok: true, sent: 0 });
      let total = 0;
      let inbox = 0;
      for (const t of tasks) {
        const base = baseIds([t.author_id, t.assigned_to], undefined);
        const body = `⏰ Срок задачи «${t.title}»: ${t.due_date}`;
        await insertInbox(base, { type: "deadline", title: "КЛИМАТ-ПРО", body, url: "/" });
        inbox += base.length;
        const ids = await recipients(base, undefined, "notif_deadline");
        total += await sendToUsers(ids, { title: "КЛИМАТ-ПРО", body, url: "/", tag: `task-${t.id}` });
      }
      return j({ ok: true, sent: total, inbox });
    }

    // --- legacy с явным адресатом ---
    if (type === "project_taken" || type === "team_invite") {
      const flag = type === "project_taken" ? "notif_project_taken" : "notif_team_invite";
      const base = baseIds([b.recipientId as string], initiator);
      const body = type === "project_taken" ? "✅ Ваш проект взят в работу" : "👥 Вас пригласили в команду проекта";
      await insertInbox(base, { type, title: "КЛИМАТ-ПРО", body, url: "/" });
      const ids = await recipients(base, undefined, flag);
      const sent = await sendToUsers(ids, { title: "КЛИМАТ-ПРО", body, url: "/" });
      return j({ ok: true, sent, inbox: base.length });
    }

    // --- комментарий/вопрос по задаче ---
    if (type === "comment") {
      const taskId = b.taskId as string | undefined;
      if (!taskId || !UUID.test(taskId)) return j({ error: "valid taskId (uuid) required" }, 400);
      const task = await loadTask(taskId);
      if (!task) return j({ ok: true, note: "task not found" });
      const members = await projectMembers(task.project_id);
      const base = baseIds([task.author_id, task.assigned_to, ...members], initiator);
      const body = `💬 Новый комментарий: ${task.title}`;
      await insertInbox(base, { type: "comment", title: "КЛИМАТ-ПРО", body, url: "/" });
      const ids = await recipients(base, undefined, "notif_comment");
      const sent = await sendToUsers(ids, { title: "КЛИМАТ-ПРО", body, url: "/", tag: `task-${taskId}` });
      return j({ ok: true, sent, inbox: base.length });
    }

    // --- broadcast: новый проект в поиске исполнителя ---
    if (type === "project_published") {
      const base = await baseApproved(b.ownerId as string);
      const body = "🆕 Новый проект в поиске исполнителя";
      await insertInbox(base, { type: "project_published", title: "КЛИМАТ-ПРО", body, url: "/" });
      const ids = await recipients(base, undefined, "notif_new_project");
      const sent = await sendToUsers(ids, { title: "КЛИМАТ-ПРО", body, url: "/" });
      return j({ ok: true, sent, inbox: base.length });
    }

    return j({ ok: true, note: "unknown type" });
  } catch (e) {
    return j({ error: String(e) }, 500);
  }
});
