# Edge-гейт web-push-notify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline — живой хост, гейты владельца). Steps use `- [ ]`.

**Goal:** Закрыть интернет-открытую edge-функцию web-push-notify dual-гейтом (валидный user-JWT ИЛИ X-Push-Secret) + удалить мёртвую telegram-notify (m7). Дизайн принят владельцем 03.07 (STATUS.md, «го действует»: живая БД + деплой).

**Architecture:** Функция сама проверяет вход (FUNCTIONS_VERIFY_JWT off): заголовок `X-Push-Secret` сверяется с `pushSecret` из config.json (не в git); иначе Authorization-JWT валидируется через GoTrue `GET /auth/v1/user` (отсекает anon/service-токены — у них нет пользователя). Секрет для pg_cron живёт в vault (`web_push_secret`, supabase_vault 0.3.1 установлен) и читается cron-джобом при каждом запуске — ни в миграции, ни в `cron.job.command` секрета нет. Тот же секрет кладётся в config.json функции.

**Tech Stack:** Deno edge-runtime (self-hosted Supabase, WSL2 docker), pg_cron + pg_net, supabase_vault, bash-скрипты деплоя/верификации.

## Global Constraints
- Живой хост: kong на `http://localhost:8000` (WSL), функции в `/srv/supabase-src/docker/volumes/functions/`, psql-паттерн `docker exec -i supabase-db psql -U postgres -d postgres -At`.
- Деплой функции — ТОЛЬКО `cp` с /mnt/f (кириллица в пути; stdin-пайп в wsl дропает UTF-8 — CLAUDE.md).
- Порядок внедрения строго: (1) секрет в vault + config.json → (2) миграция cron → (3) деплой гейченной функции. Иначе окно, где cron получает 401.
- Скрипты — worktree-agnostic (пути от `dirname "$0"`, не глоб main-checkout): внедрение идёт из worktree ДО merge.
- Фронт НЕ трогаем: supabase-js уже шлёт user-JWT (App.jsx sendPush:896, notifyTask:930). Build фронта не нужен.
- Секрет — hex (openssl rand -hex 32): безопасен для SQL/JSON-кавычек.
- merge в main — один, в конце, после верификации (го от 03.07 покрывает пакет).

---

### Task 1: Dual-гейт в index.ts + config.example.json

**Files:**
- Modify: `deploy/web-push/functions/web-push-notify/index.ts` (после `rest()`, ~строка 26; вход `Deno.serve`, ~строка 142)
- Modify: `deploy/web-push/functions/web-push-notify/config.example.json`

**Interfaces:**
- Consumes: `cfg` (JSON-import config.json), `SUPABASE_URL`, `SERVICE_KEY` — уже объявлены в файле.
- Produces: `authorized(req: Request): Promise<boolean>`; поле `pushSecret` в config.json (host).

- [ ] **Step 1: Гейт-хелпер** — вставить после объявления `function rest(...)`:

```ts
// Гейт (m6): функция торчит в интернет через kong без key-auth — пускаем только:
// (а) pg_cron с заголовком X-Push-Secret == pushSecret из config.json (тот же секрет в vault);
// (б) живой user-JWT (фронт: supabase-js шлёт Authorization сам) — валидация через GoTrue.
async function authorized(req: Request): Promise<boolean> {
  const secret = (cfg as { pushSecret?: string }).pushSecret;
  const got = req.headers.get("x-push-secret");
  if (secret && got === secret) return true;
  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer .+/.test(auth)) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: auth },
  });
  if (!r.ok) return false;
  const u = await r.json().catch(() => null);
  return typeof u?.id === "string"; // именно user-токен: у anon/service нет пользователя
}
```

- [ ] **Step 2: Врезка в serve** — сразу после OPTIONS-ветки:

```ts
  if (!(await authorized(req))) return j({ error: "unauthorized" }, 401);
```

- [ ] **Step 3: config.example.json** — добавить поле-подсказку:

```json
{
  "subject": "mailto:CHANGE_ME@example.com",
  "vapidKeys": { "publicKey": "", "privateKey": "" },
  "pushSecret": "hex из `openssl rand -hex 32`; тот же секрет — в vault под именем web_push_secret"
}
```

- [ ] **Step 4: Коммит**

```bash
git add deploy/web-push/functions/web-push-notify/index.ts deploy/web-push/functions/web-push-notify/config.example.json
git commit -m "feat(push-gate): dual-гейт web-push-notify — user-JWT или X-Push-Secret"
```

---

### Task 2: Миграция cron + скрипты apply/verify + worktree-agnostic деплой

**Files:**
- Create: `supabase/migrations/20260703_0002_web_push_cron_secret.sql`
- Create: `deploy/web-push/apply-secret-gate.sh`
- Create: `deploy/web-push/verify-secret-gate.sh`
- Modify: `deploy/web-push/deploy-edge-function.sh:5` (SRC от dirname — деплой из worktree)

**Interfaces:**
- Produces: vault-секрет `web_push_secret`; cron-джоб `web-push-deadline` с заголовком; маркеры `SECRET_GATE_APPLIED` / `PUSH_GATE_OK`.

- [ ] **Step 1: Миграция** `supabase/migrations/20260703_0002_web_push_cron_secret.sql`:

```sql
-- Edge-гейт web-push-notify (m6): deadline-джоб шлёт X-Push-Secret.
-- Секрет живёт в vault (name='web_push_secret') и читается при КАЖДОМ запуске джоба —
-- в этом файле и в cron.job.command самого секрета НЕТ. Создание секрета — шаг
-- deploy/web-push/apply-secret-gate.sh (значение секретно, в миграцию не кладём).
-- Тот же секрет — в config.json функции на edge-хосте (pushSecret).

select cron.unschedule('web-push-deadline')
  where exists (select 1 from cron.job where jobname = 'web-push-deadline');

select cron.schedule(
  'web-push-deadline',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'http://kong:8000/functions/v1/web-push-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Push-Secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'web_push_secret'), '')
    ),
    body := jsonb_build_object('type', 'deadline'),
    timeout_milliseconds := 30000
  );
  $$
);
```

- [ ] **Step 2: apply-скрипт** `deploy/web-push/apply-secret-gate.sh` (идемпотентен; шаги 1-2 порядка внедрения):

```bash
#!/usr/bin/env bash
# Внедрение edge-гейта web-push-notify (m6), шаги 1-2: секрет в vault + config.json,
# затем миграция cron. Деплой функции — ОТДЕЛЬНО deploy-edge-function.sh (шаг 3).
# Запуск (WSL root): bash apply-secret-gate.sh
set -euo pipefail
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -At"
FN_DIR=/srv/supabase-src/docker/volumes/functions/web-push-notify
MIG="$(cd "$(dirname "$0")/../../supabase/migrations" && pwd)/20260703_0002_web_push_cron_secret.sql"
[ -f "$MIG" ] || { echo "NO_MIGRATION $MIG"; exit 1; }
[ -f "$FN_DIR/config.json" ] || { echo "NO_CONFIG $FN_DIR/config.json"; exit 1; }

# 1) секрет: переиспользовать из vault или создать
SECRET=$($PSQL -c "select decrypted_secret from vault.decrypted_secrets where name='web_push_secret';")
if [ -z "$SECRET" ]; then
  SECRET=$(openssl rand -hex 32)
  $PSQL -c "select vault.create_secret('$SECRET', 'web_push_secret', 'edge-гейт web-push-notify (m6)');" >/dev/null
  echo "vault: web_push_secret создан"
else
  echo "vault: web_push_secret уже есть — переиспользую"
fi

# 2) тот же секрет в config.json функции (merge поверх VAPID, ничего не терять)
SECRET="$SECRET" python3 - "$FN_DIR/config.json" <<'PY'
import json, os, sys
p = sys.argv[1]
cfg = json.load(open(p))
cfg["pushSecret"] = os.environ["SECRET"]
json.dump(cfg, open(p, "w"), ensure_ascii=False, indent=2)
PY
echo "config.json: pushSecret записан"

# 3) cron-джоб с заголовком (миграция)
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$MIG"
echo "SECRET_GATE_APPLIED"
```

