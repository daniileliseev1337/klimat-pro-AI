# Портал заказчика Фазы 2-3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline — живая БД + edge-деплой под гейтом владельца). Steps use `- [ ]`.

**Goal:** Выделенный канал заказчик↔команда — переписка `client_messages` + файлы `client_visible` (Фаза 2), затем push/inbox-уведомления заказчику (Фаза 3). Спека: `docs/superpowers/specs/2026-07-03-client-phase23-design.md`.

**Architecture:** Новые «чистые» сущности без приватных полей → RLS с гейтом `is_project_client OR can_access_project_comments`. Чтение/запись через SECURITY DEFINER RPC (паттерн `get_tasks`/`get_project_files`). Edge `nextcloud` НЕ трогаем (download под JWT+RLS). Уведомления — новые типы в `web-push-notify` поверх готового inbox.

**Tech Stack:** self-hosted Supabase (PG17), React 18 монолит `src/App.jsx`, Deno edge, vitest (env node, lib/), bash-верификация.

## Global Constraints
- Хелперы существуют в БД (проверено baseline): `is_project_client(uuid)`, `can_access_project_comments(uuid)`, `is_approved()`, `is_admin()`, `is_project_owner(uuid)`.
- Живой apply миграций / edge-деплой / merge — ТОЛЬКО по явному «го» владельца. Транзакционная проверка (BEGIN…ROLLBACK) — свободно (откатывается). Код+коммиты+build — свободно.
- `App.jsx` — монолит: править точечно, новые компоненты — отдельными функциями в файле. Язык UI — русский.
- Миграции к БД через `docker exec -i supabase-db psql` (кириллица → файлом/stdin, не инлайн). Edge-деплой — `cp` с /mnt/f.
- git — `-c core.fsyncMethod=writeout-only`. Скрипты deploy — worktree-agnostic (пути от `dirname "$0"`).
- `get_project_files` менять аддитивно (новая колонка в КОНЕЦ RETURNS TABLE) — не сломать существующий фронт.
- Realtime переписки — ВНЕ scope (refetch). Загрузка файлов заказчиком — ВНЕ scope.

---

## ФАЗА 2 — переписка + файлы

### Task 1: Миграция Фазы 2 (таблица + колонка + RLS + 4 RPC + аддитив get_project_files)

**Files:**
- Create: `supabase/migrations/20260703_0003_client_phase2.sql`

**Interfaces (Produces):** таблица `client_messages`; колонка `project_files.client_visible`; RPC `get_client_messages(uuid)`, `post_client_message(uuid,text)`, `get_client_project_files(uuid)`, `set_file_client_visible(uuid,boolean)`; `get_project_files` +колонка `client_visible`.

- [ ] **Step 1: Написать миграцию** — создать `supabase/migrations/20260703_0003_client_phase2.sql`:

```sql
-- Портал заказчика Фаза 2: переписка client_messages + файлы client_visible.
-- Гейты — существующие хелперы is_project_client / can_access_project_comments.

-- 1) Переписка заказчик↔команда по проекту
create table if not exists public.client_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id  uuid not null references auth.users(id)   on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists idx_client_messages_project on public.client_messages(project_id, created_at);
alter table public.client_messages enable row level security;

drop policy if exists client_messages_select on public.client_messages;
create policy client_messages_select on public.client_messages for select to authenticated
  using (public.is_project_client(project_id) or public.can_access_project_comments(project_id));

drop policy if exists client_messages_insert on public.client_messages;
create policy client_messages_insert on public.client_messages for insert to authenticated
  with check (
    author_id = auth.uid() and public.is_approved()
    and (public.is_project_client(project_id) or public.can_access_project_comments(project_id))
  );
-- update/delete: политик нет (сообщения неизменны)

-- 2) Флаг видимости файла заказчику
alter table public.project_files add column if not exists client_visible boolean not null default false;

-- files_select: пересоздать с веткой заказчика (был только can_access_project_comments)
drop policy if exists files_select on public.project_files;
create policy files_select on public.project_files for select to authenticated
  using (
    public.can_access_project_comments(project_id)
    or (client_visible and public.is_project_client(project_id))
  );

-- 3) RPC переписки
create or replace function public.get_client_messages(p_project_id uuid)
returns table(id uuid, author_id uuid, author_name text, is_mine boolean, body text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.is_project_client(p_project_id) or public.can_access_project_comments(p_project_id)) then
    return;
  end if;
  return query
    select m.id, m.author_id,
           coalesce(p.name, p.email, 'Пользователь') as author_name,
           (m.author_id = auth.uid()) as is_mine,
           m.body, m.created_at
    from public.client_messages m
    left join public.profiles p on p.id = m.author_id
    where m.project_id = p_project_id
    order by m.created_at asc;
end; $$;

create or replace function public.post_client_message(p_project_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_body text := btrim(p_body);
begin
  if not (public.is_project_client(p_project_id) or public.can_access_project_comments(p_project_id)) then
    raise exception 'access denied';
  end if;
  if not public.is_approved() then raise exception 'not approved'; end if;
  if length(v_body) not between 1 and 4000 then raise exception 'body length 1..4000'; end if;
  insert into public.client_messages(project_id, author_id, body)
    values (p_project_id, auth.uid(), v_body) returning id into v_id;
  return v_id;
end; $$;

-- 4) RPC файлов заказчика (только client_visible, без приватных полей)
create or replace function public.get_client_project_files(p_project_id uuid)
returns table(id uuid, filename text, file_size bigint, mime_type text, uploader_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_project_client(p_project_id) then return; end if;
  return query
    select f.id, f.filename, f.file_size, f.mime_type,
           coalesce(p.name, p.email, 'Пользователь') as uploader_name, f.created_at
    from public.project_files f
    left join public.profiles p on p.id = f.owner_id
    where f.project_id = p_project_id and f.client_visible = true
    order by f.created_at desc;
end; $$;

-- 5) Тоггл видимости файла (команда): загрузивший / owner проекта / admin
create or replace function public.set_file_client_visible(p_file_id uuid, p_visible boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_project uuid; v_owner uuid;
begin
  select project_id, owner_id into v_project, v_owner from public.project_files where id = p_file_id;
  if v_project is null then raise exception 'file not found'; end if;
  if not (v_owner = auth.uid() or public.is_project_owner(v_project) or public.is_admin()) then
    raise exception 'access denied';
  end if;
  update public.project_files set client_visible = p_visible where id = p_file_id;
end; $$;

-- 6) get_project_files: аддитивно вернуть client_visible (для галочки у команды)
drop function if exists public.get_project_files(uuid);
create function public.get_project_files(p_project_id uuid)
returns table(id uuid, project_id uuid, owner_id uuid, uploader_name text, filename text,
              disk_path text, file_size bigint, mime_type text, is_public boolean, public_url text,
              client_visible boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.can_access_project_comments(p_project_id) then return; end if;
  return query
    select f.id, f.project_id, f.owner_id,
           coalesce(p.name, p.email, 'Пользователь') as uploader_name,
           f.filename, f.disk_path, f.file_size, f.mime_type, f.is_public, f.public_url,
           f.client_visible, f.created_at
    from public.project_files f
    left join public.profiles p on p.id = f.owner_id
    where f.project_id = p_project_id
    order by f.created_at desc;
end; $$;

grant execute on function public.get_client_messages(uuid) to authenticated;
grant execute on function public.post_client_message(uuid, text) to authenticated;
grant execute on function public.get_client_project_files(uuid) to authenticated;
grant execute on function public.set_file_client_visible(uuid, boolean) to authenticated;
grant execute on function public.get_project_files(uuid) to authenticated;
```

- [ ] **Step 2: Синтаксическая транзакционная проверка** (не оставляет следов):

Run (WSL): подать файл в psql внутри `BEGIN; \i ...; ROLLBACK;` — через обёртку в Task 2 Step 2. На этом шаге только глазами проверить SQL.

- [ ] **Step 3: Коммит**

```bash
git add supabase/migrations/20260703_0003_client_phase2.sql
git commit -m "feat(client-p2): миграция — client_messages + client_visible + RPC"
```

---

### Task 2: Скрипты apply + verify Фазы 2 (паттерн deploy/client-role/)

**Files:**
- Create: `deploy/client-phase2/apply-migrations.sh`
- Create: `deploy/client-phase2/verify-phase2.sh`

**Interfaces (Consumes):** миграция Task 1. **Produces:** маркеры `MIGRATIONS_DONE`, `CLIENT_P2_OK`.

