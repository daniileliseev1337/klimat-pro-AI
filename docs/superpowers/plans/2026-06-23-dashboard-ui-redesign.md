# UI-редизайн дашборда КЛИМАТ-ПРО — Implementation Plan

> **For agentic workers:** этот план исполняется задача-за-задачей. Из-за специфики
> (монолит App.jsx ~8200 строк, визуальный редизайн) — **inline-исполнение контроллером**,
> не субагенты (субагенты на монолите рискованны — память проекта). Шаги — чекбоксы `- [ ]`.

**Goal:** Применить утверждённый эталон (max-wow black & gold) ко всему дашборду — живой
золотой фон, breathing-логотип + shimmer, слиток-рамка карточек, 3D-tilt на крупных карточках,
видимый бейдж ⌘K — на всех экранах.

**Architecture:** Глобальный canvas-фон (один на приложение) + расширение `index.css` (классы/
анимации) + правки компонентов `Card`/`KpiCard` и шапки в App.jsx. Стиль переносится из эталона
`docs/superpowers/specs/km-etalon-black-gold.html` (источник истины).

**Tech Stack:** React 18 + Vite, чистый CSS (`src/index.css`), Canvas 2D (rAF), framer-motion
(уже подключён, App.jsx:11). Без новых внешних зависимостей.

## Global Constraints

- Палитра black & gold, переменные из `src/index.css` (`--gold #d4af37`, `--gold-bright #f0d878`, `--gold-deep #9c7c22`, `--bg-base #0a0a0a`). Весь цвет — золото, без cyan/violet.
- 3D-tilt — ТОЛЬКО на крупных карточках (`Card`, `KpiCard`); строки списков — без 3D, лёгкая золотая подсветка.
- Один глобальный canvas-фон; `requestAnimationFrame`; `prefers-reduced-motion` → один статичный кадр + глушить декор-анимации.
- Анимации перелива/блеска — `ease-in-out infinite alternate` (без рывка), НЕ `linear infinite`.
- Защита от «пустого экрана»: JS-подсистемы в `try/catch`; НЕ присваивать `canvas.clientWidth/clientHeight` (read-only → TypeError). Брать `window.innerWidth`.
- **Верификация — НЕ TDD** (визуальный редизайн): каждый таск завершается `npm run build` (сборка без ошибок) + визуальная приёмка владельцем. Юнит-тестов на анимации нет.
- **Среда:** App.jsx/index.css править через `C:\temp` → `Copy-Item` на F: (F сбоит на fsync больших файлов). git только Windows-сторона (`-c safe.directory=* -c core.fsyncMethod=writeout-only`), в PowerShell без `| tail/head`. Постоянный деплой на прод — ТОЛЬКО по явному слову «деплой».

---

### Task 1: Глобальный живой фон (canvas)

**Files:**
- Create: `src/components/BackgroundCanvas.jsx`
- Modify: `src/index.css` (убрать старый фон `body::before` dotted и `body::after` aurora, ~строки 236-253)
- Modify: `src/App.jsx` (смонтировать `<BackgroundCanvas/>` в корне дерева, до контента)

**Что делать:**
- Перенести фон-логику из эталона (`<script>` блок «Живой фон: золотой aurora + сеть + искры») в React-компонент: `useEffect` создаёт canvas-цикл (aurora-блобы + constellation-сеть с импульсами + золотые искры), `resize` через `window.innerWidth/innerHeight` (НЕ clientWidth), очистка в cleanup. Уважать `prefers-reduced-motion` (один кадр). Обернуть в `try/catch`.
- Canvas: `position:fixed; inset:0; z-index:0`, контент над ним (`#root{position:relative;z-index:1}` — уже есть в index.css:234).
- Удалить старые `body::before`/`body::after` (dotted+aurora) — их заменяет canvas.

