# Auth A+: autoconfirm регистрации + админ-сброс пароля (без SMTP). Дизайн

> Дата: 2026-06-04. Статус: **реализован, на проде** (ассет с правками входит в
> сборку 6.4b). Файл спека **воссоздан 2026-06-06** — оригинал утерян при сбое
> диска F: (disaster recovery), содержимое восстановлено из памяти проекта и
> session-report 2026-06-05. Отдельное направление онбординга, не часть 6.4b core.

## 1. Цель

Сделать онбординг новых пользователей и восстановление пароля **рабочими на
self-hosted без настройки SMTP**. Исходная проблема: SMTP в self-hosted Supabase —
дефолтная заглушка (`SMTP_HOST=supabase-mail`, fake-креды), письма наружу не уходят.
Следствие: самостоятельная регистрация (signUp → подтверждение по письму → одобрение
админом) и «забыл пароль» (`resetPasswordForEmail`) фактически не работали. Текущие
4 юзера живут только потому, что перенесены уже подтверждёнными при миграции БД 6.2.

**Решение владельца — вариант A+:** убрать зависимость от писем —
**autoconfirm регистрации** (профиль активируется без письма, барьер онбординга
держится на админском флаге `approved`) + **сброс пароля силами админа** (вместо
self-service «забыл пароль», который требует SMTP). Настройку реального SMTP
сознательно откладываем (отдельная задача, если понадобится email-канал).

## 2. Разведка (что есть)

**Модель auth:** Supabase Auth `auth.users` (bcrypt-пароли) + `public.profiles`
(`name`/`email`/`role`/`approved`/`notif_*`). Регистрация: `signUp` →
email-подтверждение → админ выставляет `approved=true`, иначе вход блокируется.

**Два корневых бага регистрации (оба чинятся):**
- **(а)** `GOTRUE_MAILER_AUTOCONFIRM=false` — GoTrue ждёт подтверждения по письму,
  а письмо уходит в заглушку → аккаунт навсегда `email_confirmed=false`, вход невозможен.
- **(б)** **Триггер `on_auth_user_created` на `auth.users` ОТСУТСТВОВАЛ.** Функция
  `handle_new_user()` в БД есть, но сам триггер потерян при миграции БД 6.2 —
  `pg_dump` не переносит триггеры схемы `auth`. Без триггера `signUp` создаёт строку
  в `auth.users`, но **не создаёт профиль** в `public.profiles` → приложение считает
  юзера несуществующим. Этот баг ломал бы регистрацию даже после включения autoconfirm.

**«Забыл пароль»** в UI вообще не реализован (нет вызова `resetPasswordForEmail`).

## 3. Что НЕ трогаем

- **SMTP не настраиваем** — осознанно (вариант A+ строится без писем).
- **Барьер `approved`** — оставляем как есть: autoconfirm убирает только
  email-подтверждение, ручное одобрение админом остаётся (защита от чужих регистраций).
- **Self-service «забыл пароль»** — не делаем (требует SMTP); вместо него админ-сброс.
- **Облако-резерв Supabase** — не трогаем.
- Существующие 4 юзера — не мигрируем повторно (живут корректно).

## 4. Порядок выполнения

1. **Миграция БД** (новая, в репо):
   `supabase/migrations/20260602_0010_admin_reset_password.sql` —
   - восстановить триггер `on_auth_user_created AFTER INSERT ON auth.users
     EXECUTE FUNCTION handle_new_user()` (idempotent: `DROP TRIGGER IF EXISTS`);
   - функция `admin_reset_password(p_user_id uuid, p_new_password text)`
     `SECURITY DEFINER`, гейт `is_admin()` (не-админ → exception), хеш через
     pgcrypto `extensions.crypt(p_new_password, extensions.gen_salt('bf',10))` → bcrypt,
     запись в `activity_log` (action `password_reset_by_admin`), фикс
     `SET search_path = public, extensions, pg_temp`.
   Применить к живой локальной БД (`docker exec -i supabase-db psql`).
2. **Серверная правка (вне репо, в env self-hosted Supabase):**
   `ENABLE_EMAIL_AUTOCONFIRM=true` в `/srv/supabase-src/docker/.env` →
   `docker compose up -d auth` (пересоздать контейнер; проверить
   `GOTRUE_MAILER_AUTOCONFIRM=true`, статус healthy).
3. **Фронт** (`src/App.jsx`, ~9 правок):
   - хелпер `adminResetPassword(userId, newPassword)` (rpc `admin_reset_password`);
   - в `AdminPage` — кнопка-ключ (иконка `KeyRound`) + модалка сброса пароля
     (стиль существующего `<Modal>`);
   - текст после регистрации: «Проверь почту» → «Заявка отправлена, ждите одобрения»;
   - на форме входа — подсказка «Забыли пароль? Обратитесь к администратору»;
   - импорт `KeyRound` из lucide-react.
4. **Сборка** `npm run build` + **деплой** `deploy/nextcloud/deploy-web.sh`.

## 5. Критерии приёмки

E2E на живой БД (через реальный GoTrue signup + psql), затем очистка тест-юзера:
1. После `signUp` **профиль создаётся** автоматически (триггер работает).
2. Новый профиль `approved=false` — **барьер одобрения цел** (вход заблокирован
   до ручного одобрения админом).
3. `email_confirmed=true` сразу после регистрации (**autoconfirm**, без письма).
4. `admin_reset_password` для админа → пароль обновлён, `bcrypt` verify = `t`
   (GoTrue примет новый пароль при входе).
5. Вызов `admin_reset_password` **не-админом** → exception (гейт `is_admin()`).
6. `verify-rls.sh` → `RLS_OK` (политики не сломаны).
7. `npm run build` зелёный; сайт отдаётся 200 со свежим ассетом.

## 6. Откат

- БД: `DROP FUNCTION admin_reset_password`; триггер можно снять
  (`DROP TRIGGER on_auth_user_created ON auth.users`) — но он легитимный, удалять
  не нужно.
- Env: вернуть `ENABLE_EMAIL_AUTOCONFIRM=false` + `docker compose up -d auth`.
- Фронт: revert коммита App.jsx.

## 7. Техдолг (зафиксирован, в этой задаче НЕ закрывался)

`admin_*` RPC, `is_admin()`, `is_approved()`, `handle_new_user()`, `log_activity()`
живут в **живой БД, но отсутствуют в репо-миграциях** → среда невоспроизводима с нуля.
Отдельная задача — забрать эти объекты в миграции. Также общий долг 6.4b: добавить
`SET search_path` всем `SECURITY DEFINER` (новая миграция этого спека — уже ставит).