- [ ] **Step 1: apply-скрипт** `deploy/client-phase2/apply-migrations.sh`:

```bash
#!/usr/bin/env bash
# Постоянное применение миграции Фазы 2 к живой БД (по слову «деплой»).
set -euo pipefail
MIG="$(cd "$(dirname "$0")/../../supabase/migrations" && pwd)/20260703_0003_client_phase2.sql"
[ -f "$MIG" ] || { echo "NO_MIGRATION $MIG"; exit 1; }
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG"
echo "MIGRATIONS_DONE"
```

- [ ] **Step 2: verify-скрипт** `deploy/client-phase2/verify-phase2.sh` — транзакционная проверка эмуляцией JWT (BEGIN…ROLLBACK, следов не оставляет). Проверяет: заказчик своего проекта пишет/читает; чужой — пусто; client_visible фильтр; тоггл под owner:

```bash
#!/usr/bin/env bash
# Верификация Фазы 2 на живой БД, всё в одной транзакции с ROLLBACK (следов нет).
# Эмуляция ролей через set_config('request.jwt.claims'). Требует существующего проекта
# с привязанным заказчиком (clients.user_id) — иначе SKIP с пояснением.
set -euo pipefail
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -At"

read -r PROJ CLIENT_UID < <($PSQL <<'SQL'
select p.id, c.user_id
from public.projects p join public.clients c on c.id = p.client_id
where c.user_id is not null limit 1;
SQL
)
[ -n "${PROJ:-}" ] && [ -n "${CLIENT_UID:-}" ] || { echo "SKIP: нет проекта с привязанным заказчиком (clients.user_id)"; exit 0; }
echo "PROJ=$PROJ CLIENT=$CLIENT_UID"

docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
begin;
-- эмулировать заказчика
select set_config('request.jwt.claims', json_build_object('sub','$CLIENT_UID','role','authenticated')::text, true);
select set_config('role','authenticated', true);
-- пишет сообщение в свой проект
select public.post_client_message('$PROJ', 'verify-p2 сообщение заказчика') as posted_id;
-- читает тред (>=1)
select case when count(*) >= 1 then 'MSG_READ_OK' else 'MSG_READ_FAIL' end from public.get_client_messages('$PROJ');
-- files: заказчик видит только client_visible (0 или N, но без падения)
select 'CLIENT_FILES_OK' where (select count(*) from public.get_client_project_files('$PROJ')) >= 0;
rollback;
SQL
echo "CLIENT_P2_OK"
```

- [ ] **Step 3: Коммит**

```bash
git add deploy/client-phase2/apply-migrations.sh deploy/client-phase2/verify-phase2.sh
git commit -m "feat(client-p2): apply + verify скрипты Фазы 2"
```

---

### Task 3: API-обёртки в App.jsx

**Files:**
- Modify: `src/App.jsx` (рядом с `fetchProjectFiles` ~994, стиль существующих)

**Interfaces (Produces):** `fetchClientMessages`, `postClientMessage`, `fetchClientVisibleFiles`, `setFileClientVisible`.

- [ ] **Step 1: Добавить обёртки** — после `deleteProjectFile` (~App.jsx:1035):

```js
// ── Портал заказчика Фаза 2: переписка + client_visible файлы ──
async function fetchClientMessages(client, projectId) {
  const { data, error } = await client.rpc("get_client_messages", { p_project_id: projectId });
  if (error) throw error;
  return data || [];
}
async function postClientMessage(client, projectId, body) {
  const { data, error } = await client.rpc("post_client_message", { p_project_id: projectId, p_body: body });
  if (error) throw error;
  return data; // uuid нового сообщения
}
async function fetchClientVisibleFiles(client, projectId) {
  const { data, error } = await client.rpc("get_client_project_files", { p_project_id: projectId });
  if (error) throw error;
  return data || [];
}
async function setFileClientVisible(client, fileId, visible) {
  const { error } = await client.rpc("set_file_client_visible", { p_file_id: fileId, p_visible: visible });
  if (error) throw error;
}
```

- [ ] **Step 2: Build** — `npm run build` зелёная (обёртки не смонтированы, но валидны).
- [ ] **Step 3: Коммит** — `git commit -am "feat(client-p2): API-обёртки переписки и client-файлов"`.