- [ ] Шаг 1: создать `BackgroundCanvas.jsx` (перенести canvas-цикл из эталона, resize через window.innerWidth, rAF, reduced-motion, try/catch, cleanup)
- [ ] Шаг 2: в index.css убрать `body::before` (dotted) и `body::after` (aurora) + их keyframes `aurora-drift`
- [ ] Шаг 3: смонтировать `<BackgroundCanvas/>` в App.jsx (в корневом контейнере, первым)
- [ ] Шаг 4: `npm run build` — сборка без ошибок
- [ ] Шаг 5: визуальная приёмка (фон золотой, движется: aurora+сеть+искры) + commit `feat(ui): живой золотой canvas-фон (aurora+сеть+искры)`

---

### Task 2: index.css — классы и анимации редизайна

**Files:**
- Modify: `src/index.css`

**Что делать (перенести из эталона):**
- Анимации: `@keyframes breathe` (пульс свечения логотипа), `@keyframes shimmer` (золотой перелив текста, `ease-in-out alternate`), `@keyframes ingot` (бегущий блеск рамки, `ease-in-out alternate`).
- Класс золотой «слиток»-рамки `.gold-ingot::before` (mask-composite градиент-бордер + `ingot`-анимация) — для применения к `.glass-card`.
- Классы лого: `.brand-breathe` (символ), `.brand-shimmer` (текст-перелив).
- Класс бейджа `.cmdk-badge`.
- Обновить `@media (prefers-reduced-motion: reduce)` — глушить новые анимации (breathe/shimmer/ingot), статичная рамка.

- [ ] Шаг 1: добавить keyframes breathe/shimmer/ingot (значения из эталона, alternate-варианты)
- [ ] Шаг 2: добавить `.gold-ingot` (слиток-рамка), `.brand-breathe`, `.brand-shimmer`, `.cmdk-badge`
- [ ] Шаг 3: расширить reduced-motion-блок (глушить новые анимации)
- [ ] Шаг 4: `npm run build` — без ошибок
- [ ] Шаг 5: commit `feat(ui): css — слиток-рамка, breathing/shimmer/ingot анимации`

---

### Task 3: Карточки Card / KpiCard — слиток-рамка + 3D-tilt

**Files:**
- Modify: `src/App.jsx` — `Card` (1185), `KpiCard` (1372), spotlight-хелпер (1177)

**Interfaces:**
- Consumes: `.gold-ingot`, `.kp-spotlight`, `.kp-hover-glow` (Task 2 + существующие).
- Produces: единый tilt-хелпер (напр. `useTilt` или inline `onMouseMove`), используемый обоими.

**Что делать:**
- Добавить 3D-tilt к `Card` и `KpiCard`: на `onMouseMove` считать `perspective(900px) rotateX/rotateY` по позиции курсора (MAX≈7°), сбрасывать на `onMouseLeave`. Совместить с уже существующим `spotlightMove` (он ставит `--mx/--my`).
- Добавить класс `gold-ingot` к этим карточкам (слиток-рамка). Сохранить `kp-spotlight` (перекрасить spotlight в золото в Task 2, если ещё cyan).
- Уважать reduced-motion (не наклонять).

- [ ] Шаг 1: написать tilt-логику (perspective+rotate по курсору) и подключить в `Card` (1185)
- [ ] Шаг 2: то же в `KpiCard` (1372); добавить `gold-ingot` к className обоих
- [ ] Шаг 3: `npm run build` — без ошибок
- [ ] Шаг 4: визуальная приёмка (карточки наклоняются + золотая рамка-слиток + spotlight) + commit `feat(ui): 3D-tilt и слиток-рамка на Card/KpiCard`

---

### Task 4: Шапка — живой логотип, бейдж ⌘K, профиль, панель без углов

**Files:**
- Modify: `src/App.jsx` — шапка (лого ~8409, вкладки ~8570, контейнер шапки выше)

**Что делать:**
- Логотип «КЛИМАТ-ПРО» (8409): обернуть символ в `.brand-breathe` (пульс), текст в `.brand-shimmer` (золотой перелив). Значок при необходимости — SVG «потоки воздуха» из эталона.
- Бейдж ⌘K: добавить компактный `.cmdk-badge` в шапку, по клику — открыть `CommandPalette` (стейт `cmdOpen`, уже есть — App.jsx:8108); хоткей Ctrl/Cmd+K уже работает (8109).
- Профиль: имя + должность (двухстрочный) — если сейчас одностройный, добавить роль/должность.
- Верхняя панель: убрать жёсткую нижнюю границу, фон — затухающий вниз градиент + боковая `mask` (туман без углов). Найти контейнер шапки (sticky) и заменить border/background.

