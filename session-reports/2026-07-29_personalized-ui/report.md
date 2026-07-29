# Персонализируемый UI — 2026-07-29

Работа выполнена в изолированной worktree `codex/personalized-ui`; основная ветка и production не изменялись.

## Готово

- Account-level настройки: 15 скинов, 15 эффектов и compatibility matrix.
- Индивидуальные override для 14 реальных зон Дашборда, Проектов, Задач и Финансов.
- Несовместимые эффекты скрываются из picker; состояние совместимых вариантов отображается сразу.
- Owner-only миграция `user_appearance_preferences`, включая настройки распознавания переводов себе.
- Закрыты согласованные UX-доводки банка v2: нормализация префикса оплаты, legacy merchant rule, mobile review.

## Проверка

- `npm test` — 157/157 passed.
- `npm run build` — passed.
- `git diff --check` — passed.
- Независимое ревью подтвердило 14 реальных поверхностей; замечание о скрытии несовместимых эффектов исправлено и повторно проверено статически.

## Не выполнялось

- Не проведена authenticated visual QA: локальный dev-server не получил безопасный Supabase env.
- Нет merge, commit, push или deploy.

## После первичной проверки

- По явному разрешению владельца миграция применена к `supabase-db` после транзакционного preflight (`BEGIN` → DDL → `ROLLBACK`).
- Структурная проверка: `relrowsecurity = true`, единственная policy `user_appearance_preferences_owner_all` использует и проверяет `user_id = auth.uid()`.
