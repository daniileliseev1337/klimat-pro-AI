# Notification Center (in-app inbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать durable in-app ленту уведомлений (колокольчик + badge непрочитанных + Realtime), которая дополняет эфемерный Web Push — пропущенный системный push остаётся следом в приложении.

**Architecture:** Таблица `public.notifications` (RLS: читать/отмечать только свои; insert только service_role) в Realtime-публикации. Edge-функция `web-push-notify` рефакторится по подходу A: для каждого события считает базовый список получателей **без** флаг-фильтра → батч-INSERT строк inbox всем (durable), затем как и раньше фильтрует по `notif_*` и шлёт push. Фронт: модуль `src/lib/notifications.js` + компонент `src/components/NotificationBell.jsx` (dropdown-панель, Realtime-подписка) в top-bar. Retention — pg_cron: чистит только прочитанные старше 7 дней.

**Tech Stack:** React 18 + Vite 5 (без JS-тест-раннера — верификация сборкой/psql/curl/E2E), self-hosted Supabase (PG17, PostgREST, Realtime, edge-runtime/Deno, kong), pg_cron/pg_net, @supabase/supabase-js, framer-motion, lucide-react.

**Спек:** `docs/superpowers/specs/2026-06-06-notification-center-design.md`.

**Грабли среды (из памяти проекта):** git ТОЛЬКО с Windows-стороны (`git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=*`); push с обходом прокси (`$env:HTTPS_PROXY=""` + `git -c http.proxy=""`); НЕ делать `wsl --shutdown` без перезапуска VBS-держателя (иначе прод 502); сложный bash в WSL — через файл-скрипт в `\\wsl.localhost\Ubuntu\root\` (ASCII-путь запуска), не inline (Cyrillic-путь `Сайт` бьёт кодировку); edge/БД — `docker exec` в WSL. Контейнер БД — `supabase-db`, src `/srv/supabase-src/docker`, REST `http://localhost:8000/rest/v1`, секреты в `$SUPA/.env`.

---

## Файловая структура

**Создаются:**
- `supabase/migrations/20260606_0004_notifications.sql` — таблица + RLS + Realtime.
- `supabase/migrations/20260606_0005_pg_cron_notifications_prune.sql` — cron-прунинг (read > 7 дней).
- `deploy/web-push/verify-notifications-rls.sh` — проверка RLS notifications под двумя юзерами.
- `src/lib/notifications.js` — фронт-модуль (fetch/count/markRead/markAllRead/subscribe).
- `src/components/NotificationBell.jsx` — колокольчик + badge + dropdown-лента + Realtime.

**Модифицируются:**
- `deploy/web-push/functions/web-push-notify/index.ts` — рефактор: base-список + `insertInbox`, во всех 8 ветках + deadline.
- `src/App.jsx` — импорт и вставка `<NotificationBell>` в top-bar (перед кнопкой «Отчёт»), хелпер навигации.

**Без изменений (переиспользуем):** `deploy/web-push/deploy-edge-function.sh` (редеплой edge), `deploy/nextcloud/deploy-web.sh` (деплой фронта), `src/lib/supabase.js`, `src/lib/push.js` (образец стиля модуля).

---

## Фаза 1 — БД: таблица, RLS, Realtime, retention

### Task 1: Миграция notifications (таблица + RLS + Realtime)

**Files:**
- Create: `supabase/migrations/20260606_0004_notifications.sql`

- [ ] **Step 1: Написать миграцию**

```sql
-- Центр уведомлений: durable in-app inbox, дополняет Web Push.
-- Строки пишет edge web-push-notify через service_role (обходит RLS);
-- клиентам INSERT не разрешён (нет insert-политики) — нельзя подделать уведомление.
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,                 -- task_assigned | task_status | task_created
                                            -- | deadline | project_taken | team_invite
                                            -- | comment | project_published
  title      text not null,
  body       text not null,
  url        text not null default '/',
  read       boolean not null default false,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read, created_at desc);

alter table public.notifications enable row level security;

-- читать только свои
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid());

-- помечать прочитанным только свои (insert/delete клиентам не даём)
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Realtime (idempotent guard — повторное применение не упадёт)
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
```

