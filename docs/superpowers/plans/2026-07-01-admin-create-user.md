# Admin создаёт пользователя — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать админу форму «создать пользователя» (email+пароль+имя+роль, сразу approved) и выдавать логин/пароль.

**Architecture:** Edge Function `admin-create-user` проверяет, что вызывающий — админ (под его JWT), создаёт auth-аккаунт через GoTrue admin API (service_role), затем RPC `admin_finalize_new_user` (is_admin-гейт, под JWT админа) ставит approved+роль+имя+аудит. UI — форма в AdminPage. Спека: `docs/superpowers/specs/2026-07-01-admin-create-user-design.md`.

**Tech Stack:** React+Vite (`src/App.jsx`), self-hosted Supabase (Postgres RPC, GoTrue, Deno Edge Functions), vitest.

## Global Constraints

- **Гейт `is_admin()` дважды**: в Edge Function (под JWT вызывающего, ДО создания в GoTrue) и в RPC `admin_finalize_new_user`.
- **Пароль ≥8**, задаётся админом вручную; НИКОГДА не логировать/не возвращать; аудит без пароля.
- **Роль ровно одна**: `client` | `employee`. Новый юзер `approved=true`, `email_confirm=true`.
- **service_role** — только внутри edge-runtime (env `SUPABASE_SERVICE_ROLE_KEY`), не на фронт.
- Все новые RPC: `security definer ... set search_path = public, pg_temp` + `grant execute ... to authenticated`.
- Edge-функция по образцу `deploy/web-push`/`deploy/nextcloud`: env `SUPABASE_URL`(=http://kong:8000)/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY`; CORS+json helper; `getUserId` из JWT; `rest()` под нужным токеном.
- **Гейт владельца**: apply миграции к живой БД, deploy edge-функции, прогон verify, деплой фронта — только по явному «го». Субагенты пишут файлы; живую БД/деплой трогает контроллер после «го».
- **Среда**: git на F: — `-c core.fsyncMethod=writeout-only` + ретрай. WSL/psql/скрипты — файлом через `Get-Content -Raw | wsl bash -c 'tr -d "\r" > /tmp/x; …'` (drvfs-глоб+кириллица нестабильны, CRLF ломает bash). Ветка: `feature/admin-create-user`.

---

### Task 1: RPC `admin_finalize_new_user` (миграция)

**Files:**
- Create: `supabase/migrations/20260701_0002_admin_finalize_new_user.sql`

**Interfaces:**
- Produces: RPC `admin_finalize_new_user(p_user_id uuid, p_role text, p_name text) returns void` — is_admin-гейт; ставит `profiles.approved=true`+`name`, заменяет `user_roles` на `[p_role]`, пишет `log_activity('user_created_by_admin', p_user_id, <email>, null)`.
- Consumes: существующие `public.is_admin()`, `public.log_activity(text, uuid, text, jsonb)` (сигнатура как в `admin_reset_password`: `log_activity('password_reset_by_admin', p_user_id, v_email, NULL)`), таблицы `profiles`, `user_roles`.

- [ ] **Step 1: Написать миграцию**

`supabase/migrations/20260701_0002_admin_finalize_new_user.sql`:
```sql
-- 20260701_0002: финализация созданного админом пользователя.
-- Вызывается Edge Function admin-create-user ПОД JWT админа после GoTrue-создания.
-- Гейт is_admin(); ставит approved+имя+единственную роль; аудит без пароля.
create or replace function public.admin_finalize_new_user(p_user_id uuid, p_role text, p_name text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_role not in ('client','employee') then raise exception 'bad_role'; end if;
  if p_user_id is null then raise exception 'no_user'; end if;

  update public.profiles
     set approved = true,
         name = coalesce(nullif(p_name, ''), name)
   where id = p_user_id;
  if not found then raise exception 'profile_not_found'; end if;

  delete from public.user_roles where user_id = p_user_id;
  insert into public.user_roles (user_id, role) values (p_user_id, p_role);

  select email into v_email from public.profiles where id = p_user_id;
  perform public.log_activity('user_created_by_admin', p_user_id, v_email, null);
end $$;
grant execute on function public.admin_finalize_new_user(uuid, text, text) to authenticated;
```

- [ ] **Step 2: Проверка синтаксиса локально (без живой БД)**

Проверить глазами: единственный `$$`-блок, `set search_path`, `grant`. Применение к живой БД — Task 5 (гейт владельца).

- [ ] **Step 3: Commit**

```bash
git -c core.fsyncMethod=writeout-only add supabase/migrations/20260701_0002_admin_finalize_new_user.sql
git -c core.fsyncMethod=writeout-only commit -m "feat(db): admin_finalize_new_user — approved+роль+аудит для admin-created юзера"
```

---

### Task 2: Чистая валидация `userCreateValidation.js` (TDD)

**Files:**
- Create: `src/lib/userCreateValidation.js`
- Test: `src/lib/userCreateValidation.test.js`

**Interfaces:**
- Produces: `validateNewUser({email,password,role})` → массив строк-кодов ошибок (`[]` = ок): `'email'` (пустой/не email-формат), `'password'` (короче 8), `'role'` (не `client`/`employee`).

- [ ] **Step 1: Написать падающий тест**

`src/lib/userCreateValidation.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { validateNewUser } from './userCreateValidation.js';

describe('validateNewUser', () => {
  it('валидный вход → нет ошибок', () => {
    expect(validateNewUser({ email:'a@b.co', password:'12345678', role:'client' })).toEqual([]);
    expect(validateNewUser({ email:'x@y.zz', password:'longpass1', role:'employee' })).toEqual([]);
  });
  it('битый email', () => {
    expect(validateNewUser({ email:'nope', password:'12345678', role:'client' })).toContain('email');
    expect(validateNewUser({ email:'', password:'12345678', role:'client' })).toContain('email');
  });
  it('короткий пароль', () => {
    expect(validateNewUser({ email:'a@b.co', password:'short', role:'client' })).toContain('password');
  });
  it('недопустимая роль', () => {
    expect(validateNewUser({ email:'a@b.co', password:'12345678', role:'visitor' })).toContain('role');
    expect(validateNewUser({ email:'a@b.co', password:'12345678', role:'' })).toContain('role');
  });
});
```

- [ ] **Step 2: Прогнать — упадут**

Run: `npm run test -- userCreateValidation`
Expected: FAIL (модуль не найден).

- [ ] **Step 3: Реализация**

`src/lib/userCreateValidation.js`:
```js
// Чистая валидация формы «создать пользователя» (без React/сети). Второй рубеж — в Edge Function.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLES = ['client', 'employee'];

export function validateNewUser({ email, password, role } = {}) {
  const errors = [];
  if (!email || !EMAIL_RE.test(email)) errors.push('email');
  if (!password || password.length < 8) errors.push('password');
  if (!ROLES.includes(role)) errors.push('role');
  return errors;
}
```

- [ ] **Step 4: Прогнать — пройдут**

Run: `npm run test -- userCreateValidation`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git -c core.fsyncMethod=writeout-only add src/lib/userCreateValidation.js src/lib/userCreateValidation.test.js
git -c core.fsyncMethod=writeout-only commit -m "feat(admin): userCreateValidation — чистая валидация формы (vitest)"
```

---

### Task 3: Edge Function `admin-create-user` + деплой-скрипт

**Files:**
- Create: `deploy/admin-create-user/functions/admin-create-user/index.ts`
- Create: `deploy/admin-create-user/deploy-edge-function.sh`

**Interfaces:**
- Consumes: env `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY`; GoTrue `POST /auth/v1/admin/users`; RPC `admin_finalize_new_user` (Task 1).
- Produces: `POST /functions/v1/admin-create-user` body `{email,password,name,role}` → `{ok:true,user_id,email}` | `{ok:false,stage,message,user_id?}`.

- [ ] **Step 1: Написать функцию**

`deploy/admin-create-user/functions/admin-create-user/index.ts`:
```ts
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
```

- [ ] **Step 2: Написать деплой-скрипт**

`deploy/admin-create-user/deploy-edge-function.sh` (по образцу `deploy/web-push/deploy-edge-function.sh`):
```bash
#!/usr/bin/env bash
# Деплой edge-функции admin-create-user в self-hosted Supabase.
set -euo pipefail
SRC="/mnt/f/Сайт/redesign-v2-fresh/deploy/admin-create-user/functions/admin-create-user"
DST="/srv/supabase-src/docker/volumes/functions/admin-create-user"
mkdir -p "$DST"
cp "$SRC/index.ts" "$DST/index.ts"
docker restart supabase-edge-functions >/dev/null 2>&1
echo "deployed admin-create-user"
ls -1 "$DST"
```
(Примечание для контроллера: путь `SRC` с кириллицей — при drvfs-нестабильности деплоить контент через stdin, как в сессии client-access; сам скрипт остаётся эталоном.)

- [ ] **Step 3: Commit**

```bash
git -c core.fsyncMethod=writeout-only add deploy/admin-create-user/
git -c core.fsyncMethod=writeout-only commit -m "feat(admin): Edge Function admin-create-user (GoTrue admin API) + деплой-скрипт"
```

---

### Task 4: Фронт — обёртка `adminCreateUser` + форма в AdminPage + метка активности

**Files:**
- Modify: `src/App.jsx` (обёртка рядом с `adminResetPassword`; форма в `AdminPage`; запись в `ACTIVITY_LABELS`)

**Interfaces:**
- Consumes: Edge Function `admin-create-user` (Task 3); `validateNewUser` (Task 2).
- Produces: `adminCreateUser(client, {email,password,name,role})` → `{ok,user_id,email}` (throw при ошибке); UI-секция «Создать пользователя» в AdminPage.

- [ ] **Step 1: Обёртка (рядом с `adminResetPassword`, ~App.jsx:743)**

```js
// Админ создаёт пользователя через Edge Function (GoTrue admin API + финализация).
async function adminCreateUser(client, { email, password, name, role }) {
  const { data, error } = await client.functions.invoke("admin-create-user", {
    body: { email, password, name, role },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.message || "Не удалось создать пользователя");
  return data; // { ok, user_id, email }
}
```

- [ ] **Step 2: Метка активности (в `ACTIVITY_LABELS`, ~App.jsx:770-802, секция «учётки»)**

Добавить строку:
```js
  user_created_by_admin:    { label: "Пользователь создан админом", color: "#6ee7a8", Icon: UserPlus },
```
(`UserPlus` уже импортирован — используется в `member_added`.)

- [ ] **Step 3: Импорт валидатора (верх App.jsx, рядом с прочими `src/lib` импортами)**

```js
import { validateNewUser } from "./lib/userCreateValidation.js";
```

- [ ] **Step 4: Форма в AdminPage**

Внутри компонента `AdminPage` (grep `function AdminPage` в App.jsx) добавить секцию-форму рядом со списком пользователей. Локальный стейт + сабмит:
```jsx
// admin: создать пользователя
const [nu, setNu] = useState({ email: "", name: "", password: "", role: "client" });
const [nuBusy, setNuBusy] = useState(false);
const submitNewUser = async () => {
  const errs = validateNewUser(nu);
  if (errs.length) { showToast("Проверь: " + errs.join(", "), "error"); return; }
  setNuBusy(true);
  try {
    const r = await adminCreateUser(client, nu);
    showToast(`Пользователь создан — выдай логин: ${r.email}`);
    setNu({ email: "", name: "", password: "", role: "client" });
  } catch (e) {
    showToast("Ошибка: " + (e.message || ""), "error");
  } finally { setNuBusy(false); }
};
```
Разметка (реюз premium-dark стилей формы AdminPage; поля email/имя/пароль + select роли + кнопка):
```jsx
<div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, borderRadius: 12,
  background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
  <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Создать пользователя</span>
  <input placeholder="email" value={nu.email} onChange={e => setNu({ ...nu, email: e.target.value })} />
  <input placeholder="имя" value={nu.name} onChange={e => setNu({ ...nu, name: e.target.value })} />
  <input placeholder="пароль (≥8)" type="text" value={nu.password} onChange={e => setNu({ ...nu, password: e.target.value })} />
  <select value={nu.role} onChange={e => setNu({ ...nu, role: e.target.value })}>
    <option value="client">Заказчик</option>
    <option value="employee">Сотрудник</option>
  </select>
  <button className={BTN.primary} disabled={nuBusy} onClick={submitNewUser}
    style={{ opacity: nuBusy ? 0.6 : 1 }}>{nuBusy ? "Создаю…" : "Создать"}</button>
</div>
```
(Инпуты — под стиль существующих полей AdminPage; если там свой класс инпута — использовать его. `BTN`, `showToast`, `client`, `useState` уже в scope AdminPage.)

- [ ] **Step 5: Проверка сборки**

Run: `npm run build`
Expected: зелёная сборка.

- [ ] **Step 6: Commit**

```bash
git -c core.fsyncMethod=writeout-only add src/App.jsx
git -c core.fsyncMethod=writeout-only commit -m "feat(admin): форма «Создать пользователя» + обёртка adminCreateUser + метка активности"
```

---

### Task 5: verify-скрипт + интеграция (гейт владельца) + финальный ревью

**Files:**
- Create: `deploy/admin-create-user/verify.sh`

**Interfaces:**
- Consumes: применённую миграцию Task 1, задеплоенную функцию Task 3.
- Produces: `ADMIN_CREATE_USER_OK` при успехе.

- [ ] **Step 1: verify-скрипт**

`deploy/admin-create-user/verify.sh` (JWT-механика как `deploy/verify-client-payments-rls.sh`):
```bash
#!/usr/bin/env bash
# E2E: админ создаёт пользователя через функцию → проверка approved/роль/логин/аудит → cleanup.
set -euo pipefail
SUPA=/srv/supabase-src/docker
BASE=http://localhost:8000
JWT_SECRET="$(grep '^JWT_SECRET=' "$SUPA/.env" | cut -d= -f2-)"
ANON="$(grep '^ANON_KEY=' "$SUPA/.env" | cut -d= -f2-)"
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -At"

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

ADMIN=$($PSQL -c "SELECT id FROM public.profiles WHERE role='admin' AND approved=true ORDER BY created_at LIMIT 1;" | grep -Eom1 '[0-9a-f-]{36}')
[ -n "$ADMIN" ] || { echo "NO_ADMIN"; exit 1; }
JA="$(sign "$ADMIN")"
EMAIL="e2e-admincreate-$(date +%s)@example.local"
PASS="verifypass123"

echo "== создать через функцию =="
RES=$(curl -s -X POST "$BASE/functions/v1/admin-create-user" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JA" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"E2E User\",\"role\":\"client\"}")
echo "resp: $RES"
UID=$(echo "$RES" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("user_id","") if d.get("ok") else "")')
[ -n "$UID" ] || { echo "CREATE_FAIL"; exit 1; }

echo "== approved/роль =="
APPROVED=$($PSQL -c "SELECT approved FROM public.profiles WHERE id='$UID';")
ROLES=$($PSQL -c "SELECT string_agg(role,',' ORDER BY role) FROM public.user_roles WHERE user_id='$UID';")
AUDIT=$($PSQL -c "SELECT count(*) FROM public.activity_log WHERE action='user_created_by_admin' AND target_id='$UID';")
echo "approved=$APPROVED roles=$ROLES audit=$AUDIT"

echo "== логин работает? =="
LOGIN=$(curl -s -X POST "$BASE/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
HAS_TOKEN=$(echo "$LOGIN" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("yes" if d.get("access_token") else "no")')
echo "login token: $HAS_TOKEN"

echo "== cleanup =="
$PSQL -c "DELETE FROM auth.users WHERE id='$UID';" >/dev/null

[ "$APPROVED" = "t" ] && [ "$ROLES" = "client" ] && [ "$AUDIT" = "1" ] && [ "$HAS_TOKEN" = "yes" ] \
  && echo "ADMIN_CREATE_USER_OK" || { echo "ADMIN_CREATE_USER_FAIL approved=$APPROVED roles=$ROLES audit=$AUDIT login=$HAS_TOKEN"; exit 1; }
```

- [ ] **Step 2: Commit скрипта**

```bash
git -c core.fsyncMethod=writeout-only add deploy/admin-create-user/verify.sh
git -c core.fsyncMethod=writeout-only commit -m "feat(admin): E2E verify admin-create-user"
```

- [ ] **Step 3: Интеграция (ГЕЙТ ВЛАДЕЛЬЦА — по «го»)**

Контроллер после явного «го»: (a) применить миграцию `20260701_0002` к живой БД; (b) задеплоить функцию (`deploy-edge-function.sh` / контент через stdin); (c) прогнать `verify.sh` → ждать `ADMIN_CREATE_USER_OK`; (d) при роли клиента для §1-E2E: создать client-only юзера формой, залинковать `set_client_user` к тест-`clients`+проекту, playwright-прогон 4 вкладок + DevTools Network (нет прямых `from('projects')`/`transactions`), cleanup.

- [ ] **Step 4: Финальный whole-branch review** (opus) `main..HEAD` — как в client-access; §1/секрет-гейт/частичный сбой.

- [ ] **Step 5:** Готовность к merge/деплою — по явному слову владельца.

---

## Заметки по среде (грабли)

- Edge-runtime env: `SUPABASE_URL=http://kong:8000`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` — уже заданы (используются web-push/nextcloud).
- Деплой функции: контент в `/srv/supabase-src/docker/volumes/functions/admin-create-user/index.ts` + `docker restart supabase-edge-functions`.
- WSL/psql/скрипты — файлом через stdin (`Get-Content -Raw | wsl bash -c 'tr -d "\r" > /tmp/x; …'`); drvfs-глоб+кириллица нестабильны.
- Живая БД/деплой — гейт владельца; git на F: — fsync-флаг+ретрай.
