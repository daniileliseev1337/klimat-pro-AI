# Фото-отчёты к задачам — заход №2 редизайна «Задач» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Прикладывание фото к задачам (только изображения, ≤10 МБ, в любой момент, любой стороной
задачи): таблица `task_photos` + RLS, хранение в Nextcloud через существующую edge-функцию
`nextcloud` (новые actions), секция в TaskModal, миниатюры на карточке доски.

**Architecture:** По образцу файлов проектов (`project_files` + edge `nextcloud`): метаданные —
прямой insert/select/delete под RLS через PostgREST под JWT юзера; байты — WebDAV-стрим под
техюзером NC, путь `tasks/<task_id>/`. RLS видимости — через готовый `can_access_task`.
Новые edge-ветки отдельные (`task-photo-*`) — существующие project-ветки НЕ трогаем.

**Tech Stack:** PostgreSQL (RLS), Deno edge (стрим fetch + duplex:'half'), React inline-styles,
Supabase JS.

**Спек:** `docs/superpowers/specs/2026-06-11-tasksview-redesign-design.md`, раздел «Заход №2».

**⚠ Грабли среды (контроллеру):** git ТОЛЬКО Windows-сторона + fsync writeout-only + ретраи;
Edit на F: может дать EIO (применяется — проверять Read); прод-действия (миграция к живой БД,
edge-деплой, веб, push) — ТОЛЬКО по явному «деплой»; в этом плане — только файлы.

---

## Карта файлов

- **Create:** `supabase/migrations/20260612_0001_task_photos.sql` — таблица + RLS + индекс.
- **Create:** `deploy/tasks/verify-task-photos-rls.sh` — RLS-проверка исполнением (на деплое).
- **Modify:** `deploy/nextcloud/functions/nextcloud/index.ts` — 4 новые ветки
  (`task-photo-upload` / `task-photo-download` / `task-photo-delete` / `task-photos-purge`)
  + `x-task-id` в CORS.
- **Modify:** `src/App.jsx`:
  - data-функции фото задач + константы валидации (рядом с file-функциями, ~787-833);
  - `deleteTask` — best-effort purge байтов перед удалением строки;
  - компоненты `TaskPhotoThumb` (+ module-кэш objectURL), `TaskPhotoLightbox`,
    `TaskPhotosSection` (в TaskModal), миниатюры в `TaskCardBoard`;
  - батч-загрузка метаданных фото в `TasksView` (для карточек доски).

---

### Task 1: миграция `task_photos` + RLS + verify-скрипт

**Files:**
- Create: `supabase/migrations/20260612_0001_task_photos.sql`
- Create: `deploy/tasks/verify-task-photos-rls.sh`

- [ ] **Step 1: Файл миграции**

```sql
-- Заход №2 редизайна задач: фото-отчёты. Метаданные файлов в Nextcloud (tasks/<task_id>/).
-- Видимость — стороны задачи (can_access_task, SECURITY DEFINER из 20260602_0004/20260611_0001).
CREATE TABLE IF NOT EXISTS public.task_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES public.project_tasks(id) ON DELETE CASCADE,
  file_path   text NOT NULL,           -- путь в Nextcloud: tasks/<task_id>/<uuid>__<имя>
  file_name   text NOT NULL,
  file_size   int  NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_photos_task ON public.task_photos(task_id);

ALTER TABLE public.task_photos ENABLE ROW LEVEL SECURITY;

-- читают стороны задачи (автор/исполнитель/админ/участники проекта — предикат can_access_task)
DROP POLICY IF EXISTS task_photos_select ON public.task_photos;
CREATE POLICY task_photos_select ON public.task_photos
  FOR SELECT TO authenticated
  USING (public.can_access_task(task_id));

-- грузит любая сторона задачи, авторство фиксируется за собой
DROP POLICY IF EXISTS task_photos_insert ON public.task_photos;
CREATE POLICY task_photos_insert ON public.task_photos
  FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND public.can_access_task(task_id));

-- удаляет только загрузивший
DROP POLICY IF EXISTS task_photos_delete ON public.task_photos;
CREATE POLICY task_photos_delete ON public.task_photos
  FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.task_photos TO authenticated;
```