---

### Task 4: Компонент чата `ClientChat` + монтаж у заказчика (вкладки в модалке)

**Files:**
- Modify: `src/App.jsx` (новый компонент `ClientChat` перед `ClientProjectTasksModal` ~7290; вкладки внутри модалки)

**Interfaces:**
- Consumes: `fetchClientMessages`, `postClientMessage`, `fetchClientVisibleFiles`, `downloadProjectFile`.
- Produces: `ClientChat({ projectId, client, showToast })` — переиспользуется и командой (Task 5).

- [ ] **Step 1: Компонент `ClientChat`** — вставить перед `function ClientProjectTasksModal`:

```jsx
// Переписка заказчик↔команда по проекту. Один компонент для обеих сторон (RPC гейтит доступ).
function ClientChat({ projectId, client, showToast }) {
  const [msgs, setMsgs] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = async () => {
    try { setMsgs(await fetchClientMessages(client, projectId)); }
    catch (e) { showToast("Ошибка переписки: " + (e.message || ""), "error"); setMsgs([]); }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [projectId]);
  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try { await postClientMessage(client, projectId, body); setText(""); await reload(); }
    catch (e) { showToast("Не отправлено: " + (e.message || ""), "error"); }
    finally { setBusy(false); }
  };
  if (msgs === null) return <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: 12 }}>Загрузка…</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflowY: "auto" }}>
        {msgs.length === 0 && <Empty text="Сообщений пока нет" />}
        {msgs.map(m => (
          <div key={m.id} style={{ alignSelf: m.is_mine ? "flex-end" : "flex-start", maxWidth: "80%",
            padding: "8px 12px", borderRadius: 12,
            background: m.is_mine ? "rgba(212,175,55,0.15)" : "rgba(255,255,255,0.04)",
            border: "1px solid " + (m.is_mine ? "rgba(212,175,55,0.28)" : "rgba(255,255,255,0.07)") }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 3 }}>
              {m.author_name} · {new Date(m.created_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </div>
            <div style={{ fontSize: 14, color: "#fafaf7", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <StyledTextarea rows={2} value={text} onChange={e => setText(e.target.value)}
          placeholder="Написать сообщение…" style={{ flex: 1 }} />
        <button className={BTN.primary} disabled={busy || !text.trim()} onClick={send}
          style={{ opacity: busy || !text.trim() ? 0.6 : 1, alignSelf: "flex-end" }}>Отправить</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Компонент `ClientFilesList`** (файлы заказчика) — вставить рядом:

```jsx
// Список client_visible файлов проекта для заказчика — только просмотр/скачивание.
function ClientFilesList({ projectId, client, showToast }) {
  const [files, setFiles] = useState(null);
  const [busyId, setBusyId] = useState(null);
  useEffect(() => {
    let off = false;
    fetchClientVisibleFiles(client, projectId)
      .then(l => { if (!off) setFiles(l); })
      .catch(e => { if (!off) { showToast("Ошибка файлов: " + (e.message || ""), "error"); setFiles([]); } });
    return () => { off = true; };
    /* eslint-disable-next-line */
  }, [projectId]);
  const download = async (f) => {
    setBusyId(f.id);
    try {
      const blob = await downloadProjectFile(client, f.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = f.filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { showToast("Не скачалось: " + (e.message || ""), "error"); }
    finally { setBusyId(null); }
  };
  if (files === null) return <div style={{ color: "var(--text-secondary)", fontSize: 14, padding: 12 }}>Загрузка…</div>;
  if (!files.length) return <Empty text="Файлов для вас пока нет" />;
  const kb = n => (Number(n) || 0) < 1048576 ? Math.round((n||0)/1024) + " КБ" : ((n||0)/1048576).toFixed(1) + " МБ";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {files.map(f => (
        <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 10, background: "#141414", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "#fafaf7", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.filename}</div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{kb(f.file_size)} · {f.uploader_name}</div>
          </div>
          <button className={BTN.ghost} disabled={busyId === f.id} onClick={() => download(f)}
            style={{ opacity: busyId === f.id ? 0.6 : 1 }}>Скачать</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Вкладки в `ClientProjectTasksModal`** — добавить локальный стейт вкладки и переключатель. Заменить `return (<Modal ...>{tasks === null ? ... }</Modal>)` на версию с табами:

Добавить в начало компонента (после `const [busyId, setBusyId] = useState(null);`):
```jsx
  const [tab, setTab] = useState("tasks"); // tasks | messages | files
```
Внутри `<Modal ...>` первым элементом — переключатель, затем контент по `tab`:
```jsx
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["tasks","Задачи"],["messages","Сообщения"],["files","Файлы"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: tab === k ? "rgba(212,175,55,0.15)" : "transparent",
              border: "1px solid " + (tab === k ? "rgba(212,175,55,0.30)" : "rgba(255,255,255,0.10)"),
              color: tab === k ? "#d4af37" : "var(--text-secondary)" }}>{label}</button>
        ))}
      </div>
      {tab === "messages" && <ClientChat projectId={order.id} client={client} showToast={showToast} />}
      {tab === "files" && <ClientFilesList projectId={order.id} client={client} showToast={showToast} />}
      {tab === "tasks" && (
        /* существующий блок tasks===null?… — обернуть сюда без изменений */
      )}
```
(существующий рендер задач переносится в ветку `tab === "tasks"`.)

- [ ] **Step 4: Build** — `npm run build` зелёная.
- [ ] **Step 5: Коммит** — `git commit -am "feat(client-p2): вкладки Задачи/Сообщения/Файлы у заказчика"`.

---

### Task 5: UI команды — секция «Переписка с заказчиком» + галочка client_visible

**Files:**
- Modify: `src/App.jsx` (карточка проекта команды: секция ~после CommentsSection ~2868; `ProjectFiles` ~6338)

**Interfaces (Consumes):** `ClientChat` (Task 4), `setFileClientVisible`, `fetchProjectFiles` (теперь возвращает `client_visible`).

- [ ] **Step 1: Секция переписки** — после блока «Комментарии» (после закрывающего `)}` ~App.jsx:2868) добавить:

```jsx
      {/* ═══ СЕКЦИЯ: Переписка с заказчиком (виден заказчику) ═══ */}
      {initial && initial.id && client && (
        <div style={{ marginBottom: 14, padding: "12px 14px",
          background: "rgba(212,175,55,0.04)", border: "1px solid rgba(212,175,55,0.18)", borderRadius: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600,
            color: "#d4af37", textTransform: "uppercase", letterSpacing: "0.10em", marginBottom: 12 }}>
            <MessageSquare size={12} strokeWidth={2.4} />
            Переписка с заказчиком · видно заказчику
          </div>
          <ClientChat projectId={initial.id} client={client} showToast={showToast} />
        </div>
      )}
```
(золотая рамка визуально отделяет клиентский канал от внутренних «Комментариев».)

- [ ] **Step 2: Галочка в `ProjectFiles`** — в рендере каждого файла добавить тоггл. Найти строку файла в списке `files.map(...)` и добавить рядом с действиями:

```jsx
              <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12,
                color: f.client_visible ? "#d4af37" : "var(--text-tertiary)", cursor: "pointer" }}>
                <input type="checkbox" checked={!!f.client_visible}
                  onChange={async (e) => {
                    try { await setFileClientVisible(client, f.id, e.target.checked); await reload(); }
                    catch (err) { showToast("Не удалось: " + (err.message || ""), "error"); }
                  }} />
                заказчику
              </label>
```
(`reload` и `client`/`showToast` уже в scope `ProjectFiles`; `f.client_visible` приходит из обновлённого `get_project_files`.)

- [ ] **Step 3: Build + тесты** — `npm run build` зелёная; `npx vitest run` (111 passed — lib/ не затронут).
- [ ] **Step 4: Коммит** — `git commit -am "feat(client-p2): переписка и галочка «заказчику» у команды"`.

---

## ФАЗА 3 — уведомления заказчику

### Task 6: Edge web-push-notify — типы client_message / client_new_file / client_stage_changed

**Files:**
- Modify: `deploy/web-push/functions/web-push-notify/index.ts` (новые ветки type перед `return j({ ok: true, note: "unknown type" })`)

**Interfaces:**
- Consumes: существующие `rest`, `baseIds`, `recipients`, `sendToUsers`, `insertInbox`, `projectName`, `projectMembers`, `projectOwner`, `authorized` (гейт из edge-гейта m6).
- Produces: обработка 3 новых типов.

- [ ] **Step 1: Хелпер «привязанный заказчик проекта»** — добавить рядом с `projectOwner`:

```ts
// user_id привязанного заказчика проекта (projects.client_id → clients.user_id)
async function projectClientUser(projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  const r = await rest(`projects?id=eq.${projectId}&select=client_id`);
  const pr = await r.json();
  const cid = Array.isArray(pr) && pr[0] ? pr[0].client_id : null;
  if (!cid) return null;
  const cr = await rest(`clients?id=eq.${cid}&select=user_id`);
  const cc = await cr.json();
  return Array.isArray(cc) && cc[0] ? cc[0].user_id : null;
}
```

- [ ] **Step 2: Ветки типов** — перед финальным `return j({ ok: true, note: "unknown type" })`:

```ts
    // --- переписка с заказчиком (двусторонняя) ---
    if (type === "client_message") {
      const pid = b.projectId as string | undefined;
      if (!pid || !UUID.test(pid)) return j({ error: "valid projectId (uuid) required" }, 400);
      const clientUser = await projectClientUser(pid);
      const fromClient = clientUser && clientUser === initiator; // писал заказчик?
      let base: string[];
      if (fromClient) { // → команде: owner + участники
        const owner = await projectOwner(pid);
        const members = await projectMembers(pid);
        base = baseIds([owner, ...members], initiator);
      } else {          // → заказчику
        base = baseIds([clientUser], initiator);
      }
      const name = (await projectName(pid)) || "проект";
      const body = `💬 Новое сообщение по проекту «${name}»`;
      const url = `/projects/${pid}`;
      await insertInbox(base, { type: "client_message", title: "КЛИМАТ-ПРО", body, url });
      const ids = await recipients(base, undefined, "notif_comment");
      const sent = await sendToUsers(ids, { title: "КЛИМАТ-ПРО", body, url });
      return j({ ok: true, sent, inbox: base.length });
    }

    // --- новый файл, помеченный «для заказчика» → заказчику ---
    if (type === "client_new_file") {
      const pid = b.projectId as string | undefined;
      if (!pid || !UUID.test(pid)) return j({ error: "valid projectId (uuid) required" }, 400);
      const clientUser = await projectClientUser(pid);
      const base = baseIds([clientUser], initiator);
      const name = (await projectName(pid)) || "проект";
      const body = `📎 Новый файл по проекту «${name}»`;
      const url = `/projects/${pid}`;
      await insertInbox(base, { type: "client_new_file", title: "КЛИМАТ-ПРО", body, url });
      const ids = await recipients(base, undefined, "notif_comment");
      const sent = await sendToUsers(ids, { title: "КЛИМАТ-ПРО", body, url });
      return j({ ok: true, sent, inbox: base.length });
    }

    // --- смена стадии проекта → заказчику ---
    if (type === "client_stage_changed") {
      const pid = b.projectId as string | undefined;
      if (!pid || !UUID.test(pid)) return j({ error: "valid projectId (uuid) required" }, 400);
      const clientUser = await projectClientUser(pid);
      const base = baseIds([clientUser], initiator);
      const name = (await projectName(pid)) || "проект";
      const stage = (b.stage as string) || "";
      const body = `📈 Проект «${name}»: стадия ${stage}`;
      const url = `/projects/${pid}`;
      await insertInbox(base, { type: "client_stage_changed", title: "КЛИМАТ-ПРО", body, url });
      const ids = await recipients(base, undefined, "notif_deadline");
      const sent = await sendToUsers(ids, { title: "КЛИМАТ-ПРО", body, url });
      return j({ ok: true, sent, inbox: base.length });
    }
```
(флаги переиспользуем: переписка/файл под `notif_comment`, стадия под `notif_deadline` — отдельный `notif_client_*` не заводим, YAGNI; заказчик регулирует общими флагами.)

- [ ] **Step 3: Коммит** — `git commit -am "feat(client-p3): edge-типы уведомлений заказчику"`.

---

### Task 7: Точки вызова во фронте

**Files:**
- Modify: `src/App.jsx` (`postClientMessage`, `setFileClientVisible` — дёргать push best-effort после успеха)

**Interfaces (Consumes):** существующий `sendPush`-паттерн (`client.functions.invoke("web-push-notify", { body })`).

- [ ] **Step 1: notify после сообщения** — в `postClientMessage` после успешного insert (перед `return data`):

```js
  try {
    await client.functions.invoke("web-push-notify", {
      body: { type: "client_message", projectId, initiatorId: (await client.auth.getUser()).data.user?.id },
    });
  } catch (e) { console.warn("client_message notify failed:", e); }
```

- [ ] **Step 2: notify после пометки файла** — в `setFileClientVisible`, только когда `visible === true`, после успеха:

```js
  if (visible) {
    try {
      const { data: prj } = await client.from("project_files").select("project_id").eq("id", fileId).single();
      if (prj?.project_id) await client.functions.invoke("web-push-notify", {
        body: { type: "client_new_file", projectId: prj.project_id, initiatorId: (await client.auth.getUser()).data.user?.id },
      });
    } catch (e) { console.warn("client_new_file notify failed:", e); }
  }
```
(смена стадии `client_stage_changed` — точка вызова там, где фронт меняет `projects.stage`; если единой такой точки нет — отложить в follow-up, НЕ выдумывать место. Отметить в STATUS.)

- [ ] **Step 3: Build** — `npm run build` зелёная.
- [ ] **Step 4: Коммит** — `git commit -am "feat(client-p3): точки вызова push из фронта"`.

---

### Task 8: Деплой Фазы 3 + верификация (по «го»)

- [ ] **Step 1:** Edge-деплой — `wsl -u root bash ".../deploy/web-push/deploy-edge-function.sh"` → `deployed web-push-notify`. (config.json с pushSecret на хосте уже есть — не перезаписывается.)
- [ ] **Step 2:** Гейт цел после редеплоя — `wsl -u root bash ".../deploy/web-push/verify-secret-gate.sh"` → `PUSH_GATE_OK`.
- [ ] **Step 3:** Дым новых типов — POST с `X-Push-Secret` и `{"type":"client_message","projectId":"<uuid реального проекта с заказчиком>"}` → 200 `{ok:true}`; проверить строку в `notifications` у заказчика (затем удалить тестовую).

---

### Task 9: Финал

- [ ] **Step 1: Ревью** — прогнать код-ревью диффа ветки (skill code-review); блокеры — fix-forward.
- [ ] **Step 2: Живой apply Фазы 2** (по «го») — `deploy/client-phase2/apply-migrations.sh` → `MIGRATIONS_DONE`; `verify-phase2.sh` → `CLIENT_P2_OK`.
- [ ] **Step 3: Деплой фронта** (по «го») — `npm run build` (Windows) → `bash deploy/nextcloud/deploy-web.sh` (WSL); сверить asset снаружи.
- [ ] **Step 4: STATUS.md** — Фазы 2-3 → «Готово» (что применено/задеплоено, verify-маркеры); дата. `client_stage_changed` точка вызова — если отложена, зафиксировать в «Дальше».
- [ ] **Step 5: merge + push** — merge ветки в main (по «го»); `git push origin main` (авто; сеть — оба варианта).

## Self-Review
**1. Spec coverage:** client_messages+RLS (T1) ✓; client_visible+files_select (T1) ✓; 4 RPC + аддитив get_project_files (T1) ✓; edge не трогаем на download — верификация РLS вместо edge (T2 verify) ✓; вкладки заказчика (T4) ✓; секция+галочка команды (T5) ✓; уведомления 3 типов (T6) + точки вызова (T7) ✓; верификация БД (T2) + деплой-гейты (T8-9) ✓.
**2. Placeholder scan:** код полный. Единственная явная развилка — точка вызова `client_stage_changed` (T7 Step 2): указано НЕ выдумывать место, отложить в follow-up если единой точки смены стадии нет — это честная неопределённость кода, не плейсхолдер.
**3. Type consistency:** RPC-имена и сигнатуры едины (T1 определяет ↔ T3 обёртки вызывают ↔ T4/T5 UI); `ClientChat({projectId,client,showToast})` одинаков у заказчика (T4) и команды (T5); edge-типы `client_message/client_new_file/client_stage_changed` совпадают (T6 обработка ↔ T7 вызов); `get_project_files` +`client_visible` согласован (T1 возвращает ↔ T5 галочка читает).
