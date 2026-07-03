# Онбординг-навигатор Этап 1 (Помощь + CommandPalette) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать каждому пользователю (сотрудник/заказчик/посетитель) справку «что тут есть и где» — раздел «Помощь» + командную палитру как навигатор, показывая только доступные его роли разделы.

**Architecture:** Контент справки — чистые данные в `src/lib/helpContent.js` + чистая функция `helpSectionsFor(allowedTabIds)`, которая фильтрует секции по УЖЕ существующему списку доступных вкладок роли (`TABS.map(t=>t.id)`, App.jsx:9459). Так §1 (заказчик не видит чужих разделов) соблюдается автоматически — новой ролевой логики не вводим. UI: отдельный компонент `HelpModal.jsx` (список секций), кнопка «?» в шапке, команда «Помощь» в CommandPalette.

**Tech Stack:** React 18, Vite 5, vitest 2 (env node — тестируем только чистую логику `lib/`), lucide-react (иконки), framer-motion (анимации, уже в App).

## Global Constraints

- Язык интерфейса — русский; контент справки на русском.
- Новые куски — отдельными файлами, НЕ разрастать монолит `src/App.jsx` (правило CLAUDE.md).
- §1 приватность: заказчик/посетитель НЕ должны видеть в справке даже упоминаний недоступных им разделов (себестоимость/доли/чужие вкладки). Фильтр — только через `allowedTabs`, без хардкода ролей в контенте.
- Тесты env node: покрываем ТОЛЬКО чистую логику (`helpContent.js`). UI-задачи верифицируются `npm run build` + визуально.
- Стиль — premium-dark, реюз существующих примитивов (`Modal` App.jsx:1555 как образец разметки).
- Vitest-паттерн проекта: `import { describe, it, expect } from 'vitest'`, файл рядом с исходником `*.test.js`.
- Коммиты частые, конвенция: `feat(onboarding): …`. В конце — `git push origin main` (авто-режим).

---

### Task 1: Контент справки + чистый фильтр по роли (`helpContent.js`)

**Files:**
- Create: `src/lib/helpContent.js`
- Test: `src/lib/helpContent.test.js`

**Interfaces:**
- Produces:
  - `HELP_SECTIONS: Array<{ tab: string|null, key: string, title: string, desc: string, how: string }>` — секция с `tab:null` общая (видна всем), иначе привязана к id вкладки.
  - `helpSectionsFor(allowedTabIds: string[]): typeof HELP_SECTIONS` — секции где `tab===null` ИЛИ `tab ∈ allowedTabIds`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/lib/helpContent.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { HELP_SECTIONS, helpSectionsFor } from './helpContent.js';