(UPDATE-политики нет намеренно — фото неизменяемы; в `supabase_realtime` НЕ добавляем.)

- [ ] **Step 2: verify-скрипт (исполняется на деплое, НЕ сейчас)**

`deploy/tasks/verify-task-photos-rls.sh` — РОВНО по паттерну рабочего
`deploy/tasks/verify-rls.sh`: подписанный JWT (python hmac по `JWT_SECRET` из
`/srv/supabase-src/docker/.env`) + REST-запросы через PostgREST (`http://localhost:8000/rest/v1`)
— тот же путь, что у edge/фронта. НЕ использовать psql `SET LOCAL ROLE` (вне транзакции
не работает).

```bash
#!/usr/bin/env bash
# RLS-проверка task_photos на живой БД (на деплое). Паттерн verify-rls.sh: JWT+REST.
set -euo pipefail
SUPA=/srv/supabase-src/docker
REST=http://localhost:8000/rest/v1
JWT_SECRET="$(grep '^JWT_SECRET=' "$SUPA/.env" | cut -d= -f2-)"
ANON="$(grep '^ANON_KEY=' "$SUPA/.env" | cut -d= -f2-)"

sign() {
  python3 - "$JWT_SECRET" "$1" <<'PY'
import hmac,hashlib,base64,json,sys,time
secret,uid=sys.argv[1],sys.argv[2]
b=lambda x: base64.urlsafe_b64encode(x).rstrip(b'=')
h=b(json.dumps({"alg":"HS256","typ":"JWT"}).encode()); n=int(time.time())
p=b(json.dumps({"sub":uid,"role":"authenticated","aud":"authenticated","iat":n,"exp":n+3600}).encode())
s=b(hmac.new(secret.encode(),h+b'.'+p,hashlib.sha256).digest())
print((h+b'.'+p+b'.'+s).decode())
PY
}

read -r A B <<EOF
$(docker exec -i supabase-db psql -U postgres -d postgres -At -F' ' -c \
"SELECT id FROM public.profiles WHERE approved=true ORDER BY created_at LIMIT 2;" | tr '\n' ' ')
EOF
[ -n "$A" ] && [ -n "$B" ] || { echo "NEED_TWO_APPROVED_USERS"; exit 1; }
JA="$(sign "$A")"; JB="$(sign "$B")"

echo "== A создаёт ЛИЧНУЮ задачу =="
TID=$(curl -s -X POST "$REST/project_tasks" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JA" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"author_id\":\"$A\",\"title\":\"photo-rls selftest\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if isinstance(d,list) and d else "")')
[ -n "$TID" ] || { echo "TASK INSERT FAILED"; exit 1; }

echo "== A вставляет метаданные фото (ожидаем 201) =="
PID=$(curl -s -X POST "$REST/task_photos" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JA" -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "{\"task_id\":\"$TID\",\"file_path\":\"tasks/$TID/t.png\",\"file_name\":\"t.png\",\"file_size\":100,\"uploaded_by\":\"$A\"}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if isinstance(d,list) and d else "")')
[ -n "$PID" ] || { echo "FAIL: photo insert by author"; exit 1; }

echo "== A видит (1), B не видит (0) =="
CA=$(curl -s "$REST/task_photos?task_id=eq.$TID&select=id" -H "apikey: $ANON" -H "Authorization: Bearer $JA" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
CB=$(curl -s "$REST/task_photos?task_id=eq.$TID&select=id" -H "apikey: $ANON" -H "Authorization: Bearer $JB" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
echo "A=$CA B=$CB"
[ "$CA" = "1" ] && [ "$CB" = "0" ] || { echo "FAIL: visibility"; exit 1; }

echo "== B не может вставить фото в задачу A (ожидаем 4xx) =="
BC=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$REST/task_photos" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JB" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TID\",\"file_path\":\"tasks/$TID/h.png\",\"file_name\":\"h.png\",\"file_size\":1,\"uploaded_by\":\"$B\"}")
echo "B insert: HTTP $BC"
case "$BC" in 4*) ;; *) echo "FAIL: stranger inserted"; exit 1;; esac

echo "== B не может удалить фото A (0 строк) =="
BD=$(curl -s -X DELETE "$REST/task_photos?id=eq.$PID" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JB" -H "Prefer: return=representation" \
  | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
[ "$BD" = "0" ] || { echo "FAIL: stranger deleted"; exit 1; }

echo "== каскад: удаляем задачу A -> метаданные фото исчезают =="
curl -s -X DELETE "$REST/project_tasks?id=eq.$TID" -H "apikey: $ANON" -H "Authorization: Bearer $JA" -o /dev/null
ORPH=$(docker exec -i supabase-db psql -U postgres -d postgres -At -c \
  "SELECT count(*) FROM public.task_photos WHERE task_id='$TID';")
[ "$ORPH" = "0" ] || { echo "FAIL: cascade left $ORPH"; exit 1; }

echo "TASK_PHOTOS_RLS_OK"
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260612_0001_task_photos.sql deploy/tasks/verify-task-photos-rls.sh
git commit -m "feat(tasks): миграция task_photos + RLS + verify-скрипт (заход №2, файлы)"
```