- [ ] **Step 2: Применить к живой БД**

Записать скрипт `\\wsl.localhost\Ubuntu\root\apply-notif-0004.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < /mnt/f/Сайт/redesign-v2-fresh/supabase/migrations/20260606_0004_notifications.sql
echo "MIG_0004_DONE"
```
Run (PowerShell): `wsl -d Ubuntu -u root -- bash /root/apply-notif-0004.sh`
Expected: `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, 2×`CREATE POLICY`, `DO`, `MIG_0004_DONE`.

- [ ] **Step 3: Проверить структуру и RLS-флаг**

Run: `wsl -d Ubuntu -u root -- docker exec supabase-db psql -U postgres -d postgres -c "\d public.notifications"`
Expected: колонки id/user_id/type/title/body/url/read/read_at/created_at; индекс `notifications_user_unread_idx`; `Row security: enabled` (политики notifications_select_own, notifications_update_own).

Run: `wsl -d Ubuntu -u root -- docker exec supabase-db psql -U postgres -d postgres -c "select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='notifications'"`
Expected: одна строка `notifications`.

- [ ] **Step 4: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* add supabase/migrations/20260606_0004_notifications.sql
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* commit -m "feat(inbox): таблица notifications + RLS + Realtime"
```

---

### Task 2: verify-notifications-rls.sh

**Files:**
- Create: `deploy/web-push/verify-notifications-rls.sh`

- [ ] **Step 1: Написать проверку** (по образцу `deploy/web-push/verify-rls.sh`)

```bash
#!/usr/bin/env bash
# Проверка RLS notifications под двумя реальными пользователями.
# Механика JWT — как в deploy/web-push/verify-rls.sh (HS256, секреты из .env).
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
$(docker exec -i supabase-db psql -U postgres -d postgres -At -F' ' -c "SELECT id FROM public.profiles WHERE approved=true ORDER BY created_at LIMIT 2;" | tr '\n' ' ')
EOF
echo "A=$A B=$B"
[ -n "$A" ] && [ -n "$B" ] || { echo "NEED_TWO_APPROVED_USERS"; exit 1; }
JA="$(sign "$A")"; JB="$(sign "$B")"

# тестовая строка для A — вставляем как postgres (service role обходит RLS; клиенту insert запрещён)
NID=$(docker exec -i supabase-db psql -U postgres -d postgres -At -c \
  "insert into public.notifications(user_id,type,title,body,url) values ('$A','selftest','КЛИМАТ-ПРО','selftest inbox','/') returning id;")
echo "NID=$NID"

echo "== B читает уведомление A (ожидаем []) =="
SEEN=$(curl -s "$REST/notifications?id=eq.$NID&select=id" -H "apikey: $ANON" -H "Authorization: Bearer $JB")
echo "B видит: $SEEN"

echo "== A видит своё (ожидаем id) =="
OWN=$(curl -s "$REST/notifications?id=eq.$NID&select=id" -H "apikey: $ANON" -H "Authorization: Bearer $JA")
echo "A видит: $OWN"

echo "== клиент (A) пытается INSERT (ожидаем 4xx — insert-политики нет) =="
INS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$REST/notifications" -H "apikey: $ANON" -H "Authorization: Bearer $JA" \
  -H "Content-Type: application/json" -d "{\"user_id\":\"$A\",\"type\":\"hack\",\"title\":\"x\",\"body\":\"y\"}")
echo "A insert: HTTP $INS"

echo "== B пытается отметить строку A прочитанной (ожидаем []: 0 изменённых) =="
BPATCH=$(curl -s -X PATCH "$REST/notifications?id=eq.$NID" -H "apikey: $ANON" -H "Authorization: Bearer $JB" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"read":true}')
echo "B patch вернул: $BPATCH"

echo "== A отмечает своё прочитанным (ожидаем read:true) =="
APATCH=$(curl -s -X PATCH "$REST/notifications?id=eq.$NID" -H "apikey: $ANON" -H "Authorization: Bearer $JA" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"read":true}')
echo "A patch вернул: $APATCH"

echo "== cleanup =="
docker exec -i supabase-db psql -U postgres -d postgres -c "delete from public.notifications where id='$NID';" >/dev/null

[ "$SEEN" = "[]" ] && echo "$OWN" | grep -q "$NID" && [ "${INS:0:1}" = "4" ] \
  && [ "$BPATCH" = "[]" ] && echo "$APATCH" | grep -q '"read":true' \
  && echo "RLS_OK" || { echo "RLS_FAIL SEEN=$SEEN OWN=$OWN INS=$INS BPATCH=$BPATCH APATCH=$APATCH"; exit 1; }
```

