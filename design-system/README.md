# Klimat Pro — Noir & Gold Design System

A design system for **Klimat Pro** (КЛИМАТ Pro) — a personal work & finance command center for an engineering / ОВиК (HVAC) studio. The product gathers projects, finances, analytics and tasks into one dark, premium dashboard. This system captures its visual soul — *Swiss-watch noir with a single antique-gold accent* — and turns it into reusable tokens, components, and screen recreations.

> **A note on direction.** The owner gave a deliberate carte-blanche to bring a fresh, professional eye. This system honors the original's black-and-gold identity and its real primitives (gold action buttons, glass cards, ticker KPIs, tabular ruble columns), but disciplines them: a tighter type scale, a calmer motion language, and a cleaner token layer so the brand scales without losing its edge.

---

## Sources

- **GitHub** — [`K7-LS/klimat-pro-AI`](https://github.com/K7-LS/klimat-pro-AI) — the production React app (React 18 · Tailwind · framer-motion · recharts · lucide-react · Geist). The token values, component behaviors (gold buttons, glass `kp-card`, animated KPI numbers, ⌘K palette, living background) and the Russian engineering/finance domain copy were all read from this source. Explore it further to recreate views with higher fidelity.

No Figma file or slide decks were provided. If you have access to the repo above, read `src/App.jsx`, `src/index.css`, and `src/components/` for the ground truth.

---

## Product context

Klimat Pro is a single-operator's working hub — built for a chief engineer (Даниил Елисеев) running multiple construction/ventilation projects at once. Core sections:

- **Дашборд** — KPI row (баланс, активные проекты, дебиторка, задачи), cashflow, project pipeline, activity feed.
- **Проекты** — each project carries a client, a colored stage badge (В работе / Проектирование / Сдан / Согласование / Просрочен), a completion bar and a contract value.
- **Финансы** — free balance hero, приход/расход dynamics, an operations ledger in tabular rubles.
- **Аналитика** — charts and breakdowns.
- **Задачи** — prioritized checklist tied to projects.

It is a **dark, dense, numbers-first** tool meant to be lived in for hours. Everything serves fast reading of money and status.

---

## CONTENT FUNDAMENTALS — how Klimat Pro writes

The product is **Russian-language**, professional but personal — a tool that talks to its single owner, not a crowd.

- **Language & casing.** Russian throughout. Section names are single nouns, sentence-case (`Дашборд`, `Финансы`, `Проекты`). UPPERCASE is used *only* for tiny eyebrow labels and is widely letter-spaced (`СВОБОДНЫЙ ОСТАТОК`, `РАЗДЕЛЫ`). No Title Case Everywhere.
- **Voice.** Implicit second person — the app addresses *you* directly and warmly: `С возвращением, Даниил`, `Фокус дня`, `Закрой счёт «Меридиан» до 16:00`. It is an assistant, not a corporation. First-person plural is avoided.
- **Tone.** Calm, competent, concrete. Numbers do the talking. Microcopy is short and action-led: `Внести`, `Перевод`, `Создать`, `Выставить счёт`, `Добавить задачу`.
- **Domain vocabulary.** Engineering + finance: ОВиК, вентиляция, воздухообмен, спецификация, КП (коммерческое предложение), акт, дебиторка, аванс, подряд, договор №. Clients are realistic Russian entities (`ООО «Стройинвест»`, `Меридиан Девелопмент`, `ИП Соколов`) — use the `«…»` guillemets for proper names.
- **Numbers.** Russian formatting: thin-space thousands (`842 500 ₽`), the `₽` glyph trails with a space, signs are spaced (`+ 420 000 ₽`, `− 397 500`). Always tabular so columns align.
- **Emoji.** None. Status is carried by colored dots, badges and icons — never emoji. The only decorative glyphs are the toast marks (`★ ✓ !`) and arrows (`▲ ▼`).
- **Vibe.** Premium, private, focused. Like the dashboard of a well-made instrument.

**Examples to emulate**

> `С возвращением, Даниил` · `Свободный остаток` · `Денежный поток · последние 6 месяцев` · `2 задачи с высоким приоритетом на сегодня` · `Дедлайн «Лесная 14» просрочен`

---

## VISUAL FOUNDATIONS

**Palette.** A material **black** canvas (`#0a0a0a`), five barely-lifted surface steps with ~3% warmth so the screen reads as an object, warm near-white ink (`#fafaf7`), and **one** accent — **antique gold** (`#d4af37`, hover `#e8c860`). The gold is the only thing allowed to feel *lit*; everything else recedes. State colors (success/warning/danger/info) are deliberately *muted* pastels so they inform without shouting over the noir. A small data-viz sequence leads with gold, then mint, sky, rose.

**Type.** **Geist** (Vercel) does almost everything; **Geist Mono** is reserved for fixed-grid figures (account numbers, dates, diffs, keycaps). The scale is tight (1.2–1.25 ratio) — most UI sits at 12–14px, display reserved for KPI figures (34px) and heroes (44–48px). Display sizes get negative tracking (`-0.022em`) to feel engineered; uppercase eyebrows open up (`+0.10em`). **Tabular numerals + ss01 are on globally** — this is a finance tool, ruble columns must align to the digit.

**Spacing & layout.** A strict **4px grid**. Generous 14–16px gaps between cards; 18–22px card padding. The app is a fixed left **sidebar** (234px, translucent) + a scrolling content column with a sticky header. KPI rows are 4-up grids; content splits ~1.7 : 1 (primary panel : side panel).

**Corners.** Tight and engineered. Cards land at **14px**, controls at 8px, chips/avatars are pills. Nothing is bubbly.

**Backgrounds.** Not flat — a **living** dark field: two large faint gold radial glows (top-right, bottom-left) over `#0a0a0a`, plus a near-invisible dot-grain texture. The production app animates drifting gold particles on a canvas; the recreation uses the calmer CSS version. No photographic imagery, no illustration — the brand is pure material + light.

**Cards.** Cut from **liquid glass** — a frosted, saturated pane that *refracts* the living background: an edge-lens ring bends light at the rounded rim (real `feDisplacementMap` refraction, not just blur) and a specular bevel paints the lit 3-D edge. Four density tiers — **Sheer / Frost / Gel / Crystal** — span everything from navigation to modals. Gold enters two ways: a lit **gold-edge** (specular + edge lensing) for the one hero surface, or a warm **gold-tint** from within. The material needs the `#lg-warp` / `#lg-rim` SVG filters on the page (drop in `assets/liquid-glass.svg`) and degrades gracefully to frost + bevel without them. A cursor **spotlight**, **parallax** tilt and hover **edge-morph** keep it alive. Tune every parameter in the **Жидкое стекло** material lab (Design System → Material). Replaces the old flat `.glass`.

**Shadows / elevation.** Dark and *close* — depth comes from black-on-black layering plus the gold edge, not big soft drop shadows. Gold *glows* (`0 0 28px -6px rgba(212,175,55,0.4)`) are a separate layer applied on hover/focus.

**Borders.** Almost always a 1px white-alpha hairline (`rgba(255,255,255,0.06–0.16)`). Gold borders (`rgba(212,175,55,0.2–0.3)`) mark accented/active elements.

**Motion.** Quiet by design. Two easings: a UI ease `cubic-bezier(0.16,1,0.3,1)` and an entrance rise `cubic-bezier(0.22,1,0.36,1)`. Interactions are near-instant (120–180ms); entrances are a 0.6s fade-rise. KPI numbers **count up** like an exchange ticker. No bouncy springs on content, no infinite decorative loops except the animated logo. All of it collapses under `prefers-reduced-motion`.

**Hover / press.** Hover = a half-pixel lift + brighter gold / lighter border / a faint glow. Buttons darken-to-brighter (gold → brighter gold). Press = a quick `scale(0.975)` shrink. Icon buttons fill with a faint white wash.

**Transparency & blur.** Used purposefully: the sidebar, modals, toasts and glass cards all blur what's behind them so the living background reads through without harming legibility. The modal scrim is a 62%-black + 4px blur.

**Focus.** A 3px soft gold ring (`rgba(212,175,55,0.18)`) plus a gold border — visible but never harsh.

---

## ICONOGRAPHY

- **System.** The product ships **lucide-react** — thin (1.7–2px stroke), rounded line icons on a 24×24 grid. This system mirrors that set as inline SVG in `ui_kits/klimat-pro/icons.jsx` (`window.Icons.Gauge`, `.Wallet`, `.Folder`, `.Check2`, `.Search`, `.Bell`, …). When building production code, import the real `lucide-react`; for static artifacts, copy from `icons.jsx`.
- **Style rules.** Always stroked, never filled (except tiny status dots and a couple of "fill" glyphs like the heart in the logo). Stroke `currentColor` so they inherit text color; gold when accented, `--text-subtle` when quiet. Size 16–18px inline, 17px in nav.
- **Logo.** The brand mark is a gold three-bar "airflow" glyph in a rounded-square black tile (`assets/logo-mark.svg`), with a gradient-gold wordmark `КЛИМАТ Pro` (`assets/logo-wordmark.svg`). The production app animates the mark through five states (поток / вращение / тепло-холод / дом+поток / дом+сердце) — see `components/logo-mark/preview.html`.
- **Emoji / unicode.** No emoji anywhere. Unicode is used sparingly as *symbols*: `₽`, `⌘`, `→`, `▾`, `▲▼`, `«»`, and toast marks `★ ✓ !`. Status is otherwise colored dots + badges.

---

## File index

```
styles.css                     → link this; @imports all tokens
tokens/
  fonts.css                    → Geist + Geist Mono (Google Fonts)
  colors.css                   → raw scale + semantic aliases + state + data-viz
  typography.css               → families, scale, weights, tracking, numerals
  spacing.css                  → 4px grid, radii, borders, shadows, motion, z-layers
  primitives.css               → resets, .liquid-glass (+ .glass alias), .gold-edge, scrollbar, selection
components/
  core/      Button · Card · KpiCard · Badge · Avatar · IconButton · ProgressBar
  forms/     Input · Textarea · Select · Switch · Checkbox · Field/Label
  feedback/  Modal · Toast · Tooltip · Skeleton · EmptyState
  navigation/ Tabs · CommandBadge · DropdownMenu
  data/      Table · Sparkline · BarChart
  logo-mark/ animated brand mark preview
ui_kits/
  klimat-pro/  interactive app: login → Дашборд · Проекты · Финансы · Аналитика · Задачи,
               ⌘K palette, invoice modal, project detail
foundations/   specimen cards (Type · Colors · Spacing · Material — the Жидкое стекло lab) for the Design System tab
assets/        logo-mark.svg · logo-wordmark.svg · liquid-glass.svg (refraction filters)
SKILL.md       Agent-Skills entry point
```

**Component namespace.** The compiler bundles every primitive to `window.KlimatProDesignSystem_a56ef7`. In card/kit HTML: link `styles.css`, `<script src=".../_ds_bundle.js">`, then `const { Button, Card, … } = window.KlimatProDesignSystem_a56ef7`.

---

## Caveats

- **Fonts** are loaded from **Google Fonts** (Geist + Geist Mono), not self-hosted, so no `@font-face` binaries ship with the system. If you want offline/self-hosted fonts, drop the `.woff2` files in `assets/` and add `@font-face` rules — flag me and I'll wire them in.
- **Icons** are hand-mirrored lucide glyphs (close matches), not the exact lucide-react SVGs. For production, use the real package.
- No Figma or decks were provided; everything derives from the GitHub repo and the brand's own CSS.