---

### Task 2: edge `nextcloud` — ветки task-photo-*

**Files:**
- Modify: `deploy/nextcloud/functions/nextcloud/index.ts`

- [ ] **Step 1: CORS** — в `Access-Control-Allow-Headers` добавить `, x-task-id` (строка ~28).

- [ ] **Step 2: Валидация-константы** — после `const NC_AUTH = ...` добавить:

```ts
// фото задач: только изображения, ≤ 10 МБ (валидация и на фронте — здесь второй рубеж)
const TASK_PHOTO_MIME = ["image/jpeg", "image/png", "image/heic", "image/webp"];
const TASK_PHOTO_MAX = 10 * 1024 * 1024;
```

- [ ] **Step 3: Ветка upload** — ПЕРЕД существующей веткой `if (req.headers.get("x-action") === "upload")` вставить:

```ts
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
```

- [ ] **Step 4: Ветки download/delete/purge** — после существующей ветки `toggle-public` (перед `return json({ error: \`unknown action...\` })`) вставить:

```ts
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
```

- [ ] **Step 5: Commit** (деплой edge — НЕ сейчас)

```bash
git add deploy/nextcloud/functions/nextcloud/index.ts
git commit -m "feat(tasks): edge nextcloud — task-photo-upload/download/delete/purge"
```

---

### Task 3: фронт — data-функции фото

**Files:**
- Modify: `src/App.jsx` — после `deleteProjectFile` (~833)

- [ ] **Step 1: Функции и константы**