- [ ] **Step 2: Запустить**

Run: `wsl -d Ubuntu -u root -- bash /mnt/f/Сайт/redesign-v2-fresh/deploy/web-push/verify-notifications-rls.sh`
Expected: последняя строка `RLS_OK`. (Требует ≥2 approved-пользователей; иначе `NEED_TWO_APPROVED_USERS`.)

- [ ] **Step 3: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* add deploy/web-push/verify-notifications-rls.sh
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* commit -m "test(inbox): verify-rls для notifications"
```

---

### Task 3: Миграция retention-cron (прунинг read > 7 дней)

**Files:**
- Create: `supabase/migrations/20260606_0005_pg_cron_notifications_prune.sql`

- [ ] **Step 1: Написать миграцию**

```sql
-- Retention Центра уведомлений: чистим ТОЛЬКО прочитанные старше 7 дней.
-- Непрочитанные сохраняются бессрочно (страховка от эфемерности push).
-- pg_cron/pg_net уже включены миграцией 20260606_0003_pg_cron_deadline.sql.
select cron.unschedule('notifications-prune')
  where exists (select 1 from cron.job where jobname = 'notifications-prune');

select cron.schedule(
  'notifications-prune',
  '30 3 * * *',  -- ежедневно 03:30
  $$ delete from public.notifications
     where read = true and created_at < now() - interval '7 days' $$
);
```

- [ ] **Step 2: Применить**

Записать скрипт `\\wsl.localhost\Ubuntu\root\apply-notif-0005.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < /mnt/f/Сайт/redesign-v2-fresh/supabase/migrations/20260606_0005_pg_cron_notifications_prune.sql
echo "MIG_0005_DONE"
```
Run: `wsl -d Ubuntu -u root -- bash /root/apply-notif-0005.sh`
Expected: вывод `schedule` (bigint job id) и `MIG_0005_DONE` (без ошибок).

- [ ] **Step 3: Проверить регистрацию job**

Run: `wsl -d Ubuntu -u root -- docker exec supabase-db psql -U postgres -d postgres -c "select jobname, schedule from cron.job where jobname='notifications-prune'"`
Expected: одна строка `notifications-prune | 30 3 * * *`.

- [ ] **Step 4: Проверить логику прунинга вручную (read удаляется, unread выживает)**

Записать скрипт `\\wsl.localhost\Ubuntu\root\test-prune.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -At"
UID=$($PSQL -c "select id from public.profiles where approved=true order by created_at limit 1;")
# read старше 7 дней — должна удалиться; unread старше 7 дней — должна выжить
$PSQL -c "insert into public.notifications(user_id,type,title,body,url,read,created_at) values
  ('$UID','selftest','К','old-read','/',true, now() - interval '8 days'),
  ('$UID','selftest','К','old-unread','/',false, now() - interval '8 days');"
# выполнить тело прунинга вручную
$PSQL -c "delete from public.notifications where read = true and created_at < now() - interval '7 days';"
LEFT=$($PSQL -c "select string_agg(body, ',') from public.notifications where type='selftest' and user_id='$UID';")
echo "осталось: $LEFT (ожидаем old-unread)"
# cleanup
$PSQL -c "delete from public.notifications where type='selftest' and user_id='$UID';" >/dev/null
[ "$LEFT" = "old-unread" ] && echo "PRUNE_OK" || { echo "PRUNE_FAIL: $LEFT"; exit 1; }
```
Run: `wsl -d Ubuntu -u root -- bash /root/test-prune.sh`
Expected: `осталось: old-unread`, затем `PRUNE_OK`.

- [ ] **Step 5: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* add supabase/migrations/20260606_0005_pg_cron_notifications_prune.sql
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* commit -m "feat(inbox): pg_cron прунинг прочитанных > 7 дней"
```

