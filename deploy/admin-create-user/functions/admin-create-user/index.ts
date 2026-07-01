// Edge Function admin-create-user — админ создаёт пользователя (email+пароль+имя+роль, approved).
// Гейт: вызывающий должен быть admin (profiles.role='admin' под его JWT) — проверка ДО GoTrue.
// Создание — GoTrue admin API (service_role). Финализация — RPC admin_finalize_new_user под JWT админа.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;            // http://kong:8000
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (b: unknown, s = 200): Response =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function getUserId(auth: string): string | null {
  try {
    const p = auth.replace(/^Bearer\s+/i, "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p)).sub ?? null;
  } catch { return null; }
}

// PostgREST под токеном (RLS применяется, если не service_role)
function rest(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ ok: false, stage: "method", message: "POST only" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const callerToken = auth.replace(/^Bearer\s+/i, "");
  const callerId = getUserId(auth);
  if (!callerId) return j({ ok: false, stage: "auth", message: "no caller" }, 401);

  // 1) вызывающий — админ? (profiles.role='admin' под ЕГО JWT; RLS даёт читать свой профиль)
  const meR = await rest(`profiles?id=eq.${callerId}&select=role`, callerToken);
  const me = await meR.json().catch(() => null);
  if (!Array.isArray(me) || me[0]?.role !== "admin") {
    return j({ ok: false, stage: "forbidden", message: "admin only" }, 403);
  }

  // 2) вход
  let body: { email?: string; password?: string; name?: string; role?: string };
  try { body = await req.json(); } catch { return j({ ok: false, stage: "input", message: "bad json" }, 400); }
  const email = (body.email ?? "").trim();
  const password = body.password ?? "";
  const name = (body.name ?? "").trim();
  const role = body.role ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return j({ ok: false, stage: "input", message: "bad email" }, 400);
  if (password.length < 8) return j({ ok: false, stage: "input", message: "password < 8" }, 400);
  if (role !== "client" && role !== "employee") return j({ ok: false, stage: "input", message: "bad role" }, 400);

  // 3) создать через GoTrue admin API (service_role)
  const cr = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const created = await cr.json().catch(() => ({}));
  if (!cr.ok || !created?.id) {
    return j({ ok: false, stage: "create", message: created?.msg || created?.error_description || `gotrue ${cr.status}` }, 400);
  }
  const userId = created.id as string;

  // 4) финализация под JWT админа (is_admin-гейт в RPC)
  const fr = await rest(`rpc/admin_finalize_new_user`, callerToken, {
    method: "POST",
    body: JSON.stringify({ p_user_id: userId, p_role: role, p_name: name }),
  });
  if (!fr.ok) {
    const ferr = await fr.text().catch(() => "");
    // частичный сбой: юзер создан, финализация упала — НЕ молчим, отдаём user_id
    return j({ ok: false, stage: "finalize", user_id: userId, message: `finalize failed: ${ferr.slice(0, 200)}` }, 500);
  }

  return j({ ok: true, user_id: userId, email });
});