describe('helpContent', () => {
  it('общие секции (tab=null) видны при любом наборе вкладок', () => {
    const keys = helpSectionsFor([]).map(s => s.key);
    expect(keys).toContain('about');
    expect(keys).toContain('search');
  });
  it('секция вкладки видна только если вкладка разрешена', () => {
    expect(helpSectionsFor(['projects']).map(s => s.key)).toContain('projects');
    expect(helpSectionsFor(['dashboard']).map(s => s.key)).not.toContain('projects');
  });
  it('§1: заказчик (4 вкладки) не видит employee-секций', () => {
    const client = helpSectionsFor(['dashboard', 'projects', 'tasks', 'finance']).map(s => s.key);
    expect(client).not.toContain('clients');
    expect(client).not.toContain('requests');
    expect(client).not.toContain('admin');
    expect(client).not.toContain('analytics');
  });
  it('сотрудник-админ видит admin-секцию', () => {
    expect(helpSectionsFor(['dashboard', 'admin']).map(s => s.key)).toContain('admin');
  });
  it('каждая секция имеет непустые title/desc/how и уникальный key', () => {
    const keys = new Set();
    for (const s of HELP_SECTIONS) {
      expect(s.title, s.key).toBeTruthy();
      expect(s.desc, s.key).toBeTruthy();
      expect(s.how, s.key).toBeTruthy();
      expect(keys.has(s.key), `dup ${s.key}`).toBe(false);
      keys.add(s.key);
    }
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run src/lib/helpContent.test.js`
Expected: FAIL — `Failed to resolve import './helpContent.js'`.

- [ ] **Step 3: Написать минимальную реализацию**

Создать `src/lib/helpContent.js`. Ключи `tab` должны совпадать с id вкладок из App.jsx:9418-9444 (`dashboard/projects/tasks/clients/requests/myorders/finance/analytics/admin`):

```js
// Контент справки «Помощь / Возможности». Чистые данные + фильтр по доступным вкладкам роли.
// tab=null — общая секция (видна всем). tab='projects' — видна, только если вкладка доступна роли
// (переиспользует allowedTabs из App.jsx → §1 соблюдается без хардкода ролей).

export const HELP_SECTIONS = [
  { tab: null, key: "about", title: "Что это за приложение",
    desc: "Личный рабочий центр: проекты, задачи, финансы и команда в одном месте. Ниже — что где находится.",
    how: "Открывается кнопкой «?» в шапке или командой «Помощь» (Ctrl/Cmd+K)." },
  { tab: "dashboard", key: "dashboard", title: "Дашборд",
    desc: "Сводка: ключевые показатели, ближайшие сроки и то, что требует внимания.",
    how: "Вкладка «Дашборд» в верхней навигации." },
  { tab: "projects", key: "projects", title: "Проекты",
    desc: "Список проектов, карточки с быстрым редактированием стадии, команды и оплаты, история изменений.",
    how: "Вкладка «Проекты»." },
  { tab: "tasks", key: "tasks", title: "Задачи",
    desc: "Задачи проектов: список с фильтрами и доска. У задачи — ТЗ, комментарии, фото, приёмка работы.",
    how: "Вкладка «Задачи»." },
  { tab: "finance", key: "finance", title: "Финансы",
    desc: "Движение денег по проектам: договор, оплачено, остаток; импорт банковских выписок и категории.",
    how: "Вкладка «Финансы»." },
  { tab: "analytics", key: "analytics", title: "Аналитика",
    desc: "Графики и разрезы: доходы/расходы по категориям, динамика, показатели проектов.",
    how: "Вкладка «Аналитика»." },
  { tab: "clients", key: "clients", title: "Заказчики",
    desc: "База заказчиков и привязка к ним проектов; выдача заказчику доступа в его портал.",
    how: "Вкладка «Заказчики»." },
  { tab: "requests", key: "requests", title: "Заявки",
    desc: "Входящие заявки заказчиков на новые проекты — принять или отклонить.",
    how: "Вкладка «Заявки»." },
  { tab: "myorders", key: "myorders", title: "Мои заказы",
    desc: "Ваши проекты как заказчика: статус, задачи на приёмке, оплата.",
    how: "Вкладка «Мои заказы»." },
  { tab: "admin", key: "admin", title: "Администрирование",
    desc: "Пользователи и роли: одобрение, назначение ролей, создание пользователя, сброс пароля.",
    how: "Вкладка «Admin» (только администратору)." },
  { tab: null, key: "search", title: "Быстрый поиск и команды",
    desc: "Мгновенный переход по разделам, проектам, задачам и заказам, не листая меню.",
    how: "Клавиши Ctrl+K (на Mac ⌘K) или бейдж «Поиск» в шапке." },
  { tab: null, key: "profile", title: "Профиль и уведомления",
    desc: "Имя, должность, настройки уведомлений, push на устройство, высокий контраст.",
    how: "Клик по своему имени/аватару в шапке." },
];

export function helpSectionsFor(allowedTabIds) {
  const allow = new Set(allowedTabIds || []);
  return HELP_SECTIONS.filter((s) => s.tab === null || allow.has(s.tab));
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npx vitest run src/lib/helpContent.test.js`
Expected: PASS (5 тестов). Затем `npx vitest run` — вся сюита зелёная (было 104 → станет 109).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/helpContent.js src/lib/helpContent.test.js
git commit -m "feat(onboarding): helpContent — контент справки + фильтр по роли (TDD)"
```

---

### Task 2: Компонент `HelpModal.jsx`

**Files:**
- Create: `src/components/HelpModal.jsx`

**Interfaces:**
- Consumes: `HELP_SECTIONS` shape из Task 1 (`{ title, desc, how }`).
- Produces: `export default function HelpModal({ sections, onClose })` — модалка со списком секций. Рендерит `sections` как есть (фильтрацию делает App, не модалка — SRP).

- [ ] **Step 1: Реализовать компонент**

Создать `src/components/HelpModal.jsx` (разметка/стиль — по образцу `Modal` App.jsx:1555, но самостоятельный портал, чтобы не тянуть App-локальный `Modal`):

```jsx
import { createPortal } from "react-dom";
import { HelpCircle, X } from "lucide-react";

// Раздел «Помощь / Возможности»: список доступных пользователю разделов с описанием и «как открыть».
// Фильтрацию секций по роли делает App (передаёт готовый sections) — здесь только отрисовка.
export default function HelpModal({ sections = [], onClose }) {
  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 200, background: "rgba(8,9,15,0.80)",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#1c1c1a", border: "1px solid var(--border-gold-subtle)", borderRadius: 18,
        width: "100%", maxWidth: "min(100vw - 32px, 560px)", maxHeight: "88vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 40px -10px var(--gold-glow)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px",
          borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <HelpCircle size={20} color="var(--gold, #d4af37)" />
          <span style={{ fontSize: 16, fontWeight: 600, color: "#fafaf7", flex: 1 }}>Возможности и помощь</span>
          <button onClick={onClose} aria-label="Закрыть"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#9a9a95", padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {sections.map((s) => (
            <div key={s.key} style={{ padding: "12px 14px", borderRadius: 12,
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fafaf7", marginBottom: 4 }}>{s.title}</div>
              <div style={{ fontSize: 13, color: "#cfcfca", lineHeight: 1.5, marginBottom: 6 }}>{s.desc}</div>
              <div style={{ fontSize: 12, color: "#8a8a85" }}>{s.how}</div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 2: Проверить сборку**

Run: `npm run build`
Expected: зелёная сборка, без ошибок импорта (`HelpModal` пока не смонтирован — проверяем только что файл валиден).

- [ ] **Step 3: Коммит**

```bash
git add src/components/HelpModal.jsx
git commit -m "feat(onboarding): HelpModal — модалка списка разделов (premium-dark)"
```

---

### Task 3: Интеграция в шапку App.jsx (кнопка «?» + монтирование)

**Files:**
- Modify: `src/App.jsx` (импорты ~1-13; стейт ~9141; шапка ~9558; монтирование ~9856)

**Interfaces:**
- Consumes: `HelpModal` (Task 2), `helpSectionsFor` + вкладки `TABS` (App.jsx:9418), `HelpCircle` (lucide).

- [ ] **Step 1: Добавить импорты**

В шапке файла: к `import CommandPalette from "./components/CommandPalette";` (App.jsx:12) добавить строкой ниже:

```jsx
import HelpModal from "./components/HelpModal";
import { helpSectionsFor } from "./lib/helpContent";
```

Убедиться, что `HelpCircle` есть в импорте из `lucide-react` (если нет — добавить в список иконок).

- [ ] **Step 2: Добавить стейт**

Рядом с `const [profileModal, setProfileModal] = useState(false);` (App.jsx:9141) добавить:

```jsx
const [helpOpen, setHelpOpen] = useState(false); // онбординг: раздел «Помощь»
```

- [ ] **Step 3: Кнопка «?» в шапке**

Сразу ПОСЛЕ блока бейджа палитры (закрывающий `</div>` на App.jsx:9558, перед `<NotificationBell`) вставить:

```jsx
<button onClick={() => setHelpOpen(true)} title="Возможности и помощь"
  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34,
    borderRadius: 8, cursor: "pointer", background: "rgba(212,175,55,0.10)",
    border: "1px solid rgba(212,175,55,0.30)", color: "#d4af37" }}>
  <HelpCircle size={18} />
</button>
```

- [ ] **Step 4: Смонтировать модалку**

Рядом с `{profileModal && <ProfileModal … />}` (App.jsx:9856) добавить:

```jsx
{helpOpen && <HelpModal sections={helpSectionsFor(TABS.map((t) => t.id))} onClose={() => setHelpOpen(false)} />}
```

- [ ] **Step 5: Проверить сборку и вручную**

Run: `npm run build`
Expected: зелёная. Затем `npm run dev` → в шапке появилась «?», клик открывает модалку; под сотрудником видно все разделы, под заказчиком (переключатель вида «Портал заказчика») — только Дашборд/Проекты/Задачи/Финансы + общие (about/search/profile), БЕЗ clients/requests/admin/analytics.

- [ ] **Step 6: Коммит**

```bash
git add src/App.jsx
git commit -m "feat(onboarding): кнопка «Помощь» в шапке + монтирование HelpModal по роли"
```

---

### Task 4: CommandPalette как навигатор (команда «Помощь»)

**Files:**
- Modify: `src/components/CommandPalette.jsx`
- Modify: `src/App.jsx` (обработчик `onNavigate` ~9460; проброс `onOpenHelp`)

**Interfaces:**
- Consumes: `setHelpOpen` из App (Task 3).
- Produces: в палитре — пункт `{ kind: "help", … }`, всегда доступный (общая команда); App в `onNavigate` открывает `HelpModal`.

- [ ] **Step 1: Добавить пункт «Помощь» в палитру**

В `CommandPalette.jsx`: расширить сигнатуру пропсов (строка 15) — добавить `onOpenHelp`. В `useMemo` (после блока секций, до `if (ql)` — строка ~31) добавить общий пункт, фильтруемый по запросу:

```jsx
if (!ql || "помощь возможности справка help".includes(ql)) {
  out.push({ kind: "help", id: "help", label: "Помощь и возможности", hint: "Справка" });
}
```

- [ ] **Step 2: Обработать выбор в App**

В `onNavigate` (App.jsx:9460-9462), где обрабатываются `it.kind`, добавить ветку:

```jsx
else if (it.kind === "help") setHelpOpen(true);
```

И в проп-передаче `<CommandPalette … />` (App.jsx:9457-9459) добавить `onOpenHelp` не нужно (открытие идёт через onNavigate/kind:"help") — проверить, что `onNavigate` уже прокинут (да, строка 9460). Проп `onOpenHelp` из Step 1 оставить опциональным на будущее либо убрать — YAGNI: убрать из сигнатуры, если не используется.

- [ ] **Step 3: Проверить сборку и вручную**

Run: `npm run build`
Expected: зелёная. `npm run dev` → Ctrl+K → пункт «Помощь и возможности» вверху; ввод «помощь» его находит; Enter открывает HelpModal. Проверить под заказчиком — команда «Помощь» тоже работает, модалка показывает только его разделы.

- [ ] **Step 4: Финальный прогон тестов + коммит + пуш**

```bash
npx vitest run          # 109 зелёных
npm run build           # зелёная
git add src/components/CommandPalette.jsx src/App.jsx
git commit -m "feat(onboarding): команда «Помощь» в CommandPalette-навигаторе"
git push origin main
```

---

## Self-Review (выполнено при написании плана)

**1. Spec coverage** (`docs/superpowers/specs/2026-07-03-onboarding-navigator-design.md`):
- Справочник разделов `HELP_SECTIONS` в отдельном `helpContent.js` → Task 1. ✓
- Раздел «Помощь» модалкой premium-dark → Task 2 + Task 3. ✓
- CommandPalette-навигатор + команда «Помощь» → Task 4. ✓
- Все роли, фильтр по своим разделам (§1) → Task 1 (`helpSectionsFor` через allowedTabs), тест §1. ✓
- Точки входа: «?» в шапке + Ctrl+K → Task 3 + Task 4. (Пункт в ProfileModal — опционально, НЕ в Этапе 1; отмечено в спеке как «+ пункт в ProfileModal» — вынести в follow-up, чтобы не раздувать; зафиксировать в STATUS.)
- vitest на фильтрацию по ролям → Task 1 Step 1. ✓
- Этап 2 (тур-coachmarks) — вне этого плана (спек: отдельная фича). ✓

**2. Placeholder scan:** код приведён полностью во всех шагах; «add validation/error handling» — нет; тест-код реальный. ✓

**3. Type consistency:** `helpSectionsFor(allowedTabIds)` — сигнатура одна в Task 1/3; поля секции `{tab,key,title,desc,how}` — единообразны в Task 1/2; `kind:"help"` — согласован Task 4 палитра↔App. ✓

**Отклонение от спека, зафиксировать:** точка входа «пункт в ProfileModal» перенесена в follow-up (Этап 1 даёт «?» в шапке + Ctrl+K — достаточно для доступности; ProfileModal-пункт не несёт новой логики). Обновить STATUS при старте.