---

## Фаза 2 — Edge: inline-INSERT строк inbox (подход A)

### Task 4: Рефактор web-push-notify (base-список + insertInbox)

**Files:**
- Modify: `deploy/web-push/functions/web-push-notify/index.ts`

Принцип: добавить хелперы `baseIds`/`baseApproved`/`insertInbox`; `recipients()` и `broadcastApproved()` остаются (push-фильтр). В каждой ветке: вычислить base (без флага) → `insertInbox(base, ...)` → push-подмножество через `recipients(base, undefined, flag)` → `sendToUsers`. Текст (`body`) и `url` вычисляются один раз и идут И в inbox, И в push.

- [ ] **Step 1: Добавить хелперы** — вставить ПОСЛЕ функции `broadcastApproved` (после строки 53), перед `projectMembers`:

```ts
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
```

- [ ] **Step 2: Переписать ветку task-событий** — заменить строки 108-129 на:

```ts
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
```

- [ ] **Step 3: Переписать ветку deadline** — заменить строки 132-147 на:

```ts
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
```

- [ ] **Step 4: Переписать ветку project_taken/team_invite** — заменить строки 150-156 на:

```ts
    if (type === "project_taken" || type === "team_invite") {
      const flag = type === "project_taken" ? "notif_project_taken" : "notif_team_invite";
      const base = baseIds([b.recipientId as string], initiator);
      const body = type === "project_taken" ? "✅ Ваш проект взят в работу" : "👥 Вас пригласили в команду проекта";
      await insertInbox(base, { type, title: "КЛИМАТ-ПРО", body, url: "/" });
      const ids = await recipients(base, undefined, flag);
      const sent = await sendToUsers(ids, { title: "КЛИМАТ-ПРО", body, url: "/" });
      return j({ ok: true, sent, inbox: base.length });
    }
```

- [ ] **Step 5: Переписать ветку comment** — заменить строки 159-168 на:

```ts
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
```

- [ ] **Step 6: Переписать ветку project_published** — заменить строки 171-175 на:

```ts
    if (type === "project_published") {
      const base = await baseApproved(b.ownerId as string);
      const body = "🆕 Новый проект в поиске исполнителя";
      await insertInbox(base, { type: "project_published", title: "КЛИМАТ-ПРО", body, url: "/" });
      const ids = await recipients(base, undefined, "notif_new_project");
      const sent = await sendToUsers(ids, { title: "КЛИМАТ-ПРО", body, url: "/" });
      return j({ ok: true, sent, inbox: base.length });
    }
```

- [ ] **Step 7: Локальная проверка типов (Deno, опционально но желательно)**

Run: `wsl -d Ubuntu -u root -- bash -lc "cd /mnt/f/Сайт/redesign-v2-fresh/deploy/web-push/functions/web-push-notify && deno check index.ts"`
Expected: без ошибок типов. (Если `config.json` отсутствует локально и `deno check` ругается на импорт — пропустить шаг, тип-проверка будет покрыта smoke-тестом после деплоя в Task 5.)

- [ ] **Step 8: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* add deploy/web-push/functions/web-push-notify/index.ts
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* commit -m "feat(inbox): edge пишет durable-строки notifications во всех ветках (подход A)"
```

---

### Task 5: Редеплой edge + smoke + функциональная проверка inbox

**Files:** (без новых; используем `deploy/web-push/deploy-edge-function.sh`)

- [ ] **Step 1: Редеплой edge**

Run: `wsl -d Ubuntu -u root -- bash /mnt/f/Сайт/redesign-v2-fresh/deploy/web-push/deploy-edge-function.sh`
Expected: `deployed web-push-notify`; edge-runtime healthy. (config.json уже на сервере с прошлой фичи — скрипт его не трогает.)

- [ ] **Step 2: Smoke — функция стартовала**

Run: `wsl -d Ubuntu -u root -- docker exec supabase-kong curl -s -X POST http://localhost:8000/functions/v1/web-push-notify -H "Content-Type: application/json" -d '{"type":"unknown"}'`
Expected: `{"ok":true,"note":"unknown type"}` (первый запрос после restart может дать WorkerRequestCancelled — повторить). Подтверждает, что рефакторенный модуль импортировался без синтаксических/типовых ошибок.