```js
// ── Заход №2: фото-отчёты задач (хранение в Nextcloud, метаданные task_photos) ──
export const TASK_PHOTO_MIME = ["image/jpeg", "image/png", "image/heic", "image/webp"];
export const TASK_PHOTO_MAX = 10 * 1024 * 1024; // 10 МБ

async function fetchTaskPhotos(client, taskId) {
  const { data, error } = await client.from("task_photos")
    .select("*").eq("task_id", taskId).order("created_at");
  if (error) throw error;
  return data || [];
}

// батч для карточек доски: метаданные фото всех видимых задач одним запросом
async function fetchTaskPhotosBatch(client, taskIds) {
  if (!taskIds.length) return {};
  const { data, error } = await client.from("task_photos")
    .select("id, task_id, file_name").in("task_id", taskIds).order("created_at");
  if (error) throw error;
  const map = {};
  for (const p of data || []) (map[p.task_id] = map[p.task_id] || []).push(p);
  return map;
}

async function uploadTaskPhoto(client, taskId, file) {
  const { data, error } = await client.functions.invoke("nextcloud", {
    body: file,
    headers: {
      "x-action":    "task-photo-upload",
      "x-task-id":   taskId,
      "x-filename":  encodeURIComponent(file.name),
      "x-mime-type": file.type || "",
      "x-file-size": String(file.size),
    },
  });
  if (error) throw error;
  return data;
}

async function downloadTaskPhoto(client, photoId) {
  const { data, error } = await client.functions.invoke("nextcloud", {
    body: { action: "task-photo-download", id: photoId },
  });
  if (error) throw error;
  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer) return new Blob([data]);
  if (typeof data === "string") return new Blob([data]);
  throw new Error("Не удалось получить фото");
}

async function deleteTaskPhoto(client, photoId) {
  return ncAction(client, "task-photo-delete", { id: photoId });
}

async function purgeTaskPhotos(client, taskId) {
  return ncAction(client, "task-photos-purge", { taskId });
}
```

- [ ] **Step 2: `deleteTask` — purge байтов перед удалением строки** (~713):