- [ ] **Step 3: deploy-edge-function.sh — SRC от dirname** (замена строки 5):

```bash
SRC="$(cd "$(dirname "$0")/functions/web-push-notify" && pwd)"
```

- [ ] **Step 4: verify-скрипт** `deploy/web-push/verify-secret-gate.sh`:

```bash
#!/usr/bin/env bash
# Верификация edge-гейта web-push-notify: 401 без auth и на anon-JWT, 200 на секрет
# и на реальный user-JWT (temp-пользователь: создать → password grant → удалить),
# cron-джоб пересоздан с заголовком. Тип __gate_check не имеет side-effect (unknown type).
set -euo pipefail
SUPA=/srv/supabase-src/docker
BASE=http://localhost:8000
URL=$BASE/functions/v1/web-push-notify
ANON="$(grep '^ANON_KEY=' "$SUPA/.env" | cut -d= -f2-)"
SERVICE="$(grep '^SERVICE_ROLE_KEY=' "$SUPA/.env" | cut -d= -f2-)"
PSQL="docker exec -i supabase-db psql -U postgres -d postgres -At"
SECRET=$($PSQL -c "select decrypted_secret from vault.decrypted_secrets where name='web_push_secret';")
[ -n "$SECRET" ] || { echo "NO_VAULT_SECRET"; exit 1; }
FAIL=0
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

C=$(code -X POST "$URL" -H "Content-Type: application/json" -d '{"type":"__gate_check"}')
echo "no-auth: $C (ожидаем 401)"; [ "$C" = 401 ] || FAIL=1

C=$(code -X POST "$URL" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"type":"__gate_check"}')
echo "anon-jwt: $C (ожидаем 401)"; [ "$C" = 401 ] || FAIL=1

C=$(code -X POST "$URL" -H "X-Push-Secret: $SECRET" -H "Content-Type: application/json" -d '{"type":"__gate_check"}')
echo "secret: $C (ожидаем 200)"; [ "$C" = 200 ] || FAIL=1

EMAIL="e2e-pushgate-$(date +%s)@example.local"; PASS="verifypass123"
NUID=$(curl -s -X POST "$BASE/auth/v1/admin/users" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
  -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))')
[ -n "$NUID" ] || { echo "TEMP_USER_CREATE_FAIL"; exit 1; }
TOKEN=$(curl -s -X POST "$BASE/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')
C=$(code -X POST "$URL" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"type":"__gate_check"}')
echo "user-jwt: $C (ожидаем 200)"; [ "$C" = 200 ] || FAIL=1
$PSQL -c "delete from auth.users where id='$NUID';" >/dev/null

HAS=$($PSQL -c "select count(*) from cron.job where jobname='web-push-deadline' and command like '%X-Push-Secret%';")
echo "cron header: $HAS (ожидаем 1)"; [ "$HAS" = 1 ] || FAIL=1

[ "$FAIL" = 0 ] && echo "PUSH_GATE_OK" || { echo "PUSH_GATE_FAIL"; exit 1; }
```

- [ ] **Step 5: Коммит**

```bash
git add supabase/migrations/20260703_0002_web_push_cron_secret.sql deploy/web-push/apply-secret-gate.sh deploy/web-push/verify-secret-gate.sh deploy/web-push/deploy-edge-function.sh
git commit -m "feat(push-gate): миграция cron с vault-секретом + apply/verify скрипты"
```

---

### Task 3: Внедрение на живом хосте (го от 03.07)

