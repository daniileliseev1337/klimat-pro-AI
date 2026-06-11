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
//   upload — БИНАРНЫЙ: тело запроса = сырые байты файла (стрим), метаданные в
//            заголовках x-*. Тело НЕ буферизуется в памяти (стримится в WebDAV) —
//            иначе worker упирается в memory limit на крупных файлах.
//   остальные — JSON-тело { action, ... }.
//
// Креды Nextcloud — в config.json рядом с этим файлом (на сервере, не в git).
// SUPABASE_URL / SUPABASE_ANON_KEY берутся из окружения edge-runtime.
import nc from "./config.json" with { type: "json" };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;        // http://kong:8000
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const DAV_BASE = `${nc.url}/remote.php/dav/files/${nc.user}`;
const NC_AUTH = "Basic " + btoa(`${nc.user}:${nc.password}`);

// фото задач: только изображения, ≤ 10 МБ (валидация и на фронте — здесь второй рубеж)
const TASK_PHOTO_MIME = ["image/jpeg", "image/png", "image/heic", "image/webp"];
const TASK_PHOTO_MAX = 10 * 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-action, x-project-id, x-filename, x-mime-type, x-file-size, x-task-id",
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

  try {
    // ─── TASK-PHOTO-UPLOAD (бинарный стрим; как upload, но для task_photos) ───
    if (req.headers.get("x-action") === "task-photo-upload") {
      const taskId = req.headers.get("x-task-id");
      const fnRaw = req.headers.get("x-filename");
      const filename = fnRaw ? decodeURIComponent(fnRaw) : "";
      const mimeType = req.headers.get("x-mime-type") || "";
      const fileSize = parseInt(req.headers.get("x-file-size") || "0", 10);
      if (!taskId || !filename || !req.body) {
        return json({ error: "bad params (x-task-id, x-filename, body required)" }, 400);
      }
      if (!TASK_PHOTO_MIME.includes(mimeType)) {
        return json({ error: `only images allowed (${TASK_PHOTO_MIME.join(", ")})` }, 415);
      }
      if (!fileSize || fileSize > TASK_PHOTO_MAX) {
        return json({ error: "file too large (max 10 MB)" }, 413);
      }

      const safeName = filename.replace(/[\/\\]/g, "_");
      const diskPath = `tasks/${taskId}/${crypto.randomUUID()}__${safeName}`;

      await ncMkcol("tasks");
      await ncMkcol(`tasks/${taskId}`);

      const put = await fetch(`${DAV_BASE}/${encodePath(diskPath)}`, {
        method: "PUT",
        headers: { Authorization: NC_AUTH, "Content-Type": mimeType },
        body: req.body,
        // @ts-ignore — duplex обязателен для стрим-тела
        duplex: "half",
      });
      if (![200, 201, 204].includes(put.status)) {
        return json({ error: `webdav put failed: ${put.status}` }, 502);
      }

      // метаданные под RLS (task_photos_insert проверит стороны задачи)
      const ins = await rest("task_photos", authHeader, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          task_id: taskId,
          file_path: diskPath,
          file_name: safeName,
          file_size: fileSize,
          uploaded_by: uid,
        }),
      });
      if (!ins.ok) {
        await fetch(`${DAV_BASE}/${encodePath(diskPath)}`, {
          method: "DELETE", headers: { Authorization: NC_AUTH },
        });
        const detail = await ins.text();
        return json({ error: "insert denied", status: ins.status, detail }, ins.status === 401 ? 403 : ins.status);
      }
      const rows = await ins.json();
      return json({ photo: Array.isArray(rows) ? rows[0] : rows });
    }

    // ─── UPLOAD (бинарный стрим, метаданные в заголовках) ─────────────────────
    if (req.headers.get("x-action") === "upload") {
      const projectId = req.headers.get("x-project-id");
      const fnRaw = req.headers.get("x-filename");
      const filename = fnRaw ? decodeURIComponent(fnRaw) : "";
      const mimeType = req.headers.get("x-mime-type") || null;
      const fileSize = parseInt(req.headers.get("x-file-size") || "0", 10);
      if (!projectId || !filename || !req.body) {
        return json({ error: "bad params (x-project-id, x-filename, body required)" }, 400);
      }

      const safeName = filename.replace(/[\/\\]/g, "_");
      const diskPath = `projects/${projectId}/${crypto.randomUUID()}__${safeName}`;

      // создать каталоги проекта (best-effort)
      await ncMkcol("projects");
      await ncMkcol(`projects/${projectId}`);

      // СТРИМ: тело запроса напрямую в WebDAV PUT, без буферизации в память
      const put = await fetch(`${DAV_BASE}/${encodePath(diskPath)}`, {
        method: "PUT",
        headers: { Authorization: NC_AUTH, "Content-Type": mimeType || "application/octet-stream" },
        body: req.body,
        // @ts-ignore — duplex обязателен для стрим-тела в fetch (deno/undici)
        duplex: "half",
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
          file_size: fileSize,
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

    // ─── Прочие действия — JSON-тело ──────────────────────────────────────────
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = body.action as string;

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

    // ─── TASK-PHOTO-DOWNLOAD ──────────────────────────────────────────────
    if (action === "task-photo-download") {
      const id = body.id as string;
      if (!id) return json({ error: "bad params (id required)" }, 400);
      const sel = await rest(
        `task_photos?id=eq.${id}&select=file_path,file_name`,
        authHeader, { method: "GET" },
      );
      const rows = await sel.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        return json({ error: "not found or access denied" }, 403);
      }
      const f = rows[0];
      const get = await fetch(`${DAV_BASE}/${encodePath(f.file_path)}`, {
        headers: { Authorization: NC_AUTH },
      });
      if (!get.ok || !get.body) {
        return json({ error: `webdav get failed: ${get.status}` }, 502);
      }
      return new Response(get.body, {
        status: 200,
        headers: {
          ...CORS,
          "Content-Type": "image/*",
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.file_name)}`,
        },
      });
    }

    // ─── TASK-PHOTO-DELETE (только загрузивший — RLS) ─────────────────────
    if (action === "task-photo-delete") {
      const id = body.id as string;
      if (!id) return json({ error: "bad params (id required)" }, 400);
      const sel = await rest(`task_photos?id=eq.${id}&select=file_path`, authHeader, { method: "GET" });
      const selRows = await sel.json();
      if (!Array.isArray(selRows) || selRows.length === 0) {
        return json({ error: "not found or access denied" }, 403);
      }
      const filePath = selRows[0].file_path;
      const del = await rest(`task_photos?id=eq.${id}`, authHeader, {
        method: "DELETE", headers: { Prefer: "return=representation" },
      });
      const delRows = await del.json().catch(() => []);
      if (!del.ok || !Array.isArray(delRows) || delRows.length === 0) {
        return json({ error: "delete denied" }, 403);
      }
      await fetch(`${DAV_BASE}/${encodePath(filePath)}`, {
        method: "DELETE", headers: { Authorization: NC_AUTH },
      });
      return json({ ok: true });
    }

    // ─── TASK-PHOTOS-PURGE (байты всех фото задачи; вызывать ДО удаления задачи) ──
    // Метаданные удалит каскад FK; здесь только WebDAV (best-effort).
    if (action === "task-photos-purge") {
      const taskId = body.taskId as string;
      if (!taskId) return json({ error: "bad params (taskId required)" }, 400);
      // список путей под RLS — посторонний получит пусто и ничего не удалит
      const sel = await rest(
        `task_photos?task_id=eq.${taskId}&select=file_path`,
        authHeader, { method: "GET" },
      );
      const rows = await sel.json();
      if (!Array.isArray(rows)) return json({ error: "select failed" }, 502);
      for (const r of rows) {
        await fetch(`${DAV_BASE}/${encodePath(r.file_path)}`, {
          method: "DELETE", headers: { Authorization: NC_AUTH },
        }).catch(() => {});
      }
      // папку задачи тоже прибрать (best-effort)
      await fetch(`${DAV_BASE}/${encodePath(`tasks/${taskId}`)}`, {
        method: "DELETE", headers: { Authorization: NC_AUTH },
      }).catch(() => {});
      return json({ ok: true, purged: rows.length });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
