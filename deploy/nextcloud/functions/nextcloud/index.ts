// Edge Function `nextcloud` — файловое хранилище проекта (этап 6.3, заменяет yandex-disk).
//
// Архитектура: браузер -> (Supabase Edge Function) -> Nextcloud WebDAV.
// Nextcloud наружу не выставлен. Авторизация и права доступа проверяются через
// PostgREST под JWT пользователя (срабатывает RLS таблицы project_files) — функция
// НЕ использует service_role для операций с метаданными, поэтому доступ к чужим
// проектам невозможен. Байты файлов кладутся/читаются в Nextcloud по WebDAV под
// техюзером приложения.
//
// Actions: upload | download | delete | toggle-public
//
// Креды Nextcloud — в config.json рядом с этим файлом (на сервере, не в git).
// SUPABASE_URL / SUPABASE_ANON_KEY берутся из окружения edge-runtime.
import nc from "./config.json" with { type: "json" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;        // http://kong:8000
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const DAV_BASE = `${nc.url}/remote.php/dav/files/${nc.user}`;
const NC_AUTH = "Basic " + btoa(`${nc.user}:${nc.password}`);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// uid из JWT (без верификации подписи — её проверяет PostgREST/RLS дальше)
function getUserId(authHeader: string): string | null {
  try {
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part));
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

// PostgREST под JWT пользователя — RLS применяется
function rest(path: string, authHeader: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON_KEY,
      Authorization: authHeader,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function ncMkcol(path: string): Promise<void> {
  // 201 — создано, 405 — уже существует; оба приемлемы
  await fetch(`${DAV_BASE}/${encodePath(path)}`, {
    method: "MKCOL",
    headers: { Authorization: NC_AUTH },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "missing authorization header" }, 401);
  const uid = getUserId(authHeader);
  if (!uid) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = body.action as string;

  try {
    // ─── UPLOAD ───────────────────────────────────────────────────────────
    if (action === "upload") {
      const projectId = body.projectId as string;
      const filename = body.filename as string;
      const mimeType = (body.mimeType as string) || null;
      const fileBase64 = body.fileBase64 as string;
      if (!projectId || !filename || !fileBase64) {
        return json({ error: "bad params (projectId, filename, fileBase64 required)" }, 400);
      }

      const bytes = Uint8Array.from(atob(fileBase64), (c) => c.charCodeAt(0));
      const safeName = filename.replace(/[\/\\]/g, "_");
      const diskPath = `projects/${projectId}/${crypto.randomUUID()}__${safeName}`;

      // создать каталоги проекта (best-effort)
      await ncMkcol("projects");
      await ncMkcol(`projects/${projectId}`);

      const put = await fetch(`${DAV_BASE}/${encodePath(diskPath)}`, {
        method: "PUT",
        headers: { Authorization: NC_AUTH },
        body: bytes,
      });
      if (![200, 201, 204].includes(put.status)) {
        return json({ error: `webdav put failed: ${put.status}` }, 502);
      }

      // метаданные — прямой insert под RLS (files_insert проверит права на проект)
      const ins = await rest("project_files", authHeader, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          project_id: projectId,
          owner_id: uid,
          filename: safeName,
          disk_path: diskPath,
          file_size: bytes.length,
          mime_type: mimeType,
          is_public: false,
          public_url: null,
        }),
      });
      if (!ins.ok) {
        // откат: убрать загруженный файл, раз метаданные не легли (нет прав)
        await fetch(`${DAV_BASE}/${encodePath(diskPath)}`, {
          method: "DELETE",
          headers: { Authorization: NC_AUTH },
        });
        const detail = await ins.text();
        return json({ error: "insert denied", status: ins.status, detail }, ins.status === 401 ? 403 : ins.status);
      }
      const rows = await ins.json();
      return json({ file: Array.isArray(rows) ? rows[0] : rows });
    }

    // ─── DOWNLOAD ─────────────────────────────────────────────────────────
    if (action === "download") {
      const id = body.id as string;
      if (!id) return json({ error: "bad params (id required)" }, 400);

      // select под RLS — вернёт строку только при наличии доступа
      const sel = await rest(
        `project_files?id=eq.${id}&select=disk_path,filename,mime_type`,
        authHeader,
        { method: "GET" },
      );
      const rows = await sel.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        return json({ error: "not found or access denied" }, 403);
      }
      const f = rows[0];

      const get = await fetch(`${DAV_BASE}/${encodePath(f.disk_path)}`, {
        headers: { Authorization: NC_AUTH },
      });
      if (!get.ok || !get.body) {
        return json({ error: `webdav get failed: ${get.status}` }, 502);
      }
      return new Response(get.body, {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": f.mime_type || "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        },
      });
    }

    // ─── DELETE ───────────────────────────────────────────────────────────
    if (action === "delete") {
      const id = body.id as string;
      if (!id) return json({ error: "bad params (id required)" }, 400);

      // путь под RLS (доступ на чтение)
      const sel = await rest(`project_files?id=eq.${id}&select=disk_path`, authHeader, { method: "GET" });
      const selRows = await sel.json();
      if (!Array.isArray(selRows) || selRows.length === 0) {
        return json({ error: "not found or access denied" }, 403);
      }
      const diskPath = selRows[0].disk_path;

      // удалить запись под RLS files_delete
      const del = await rest(`project_files?id=eq.${id}`, authHeader, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      });
      const delRows = await del.json().catch(() => []);
      if (!del.ok || !Array.isArray(delRows) || delRows.length === 0) {
        return json({ error: "delete denied" }, 403);
      }

      // удалить байты в Nextcloud (best-effort — запись уже удалена)
      await fetch(`${DAV_BASE}/${encodePath(diskPath)}`, {
        method: "DELETE",
        headers: { Authorization: NC_AUTH },
      });
      return json({ ok: true });
    }

    // ─── TOGGLE-PUBLIC ────────────────────────────────────────────────────
    // При внутреннем Nextcloud прямой внешней ссылки нет: меняем только флаг,
    // public_url остаётся null. Скачивание всегда идёт через эту функцию.
    if (action === "toggle-public") {
      const id = body.id as string;
      const makePublic = !!body.makePublic;
      if (!id) return json({ error: "bad params (id required)" }, 400);

      const upd = await rest(`project_files?id=eq.${id}`, authHeader, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ is_public: makePublic, public_url: null }),
      });
      const updRows = await upd.json().catch(() => []);
      if (!upd.ok || !Array.isArray(updRows) || updRows.length === 0) {
        return json({ error: "update denied" }, 403);
      }
      return json({ file: updRows[0], note: "public_url unavailable (internal Nextcloud)" });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
