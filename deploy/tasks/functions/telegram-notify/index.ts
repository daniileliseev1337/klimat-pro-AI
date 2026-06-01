// Edge Function `telegram-notify` — уведомления в Telegram (этап 6.4a, Task 7).
//
// Назначение: получить POST с { type, ... } и разослать уведомление в Telegram
// заинтересованным пользователям. Реализованы типы задач:
//   - task_assigned : исполнителю назначена задача
//   - task_status   : изменился статус задачи (автор + исполнитель)
//   - task_created  : создана новая задача в проекте (участники + владелец)
//
// Legacy-типы (project_taken / team_invite / comment / deadline) жили в облачном
// Supabase и локально не реализованы — обрабатываются как passthrough (ok=true).
//
// PostgREST-запросы идут под service_role (минуя RLS) на внутренний адрес
// SUPABASE_URL=http://kong:8000. Получатели фильтруются: notif_task=true,
// есть telegram_chat_id, и из списка исключается инициатор действия.
//
// ВНИМАНИЕ: TELEGRAM_BOT_TOKEN на момент написания НЕ задан в окружении
// edge-runtime (см. docker-compose.yml -> functions.environment). Без него
// реальная отправка работать не будет — добавить переменную перед использованием.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;              // http://kong:8000
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN    = Deno.env.get("TELEGRAM_BOT_TOKEN")!;        // задаётся в env edge-runtime

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const j = (b: unknown, s = 200): Response =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function rest(path: string): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

async function sendTo(chatId: string, text: string): Promise<void> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    if (!r.ok) console.warn("telegram sendMessage failed", r.status, await r.text());
  } catch (e) { console.warn("telegram sendMessage error", String(e)); }
}

async function recipients(
  ids: (string | null | undefined)[],
  initiator: string | undefined,
): Promise<{ id: string; chat: string }[]> {
  const uniq = [...new Set(ids.filter(Boolean).filter((x) => x !== initiator))] as string[];
  if (!uniq.length) return [];
  const inList = uniq.map((x) => `"${x}"`).join(",");
  const r = await rest(
    `profiles?id=in.(${inList})&notif_task=eq.true&telegram_chat_id=not.is.null&select=id,telegram_chat_id`,
  );
  const rows = await r.json();
  return Array.isArray(rows) ? rows.map((p) => ({ id: p.id, chat: p.telegram_chat_id })) : [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const type = body.type as string | undefined;
  try {
    if (type === "task_assigned" || type === "task_status" || type === "task_created") {
      const taskId = body.taskId as string | undefined;
      const initiator = body.initiatorId as string | undefined;
      if (!taskId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(taskId)) {
        return j({ error: "valid taskId (uuid) required" }, 400);
      }
      const tr = await rest(
        `project_tasks?id=eq.${taskId}&select=title,project_id,author_id,assigned_to,status`,
      );
      const trows = await tr.json();
      const task = Array.isArray(trows) ? trows[0] : null;
      if (!task) return j({ ok: true, note: "task not found" });
      let targetIds: (string | null | undefined)[] = [];
      let text = "";
      if (type === "task_assigned") {
        targetIds = [task.assigned_to];
        text = `📌 Вам назначена задача: <b>${task.title}</b>`;
      } else if (type === "task_status") {
        targetIds = [task.author_id, task.assigned_to];
        text = `🔄 Задача «<b>${task.title}</b>» → статус: <b>${task.status}</b>`;
      } else {
        if (task.project_id) {
          const mr = await rest(`project_members?project_id=eq.${task.project_id}&select=user_id`);
          const mrows = await mr.json();
          const members = Array.isArray(mrows) ? mrows.map((m) => m.user_id) : [];
          const pr = await rest(`projects?id=eq.${task.project_id}&select=owner_id`);
          const prows = await pr.json();
          const owner = Array.isArray(prows) && prows[0] ? prows[0].owner_id : null;
          targetIds = [...members, owner].filter(Boolean).filter(id => id !== task.assigned_to);
        }
        text = `🆕 Новая задача в проекте: <b>${task.title}</b>`;
      }
      const recs = await recipients(targetIds, initiator);
      for (const r of recs) await sendTo(r.chat, text);
      return j({ ok: true, sent: recs.length });
    }
    return j({ ok: true, note: "legacy type passthrough" });
  } catch (e) {
    return j({ error: String(e) }, 500);
  }
});
