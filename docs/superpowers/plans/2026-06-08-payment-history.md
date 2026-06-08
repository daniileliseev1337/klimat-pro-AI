# История платежей по проектам + сводная панель (№2) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: используйте superpowers:subagent-driven-development
> (рекомендуется) или superpowers:executing-plans. Шаги — чекбоксы `- [ ]`.

**Goal:** Заменить накопительное `projects.paid_amount` историей платежей (`project_payments`,
дата+сумма), сделать `paid_amount` производным (триггер), влить проектные доходы в «Финансы»
помесячно и добавить сводную панель по выбранным проектам на вкладке «Проекты».

**Architecture:** Платёж — в счёт договора, распределяется пропорционально долям (модель долей
не меняется). `paid_amount = SUM(платежей)` поддерживается БД-триггером — все текущие чтения
работают без изменений. Финансы вливают мою долю платежей моих проектов по дате платежа (на лету,
без строк `transactions`). Панель №2 считает из `projects`+`project_shares`.

**Tech Stack:** Postgres (self-hosted Supabase, миграции `supabase/migrations/`), React+Vite
(`src/App.jsx` монолит, `src/lib/dashboardMetrics.js`), vitest.

**Спек:** `docs/superpowers/specs/2026-06-08-payment-history-design.md`.

**Окружение (важно — грабли):** git только с Windows-стороны
(`git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=*`); push с обходом прокси. Применение
миграций к живой БД и psql — через WSL под root, файлами-скриптами (кириллица/кавычки в inline
бьются). БД-юнит (Task 1) исполняет контроллер, не субагент (грабли среды). Сборка `npm run build`,
тесты `npm run test` — с Windows-стороны.

---

## File Structure

- Create: `supabase/migrations/20260608_0001_project_payments.sql` — таблица + RLS.
- Create: `supabase/migrations/20260608_0002_recalc_paid_amount_trigger.sql` — триггер.
- Create: `supabase/migrations/20260608_0003_set_project_payments_rpc.sql` — RPC replace-all.
- Create: `supabase/migrations/20260608_0004_backfill_payments.sql` — перенос paid_amount.
- Create: `deploy/payment-history/apply-migrations.sh` — применение к живой БД.
- Create: `deploy/payment-history/verify-payments-rls.sh` — проверка RLS под двумя юзерами.
- Modify: `src/lib/dashboardMetrics.js` — `myProjectIncomeForMonth`, `selectionTotals`.
- Modify: `src/lib/dashboardMetrics.test.js` — тесты новых функций.
- Modify: `src/App.jsx` — data-слой платежей, ProjectForm (секция «Платежи»), Finance (вливание),
  Projects (панель №2), `projectJsToDb` (убрать paid_amount).

---

## Task 1: БД — таблица, триггер, RPC, backfill (исполняет контроллер)

**Files:**
- Create: `supabase/migrations/20260608_0001_project_payments.sql`
- Create: `supabase/migrations/20260608_0002_recalc_paid_amount_trigger.sql`
- Create: `supabase/migrations/20260608_0003_set_project_payments_rpc.sql`
- Create: `supabase/migrations/20260608_0004_backfill_payments.sql`
- Create: `deploy/payment-history/apply-migrations.sh`, `deploy/payment-history/verify-payments-rls.sh`

- [ ] **Step 1: Миграция таблицы + RLS** — `20260608_0001_project_payments.sql`:

```sql
create table if not exists public.project_payments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  amount      numeric not null check (amount > 0),
  paid_on     date not null,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) default auth.uid()
);
create index if not exists project_payments_project_id_idx on public.project_payments(project_id);
alter table public.project_payments enable row level security;

drop policy if exists project_payments_select on public.project_payments;
create policy project_payments_select on public.project_payments
for select using (
  exists (select 1 from public.projects p
          where p.id = project_payments.project_id and p.owner_id = auth.uid())
);
drop policy if exists project_payments_write on public.project_payments;
create policy project_payments_write on public.project_payments
for all using (
  exists (select 1 from public.projects p
          where p.id = project_payments.project_id and p.owner_id = auth.uid())
) with check (
  exists (select 1 from public.projects p
          where p.id = project_payments.project_id and p.owner_id = auth.uid())
);
```