- [ ] Шаг 1: лого — breathe + shimmer (8409)
- [ ] Шаг 2: добавить бейдж ⌘K → открывает CommandPalette
- [ ] Шаг 3: профиль с должностью; панель — убрать границу, туман-края (mask)
- [ ] Шаг 4: `npm run build` — без ошибок
- [ ] Шаг 5: визуальная приёмка (лого дышит+переливается, бейдж виден и кликает, панель без углов) + commit `feat(ui): живой логотип, бейдж ⌘K, профиль, панель-туман`

---

### Task 5: Доп-фишки — magnetic CTA, count-up KPI, stagger

**Files:**
- Modify: `src/App.jsx` (KpiCard count-up; основные CTA — magnetic; контейнеры — reveal)
- Возможно: `src/components/MagneticButton` (уже есть — переиспользовать на ключевых CTA)

**Что делать:**
- KPI-цифры: count-up 0→N (rAF, easing) в `KpiCard`; reduced-motion → сразу финал.
- Ключевые CTA («Новый проект» и т.п.) — обернуть в существующий `MagneticButton`.
- Появление крупных блоков — мягкий stagger-reveal (через framer-motion `motion` — уже импортирован, или CSS `.reveal`). Не навязчиво.

- [ ] Шаг 1: count-up в KpiCard
- [ ] Шаг 2: magnetic на 1-2 ключевых CTA; stagger-reveal крупных блоков дашборда
- [ ] Шаг 3: `npm run build` — без ошибок
- [ ] Шаг 4: визуальная приёмка + commit `feat(ui): count-up KPI, magnetic CTA, stagger`

---

### Task 6: Прогон по всем экранам + производительность + финальная приёмка

**Files:**
- Modify: `src/App.jsx` (точечно по экранам: Проекты, Задачи, Заказчики, Финансы, Аналитика, История)

**Что делать:**
- Пройти каждый таб: карточки/секции используют `Card`/`KpiCard` → стиль подхватывается; где верстка inline-карточками — привести к единому стилю (gold-ingot/spotlight).
- Производительность: убедиться, что tilt только на крупных карточках (не на строках длинных списков); один canvas; на больших списках — без 3D.
- reduced-motion: проверить, что всё глушится.
- Финальный `npm run build`; визуальная приёмка владельцем по всем экранам.

- [ ] Шаг 1: пройти все табы, привести inline-карточки к единому стилю
- [ ] Шаг 2: проверка perf (tilt-scope, отсутствие тормозов на списках) + reduced-motion
- [ ] Шаг 3: `npm run build` — без ошибок
- [ ] Шаг 4: визуальная приёмка по всем экранам + commit `feat(ui): редизайн по всем экранам + perf`
- [ ] Шаг 5: (по слову «деплой») собрать и выкатить на прод через `deploy/nextcloud/deploy-web.sh`, проверить бандл/смену хэша

---

## Self-Review (выполнено)

- **Покрытие спека:** фон (T1), css-классы/анимации (T2), карточки слиток+tilt (T3), лого/бейдж/профиль/панель (T4), доп-фишки (T5), все экраны+perf (T6). Все решения спека покрыты.
- **Плейсхолдеры:** код переносится из эталона (источник истины) — точные значения там; задачи ссылаются на конкретные строки App.jsx. Нет «TODO/позже».
- **Согласованность:** tilt-хелпер един для Card/KpiCard; классы `.gold-ingot/.brand-breathe/.brand-shimmer/.cmdk-badge` определены в T2, используются в T3/T4.
- **Особенность:** верификация — build + визуальная приёмка (не TDD), т.к. редизайн визуальный — отражено в Global Constraints.
