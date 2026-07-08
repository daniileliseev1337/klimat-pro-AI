# КЛИМАТ-ПРО · Темы карточек — спека для Claude Code

Пользователь собирает карточку из двух независимых слоёв. Утверждённый финал:

- **Скины (9):** `classic` (сайт: стекло + слиток-кромка, дефолт) · `carbon` · `ingot` · `data` · `foil` · `neon` · `holo` · `marble` (яркие переливающиеся жилы + слиток-рамка) · `dust`
- **Поведения (7):** `none` (дефолт) · `flip` · `spark` · `exp` · `pulse` · `tilt` · `lev`

Любая пара совместима (63 комбинации). UI выбора — как в `preview/card-builder.html`
(живое превью + плитки с авто-демо).

## Хранение
```json
{ "cardTheme": { "skin": "classic", "behavior": "none" } }
```
В профиле пользователя; дефолт = текущий вид сайта.

## Подключение
1. `card-themes.css` — после основного `index.css`.
2. `card-themes.js` — любым `<script>`.
3. На каждую карточку при рендере:
```js
KPCardThemes.apply(cardEl, user.cardTheme);
```
`apply` сам оборачивает содержимое в `.kp-body`, вешает классы
`.kp-themed .kp-skin-<id> .kp-bh-<id>`, внедряет слои (кромка, жилы, график,
искры) и вешает JS-обработчики (tilt, flip). `KPCardThemes.clear(el)` снимает.

## Требования к разметке по поведениям
- `flip` — внутри карточки `<div class="kp-back">…</div>` (обратная сторона).
- `exp` — внутри `.kp-body` блок `<div class="kp-more">…</div>`.
- остальные — ничего не требуют.

## Реестры для UI
`KPCardThemes.skins`, `KPCardThemes.behaviors` — массивы id.

## Замечания
- Все анимации — чистый CSS, кроме tilt/flip (лёгкий JS).
- В `React` вызывать `apply` в `useEffect` после рендера карточки (и `clear`
  в cleanup), либо портировать классы/слои в JSX по этому же контракту.
- Уважать `prefers-reduced-motion`: при reduce отключать `pulse/neon/foil/holo`
  анимации (media-query можно добавить поверх).