- [ ] **Step 2: Миграция триггера** — `20260608_0002_recalc_paid_amount_trigger.sql`:

```sql
create or replace function public.recalc_project_paid_amount()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare pid uuid;
begin
  pid := coalesce(new.project_id, old.project_id);
  update public.projects
     set paid_amount = (select coalesce(sum(amount),0) from public.project_payments where project_id = pid)
   where id = pid;
  if (tg_op = 'UPDATE' and new.project_id is distinct from old.project_id) then
    update public.projects
       set paid_amount = (select coalesce(sum(amount),0) from public.project_payments where project_id = old.project_id)
     where id = old.project_id;
  end if;
  return null;
end; $$;

drop trigger if exists trg_recalc_paid_amount on public.project_payments;
create trigger trg_recalc_paid_amount
after insert or update or delete on public.project_payments
for each row execute function public.recalc_project_paid_amount();
```

- [ ] **Step 3: Миграция RPC** — `20260608_0003_set_project_payments_rpc.sql`:

```sql
create or replace function public.set_project_payments(p_project_id uuid, p_rows jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.projects where id = p_project_id and owner_id = auth.uid()) then
    raise exception 'not project owner';
  end if;
  delete from public.project_payments where project_id = p_project_id;
  insert into public.project_payments (project_id, amount, paid_on, note, created_by)
  select p_project_id, (r->>'amount')::numeric, (r->>'paid_on')::date, nullif(r->>'note',''), auth.uid()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where (r->>'amount') is not null and (r->>'amount')::numeric > 0 and (r->>'paid_on') is not null;
end; $$;
grant execute on function public.set_project_payments(uuid, jsonb) to authenticated;
```

- [ ] **Step 4: Миграция backfill** — `20260608_0004_backfill_payments.sql`:

```sql
insert into public.project_payments (project_id, amount, paid_on, note, created_by)
select p.id, p.paid_amount, current_date, 'Перенос из paid_amount', p.owner_id
from public.projects p
where p.paid_amount > 0
  and not exists (select 1 from public.project_payments pp where pp.project_id = p.id);
```

- [ ] **Step 5: apply-migrations.sh** (по образцу `deploy/payment-shares/apply-migrations.sh`):
применяет 0001..0004 к контейнеру `supabase-db` через `docker exec ... psql -U postgres -d postgres -f`.
Скопировать структуру существующего apply-скрипта; перечислить 4 файла по порядку.

- [ ] **Step 6: Применить к живой БД** (контроллер, WSL):
Run: `wsl -d Ubuntu -u root -- bash -c "bash /mnt/f/*/redesign-v2-fresh/deploy/payment-history/apply-migrations.sh"`
Expected: 4 миграции применены без ошибок.

- [ ] **Step 7: verify-payments-rls.sh** (по образцу `deploy/payment-shares/verify-shares-rls.sh`):
под юзером-владельцем — insert платежа в свой проект ОК, select видит; под другим юзером —
select чужого проекта = 0 строк, insert в чужой проект = ошибка RLS. Печатает `PAYMENTS_RLS_OK`/`FAIL`.

- [ ] **Step 8: Верифицировать триггер и backfill** (контроллер, psql через файл-скрипт):
проверить: (а) для проекта с платежами `paid_amount = SUM(amount)`; (б) после backfill у каждого
проекта с прежней оплатой ровно 1 платёж и `paid_amount` не изменился. Запрос:
`select p.id, p.paid_amount, coalesce(sum(pp.amount),0) s from projects p left join project_payments pp on pp.project_id=p.id group by p.id having p.paid_amount <> coalesce(sum(pp.amount),0);`
Expected: 0 строк (расхождений нет).

