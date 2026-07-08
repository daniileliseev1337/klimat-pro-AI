# UI Kit — Klimat Pro app

An interactive, click-through recreation of the Klimat Pro work center, composed entirely from this system's primitives (`window.KlimatProDesignSystem_a56ef7`). It is a **recreation**, not production code — cosmetic fidelity over real logic.

## Run it
Open `index.html`. It links `../../styles.css` and `../../_ds_bundle.js`, then loads the screen files as Babel scripts.

## Flow
1. **Login** — gold-edged card, prefilled. "Войти" →
2. **Дашборд** — KPI row (ticker numbers), cashflow area chart, expense donut, project pipeline, activity feed.
3. **Проекты** — searchable, stage-filtered Table with sparkline trends; row ⋯ menu; click a row for the project detail modal.
4. **Финансы** — balance hero, приход/расход dynamics, operations ledger in tabular rubles.
5. **Аналитика** — revenue bars, margin sparkline, expense donut, acquisition-channel table.
6. **Задачи** — add a task (Enter or "Добавить"), toggle done, filter Все/Открытые/Готово, focus-of-day card.
- **“Создать”** (header) opens the **invoice modal** (client, project, sum, НДС toggle, live total).
- **⌘K / Ctrl-K** anywhere — command palette (search + jump + actions). Bell fires toasts.

## Files
- `index.html` — shell: living background, sidebar nav, sticky topbar, command palette, invoice modal, toast host, auth gate.
- `icons.jsx` — `window.Icons`, lucide-style stroke SVGs.
- `data.jsx` — `window.KP_DATA`, plausible ОВиК/finance domain data.
- `Charts.jsx` — `window.KPCharts`, hand-built SVG area chart + donut.
- `Dashboard.jsx` / `Projects.jsx` / `Finances.jsx` / `Analytics.jsx` / `Tasks.jsx` — `window.<Screen>`.

## Not included
The screens cover the product's core. Add more by following the same pattern (a `window.<Screen>` function consuming the namespace primitives), then register it in `SCREENS` and `NAV` in `index.html`.
