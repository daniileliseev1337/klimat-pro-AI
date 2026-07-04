# Умный импорт выписки Яндекс Банка v2 — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вынести парсинг и категоризацию банковской выписки из монолита `App.jsx` в тестируемый модуль `src/lib/bankParsers.js`, добавить классификацию типов операций, обучаемый категоризатор-цепочку и ручной review, где владелец — финальный арбитр.

**Architecture:** Чистые функции (парсинг/классификация/категоризация/дедуп) в `src/lib/bankParsers.js` под vitest. PDF-извлечение (pdf.js) остаётся тонкой обёрткой в `App.jsx` и передаёт готовые строки в чистую `parseYandexRows`. Выученные правила категорий хранятся в Supabase (`merchant_rules`, RLS «только владелец»), синк между устройствами. UI — усиление существующего `CsvImportModal`.

**Tech Stack:** React 18 + Vite 5 (plain JS, без TypeScript), vitest, Supabase (self-hosted, PostgREST + RLS), pdf.js (уже подключён через `loadPdfJs`).

**Спека:** `docs/superpowers/specs/2026-07-04-bank-import-v2-design.md`

## Global Constraints

- **Plain JS**, без TypeScript. Функции `camelCase`, комментарии по-русски (стиль `App.jsx`).
- **Тесты — vitest, только `src/lib/`** (существующий паттерн: 111 тестов в `src/lib/*.test.js`). App.jsx юнитами не покрывается.
- **Банк — только Яндекс.** Парсеры `parseTinkoff`/`parseSber`/`parseAlfa` НЕ трогаем (остаются рабочими).
- **LLM-слой [4]** — только интерфейс-заглушка `categorizeLLM(merchant) → Promise<null>`, реальная реализация вне scope.
- **Обезличивание:** тест-фикстуры без ПДн — ФИО/телефоны в переводах вырезаны, мерчанты/суммы реальны.
- **БД-гейт:** миграция `merchant_rules` кладётся в `supabase/migrations/`, применение к живой БД — ТОЛЬКО по явному «го» владельца (не в рамках выполнения плана).
- **RLS:** `merchant_rules` доступна только владельцу строки (`owner_id = auth.uid()`).
- **Коммиты частые** — после каждой задачи, с `-c core.fsyncMethod=writeout-only` (грабля F:).

---

## File Structure

| Файл | Ответственность |
|---|---|
| `src/lib/bankParsers.js` (создать) | Чистые функции: `normalizeMerchant`, MCC-таблица + `categorizeByMcc`, `categorizeByDict`, `categorize`, `classifyOperation`, `parseYandexRows`, `hashOperation`, `dedupe`, `categorizeLLM` (заглушка) |
| `src/lib/bankParsers.test.js` (создать) | vitest-тесты всех функций на обезличенных фикстурах |
| `supabase/migrations/20260704_0001_merchant_rules.sql` (создать) | Таблица `merchant_rules` + RLS + RPC `get_merchant_rules`/`upsert_merchant_rule` |
| `src/App.jsx` (модифицировать) | `extractYandexPdfRows` (pdf.js-обёртка) вызывает `parseYandexRows`; `CsvImportModal` — review-UI; API-обёртки `fetchMerchantRules`/`upsertMerchantRule`; удалить старые `CAT_RULES`/`guessCategory`/`parseYandex`/`parsePdfYandex` после переноса |

Порядок: сначала чистое ядро (`lib`, Задачи 1-7, полностью тестируемо и коммитится независимо), затем БД (Задача 8), затем интеграция в UI (Задачи 9-10).

---

## Task 1: `normalizeMerchant` — нормализация мерчанта в ключ

**Files:**
- Create: `src/lib/bankParsers.js`
- Test: `src/lib/bankParsers.test.js`

**Interfaces:**
- Produces: `normalizeMerchant(rawDesc: string) → string` (ключ для слоёв 1 и 3 категоризатора)

Нормализация: lowercase; заменить не-буквенно-цифровые на пробел; отбросить токены из одних цифр и короче 2 символов; взять первый значимый токен как бренд-ключ. Цель — «MAGNIT MM STANTSIONNYJ 12» и «MAGNIT 7745» дают один ключ `magnit`.

- [ ] **Step 1: Написать падающий тест**