- [ ] **Step 9: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* add supabase/migrations/20260608_000*.sql deploy/payment-history/
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* commit -m "feat(payments): таблица project_payments, триггер paid_amount, RPC, backfill"
```

---

## Task 2: Расчёты + тесты (`dashboardMetrics.js`)

**Files:**
- Modify: `src/lib/dashboardMetrics.js` (добавить в конец, перед/после существующих экспортов)
- Test: `src/lib/dashboardMetrics.test.js`

- [ ] **Step 1: Написать падающие тесты** — добавить в `dashboardMetrics.test.js`:

```js
import { myProjectIncomeForMonth, selectionTotals } from './dashboardMetrics';

describe('myProjectIncomeForMonth', () => {
  const projects = [{ id: 'p1', ownerId: 'me', stage: 'В работе', contractSum: 100, paidAmount: 50 }];
  const shares = { p1: [] }; // нет долей → моя доля = весь договор (100)
  const pays = { p1: [{ amount: 30, paidOn: '2026-06-10' }, { amount: 20, paidOn: '2026-05-01' }] };
  it('суммирует мою долю платежей за месяц', () => {
    // доля владельца = 100/100 = 1; за июнь только платёж 30 → 30*100/100 = 30
    expect(myProjectIncomeForMonth(pays, projects, shares, 'me', '2026-06')).toBe(30);
  });
  it('игнорирует чужие проекты', () => {
    const other = [{ id: 'p1', ownerId: 'someone', stage: 'В работе', contractSum: 100, paidAmount: 50 }];
    expect(myProjectIncomeForMonth(pays, other, shares, 'me', '2026-06')).toBe(0);
  });
  it('contract=0 → 0', () => {
    const z = [{ id: 'p1', ownerId: 'me', stage: 'В работе', contractSum: 0, paidAmount: 0 }];
    expect(myProjectIncomeForMonth(pays, z, shares, 'me', '2026-06')).toBe(0);
  });
  it('учитывает долю: участник забрал 40% → владелец получает 60% платежа', () => {
    const sh = { p1: [{ shareKind: 'percent', shareValue: 40 }] }; // доля владельца = 60
    expect(myProjectIncomeForMonth(pays, projects, sh, 'me', '2026-06')).toBeCloseTo(18); // 30*60/100
  });
});