```js
async function deleteTask(client, id) {
  // байты фото в NC чистим ДО удаления строки (каскад снесёт метаданные); best-effort
  try { await purgeTaskPhotos(client, id); } catch { /* осиротевшие байты — косметика */ }
  const { error } = await client.from("project_tasks").delete().eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 3: Сборка + commit**

`npm run build` зелёная, `npx vitest run` 96 PASS.

```bash
git add src/App.jsx
git commit -m "feat(tasks): data-функции фото задач + purge при удалении задачи"
```

---

### Task 4: UI — секция «Фото-отчёт» в TaskModal

**Files:**
- Modify: `src/App.jsx` — компоненты перед `TaskWorkflowButton`; вставка секции в TaskModal

- [ ] **Step 1: Кэш и компонент миниатюры**

Вставить перед `function TaskWorkflowButton(`:

```jsx
// Кэш objectURL скачанных фото (живёт сессию страницы — повторные открытия без сети).
const taskPhotoUrlCache = new Map(); // photoId -> objectURL

// Миниатюра фото задачи: лениво качает через edge, кэширует objectURL.
function TaskPhotoThumb({ photo, client, size = 64, onClick }) {
  const [url, setUrl] = useState(taskPhotoUrlCache.get(photo.id) || null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (url || failed) return;
    let alive = true;
    downloadTaskPhoto(client, photo.id)
      .then(blob => {
        const u = URL.createObjectURL(blob);
        taskPhotoUrlCache.set(photo.id, u);
        if (alive) setUrl(u);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [photo.id, client, url, failed]);
  return (
    <div onClick={onClick} title={photo.file_name} style={{
      width: size, height: size, borderRadius: 8, overflow: "hidden", flexShrink: 0,
      background: "#0a0b11", border: "1px solid rgba(255,255,255,0.08)",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: onClick ? "pointer" : "default",
    }}>
      {url
        ? <img src={url} alt={photo.file_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <span style={{ fontSize: size / 3, opacity: 0.4 }}>{failed ? "✕" : "🖼"}</span>}
    </div>
  );
}

// Полноэкранный просмотр фото (клик по фону или ✕ — закрыть).
// Кэша может ещё не быть (клик до загрузки миниатюры) — грузит сам.
function TaskPhotoLightbox({ photo, client, onClose }) {
  const [url, setUrl] = useState(taskPhotoUrlCache.get(photo.id) || null);
  useEffect(() => {
    if (url) return;
    let alive = true;
    downloadTaskPhoto(client, photo.id)
      .then(blob => {
        const u = URL.createObjectURL(blob);
        taskPhotoUrlCache.set(photo.id, u);
        if (alive) setUrl(u);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [photo.id, client, url]);
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.9)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <button onClick={onClose} style={{
        position: "absolute", top: 16, right: 20, background: "none", border: "none",
        color: "#fff", fontSize: 28, cursor: "pointer",
      }}>×</button>
      {url
        ? <img src={url} alt={photo.file_name} onClick={e => e.stopPropagation()}
               style={{ maxWidth: "95vw", maxHeight: "90vh", borderRadius: 8 }} />
        : <span style={{ color: "#9b9ca4" }}>Загрузка…</span>}
    </div>
  );
}

// Секция «Фото-отчёт» в модалке задачи: сетка миниатюр + приложить/удалить/просмотр.
function TaskPhotosSection({ task, client, profile, showToast }) {
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState(null);
  const fileRef = useRef(null);

  const reload = useCallback(async () => {
    try { setPhotos(await fetchTaskPhotos(client, task.id)); }
    catch (e) { showToast("Ошибка загрузки фото: " + (e.message || ""), "error"); }
  }, [client, task.id, showToast]);
  useEffect(() => { reload(); }, [reload]);

  const pick = () => fileRef.current?.click();
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // повторный выбор того же файла
    if (!file) return;
    if (!TASK_PHOTO_MIME.includes(file.type)) {
      showToast("Только фото: JPG, PNG, HEIC, WebP", "error"); return;
    }
    if (file.size > TASK_PHOTO_MAX) {
      showToast("Файл больше 10 МБ", "error"); return;
    }
    setBusy(true);
    try { await uploadTaskPhoto(client, task.id, file); await reload(); showToast("✓ Фото приложено"); }
    catch (err) { showToast("Ошибка загрузки: " + (err.message || ""), "error"); }
    finally { setBusy(false); }
  };
  const remove = async (photo) => {
    try {
      await deleteTaskPhoto(client, photo.id);
      const u = taskPhotoUrlCache.get(photo.id);
      if (u) { URL.revokeObjectURL(u); taskPhotoUrlCache.delete(photo.id); }
      await reload();
    } catch (e) { showToast("Ошибка удаления: " + (e.message || ""), "error"); }
  };

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Label>Фото-отчёт{photos.length ? ` · ${photos.length}` : ""}</Label>
        <button onClick={pick} disabled={busy} style={{
          marginLeft: "auto", fontSize: 12, padding: "5px 10px", borderRadius: 8,
          background: "#d4af3722", border: "1px solid #d4af3744", color: "#e8c860",
          cursor: "pointer", fontWeight: 600,
        }}>{busy ? "Загрузка…" : "📷 Приложить фото"}</button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/heic,image/webp"
               onChange={onFile} style={{ display: "none" }} />
      </div>
      {photos.length === 0
        ? <div style={{ fontSize: 12, color: "#62646b" }}>Фото пока нет</div>
        : <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {photos.map(p => (
              <div key={p.id} style={{ position: "relative" }}>
                <TaskPhotoThumb photo={p} client={client} size={72} onClick={() => setViewing(p)} />
                {p.uploaded_by === profile.id && (
                  <button onClick={() => remove(p)} title="Удалить фото" style={{
                    position: "absolute", top: -6, right: -6, width: 20, height: 20,
                    borderRadius: "50%", border: "none", cursor: "pointer",
                    background: "#1c1c1a", color: "#f8a3a3", fontSize: 12, lineHeight: 1,
                  }}>×</button>
                )}
              </div>
            ))}
          </div>}
      {viewing && <TaskPhotoLightbox photo={viewing} client={client} onClose={() => setViewing(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: Вставка в TaskModal**

В TaskModal сразу ПОСЛЕ блока `{!isNew && <TaskWorkflowButton ... />}` добавить:

```jsx
        {!isNew && <TaskPhotosSection task={task} client={client} profile={profile} showToast={showToast} />}
```

- [ ] **Step 3: Сборка + commit**

`npm run build`, `npx vitest run` (96 PASS).

```bash
git add src/App.jsx
git commit -m "feat(tasks): секция Фото-отчёт в модалке — миниатюры/просмотр/удаление своих"
```

---

### Task 5: UI — миниатюры на карточке доски

**Files:**
- Modify: `src/App.jsx` — `TasksView` (батч), `TasksBoard`/`TaskCardBoard` (проп + рендер)

- [ ] **Step 1: Батч метаданных в TasksView**

После состояния `const [tasks, setTasks] = useState([]);` добавить
`const [photosByTask, setPhotosByTask] = useState({});`

В `reload` после `setTasks(list);` добавить:

```js
      try { setPhotosByTask(await fetchTaskPhotosBatch(client, list.map(t => t.id))); }
      catch { setPhotosByTask({}); } // миниатюры — некритичное украшение
```

- [ ] **Step 2: Прокинуть в доску**

Вызов: `<TasksBoard tasks={shown} photosByTask={photosByTask} ...>` (остальные пропсы как есть).
`TasksBoard`: добавить `photosByTask` в деструктуризацию и передать
`photos={photosByTask[t.id] || []}` в `TaskCardBoard`.

- [ ] **Step 3: Рендер на карточке**

`TaskCardBoard({ t, onOpen, draggable, onDragStart, photos = [], client })` — добавить пропсы
`photos` и `client` (client прокинуть из TasksBoard так же, как onOpen). После блока
`{t.hasOpenQuestion && (...)}` вставить:

```jsx
      {photos.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 11, alignItems: "center" }}>
          {photos.slice(0, 3).map(p => (
            <TaskPhotoThumb key={p.id} photo={p} client={client} size={46} />
          ))}
          {photos.length > 3 && (
            <span style={{ fontSize: 11, color: "#9b9ca4", fontWeight: 700 }}>+{photos.length - 3}</span>
          )}
        </div>
      )}
```

(Клик по миниатюре на карточке отдельно не обрабатываем — клик по карточке открывает модалку,
там полноценный просмотр. `TaskRowList` миниатюры не показывает — спек требовал только доску.)

- [ ] **Step 4: Сборка + полный прогон + commit**

`npm run build`, `npx vitest run` (96 PASS).

```bash
git add src/App.jsx
git commit -m "feat(tasks): миниатюры фото на карточке доски (до 3 + «+N», батч метаданных)"
```

---

### Task 6: финальная верификация

- [ ] `npx vitest run` → 96 PASS; `npm run build` → зелёная.
- [ ] `git diff --stat main` → только заявленные файлы (App.jsx, edge index.ts, миграция, verify-скрипт).
- [ ] Самопроверка диффа контроллером: ветки edge не задели project-ветки; CORS дополнен;
      RLS-политики соответствуют спеку (select=стороны, insert=стороны+своё, delete=своё).

---

## Чек-лист деплоя (по явному «деплой» владельца)

1. `npm run build`.
2. Миграция: `docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/20260612_0001_task_photos.sql`.
3. RLS-верификация исполнением: `wsl bash deploy/tasks/verify-task-photos-rls.sh` → `TASK_PHOTOS_RLS_OK`.
4. Edge: `wsl bash deploy/nextcloud/deploy-edge-function.sh` (функция nextcloud; скрипт уже целится в неё) → `EDGE_DEPLOYED`.
5. Веб: `wsl bash /mnt/f/*/redesign-v2-fresh/deploy/nextcloud/deploy-web.sh`.
6. E2E вручную владельцем: приложить фото (валидное/невалидное/большое), просмотр, удаление своего,
   миниатюры на доске, второй юзер видит фото командной задачи но НЕ может удалить чужое.
7. Push main → origin; сброс кэша PWA.

## Вне плана

Мобильная адаптация вкладки — отдельный проход. Серверный ресайз миниатюр (сейчас миниатюра
качает полный файл — приемлемо для локальной сети self-hosted; если станет медленно на телефоне
через туннель — кандидат на оптимизацию отдельной задачей).