```js
import { describe, it, expect } from "vitest";
import { normalizeMerchant } from "./bankParsers.js";

describe("normalizeMerchant", () => {
  it("сводит разные точки одной сети к одному ключу", () => {
    expect(normalizeMerchant("MAGNIT MM STANTSIONNYJ 12")).toBe("magnit");
    expect(normalizeMerchant("MAGNIT 7745")).toBe("magnit");
  });
  it("чистит спецсимволы и регистр", () => {
    expect(normalizeMerchant("Pyaterochka 5231")).toBe("pyaterochka");
    expect(normalizeMerchant("  VERNYJ 1300 ")).toBe("vernyj");
  });
  it("пустую строку отдаёт пустым ключом", () => {
    expect(normalizeMerchant("")).toBe("");
    expect(normalizeMerchant("   ")).toBe("");
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- bankParsers`
Expected: FAIL «normalizeMerchant is not a function» / модуль не найден.

- [ ] **Step 3: Минимальная реализация**

```js
// src/lib/bankParsers.js
// Умный импорт выписки Яндекс Банка v2. Чистые функции — покрыты vitest.

// Нормализация описания в ключ мерчанта: разные точки сети → один ключ.
export function normalizeMerchant(rawDesc) {
  const tokens = (rawDesc || "")
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(t => t.length >= 2 && !/^\d+$/.test(t));
  return tokens[0] || "";
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npm test -- bankParsers`
Expected: PASS (3 теста).

- [ ] **Step 5: Коммит**

```bash
git -c core.fsyncMethod=writeout-only add src/lib/bankParsers.js src/lib/bankParsers.test.js
git -c core.fsyncMethod=writeout-only commit -m "feat(bank-v2): normalizeMerchant + каркас lib/bankParsers"
```

---

## Task 2: MCC-таблица + `categorizeByMcc` (слой 2)

**Files:**
- Modify: `src/lib/bankParsers.js`
- Test: `src/lib/bankParsers.test.js`

**Interfaces:**
- Consumes: —
- Produces: `categorizeByMcc(rawDesc: string) → string | null` (категория или null, если MCC не найден). Формат MCC в описании Яндекса — `YANDEX*NNNN*` (NNNN — 4-значный MCC).

- [ ] **Step 1: Написать падающий тест**

```js
import { categorizeByMcc } from "./bankParsers.js";

describe("categorizeByMcc", () => {
  it("распознаёт MCC такси", () => {
    expect(categorizeByMcc("YANDEX*4121*TAXI")).toBe("Такси");
  });
  it("распознаёт MCC продуктов", () => {
    expect(categorizeByMcc("YANDEX*5411*LAVKA")).toBe("Питание");
  });
  it("возвращает null без MCC", () => {
    expect(categorizeByMcc("MAGNIT MM STANTSIONNYJ")).toBeNull();
    expect(categorizeByMcc("YANDEX*9999*UNKNOWN")).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- bankParsers`
Expected: FAIL «categorizeByMcc is not a function».

- [ ] **Step 3: Минимальная реализация**

```js
// Стандартные группы MCC → категория сайта. Расширяется по мере встреч.
const MCC_CATEGORIES = {
  "4121": "Такси", "4111": "Транспорт", "4131": "Транспорт",
  "5411": "Питание", "5412": "Питание", "5499": "Питание",
  "5812": "Питание", "5814": "Питание", "5813": "Питание",
  "5912": "Здоровье / аптека", "5122": "Здоровье / аптека",
  "5815": "ПО и инструменты", "5816": "ПО и инструменты",
  "4814": "Связь", "4812": "Связь",
  "5541": "Транспорт", "5542": "Транспорт",
};

// Категория по MCC из описания вида YANDEX*NNNN*. null — если MCC нет/неизвестен.
export function categorizeByMcc(rawDesc) {
  const m = (rawDesc || "").match(/\*(\d{4})\*/);
  if (!m) return null;
  return MCC_CATEGORIES[m[1]] || null;
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npm test -- bankParsers`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git -c core.fsyncMethod=writeout-only add src/lib/bankParsers.js src/lib/bankParsers.test.js
git -c core.fsyncMethod=writeout-only commit -m "feat(bank-v2): categorizeByMcc + таблица MCC (слой 2)"
```

---

## Task 3: `categorizeByDict` — словарь-затравка с границами слов (слой 3)

**Files:**
- Modify: `src/lib/bankParsers.js`
- Test: `src/lib/bankParsers.test.js`

**Interfaces:**
- Produces: `categorizeByDict(rawDesc: string) → string | null`. Матч по границам слов (НЕ `includes`), чинит ложные срабатывания.

Перенести `CAT_RULES` из `App.jsx:4167-4249` в `bankParsers.js` как есть (значения-ключи мерчантов), но матчить через границы слов.

- [ ] **Step 1: Написать падающий тест**

```js
import { categorizeByDict } from "./bankParsers.js";