describe('selectionTotals', () => {
  const shares = {};
  it('суммирует получено/остаток/договор и даёт разбивку', () => {
    const sel = [
      { id: 'a', name: 'A', contractSum: 100, paidAmount: 50 },
      { id: 'b', name: 'B', contractSum: 200, paidAmount: 0 },
    ];
    const r = selectionTotals(sel, shares, 'me');
    expect(r.contract).toBe(300);
    expect(r.received).toBe(50);      // A: 50*100/100=50; B: 0
    expect(r.remaining).toBe(250);    // A:50 + B:200
    expect(r.breakdown).toEqual([{ id: 'a', name: 'A', received: 50 }, { id: 'b', name: 'B', received: 0 }]);
  });
  it('пустой выбор → нули', () => {
    expect(selectionTotals([], shares, 'me')).toEqual({ received: 0, remaining: 0, contract: 0, breakdown: [] });
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm run test`
Expected: FAIL (`myProjectIncomeForMonth`/`selectionTotals` не определены).

- [ ] **Step 3: Реализовать функции** — добавить в `src/lib/dashboardMetrics.js` (используют существующие `ownerShareAmount`, `proportionReceived`):

```js
// Моя доля проектных платежей за месяц 'YYYY-MM' — только мои проекты (где ownerId), архив исключён.
// paymentsByProject: { [projectId]: [{ amount:number, paidOn:'YYYY-MM-DD' }] }
export function myProjectIncomeForMonth(paymentsByProject, projects, sharesByProject = {}, ownerId = null, monthStr) {
  let total = 0;
  for (const p of projects) {
    if (ownerId != null && p.ownerId !== ownerId) continue;
    if (p.stage === 'Архив') continue;
    const contract = Number(p.contractSum) || 0;
    if (contract <= 0) continue;
    const myShare = ownerShareAmount(p, sharesByProject[p.id] || []);
    for (const pay of (paymentsByProject[p.id] || [])) {
      if (!pay.paidOn || !pay.paidOn.startsWith(monthStr)) continue;
      total += (Number(pay.amount) || 0) * myShare / contract;
    }
  }
  return total;
}

// Сводка по выбранным проектам (моя доля владельца). breakdown — построчно.
export function selectionTotals(selectedProjects = [], sharesByProject = {}, ownerId = null) {
  let received = 0, remaining = 0, contract = 0;
  const breakdown = [];
  for (const p of selectedProjects) {
    const c = Number(p.contractSum) || 0;
    const myShare = ownerShareAmount(p, sharesByProject[p.id] || []);
    const rec = proportionReceived(p.paidAmount, myShare, c);
    received += rec;
    remaining += Math.max(0, myShare - rec);
    contract += c;
    breakdown.push({ id: p.id, name: p.name, received: rec });
  }
  return { received, remaining, contract, breakdown };
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npm run test`
Expected: PASS (старые 55 + новые).

- [ ] **Step 5: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* add src/lib/dashboardMetrics.js src/lib/dashboardMetrics.test.js
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* commit -m "feat(payments): расчёты myProjectIncomeForMonth + selectionTotals (+тесты)"
```

---

## Task 3: Data-слой платежей + ProjectForm (секция «Платежи»)

**Files:** Modify `src/App.jsx`.

- [ ] **Step 1: Маппер и data-обёртки.** Рядом с `shareDbToJs` добавить `paymentDbToJs`:

```js
function paymentDbToJs(row) {
  return { id: row.id, amount: Number(row.amount) || 0, paidOn: row.paid_on, note: row.note || "" };
}
```
Рядом с `getMyShares`/`set_project_shares`-обёртками добавить:

```js
async function fetchProjectPayments(client, projectId) {
  const { data, error } = await client.from("project_payments")
    .select("id, amount, paid_on, note").eq("project_id", projectId).order("paid_on", { ascending: false });
  if (error) throw error;
  return (data || []).map(paymentDbToJs);
}
async function setProjectPayments(client, projectId, rows) {
  const payload = rows.map(r => ({ amount: Number(r.amount) || 0, paid_on: r.paidOn, note: r.note || null }));
  const { error } = await client.rpc("set_project_payments", { p_project_id: projectId, p_rows: payload });
  if (error) throw error;
}
```

- [ ] **Step 2: Убрать `paid_amount` из `projectJsToDb`.** Найти в `projectJsToDb` строку
`paid_amount: parseFloat(p.paidAmount) || 0,` и **удалить** её (источник правды — триггер; иначе
сохранение проекта затрёт значение). Проверить, что `projectDbToJs` по-прежнему читает `paid_amount`
(карточки/отчёты используют `p.paidAmount`).

- [ ] **Step 3: Секция «Платежи» в ProjectForm.** Найти в форме поле ввода `paidAmount`
(`<StyledInput type="number" value={f.paidAmount} ... />`, ~строка 1773) и заменить блок на
редактор платежей. Состояние формы: добавить массив `payments` (загружается при открытии проекта
из `fetchProjectPayments`, для нового проекта — `[]`). UI: список строк `{paidOn, amount, note}` с
полями (date input + number + text) и кнопками удалить/добавить; внизу read-only «Оплачено всего:
{fmt(сумма amount)}». Поле `f.paidAmount` в форме больше не редактируется напрямую.

```jsx
{/* Платежи (история; paid_amount = их сумма, считается триггером) */}
<div>
  <Label>Платежи</Label>
  {(f.payments || []).map((pay, i) => (
    <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
      <input type="date" value={pay.paidOn || ""} onChange={e => updatePayment(i, "paidOn", e.target.value)} style={{ ...BASE_INPUT, width: "auto" }} />
      <StyledInput type="number" value={pay.amount} onChange={e => updatePayment(i, "amount", e.target.value)} placeholder="сумма" />
      <StyledInput value={pay.note || ""} onChange={e => updatePayment(i, "note", e.target.value)} placeholder="заметка" />
      <button type="button" onClick={() => removePayment(i)} className={BTN.edit}>🗑️</button>
    </div>
  ))}
  <button type="button" onClick={addPayment} className={BTN.edit}>+ платёж</button>
  <div style={{ fontSize: 12, color: "#a8a8a3", marginTop: 4 }}>
    Оплачено всего: <span style={{ color: "#6ee7a8", fontWeight: 600 }}>{fmt((f.payments || []).reduce((s, p) => s + (+p.amount || 0), 0))}</span>
  </div>
</div>
```
с хелперами в ProjectForm: `addPayment` (push `{paidOn: todayStr(), amount: "", note: ""}`),
`updatePayment(i, key, val)`, `removePayment(i)` — иммутабельно обновляют `f.payments`.

- [ ] **Step 4: Загрузка платежей при открытии проекта.** Там, где форма инициализируется из
проекта (модалка редактирования), подгрузить `fetchProjectPayments(client, project.id)` в
`f.payments` (для нового проекта — `[]`).

- [ ] **Step 5: Сохранение платежей.** В `saveProject` после успешного insert/update проекта,
если `saved?.id` — вызвать `await setProjectPayments(client, saved.id, form.payments || [])`, затем
обновить локальный проект свежим `paid_amount` (рефетч проекта или `fetchProjects`). Стадия
«Оплачен»: если выбрана и сумма платежей < contractSum — предложить (подставить) платёж на остаток
датой сегодня перед сохранением (заменяет прежнее автозаполнение `paid=contract`).

- [ ] **Step 6: Проверка сборки**

Run: `npm run build`
Expected: зелёная сборка.

- [ ] **Step 7: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* add src/App.jsx
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* commit -m "feat(payments): ввод платежей в ProjectForm + data-слой, paid_amount убран из projectJsToDb"
```

---

## Task 4: Finance — помесячное вливание проектных доходов

**Files:** Modify `src/App.jsx`.

- [ ] **Step 1: Загрузить платежи моих проектов в App.** Добавить state
`const [paymentsByProject, setPaymentsByProject] = useState({});`. В местах загрузки данных
(`Promise.all` с `fetchProjects`/`getMyShares`) дозагрузить платежи моих проектов: после загрузки
`projects` для проектов где `ownerId === profile.id` собрать `{ [projectId]: payments }` (один запрос
`from('project_payments').select('project_id, amount, paid_on')` без фильтра — RLS отдаст только мои;
сгруппировать на клиенте по `project_id`, маппить в `{amount, paidOn}`). Сбрасывать на SIGNED_OUT.

```js
async function fetchMyPayments(client) {
  const { data, error } = await client.from("project_payments").select("project_id, amount, paid_on");
  if (error) throw error;
  const by = {};
  for (const r of (data || [])) (by[r.project_id] ||= []).push({ amount: Number(r.amount) || 0, paidOn: r.paid_on });
  return by;
}
```

- [ ] **Step 2: Передать в Finance и влить в «Доходы».** Импорт `myProjectIncomeForMonth` в App
(дополнить существующий импорт из `./lib/dashboardMetrics`). Передать в `<Finance ... paymentsByProject={paymentsByProject} sharesByProject={sharesByProject} />`
(`projects`, `ownerId` уже переданы из Task №3-волны багов). В компоненте `Finance` добавить в
сигнатуру `paymentsByProject = {}`. Посчитать:

```js
const projIncomeMonth = myProjectIncomeForMonth(paymentsByProject, projects, sharesByProject, ownerId, monthF);
const incTotal = inc + projIncomeMonth;
```
Заменить в карточках значения: «Доходы» → `incTotal`, «Баланс» → `incTotal - exp`. В пироге
«Источники доходов» добавить срез `{ name: "Проектные доходы", value: projIncomeMonth }` при
`projIncomeMonth > 0`.

- [ ] **Step 3: Проверка сборки**

Run: `npm run build`
Expected: зелёная.

- [ ] **Step 4: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* add src/App.jsx
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* commit -m "feat(payments): Finance вливает мою долю проектных платежей по месяцу в Доходы"
```

---

## Task 5: Панель №2 — выбор проектов + сводка

**Files:** Modify `src/App.jsx`.

- [ ] **Step 1: Импорт и состояние выбора.** Импорт `selectionTotals` из `./lib/dashboardMetrics`.
В компоненте `Projects` добавить `const [selectMode, setSelectMode] = useState(false);` и
`const [selectedIds, setSelectedIds] = useState(new Set());`. Кнопка-тумблер «Выбрать» рядом с
фильтрами стадий: включает `selectMode`, сбрасывает выбор при выключении.

- [ ] **Step 2: Чекбоксы на карточках.** В рендере карточки проекта при `selectMode` показать
чекбокс; клик переключает `selectedIds` (иммутабельно: новый Set). Клик по чекбоксу не должен
открывать модалку (stopPropagation).

- [ ] **Step 3: Сводная панель.** Под списком (или sticky снизу) при `selectMode && selectedIds.size > 0`:

```jsx
{(() => {
  const sel = projects.filter(p => selectedIds.has(p.id));
  const t = selectionTotals(sel, sharesByProject, ownerId);
  return (
    <div style={{ position: "sticky", bottom: 0, background: "#101012", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 12, padding: 14, marginTop: 12, zIndex: 30 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
        <span>Получено: <b style={{ color: "#6ee7a8" }}>{fmt(t.received)}</b></span>
        <span>К получению: <b style={{ color: t.remaining > 0 ? "#f8a3a3" : "#6b6b67" }}>{fmt(t.remaining)}</b></span>
        <span>Сумма договоров: <b>{fmt(t.contract)}</b></span>
        <span style={{ marginLeft: "auto", color: "#62646b" }}>выбрано: {sel.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 160, overflowY: "auto" }}>
        {t.breakdown.map(b => (
          <div key={b.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#a8a8a3" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
            <span style={{ color: "#6ee7a8" }}>{fmt(b.received)}</span>
          </div>
        ))}
      </div>
    </div>
  );
})()}
```

- [ ] **Step 4: Проверка сборки**

Run: `npm run build`
Expected: зелёная.

- [ ] **Step 5: Commit**

```
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* add src/App.jsx
git -C "F:\Сайт\redesign-v2-fresh" -c safe.directory=* commit -m "feat(payments): сводная панель по выбранным проектам на вкладке Проекты (#2)"
```

---

## Финальная верификация (после всех задач)

- [ ] `npm run test` — старые 55 + новые тесты зелёные.
- [ ] `npm run build` — зелёная.
- [ ] verify-payments-rls.sh → `PAYMENTS_RLS_OK`.
- [ ] Запрос-сверка `paid_amount = SUM(payments)` → 0 расхождений.
- [ ] Живая проверка владельцем (preview новый порт): ввод платежа → paid_amount/доли/дашборд
  пересчитались; Финансы за месяц включают проектный доход; панель №2 суммирует по выбранным.
- [ ] Деплой (фронт; миграции уже применены) + merge `feature/payment-history` → main + push — по команде.
