# Исправление visual-регрессии account appearance — 2026-07-29

Работа начата в изолированной ветке `codex/appearance-ui-fix`, затем по явному разрешению владельца перенесена fast-forward в `main`, применена к живой БД и задеплоена.

## Исправлено

- `AppearancePanel` больше не создаёт внешний `section` и не вмешивается в layout.
- Скины и эффекты применяются к существующим карточкам Дашборда, Проектов, Задач и Финансов.
- Из каталога удалены псевдопанели управления/фильтров/редактора.
- Добавлены зоны Admin: пользователи, статистика, журнал.
- Форма создания пользователя приведена к компонентам и палитре сайта.
- Настройки получили группировку, визуальные образцы и настоящий live-preview эффектов.

## Проверка

- Регрессионный SSR-тест: отсутствие `section`/`kp-appearance-panel-body`.
- Каталог: 15 скинов, 15 эффектов, 13 реальных настраиваемых поверхностей.
- `npm test -- --run`: 161/161 passed.
- Production build с production-env: PASS.
- `git diff --check`: PASS.
- Visual QA: desktop PASS; mobile 390 px, `scrollWidth === innerWidth`; shimmer-layer: `kp-ui-shimmer`, `6s`, gradient present.
- Независимое review: первичные Important по preview/Admin/grid/transform устранены; повторный verdict по transform-fix — Ready.

## Release

- Миграция `20260729_0001_user_appearance_preferences.sql` повторно применена идемпотентно: 6/6 колонок, RLS=true, owner-only policy подтверждена.
- `main` и `origin/main`: `c38d8a2` (`fix: apply appearance to existing cards`).
- Финальная проверка объединённого `main`: 161/161 tests, production build PASS, `git diff --check` PASS.
- Production deploy выполнен из основного checkout; `dist` и nginx совпадают.
- Внешний HTTPS через WSL: HTML=200, `index-BsHtLjtJ.js`=200, `index-DegNOVBM.css`=200. Windows-запрос с активным VPN дал локальный timeout, но frpc active и внешний маршрут независимо подтверждён.
- Browser smoke на nginx: правильные asset-хеши, console errors отсутствуют, `scrollWidth === innerWidth`.
