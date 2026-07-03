# Онбординг-тур Этап 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Слайд-тур по разделам при первом входе (авто) + повторный запуск из «Помощи», контент по роли (реюз helpContent).

**Architecture:** Тур переиспользует роль-фильтрованные секции `helpSectionsFor(TABS.map(t=>t.id))` (Этап 1, §1 бесплатно). Новый `TourModal.jsx` листает их слайдами. Авто-старт по `localStorage("kp-tour-seen")` через чистый хелпер `shouldAutoStartTour`. Кнопка повторного запуска — в существующем HelpModal.

**Tech Stack:** React 18, Vite 5, vitest 2 (env node — тест только чистой логики), lucide-react, createPortal.

## Global Constraints
- Язык UI — русский.
- Новые куски — отдельными файлами; App.jsx править ТОЧЕЧНО (монолит).
- §1: контент тура — ТОЛЬКО через `helpSectionsFor(allowedTabs)`, без хардкода ролей (наследует Этап 1).
- Стиль premium-dark, реюз визуального языка HelpModal.jsx (портал, тёмный фон, золотые токены).
- localStorage-доступ оборачивать в try/catch (как существующие `km_view_mode`/`kp-hc` в App.jsx).
- Тесты env node: покрываем только `shouldAutoStartTour`. UI — build + визуально.
- Коммиты feat(onboarding): ...; НЕ пуш/merge (контроллер по «го»).

---

### Task 1: Хелпер авто-старта `shouldAutoStartTour` (TDD)

**Files:**
- Modify: `src/lib/helpContent.js` (добавить экспорт в конец)
- Modify: `src/lib/helpContent.test.js` (добавить describe)

**Interfaces:**
- Produces: `shouldAutoStartTour(seenFlag: string|null|undefined): boolean` — `true`, если тур ещё не видели (`seenFlag !== "1"`).

- [ ] **Step 1: Написать падающий тест** — добавить в `src/lib/helpContent.test.js`:

```js
describe('shouldAutoStartTour', () => {
  it('true когда флаг не "1" (тур не видели)', () => {
    expect(shouldAutoStartTour(null)).toBe(true);
    expect(shouldAutoStartTour(undefined)).toBe(true);
    expect(shouldAutoStartTour('')).toBe(true);
  });
  it('false когда тур уже видели (флаг "1")', () => {
    expect(shouldAutoStartTour('1')).toBe(false);
  });
});
```
И добавить `shouldAutoStartTour` в строку импорта сверху файла:
`import { HELP_SECTIONS, helpSectionsFor, shouldAutoStartTour } from './helpContent.js';`

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/lib/helpContent.test.js`
Expected: FAIL — `shouldAutoStartTour is not a function` / import undefined.

- [ ] **Step 3: Реализация** — добавить в конец `src/lib/helpContent.js`:

```js
// Онбординг-тур: показывать ли авто при входе. "1" = уже видели (localStorage kp-tour-seen).
export function shouldAutoStartTour(seenFlag) {
  return seenFlag !== "1";
}
```

- [ ] **Step 4: Запустить — проходит**

Run: `npx vitest run` — вся сюита зелёная (было 109 → станет 111).

- [ ] **Step 5: Коммит**

```bash
git add src/lib/helpContent.js src/lib/helpContent.test.js
git commit -m "feat(onboarding): shouldAutoStartTour — хелпер авто-старта тура (TDD)"
```

---

### Task 2: Компонент `TourModal.jsx` (слайд-тур)

**Files:**
- Create: `src/components/TourModal.jsx`

**Interfaces:**
- Consumes: секции формы `{ key, title, desc, how }` (из helpContent).
- Produces: `export default function TourModal({ sections, onClose })` — слайд-тур; `onClose` вызывается на Готово/Пропустить/Esc/клик-фон.

- [ ] **Step 1: Реализовать компонент** — создать `src/components/TourModal.jsx`:

```jsx
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Compass, X } from "lucide-react";