- [ ] **Step 3: Функциональная проверка — inbox ловит всех, push фильтрует по флагу**

Записать скрипт `\\wsl.localhost\Ubuntu\root\test-inbox-insert.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -At"
# берём реальную задачу с author_id и assigned_to (разные люди), назначаем notif_task=false назначенному
TASK=$($PSQL -c "select id from public.project_tasks where assigned_to is not null and author_id is not null and assigned_to <> author_id limit 1;")
[ -n "$TASK" ] || { echo "NO_SUITABLE_TASK (нужна задача с разными author/assignee)"; exit 1; }
ASG=$($PSQL -c "select assigned_to from public.project_tasks where id='$TASK';")
echo "TASK=$TASK ASG=$ASG"
# запомним сколько строк inbox у назначенного было до
BEFORE=$($PSQL -c "select count(*) from public.notifications where user_id='$ASG' and type='task_assigned';")
# временно выключим push-флаг назначенному (inbox всё равно должен записаться)
$PSQL -c "update public.profiles set notif_task=false where id='$ASG';" >/dev/null
# вызвать edge: task_assigned, без initiator
docker exec supabase-kong curl -s -X POST http://localhost:8000/functions/v1/web-push-notify \
  -H "Content-Type: application/json" -d "{\"type\":\"task_assigned\",\"taskId\":\"$TASK\"}" ; echo
AFTER=$($PSQL -c "select count(*) from public.notifications where user_id='$ASG' and type='task_assigned';")
echo "inbox назначенного: было $BEFORE, стало $AFTER (ожидаем +1 несмотря на notif_task=false)"
# вернуть флаг и почистить тестовую строку
$PSQL -c "update public.profiles set notif_task=true where id='$ASG';" >/dev/null
$PSQL -c "delete from public.notifications where user_id='$ASG' and type='task_assigned' and created_at > now() - interval '2 minutes';" >/dev/null
[ "$AFTER" -gt "$BEFORE" ] && echo "INBOX_INSERT_OK" || { echo "INBOX_INSERT_FAIL"; exit 1; }
```
Run: `wsl -d Ubuntu -u root -- bash /root/test-inbox-insert.sh`
Expected: `inbox назначенного: было N, стало N+1`, затем `INBOX_INSERT_OK` — подтверждает, что строка inbox пишется даже при выключенном push-флаге (inbox ловит всё, push фильтрует).

- [ ] **Step 4: Commit** (изменений в файлах нет; деплой-артефакт. Если правился deploy-скрипт — закоммитить, иначе шаг пропустить.)

---

## Фаза 3 — Фронт: модуль + компонент + интеграция

### Task 6: Фронт-модуль notifications.js

**Files:**
- Create: `src/lib/notifications.js`

Стиль — как `src/lib/push.js` (без `;`, одинарные кавычки, `client` передаётся параметром).

- [ ] **Step 1: Написать модуль**

```js
// Центр уведомлений: чтение/отметка прочитанным + Realtime-подписка.
// RLS отдаёт только свои строки (select по auth.uid()), поэтому фильтр по user_id
// в запросах не обязателен; для Realtime-канала фильтруем по user_id ради трафика.

export async function fetchNotifications(client, limit = 30) {
  const { data, error } = await client
    .from('notifications')
    .select('id, type, title, body, url, read, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function getUnreadCount(client) {
  const { count, error } = await client
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('read', false)
  if (error) throw error
  return count || 0
}

export async function markRead(client, id) {
  const { error } = await client
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function markAllRead(client) {
  const { error } = await client
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('read', false)
  if (error) throw error
}

// Realtime: INSERT (новое уведомление) и UPDATE (read-синхронизация между устройствами).
// Возвращает cleanup-функцию (removeChannel).
export function subscribeNotifications(client, userId, { onInsert, onUpdate }) {
  const channel = client
    .channel('notifications')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => { if (onInsert) onInsert(payload.new) })
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => { if (onUpdate) onUpdate(payload.new) })
    .subscribe()
  return () => { client.removeChannel(channel) }
}
```