- [ ] **Step 1: LF-проверка** — `git ls-files --eol deploy/web-push` → `.sh` должны быть `w/lf`; CRLF лечить `wsl sed -i 's/\r$//' <file>` (правка НЕ через stdin — кириллица).
- [ ] **Step 2: apply** — `wsl -u root bash "/mnt/f/Сайт/redesign-v2-fresh/.claude/worktrees/great-perlman-cdce3c/deploy/web-push/apply-secret-gate.sh"` → `SECRET_GATE_APPLIED`.
- [ ] **Step 3: деплой функции** — `wsl -u root bash ".../deploy/web-push/deploy-edge-function.sh"` (тот же worktree-путь) → `deployed web-push-notify`.

### Task 4: Верификация

- [ ] **Step 1:** `wsl -u root bash ".../deploy/web-push/verify-secret-gate.sh"` → `PUSH_GATE_OK` (все 5 проверок).
- [ ] **Step 2:** Прод снаружи жив: `curl -s -o /dev/null -w '%{http_code}' https://193-124-130-236.sslip.io` → 200 (фронт не трогали — asset не должен смениться).

### Task 5: Удалить telegram-notify (m7)

**Files:**
- Delete: `deploy/tasks/deploy-telegram-fn.sh`, `deploy/tasks/functions/telegram-notify/index.ts`
- Modify: `deploy/INFRASTRUCTURE.md:114-117` (упоминание Telegram → web-push + гейт)
- Host: `rm -rf /srv/supabase-src/docker/volumes/functions/telegram-notify` + `docker restart supabase-edge-functions`

- [ ] **Step 1: Хост** — `wsl -u root rm -rf /srv/supabase-src/docker/volumes/functions/telegram-notify` затем `wsl docker restart supabase-edge-functions`; проверить `wsl ls /srv/supabase-src/docker/volumes/functions/`.
- [ ] **Step 2: Репо** — `git rm deploy/tasks/deploy-telegram-fn.sh deploy/tasks/functions/telegram-notify/index.ts` (папка functions/ опустеет — git уберёт сам).
- [ ] **Step 3: INFRASTRUCTURE.md** — блок про Telegram заменить на актуальное: уведомления = web-push-notify (dual-гейт: user-JWT/X-Push-Secret, секрет в vault + config.json), telegram-notify удалена 03.07 как мёртвый код.
- [ ] **Step 4: Коммит** — `git commit -m "chore(push): удалить мёртвую telegram-notify (m7) + актуализировать INFRASTRUCTURE"`.

### Task 6: Финал

- [ ] **Step 1: Ревью** — прогнать ревью диффа ветки (skill code-review) перед merge; блокеры чинить fix-forward.
- [ ] **Step 2: STATUS.md** — задачу из «Не начато, но принято» → «Готово» (гейт применён, verify PUSH_GATE_OK, telegram удалена); дата.
- [ ] **Step 3: merge в main** — из основной копии: `git -C "F:\Сайт\redesign-v2-fresh" merge --no-ff claude/great-perlman-cdce3c` (го от 03.07; проверить чистоту основной копии до).
- [ ] **Step 4: push** — `git -C "F:\Сайт\redesign-v2-fresh" push origin main` (авто; capризы сети — пробовать дефолт И обход прокси).

## Self-Review
**1. Spec coverage:** dual-гейт JWT/секрет (T1) ✓; секрет НЕ в миграции, из vault при применении (T2 S1-S2) ✓; cron пересоздан с заголовком (T2 S1) ✓; деплой только cp (T3 S3 — существующий cp-скрипт) ✓; telegram-notify удалить volume+репо (T5) ✓; живая БД+деплой по го (T3) ✓.
**2. Placeholder scan:** код полный во всех шагах; путей «найди сам» нет (worktree-путь внедрения выписан).
**3. Type consistency:** `authorized(req)` — одна сигнатура (T1); имя vault-секрета `web_push_secret` едино (T1 комментарий, T2 миграция/скрипты); маркеры `SECRET_GATE_APPLIED`/`PUSH_GATE_OK` совпадают в скриптах и шагах T3-T4.