describe("categorizeByDict", () => {
  it("узнаёт мерчанта по границе слова", () => {
    expect(categorizeByDict("MAGNIT MM STANTSIONNYJ")).toBe("Питание");
    expect(categorizeByDict("VERNYJ 1300")).toBe("Питание");
  });
  it("НЕ ловит подстроку внутри слова (чинит слабость substring)", () => {
    // 'spar' не должен срабатывать внутри 'sparta gym'
    expect(categorizeByDict("SPARTA GYM")).not.toBe("Питание");
    // 'metro' (транспорт) не должен ловить 'METRO CASH AND CARRY'
    expect(categorizeByDict("METRO CASH AND CARRY")).not.toBe("Транспорт");
  });
  it("возвращает null для незнакомого", () => {
    expect(categorizeByDict("SOME UNKNOWN SHOP")).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- bankParsers`
Expected: FAIL «categorizeByDict is not a function».

- [ ] **Step 3: Реализация**

Перенести массив `CAT_RULES` из `App.jsx:4167-4249` в начало `bankParsers.js` (без изменений содержимого). Добавить:

```js
// Матч ключа по границам слов внутри описания. Ключи с '*' (MCC-паттерны
// вида yandex*4121*taxi) матчатся как подстрока — они и так уникальны;
// обычные словарные ключи — по границам слов (чинит substring-слабость).
function keyMatches(desc, key) {
  if (key.includes("*")) return desc.includes(key);
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-zа-яё0-9])${esc}([^a-zа-яё0-9]|$)`, "i").test(desc);
}

// Категория по словарю-затравке. null — если ни одно правило не сработало.
export function categorizeByDict(rawDesc) {
  const d = (rawDesc || "").toLowerCase();
  for (const rule of CAT_RULES) {
    if (rule.keys.some(k => keyMatches(d, k.toLowerCase()))) return rule.cat;
  }
  return null;
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npm test -- bankParsers`
Expected: PASS. Если реальный ключ конфликтует с тестом границ слов — уточнить ключ в `CAT_RULES` (тест ведёт).

- [ ] **Step 5: Коммит**

```bash
git -c core.fsyncMethod=writeout-only add src/lib/bankParsers.js src/lib/bankParsers.test.js
git -c core.fsyncMethod=writeout-only commit -m "feat(bank-v2): categorizeByDict с границами слов (слой 3)"
```

---

## Task 4: `categorize` — цепочка слоёв + заглушка LLM

**Files:**
- Modify: `src/lib/bankParsers.js`
- Test: `src/lib/bankParsers.test.js`

**Interfaces:**
- Consumes: `normalizeMerchant`, `categorizeByMcc`, `categorizeByDict`
- Produces:
  - `categorizeLLM(merchant: string) → Promise<string|null>` (заглушка, всегда `null`)
  - `categorize(op: {rawDesc, type}, learned: Map<string,string>) → {category: string, source: "learned"|"mcc"|"dict"|"none"}` (синхронная; слой LLM подключается отдельно позже)

Приоритет: learned → mcc → dict → none. `learned` — Map ключ мерчанта → категория (из `merchant_rules`).

- [ ] **Step 1: Написать падающий тест**

```js
import { categorize } from "./bankParsers.js";

describe("categorize (цепочка)", () => {
  it("слой 1: выученное побеждает всё", () => {
    const learned = new Map([["magnit", "Особое"]]);
    const r = categorize({ rawDesc: "MAGNIT MM 12", type: "expense" }, learned);
    expect(r).toEqual({ category: "Особое", source: "learned" });
  });
  it("слой 2: MCC, если не выучено", () => {
    const r = categorize({ rawDesc: "YANDEX*4121*TAXI", type: "expense" }, new Map());
    expect(r).toEqual({ category: "Такси", source: "mcc" });
  });
  it("слой 3: словарь, если нет MCC", () => {
    const r = categorize({ rawDesc: "VERNYJ 1300", type: "expense" }, new Map());
    expect(r).toEqual({ category: "Питание", source: "dict" });
  });
  it("слой 5: незнакомый → none + Прочие", () => {
    const r = categorize({ rawDesc: "UNKNOWN XYZ", type: "expense" }, new Map());
    expect(r).toEqual({ category: "Прочие расходы", source: "none" });
  });
  it("незнакомый доход → Прочий доход", () => {
    const r = categorize({ rawDesc: "UNKNOWN XYZ", type: "income" }, new Map());
    expect(r).toEqual({ category: "Прочий доход", source: "none" });
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- bankParsers`
Expected: FAIL «categorize is not a function».

- [ ] **Step 3: Реализация**

```js
// Слой 4 (LLM) — заглушка. Реальная локальная модель подключается позже,
// не меняя сигнатуру: категоризатор станет async и вставит await между dict и none.
export async function categorizeLLM(_merchant) { return null; }

// Категоризатор-цепочка. Первый сработавший слой побеждает.
// learned: Map<merchantKey, category> из merchant_rules.
export function categorize(op, learned = new Map()) {
  const key = normalizeMerchant(op.rawDesc);
  if (key && learned.has(key)) return { category: learned.get(key), source: "learned" };
  const byMcc = categorizeByMcc(op.rawDesc);
  if (byMcc) return { category: byMcc, source: "mcc" };
  const byDict = categorizeByDict(op.rawDesc);
  if (byDict) return { category: byDict, source: "dict" };
  return { category: op.type === "income" ? "Прочий доход" : "Прочие расходы", source: "none" };
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npm test -- bankParsers`
Expected: PASS (5 тестов).

- [ ] **Step 5: Коммит**

```bash
git -c core.fsyncMethod=writeout-only add src/lib/bankParsers.js src/lib/bankParsers.test.js
git -c core.fsyncMethod=writeout-only commit -m "feat(bank-v2): categorize цепочка слоёв + заглушка LLM"
```

---

## Task 5: `classifyOperation` — типы операций + обезличивание

**Files:**
- Modify: `src/lib/bankParsers.js`
- Test: `src/lib/bankParsers.test.js`

**Interfaces:**
- Produces: `classifyOperation(op: {rawDesc, amount, sign}, meNames: string[]) → {opType: "payment"|"self_transfer"|"peer_transfer"|"technical", counterparty: string|null, cleanDesc: string}`
  - `opType`: перевод, где контрагент ∈ `meNames` → `self_transfer`; СБП физлицу (чужое ФИО) → `peer_transfer` (ФИО/телефон вырезаны из `cleanDesc`); капитализация/проценты/кэшбэк → `technical`; иначе `payment`.
  - `meNames` — варианты написания владельца (из настройки `self_names`).

- [ ] **Step 1: Написать падающий тест**

```js
import { classifyOperation } from "./bankParsers.js";

const ME = ["даниил владимирович е", "елисеев даниил"];

describe("classifyOperation", () => {
  it("перевод себе распознаётся по ФИО владельца", () => {
    const r = classifyOperation(
      { rawDesc: "Входящий перевод СБП, Даниил Владимирович Е.", amount: 147000, sign: 1 }, ME);
    expect(r.opType).toBe("self_transfer");
  });
  it("перевод физлицу обезличивается", () => {
    const r = classifyOperation(
      { rawDesc: "Исходящий перевод СБП, Римма Одеговна К., +79001234567", amount: 5000, sign: -1 }, ME);
    expect(r.opType).toBe("peer_transfer");
    expect(r.cleanDesc).not.toMatch(/Римма/);
    expect(r.cleanDesc).not.toMatch(/79001234567/);
  });
  it("техническая операция — капитализация", () => {
    const r = classifyOperation(
      { rawDesc: "Начисление процентов на остаток", amount: 320, sign: 1 }, ME);
    expect(r.opType).toBe("technical");
  });
  it("обычная оплата — payment", () => {
    const r = classifyOperation(
      { rawDesc: "MAGNIT MM STANTSIONNYJ", amount: 540, sign: -1 }, ME);
    expect(r.opType).toBe("payment");
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- bankParsers`
Expected: FAIL «classifyOperation is not a function».

- [ ] **Step 3: Реализация**

```js
const TRANSFER_RE = /перевод|перевода|сбп|transfer/i;
const TECH_RE = /капитализац|начислен\w* процент|проценты на остаток|кэшбэк|cashback|внутрибанк/i;
const PHONE_RE = /\+?\d[\d\s()-]{9,}\d/g;

function containsName(desc, names) {
  const d = desc.toLowerCase();
  return names.some(n => n && d.includes(n.toLowerCase()));
}

// Классификация типа операции + очистка ПДн из описания.
export function classifyOperation(op, meNames = []) {
  const desc = op.rawDesc || "";
  if (TECH_RE.test(desc)) {
    return { opType: "technical", counterparty: null, cleanDesc: desc };
  }
  if (TRANSFER_RE.test(desc)) {
    if (containsName(desc, meNames)) {
      return { opType: "self_transfer", counterparty: null, cleanDesc: "Перевод себе" };
    }
    // перевод физлицу — вырезаем телефон и всё после первой запятой (ФИО контрагента)
    const cleanDesc = desc.replace(PHONE_RE, "").split(",")[0].trim();
    return { opType: "peer_transfer", counterparty: null, cleanDesc: cleanDesc || "Перевод физлицу" };
  }
  return { opType: "payment", counterparty: null, cleanDesc: desc };
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npm test -- bankParsers`
Expected: PASS (4 теста).

- [ ] **Step 5: Коммит**

```bash
git -c core.fsyncMethod=writeout-only add src/lib/bankParsers.js src/lib/bankParsers.test.js
git -c core.fsyncMethod=writeout-only commit -m "feat(bank-v2): classifyOperation — типы операций + обезличивание"
```

---

## Task 6: `parseYandexRows` — чистый парсинг строк выписки

**Files:**
- Modify: `src/lib/bankParsers.js`
- Modify: `src/App.jsx` (разделить `parsePdfYandex`: pdf.js-извлечение остаётся, парсинг строк → в lib)
- Test: `src/lib/bankParsers.test.js`

**Interfaces:**
- Produces: `parseYandexRows(rows: string[]) → Array<{date: string, amount: number, sign: 1|-1, rawDesc: string}>`
  - `rows` — массив строк текста PDF, сгруппированных по вертикали (то, что pdf.js уже собирает в `parsePdfYandex`, `App.jsx:4397-4491`).
  - `date` → ISO `YYYY-MM-DD`; `amount` → положительное число; `sign` → знак операции.

Извлечь чистую логику разбора строки (дата + сумма + описание) из существующей `parsePdfYandex` (`App.jsx:4397-4491`). Регэкспы даты/суммы и правила SKIP перенести как есть. PDF-извлечение (`loadPdfJs`, чтение `arrayBuffer`, группировка по Y) остаётся в `App.jsx` новой функцией `extractYandexPdfRows(file) → string[]`, которая затем зовёт `parseYandexRows`.

- [ ] **Step 1: Написать падающий тест на обезличенных строках**

```js
import { parseYandexRows } from "./bankParsers.js";

describe("parseYandexRows", () => {
  it("разбирает строку оплаты", () => {
    const rows = ["04.07.2026 12:30 MAGNIT MM STANTSIONNYJ 540,00 ₽ -540,00"];
    const r = parseYandexRows(rows);
    expect(r[0]).toMatchObject({ date: "2026-07-04", amount: 540, sign: -1, rawDesc: expect.stringContaining("MAGNIT") });
  });
  it("разбирает входящий (положительный) и пропускает служебные строки", () => {
    const rows = [
      "Дата операции Описание Сумма",              // заголовок — SKIP
      "03.07.2026 Входящий перевод СБП 147 000,00", // sign +1
    ];
    const r = parseYandexRows(rows);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ date: "2026-07-03", amount: 147000, sign: 1 });
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- bankParsers`
Expected: FAIL «parseYandexRows is not a function».

- [ ] **Step 3: Реализация**

Перенести разбор из `App.jsx:4397-4491`. Ключевые части (сверить с оригиналом при переносе): регэксп даты `DATE_RE`, суммы `AMT_RE` (берётся последняя сумма в строке — «Сумма в валюте Договора»), пропуск служебных `SKIP_RE`, сборка многострочного описания. Сигнатура — принимает `rows: string[]`, возвращает массив `{date, amount, sign, rawDesc}` (вместо старого `{date, type, amount, description, bankCategory}` — тип/категория теперь считаются отдельно на следующих шагах). Пример каркаса:

```js
const YA_DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})/;
const YA_AMT_RE = /(-?\d[\d\s]*,\d{2})/g;
const YA_SKIP_RE = /^(дата|описание|итого|остаток|входящий остаток|исходящий остаток|продолжение)/i;

export function parseYandexRows(rows) {
  const out = [];
  for (const raw of rows) {
    const line = (raw || "").trim();
    if (!line || YA_SKIP_RE.test(line)) continue;
    const dm = line.match(YA_DATE_RE);
    if (!dm) continue;
    const date = `${dm[3]}-${dm[2]}-${dm[1]}`;
    const amounts = line.match(YA_AMT_RE);
    if (!amounts || !amounts.length) continue;
    const last = amounts[amounts.length - 1].replace(/\s/g, "").replace(",", ".");
    const val = parseFloat(last);
    if (isNaN(val) || val === 0) continue;
    const rawDesc = line
      .replace(YA_DATE_RE, "")
      .replace(/\d{2}:\d{2}/, "")
      .replace(YA_AMT_RE, "")
      .replace(/₽/g, "")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ date, amount: Math.abs(val), sign: val < 0 ? -1 : 1, rawDesc });
  }
  return out;
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npm test -- bankParsers`
Expected: PASS. Уточнить регэкспы на реальных обезличенных строках выписки (владелец даст образец; тест ведёт).

- [ ] **Step 5: Разделить `App.jsx` — pdf.js-обёртка зовёт `parseYandexRows`**

В `App.jsx` заменить тело `parsePdfYandex` (`4397-4491`): оставить извлечение строк через pdf.js (переименовать в `extractYandexPdfRows(file) → string[]`), затем `import { parseYandexRows } from "./lib/bankParsers.js"` и вернуть `parseYandexRows(rows)`. Старую inline-логику разбора удалить.

- [ ] **Step 6: Проверить сборку**

Run: `npm run build`
Expected: `✓ built`. Import из lib резолвится.

- [ ] **Step 7: Коммит**

```bash
git -c core.fsyncMethod=writeout-only add src/lib/bankParsers.js src/lib/bankParsers.test.js src/App.jsx
git -c core.fsyncMethod=writeout-only commit -m "feat(bank-v2): parseYandexRows (чистый парсинг) + разделение pdf.js-обёртки"
```

---

## Task 7: `hashOperation` + `dedupe` — защита от повторного импорта

**Files:**
- Modify: `src/lib/bankParsers.js`
- Test: `src/lib/bankParsers.test.js`

**Interfaces:**
- Consumes: `normalizeMerchant`
- Produces:
  - `hashOperation(op: {date, amount, rawDesc}) → string`
  - `dedupe(ops: Op[], existingHashes: Set<string>) → Array<Op & {dupe: boolean}>`

- [ ] **Step 1: Написать падающий тест**

```js
import { hashOperation, dedupe } from "./bankParsers.js";

describe("hashOperation + dedupe", () => {
  it("одинаковые операции дают одинаковый хеш", () => {
    const a = { date: "2026-07-04", amount: 540, rawDesc: "MAGNIT MM 12" };
    const b = { date: "2026-07-04", amount: 540, rawDesc: "MAGNIT MM 12" };
    expect(hashOperation(a)).toBe(hashOperation(b));
  });
  it("помечает уже существующие как dupe", () => {
    const op = { date: "2026-07-04", amount: 540, rawDesc: "MAGNIT MM 12" };
    const existing = new Set([hashOperation(op)]);
    const [r] = dedupe([op], existing);
    expect(r.dupe).toBe(true);
  });
  it("новую операцию не помечает", () => {
    const op = { date: "2026-07-05", amount: 100, rawDesc: "NEW SHOP" };
    const [r] = dedupe([op], new Set());
    expect(r.dupe).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npm test -- bankParsers`
Expected: FAIL «hashOperation is not a function».

- [ ] **Step 3: Реализация**

```js
// Ключ операции для дедупа: дата + сумма + нормализованный мерчант.
export function hashOperation(op) {
  return `${op.date}|${op.amount}|${normalizeMerchant(op.rawDesc)}`;
}

// Пометка повторов относительно множества хешей уже импортированных операций.
export function dedupe(ops, existingHashes = new Set()) {
  return ops.map(op => ({ ...op, dupe: existingHashes.has(hashOperation(op)) }));
}
```

- [ ] **Step 4: Запустить — убедиться, что проходит**

Run: `npm test -- bankParsers`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git -c core.fsyncMethod=writeout-only add src/lib/bankParsers.js src/lib/bankParsers.test.js
git -c core.fsyncMethod=writeout-only commit -m "feat(bank-v2): hashOperation + dedupe"
```

---

## Task 8: Миграция `merchant_rules` + RPC (Supabase)

**Files:**
- Create: `supabase/migrations/20260704_0001_merchant_rules.sql`

**Interfaces:**
- Produces (RPC под PostgREST):
  - `get_merchant_rules() → setof {merchant_key text, category text}`
  - `upsert_merchant_rule(p_merchant_key text, p_category text) → void`

**ВАЖНО:** миграция кладётся в репо. Применение к живой БД — по «го» владельца (гейт), НЕ в рамках выполнения этой задачи. «Тест» задачи — синтаксическая валидность SQL и ревью RLS.

- [ ] **Step 1: Написать миграцию**

```sql
-- merchant_rules: выученные категории мерчантов (личные, только владелец).
create table if not exists public.merchant_rules (
  owner_id     uuid not null references auth.users(id) on delete cascade,
  merchant_key text not null,
  category     text not null,
  updated_at   timestamptz not null default now(),
  primary key (owner_id, merchant_key)
);
alter table public.merchant_rules enable row level security;

create policy merchant_rules_owner_all on public.merchant_rules
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Чтение своих правил.
create or replace function public.get_merchant_rules()
returns setof public.merchant_rules
language sql security definer set search_path = public, pg_temp
as $$ select * from public.merchant_rules where owner_id = auth.uid() $$;

-- Upsert одного правила (обучение при правке категории в review).
create or replace function public.upsert_merchant_rule(p_merchant_key text, p_category text)
returns void
language sql security definer set search_path = public, pg_temp
as $$
  insert into public.merchant_rules (owner_id, merchant_key, category)
  values (auth.uid(), p_merchant_key, p_category)
  on conflict (owner_id, merchant_key)
  do update set category = excluded.category, updated_at = now();
$$;

grant execute on function public.get_merchant_rules() to authenticated;
grant execute on function public.upsert_merchant_rule(text, text) to authenticated;
```

- [ ] **Step 2: Проверить синтаксис (dry-run, без применения)**

Прогнать через локальный psql в docker в транзакции с ROLLBACK (read-only проверка синтаксиса, живую БД не меняем):
Run: `wsl bash -c "docker exec -i supabase-db psql -U postgres -v ON_ERROR_STOP=1 -c 'begin; \i /tmp/mig.sql; rollback;'"` (файл предварительно скопировать в контейнер).
Expected: без ошибок синтаксиса. При невозможности dry-run — ревью SQL глазами + `search_path` присутствует на обеих функциях.

- [ ] **Step 3: Коммит (применение — по «го» владельца отдельно)**

```bash
git -c core.fsyncMethod=writeout-only add supabase/migrations/20260704_0001_merchant_rules.sql
git -c core.fsyncMethod=writeout-only commit -m "feat(bank-v2): миграция merchant_rules + RPC (применение по го)"
```

---

## Task 9: API-обёртки `merchant_rules` во фронте

**Files:**
- Modify: `src/App.jsx` (рядом с прочими API-обёртками, напр. после `insertTransactionsBulk`)

**Interfaces:**
- Consumes: RPC `get_merchant_rules`, `upsert_merchant_rule` (Task 8)
- Produces:
  - `fetchMerchantRules(client) → Promise<Map<string,string>>` (ключ мерчанта → категория)
  - `upsertMerchantRule(client, merchantKey, category) → Promise<void>`

**ВАЖНО:** без применённой миграции (Task 8) RPC вернёт ошибку — это ожидаемо до «го». Обёртки best-effort: при ошибке `fetchMerchantRules` возвращает пустой Map (импорт работает без выученного).

- [ ] **Step 1: Реализация обёрток**

```js
async function fetchMerchantRules(client) {
  try {
    const { data, error } = await client.rpc("get_merchant_rules");
    if (error) throw error;
    return new Map((data || []).map(r => [r.merchant_key, r.category]));
  } catch (e) { console.warn("merchant_rules fetch failed:", e); return new Map(); }
}

async function upsertMerchantRule(client, merchantKey, category) {
  if (!merchantKey) return;
  try {
    await client.rpc("upsert_merchant_rule", { p_merchant_key: merchantKey, p_category: category });
  } catch (e) { console.warn("merchant_rule upsert failed:", e); }
}
```

- [ ] **Step 2: Проверить сборку**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 3: Коммит**

```bash
git -c core.fsyncMethod=writeout-only add src/App.jsx
git -c core.fsyncMethod=writeout-only commit -m "feat(bank-v2): API-обёртки merchant_rules (best-effort)"
```

---

## Task 10: Интеграция в `CsvImportModal` — review-экран

**Files:**
- Modify: `src/App.jsx` (`CsvImportModal` ~5482; использование `guessCategory` ~5504/5523; удалить старые `CAT_RULES`/`guessCategory`/`parseYandex` после переноса)

**Interfaces:**
- Consumes: `parseYandexRows`, `classifyOperation`, `categorize`, `dedupe`, `normalizeMerchant` (lib); `fetchMerchantRules`, `upsertMerchantRule` (App.jsx); настройка `self_names`.

Усилить существующий предпросмотр: при загрузке выписки прогнать операции через `classifyOperation` + `categorize` (с выученными правилами) + `dedupe`; показать тип-бейдж, редактируемую категорию, метку `source`, приглушить `self_transfer`, пометить `dupe`; при импорте — сохранить правки категорий в `merchant_rules`.

- [ ] **Step 1: Загрузить выученные правила при открытии модалки**

В `CsvImportModal` добавить состояние и загрузку:
```js
const [learned, setLearned] = useState(new Map());
useEffect(() => { fetchMerchantRules(client).then(setLearned); /* eslint-disable-next-line */ }, []);
```
(проброс `client` в `CsvImportModal`, если ещё не передан — добавить проп.)

- [ ] **Step 2: Прогнать операции через ядро при парсинге PDF**

Заменить обогащение после `extractYandexPdfRows`/`parseYandexRows`:
```js
const meNames = selfNames || []; // проп selfNames (из настройки self_names владельца, Step 5)
const enriched = dedupe(parsed, existingHashes).map((op, i) => {
  const cls = classifyOperation(op, meNames);
  const cat = categorize({ rawDesc: op.rawDesc, type: op.sign < 0 ? "expense" : "income" }, learned);
  return {
    ...op, i,
    opType: cls.opType,
    description: cls.cleanDesc,
    category: cat.category,
    source: cat.source,
    skip: cls.opType === "self_transfer" || op.dupe, // по умолчанию не импортируем переводы себе и дубли
  };
});
```
`existingHashes` — Set хешей уже загруженных транзакций (собрать из `txs` через `hashOperation`, передать пропом или считать в модалке).

- [ ] **Step 3: Review-таблица — бейдж типа, селект категории, метка source, пометки**

В рендере строки предпросмотра добавить: бейдж `opType`, `<select>` категории (список из `PROJECT`-независимого справочника категорий — вынести константу `CATEGORIES` рядом с `CAT_RULES`), подпись `source` (`выучено`/`MCC`/`словарь`/`нужен выбор`), приглушение при `self_transfer`, иконку замка при `peer_transfer`, пометку «дубль» при `dupe`. Правка селекта → `setEdited(...)`.

- [ ] **Step 4: При импорте — сохранить правки в merchant_rules**

В обработчике импорта (после `onImport(toAdd)`), для операций типа `payment`, где пользователь выбрал/подтвердил категорию:
```js
for (const r of toAdd.filter(x => x.opType === "payment")) {
  const key = normalizeMerchant(r.rawDesc);
  if (key) await upsertMerchantRule(client, key, r.category);
}
```

- [ ] **Step 5: Настройка «мои ФИО» (`self_names`)**

Хранить массив вариантов ФИО владельца. Минимально — константа/поле в профиле; seed из шапки выписки. Прокинуть в `CsvImportModal` как проп `selfNames`. (Полноценный UI-редактор настройки — отдельная микрозадача, вне критического пути; для старта достаточно значения из профиля владельца.)

- [ ] **Step 6: Удалить мёртвый код**

Удалить из `App.jsx`: старый `parseYandex` (CSV-ветка Яндекса, если заменена), `parsePdfYandex` inline-разбор (заменён Task 6), `guessCategory` и `CAT_RULES` (перенесены в lib). `detectBank`/`parseCSV`/`parseTinkoff`/`parseSber`/`parseAlfa` — ОСТАВИТЬ (другие банки вне scope, но рабочие). Сверить, что `guessCategory` больше нигде не вызывается (`5504`/`5523` заменены на `categorize`).

- [ ] **Step 7: Проверить сборку и тесты**

Run: `npm run build && npm test`
Expected: `✓ built`; все тесты зелёные (111 прежних + новые bankParsers).

- [ ] **Step 8: Коммит**

```bash
git -c core.fsyncMethod=writeout-only add src/App.jsx
git -c core.fsyncMethod=writeout-only commit -m "feat(bank-v2): review-экран CsvImportModal + обучение merchant_rules"
```

---

## Финал (после всех задач)

- **Ручная проверка на реальной выписке** (владелец): импортировать свежий PDF, проверить типы/категории/дедуп/обезличивание, поправить пару категорий → убедиться, что запомнились.
- **Применение миграции** `merchant_rules` к живой БД — по «го» владельца (Task 8 гейт).
- **Обновить** `docs/STATUS.md` (банк v2 — в работе/готово) и `docs/IDEAS.md`.
- **LLM-слой [4]** и **push-real-time канал** — следующие итерации (вне этого плана).

## Примечания по гейтам владельца

- Задачи 1-7, 9 — чистый код/тесты/сборка, без живой БД → выполняются свободно.
- Задача 8 (миграция) — коммит в репо свободно; **применение к БД — по «го»**.
- Деплой на прод (после интеграции) — по «го», с уроком: build в ОСНОВНОМ репо, `deploy-web.sh`, сверка asset.