- [ ] **Step 2: Проверить сборку (битые импорты ловит build)**

Run (PowerShell): `Set-Location "F:\Сайт\redesign-v2-fresh"; npm run build`
Expected: `✓ built` без ошибок (модуль ещё не импортируется — проверка, что файл валиден синтаксически).

- [ ] **Step 3: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* add src/lib/notifications.js
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* commit -m "feat(inbox): фронт-модуль notifications.js (fetch/count/markRead/subscribe)"
```

---

### Task 7: Компонент NotificationBell.jsx

**Files:**
- Create: `src/components/NotificationBell.jsx`

Стиль — как `App.jsx` (с `;`, двойные кавычки, inline-стили, framer-motion). Тёмная тема: фон панели `#101012`, бордюр `rgba(255,255,255,0.10)`, золото `#e8c860`, текст `#f7f8f8`/`#9b9ca4`, опасность-бейдж `#f8a3a3`/`#ef4444`.

- [ ] **Step 1: Написать компонент**

```jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { Bell } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  fetchNotifications, getUnreadCount, markRead, markAllRead, subscribeNotifications,
} from "../lib/notifications";

// относительное время «N мин/ч/дн назад»
function timeAgo(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "только что";
  const m = Math.floor(s / 60); if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24); return `${d} дн назад`;
}

export default function NotificationBell({ client, userId, onNavigate, showToast }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef(null);

  const refreshCount = useCallback(async () => {
    try { setUnread(await getUnreadCount(client)); } catch (e) { /* бейдж не критичен */ }
  }, [client]);

  const loadList = useCallback(async () => {
    try { setItems(await fetchNotifications(client)); }
    catch (e) { if (showToast) showToast("Не удалось загрузить уведомления", "error"); }
  }, [client, showToast]);

  // первичный счётчик + Realtime (INSERT/UPDATE)
  useEffect(() => {
    if (!userId) return;
    refreshCount();
    const unsub = subscribeNotifications(client, userId, {
      onInsert: (row) => {
        setItems((prev) => [row, ...prev].slice(0, 50));
        setUnread((n) => n + 1);
      },
      onUpdate: (row) => {
        setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, ...row } : it)));
        refreshCount();
      },
    });
    return unsub;
  }, [client, userId, refreshCount]);

  // открытие панели → подгрузить ленту (refetch также чинит пропуски после reconnect)
  useEffect(() => { if (open) loadList(); }, [open, loadList]);

  // клик вне → закрыть
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const onItemClick = async (it) => {
    if (!it.read) {
      setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, read: true } : x)));
      setUnread((n) => Math.max(0, n - 1));
      try { await markRead(client, it.id); } catch (e) { /* не блокируем навигацию */ }
    }
    setOpen(false);
    if (it.url && it.url !== "/" && onNavigate) onNavigate(it.url);
  };

  const onMarkAll = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    try { await markAllRead(client); }
    catch (e) { if (showToast) showToast("Не удалось отметить всё", "error"); refreshCount(); }
  };

  const btnStyle = {
    position: "relative", fontSize: 12, padding: "6px 10px", borderRadius: 8, cursor: "pointer",
    fontWeight: 500, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)",
    color: "#9b9ca4", display: "flex", alignItems: "center", gap: 6, transition: "all 0.18s", fontFamily: "inherit",
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={btnStyle}
        title="Уведомления"
        onMouseOver={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
        onMouseOut={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
      >
        <Bell size={13} strokeWidth={2.2} />
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -5, right: -5, minWidth: 16, height: 16, padding: "0 4px",
            borderRadius: 8, background: "#ef4444", color: "#fff", fontSize: 10, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
          }}>{unread > 99 ? "99+" : unread}</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.15 }}
            style={{
              position: "absolute", right: 0, top: "calc(100% + 8px)", width: 360, maxHeight: 460,
              overflowY: "auto", zIndex: 80, background: "#101012",
              border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12,
              boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)",
              position: "sticky", top: 0, background: "#101012",
            }}>
              <span style={{ color: "#f7f8f8", fontWeight: 600, fontSize: 14 }}>Уведомления</span>
              <button
                onClick={onMarkAll}
                disabled={unread === 0}
                style={{
                  fontSize: 11, padding: "4px 8px", borderRadius: 6, fontFamily: "inherit",
                  cursor: unread === 0 ? "default" : "pointer",
                  background: "transparent", border: "1px solid rgba(212,175,55,0.30)",
                  color: unread === 0 ? "#62646b" : "#e8c860",
                }}
              >Прочитать всё</button>
            </div>

            {items.length === 0 ? (
              <div style={{ padding: "28px 14px", textAlign: "center", color: "#62646b", fontSize: 13 }}>
                Нет уведомлений
              </div>
            ) : (
              items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => onItemClick(it)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "11px 14px",
                    background: it.read ? "transparent" : "rgba(212,175,55,0.06)",
                    border: "none", borderBottom: "1px solid rgba(255,255,255,0.05)",
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    {!it.read && <span style={{
                      marginTop: 5, width: 7, height: 7, borderRadius: 4, background: "#e8c860", flexShrink: 0,
                    }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        color: it.read ? "#b6b8bf" : "#f7f8f8", fontSize: 13,
                        fontWeight: it.read ? 400 : 600, lineHeight: 1.35,
                      }}>{it.body}</div>
                      <div style={{ color: "#62646b", fontSize: 11, marginTop: 3 }}>{timeAgo(it.created_at)}</div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 2: Проверить сборку**

Run (PowerShell): `Set-Location "F:\Сайт\redesign-v2-fresh"; npm run build`
Expected: `✓ built` (компонент ещё не используется — проверяем валидность JSX/импортов).

- [ ] **Step 3: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* add src/components/NotificationBell.jsx
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* commit -m "feat(inbox): компонент NotificationBell (dropdown + badge + Realtime)"
```

