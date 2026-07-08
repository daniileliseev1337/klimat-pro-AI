---
name: klimat-pro-design
description: Use this skill to generate well-branded interfaces and assets for Klimat Pro, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick map
- `README.md` — the full design guide: context, content voice, visual foundations, iconography, file index.
- `styles.css` — the single global stylesheet to link. `@import`s everything in `tokens/`.
- `tokens/` — colors, typography, spacing/radius/shadow/motion, fonts (Geist via Google Fonts), primitives.
- `components/` — React primitives (Button, Card, KpiCard, Badge, Input, Modal, Toast, Tabs, …). Build from `_ds_bundle.js`, namespace `window.KlimatProDesignSystem_a56ef7`.
- `ui_kits/klimat-pro/` — interactive recreation of the app (login → dashboard → finances → tasks, ⌘K palette).
- `foundations/` — specimen cards for the Design System tab.
- `assets/` — gold logo mark + wordmark (SVG).

## The one-line essence
Swiss-watch noir: material black surfaces, a single antique-gold accent, Geist with tabular finance numerals. Quiet motion, tight corners, glass + a metallic gold edge on the things that matter. Russian-language ОВиК / engineering domain.