// Онбординг-тур: слайд-тур по разделам. sections — готовый роль-фильтрованный массив (фильтрацию
// делает App через helpSectionsFor). Показывает по одной секции, листание кнопками/стрелками.
export default function TourModal({ sections = [], onClose }) {
  const [idx, setIdx] = useState(0);

  // пустой тур не показываем — сразу закрыть
  useEffect(() => { if (!sections.length) onClose?.(); }, [sections.length, onClose]);

  // клавиатура: ← → листают, Esc закрывает
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(i + 1, sections.length - 1));
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sections.length, onClose]);

  if (!sections.length) return null;
  const i = Math.min(idx, sections.length - 1);
  const s = sections[i];
  const last = i >= sections.length - 1;
  const btn = (bg, color, border) => ({
    padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 600,
    background: bg, color, border: border || "none",
  });

  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 210, background: "rgba(8,9,15,0.82)",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#1c1c1a", border: "1px solid var(--border-gold-subtle)", borderRadius: 18,
        width: "100%", maxWidth: "min(100vw - 32px, 480px)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 40px -10px var(--gold-glow)", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px",
          borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <Compass size={20} color="var(--gold, #d4af37)" />
          <span style={{ fontSize: 15, fontWeight: 600, color: "#fafaf7", flex: 1 }}>Экскурсия по разделам</span>
          <button onClick={onClose} aria-label="Пропустить"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#9a9a95", padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: "20px 18px", minHeight: 120 }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: "#fafaf7", marginBottom: 8 }}>{s.title}</div>
          <div style={{ fontSize: 14, color: "#cfcfca", lineHeight: 1.55, marginBottom: 10 }}>{s.desc}</div>
          <div style={{ fontSize: 12, color: "#8a8a85" }}>{s.how}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 6, padding: "4px 0 10px" }}>
          {sections.map((sec, k) => (
            <span key={sec.key} style={{ width: 6, height: 6, borderRadius: "50%",
              background: k === i ? "var(--gold, #d4af37)" : "rgba(255,255,255,0.18)" }} />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px",
          borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={() => setIdx((x) => Math.max(x - 1, 0))} disabled={i === 0}
            style={{ ...btn("rgba(255,255,255,0.06)", i === 0 ? "#55554f" : "#cfcfca"), cursor: i === 0 ? "default" : "pointer" }}>
            Назад
          </button>
          <span style={{ fontSize: 12, color: "#6b6b67" }}>{i + 1} из {sections.length}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={btn("transparent", "#8a8a85", "1px solid rgba(255,255,255,0.12)")}>Пропустить</button>
          {last
            ? <button onClick={onClose} style={btn("var(--gold, #d4af37)", "#1a1a17")}>Готово</button>
            : <button onClick={() => setIdx((x) => Math.min(x + 1, sections.length - 1))} style={btn("var(--gold, #d4af37)", "#1a1a17")}>Далее</button>}
        </div>
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 2: Сборка**

Run: `npm run build` — зелёная (компонент валиден, ещё не смонтирован).

- [ ] **Step 3: Коммит**

```bash
git add src/components/TourModal.jsx
git commit -m "feat(onboarding): TourModal — слайд-тур по разделам (premium-dark)"
```

---

### Task 3: Интеграция — HelpModal «Пройти тур» + App.jsx (авто-старт, монтаж)

**Files:**
- Modify: `src/components/HelpModal.jsx` (проп `onStartTour` + кнопка)
- Modify: `src/App.jsx` (импорты, стейт, useEffect, монтаж, проп в HelpModal)

**Interfaces:**
- Consumes: `TourModal` (Task 2), `shouldAutoStartTour` (Task 1), существующие `helpSectionsFor`, `helpOpen`/`setHelpOpen`, `TABS`, переменная фазы готовности App.

- [ ] **Step 1: HelpModal — кнопка «Пройти тур»**

В `src/components/HelpModal.jsx`: расширить сигнатуру до `HelpModal({ sections = [], onClose, onStartTour })`. В шапке модалки, между заголовком и кнопкой закрытия (X), добавить условную кнопку:

```jsx
{onStartTour && (
  <button onClick={onStartTour}
    style={{ padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600,
      background: "rgba(212,175,55,0.12)", border: "1px solid rgba(212,175,55,0.30)", color: "#d4af37" }}>
    Пройти тур
  </button>
)}
```
(разместить перед `<button onClick={onClose} aria-label="Закрыть">`; заголовок-span уже имеет `flex:1`, кнопка встанет справа от него.)

- [ ] **Step 2: App.jsx — импорты**

Рядом с `import HelpModal from "./components/HelpModal";` добавить:
```jsx
import TourModal from "./components/TourModal";
```
В строке импорта из `./lib/helpContent` добавить `shouldAutoStartTour`:
```jsx
import { helpSectionsFor, shouldAutoStartTour } from "./lib/helpContent";
```

- [ ] **Step 3: App.jsx — стейт + обработчик закрытия**

Рядом с `const [helpOpen, setHelpOpen] = useState(false);` добавить:
```jsx
const [tourOpen, setTourOpen] = useState(false); // онбординг-тур (Этап 2)
```
Рядом с обработчиками (около showToast/других useCallback либо просто функцией перед return) добавить:
```jsx
const closeTour = () => {
  try { localStorage.setItem("kp-tour-seen", "1"); } catch {}
  setTourOpen(false);
};
```

- [ ] **Step 4: App.jsx — авто-старт при первом входе**

Готовность приложения — переменная `phase` (объявлена `const [phase, setPhase] = useState("loading")` ~App.jsx:9075; значения loading/auth/ready/error). Рядом с другими `useEffect` в теле App добавить (НЕ трогать существующие эффекты):
```jsx
useEffect(() => {
  if (phase !== "ready") return;
  let seen = "1";
  try { seen = localStorage.getItem("kp-tour-seen"); } catch {}
  if (shouldAutoStartTour(seen)) setTourOpen(true);
}, [phase]);
```

- [ ] **Step 5: App.jsx — монтаж TourModal + проп в HelpModal**

Рядом с `{helpOpen && <HelpModal ... />}` добавить монтаж тура и прокинуть `onStartTour`:
```jsx
{helpOpen && <HelpModal
  sections={helpSectionsFor(TABS.map((t) => t.id))}
  onClose={() => setHelpOpen(false)}
  onStartTour={() => { setHelpOpen(false); setTourOpen(true); }} />}
{tourOpen && <TourModal sections={helpSectionsFor(TABS.map((t) => t.id))} onClose={closeTour} />}
```
(если HelpModal уже смонтирован — добавить проп `onStartTour` к нему и рядом строку TourModal; не дублировать HelpModal.)

- [ ] **Step 6: Сборка + тесты + ручная проверка**

Run: `npm run build` (зелёная); `npx vitest run` (111 passed).
Ручная: чистый localStorage (DevTools → удалить `kp-tour-seen`) → перезаход → тур авто-открылся; Пропустить → закрылся; перезаход → НЕ открывается; «?» → «Пройти тур» → открылся; под заказчиком слайдов меньше (только его разделы).

- [ ] **Step 7: Коммит**

```bash
git add src/components/HelpModal.jsx src/App.jsx
git commit -m "feat(onboarding): авто-тур при 1-м входе + «Пройти тур» в Помощи"
```

---

## Self-Review
**1. Spec coverage:** слайд-тур (Task 2) ✓; реюз helpSectionsFor/§1 (Task 3 монтаж) ✓; авто при 1-м входе + localStorage (Task 1 хелпер + Task 3 useEffect) ✓; повторный из «Помощи» (Task 3 onStartTour) ✓; пустой тур→onClose (Task 2 useEffect) ✓; localStorage try/catch (Task 3) ✓; TDD shouldAutoStartTour (Task 1) ✓.
**2. Placeholder scan:** код полный, плейсхолдеров нет; переменная готовности уточнена до `phase` (App.jsx:9075) — точная, не «найди по месту».
**3. Type consistency:** `shouldAutoStartTour(seenFlag)` — одна сигнатура (Task 1↔3); секции `{key,title,desc,how}` — как в Этапе 1 (Task 2); `onStartTour` — согласован HelpModal↔App (Task 3).
**4. Ambiguity:** нет открытых — `phase` зафиксирован. Иконка тура — Compass (одна, не пер-секционная, YAGNI).