---

### Task 8: Интеграция в App.jsx (top-bar)

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Импорт компонента** — добавить после строки 4 (`import { isPushSupported, ... } from "./lib/push";`):

```jsx
import NotificationBell from "./components/NotificationBell";
```

- [ ] **Step 2: Вставить колокольчик в top-bar** — внутри `<div>` на строке 6983, ПЕРЕД комментарием `{/* Кнопка отчёта ... */}` (перед строкой 6984), добавить:

```jsx
            {/* Колокольчик Центра уведомлений */}
            <NotificationBell
              client={supabase}
              userId={profile?.id}
              showToast={showToast}
              onNavigate={(url) => { if (url && url.startsWith("/tasks")) setTab("tasks"); }}
            />
```

Примечание: `onNavigate` сейчас почти всегда no-op (все `url` в edge = `"/"`); оставлен как точка расширения для deep-link на конкретный объект (forward-compat из спека).

- [ ] **Step 3: Проверить сборку**

Run (PowerShell): `Set-Location "F:\Сайт\redesign-v2-fresh"; npm run build`
Expected: `✓ built` без ошибок; в бандле появляется код NotificationBell (импорт связан).

- [ ] **Step 4: Локальный визуальный smoke (dev)**

Run (PowerShell): `Set-Location "F:\Сайт\redesign-v2-fresh"; npm run dev`
Открыть локальный URL, войти под approved-пользователем. Expected: в правой части top-bar перед «Отчёт» виден колокольчик; клик открывает тёмную панель «Уведомления» (пустую или с лентой); клик вне — закрывает. Остановить dev (Ctrl+C).

- [ ] **Step 5: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* add src/App.jsx
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* commit -m "feat(inbox): NotificationBell в top-bar App.jsx"
```

---

## Фаза 4 — Деплой и E2E-приёмка

### Task 9: Деплой фронта + E2E + merge

- [ ] **Step 1: Деплой фронта**

Run (PowerShell): `Set-Location "F:\Сайт\redesign-v2-fresh"; npm run build`
Run: `wsl -d Ubuntu -u root -- bash /mnt/f/Сайт/redesign-v2-fresh/deploy/nextcloud/deploy-web.sh`
Expected: `DEPLOYED`; прод отдаёт новый ассет (curl 200 на index).

- [ ] **Step 2: E2E — Realtime badge**

На проде: войти под пользователем A (с подпиской/без — неважно для inbox). Со второго аккаунта B спровоцировать событие, адресованное A (например, назначить A задачу). Expected: badge на колокольчике у A увеличивается **без перезагрузки** (Realtime INSERT); в панели появляется новая строка сверху.

- [ ] **Step 3: E2E — отметка прочитанным**

Кликнуть по непрочитанному уведомлению. Expected: строка теряет подсветку/точку, badge уменьшается на 1. Нажать «Прочитать всё» при наличии непрочитанных. Expected: badge → 0, все строки серые.

- [ ] **Step 4: E2E — durable (переживает перезагрузку) + кросс-девайс**

Перезагрузить страницу A. Expected: лента и текущий badge сохранились (в отличие от эфемерного push — это ключевая проверка). Открыть A на втором устройстве/вкладке. Expected: пометка прочитанным на одном устройстве отражается на другом (Realtime UPDATE → refreshCount).

- [ ] **Step 5: E2E — inbox ловит при выключенном push-флаге**

У A выключить соответствующий `notif_*` (push), оставить включённым. Спровоцировать событие. Expected: системный push НЕ приходит, но строка в Центре уведомлений появляется (badge растёт) — подтверждает «inbox ловит всё, флаги только для push».

- [ ] **Step 6: Финальный commit + merge в main**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* add -A
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* commit -m "feat(inbox): Центр уведомлений — приёмка пройдена"
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* checkout main
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* merge --no-ff feature/notification-center -m "Merge feature/notification-center: Центр уведомлений (in-app inbox)"
```
Push (обход прокси):
```
$env:HTTPS_PROXY=""; $env:HTTP_PROXY=""
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* -c http.proxy="" push origin main
```

---

## Замечания по верификации (TDD-адаптация)

В репо нет JS-тест-раннера (только `dev`/`build`/`preview`) — браузерные/Realtime/SW API не покрываются юнит-тестами. Верификация — проверяемыми наблюдаемыми результатами на каждом шаге: `npm run build` (ловит битые импорты/JSX), psql-проверки структуры (`\d`, `cron.job`, `pg_publication_tables`), `verify-notifications-rls.sh` → `RLS_OK`, `test-prune.sh` → `PRUNE_OK`, `test-inbox-insert.sh` → `INBOX_INSERT_OK`, smoke edge (200 + рефактор импортируется), и ручной E2E на реальных устройствах (Realtime, durable, кросс-девайс). Каждый Task завершается явной проверкой перед commit.

## Покрытие спека (self-review)

- §1 Таблица notifications → Task 1. `type` (для иконки), без `related_id` → схема Task 1.
- §2 RLS (select/update own, insert только service_role) + Realtime → Task 1 + Task 2 (verify).
- §3 Edge подход A (base без флага → insertInbox → push-подмножество) во всех 8 ветках + deadline → Task 4, проверка Task 5.
- §4 Фронт: модуль (fetch/count/markRead/markAllRead/subscribe) → Task 6; компонент (dropdown, badge, Realtime, mark-read, mark-all, пустое состояние, клик-вне) → Task 7; интеграция top-bar + навигация → Task 8.
- §5 Retention (только read > 7 дней, unread бессрочно) → Task 3 (+ test-prune).
- §6 Обработка ошибок: edge — insert логируется, не блокирует push (insertInbox try/catch, Task 4); фронт — Toast при сбоях, refetch при открытии (Task 7).
- Критерии верификации спека → verify-скрипты + E2E (Tasks 2/3/5/9).
