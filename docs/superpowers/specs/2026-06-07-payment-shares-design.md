# Доли оплаты проекта (кластер #1/#2) — дизайн

**Дата:** 2026-06-07
**Статус:** согласован владельцем, готов к writing-plans
**Поглощает:** баг #8 (стадия «Оплачен» рассинхронизирована с `paid_amount`)

## Проблема и цель

Сейчас договор проекта — это одно число `contract_sum` + ручное `paid_amount`, и вся
сумма считается «моей» на дашборде/в финансах. На практике проект часто делится: часть
суммы причитается соисполнителю или процент берёт заказчик. Нужно:

1. Делить сумму договора на **доли между несколькими участниками**.
2. На **моём** дашборде/в финансах учитывать **только мою долю**, а не всю сумму договора.
3. Если участник — **зарегистрированный юзер**, его доля должна появляться в **его**
   дашборде («каждый видит свои финансы»).

Параллельно закрывается баг #8: стадия «Оплачен» и `paid_amount` сегодня независимы,
из-за чего «Оплачен»-проект без заполненного `paid_amount` висит в дебиторке.

## Согласованные решения (развилки брейнсторма)

| Развилка | Решение |
|---|---|
| Кто такой участник-исполнитель | гибрид: **юзер системы** / **внешнее имя** / **заказчик** |
| Суть механики | сумма договора делится на доли между N участниками; **журнала платежей нет** |
| Влияние на деньги | моя доля — в моих метриках; **юзер-участник видит свою долю в своём дашборде** |
| Формат доли | **гибко**: процент **или** сумма (на участника, с автопересчётом) |
| Видимость участника | **название проекта + своя доля** (₽ + получено); заказчик/полная сумма/чужие доли — скрыты |
| Доля владельца | **остаток** (`contract_sum − Σ долей других`), отдельной строкой в таблице не хранится |
| Доли участника на его дашборде | **отдельный блок** «Мои доли в проектах»; но **получено по долям — реальный доход**, влитый в KPI «Получено» |
| KPI «Портфель» | остаётся **полным** (Σ договоров) — объём, которым управляешь |

## Архитектура (Подход 1)

Одна таблица-источник `project_shares` + RLS + приватный `SECURITY DEFINER` RPC
`get_my_shares()`. Деньги доли **вычисляются**, а не дублируются (нечему
рассинхронизироваться). Отклонённые альтернативы:

- **Подход 2** (материализованные «начисления» в txs-подобной таблице) — дублирование +
  необходимость пересчитывать/переписывать строки всем при правке долей/оплаты; источник
  рассинхрона.
- **Подход 3** (расшарить участнику всю строку `projects`, фильтровать поля на клиенте) —
  RLS отдаст чувствительное (заказчик, полная сумма); фильтрация на клиенте небезопасна.

---

## Секция 1. Модель данных

```sql
create table public.project_shares (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  -- полиморфный участник: ровно один «адрес» из трёх
  participant_user_id   uuid references auth.users(id),     -- юзер системы
  participant_client_id uuid references public.clients(id), -- заказчик
  participant_name      text,                               -- внешнее имя (нет в системе)
  -- размер доли: гибко — % ИЛИ сумма
  share_kind            text    not null check (share_kind in ('percent','amount')),
  share_value           numeric not null check (share_value >= 0),
  note                  text,
  created_at            timestamptz not null default now(),
  -- ровно один способ адресации участника
  constraint project_shares_one_participant check (
    (participant_user_id   is not null)::int
  + (participant_client_id is not null)::int
  + (participant_name      is not null)::int = 1
  )
);
create index project_shares_project_id_idx on public.project_shares(project_id);
create index project_shares_participant_user_idx
  on public.project_shares(participant_user_id) where participant_user_id is not null;
```

Решения:

1. **Владелец = остаток.** В таблице лежат только доли *других* участников. Моя доля
   считается как `contract_sum − Σ(доли других в ₽)`. Свою строку не заводим.
2. **`paid_amount` остаётся как есть** (одно число «сколько всего пришло по договору»).
   Доли — это *разрез* суммы; отдельной механики оплаты долей нет.
3. **Сумма долей не прибита к 100% на уровне БД** (гибкий пошаговый ввод % и сумм
   временно может не сходиться). Контроль — мягкий, в UI (показ остатка + предупреждение
   при перерасходе `> contract_sum`).
4. **`on delete cascade`**: удаление проекта удаляет его доли.

## Секция 2. RLS и доступ

```sql
alter table public.project_shares enable row level security;

-- SELECT: владелец проекта (все доли своего проекта) ИЛИ сам участник (только свою строку)
create policy project_shares_select on public.project_shares
for select using (
  exists (select 1 from public.projects p
          where p.id = project_shares.project_id and p.owner_id = auth.uid())
  or participant_user_id = auth.uid()
);

-- INSERT/UPDATE/DELETE: только владелец проекта
create policy project_shares_write on public.project_shares
for all using (
  exists (select 1 from public.projects p
          where p.id = project_shares.project_id and p.owner_id = auth.uid())
) with check (
  exists (select 1 from public.projects p
          where p.id = project_shares.project_id and p.owner_id = auth.uid())
);
```

Тонкость: по RLS участник видит свою *строку доли*, но **строку `projects` — нет**
(на `projects` своя per-owner RLS), значит название проекта прямым запросом ему
недоступно. Единственный канал чтения для участника:

```sql
create or replace function public.get_my_shares()
returns table (project_name text, my_amount numeric, my_received numeric, my_receivable numeric)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    p.name as project_name,
    case when s.share_kind = 'percent'
         then coalesce(p.contract_sum,0) * s.share_value / 100.0
         else s.share_value end as my_amount,
    case when coalesce(p.contract_sum,0) > 0
         then coalesce(p.paid_amount,0)
              * (case when s.share_kind = 'percent'
                      then coalesce(p.contract_sum,0) * s.share_value / 100.0
                      else s.share_value end)
              / coalesce(p.contract_sum,0)
         else 0 end as my_received,
    (case when s.share_kind = 'percent'
          then coalesce(p.contract_sum,0) * s.share_value / 100.0
          else s.share_value end)
    - (case when coalesce(p.contract_sum,0) > 0
            then coalesce(p.paid_amount,0)
                 * (case when s.share_kind = 'percent'
                         then coalesce(p.contract_sum,0) * s.share_value / 100.0
                         else s.share_value end)
                 / coalesce(p.contract_sum,0)
            else 0 end) as my_receivable
  from public.project_shares s
  join public.projects p on p.id = s.project_id
  where s.participant_user_id = auth.uid()
    and p.owner_id <> auth.uid();   -- исключить собственные проекты (там я владелец)
$$;
grant execute on function public.get_my_shares() to authenticated;
```

Функция отдаёт **строго** `{project_name, my_amount, my_received, my_receivable}` —
строку `projects` целиком наружу не выдаёт; заказчик, контакты, доли других не утекают.

**Владельцу отдельный RPC не нужен** — он читает `project_shares` своих проектов напрямую
под RLS; запись долей — прямой `insert/update/delete` под RLS (без лишних RPC).

## Секция 3. Расчёты, метрики и баг #8

**А. Метрики владельца** — чистые функции в `src/lib/dashboardMetrics.js` (+ vitest).
Получают доп. аргумент — карту долей `project_id → [доли]` (владелец читает
`project_shares` своих проектов):

- *Моя доля по проекту* `my_amount = contract_sum − Σ(доли других в ₽)`
  (где доля в ₽ = `percent → contract_sum × value/100`, либо `amount → value`).
- *Получено по моей доле* `= paid_amount × my_amount / contract_sum` (при `contract_sum = 0` → 0).
- *Моя дебиторка* `= my_amount − получено_моё`.
- KPI **«Получено»** = `Σ получено_моё` (+ получено по моим долям в чужих, см. Б);
  **`receivables`** = `Σ моя_дебиторка` (+ остаток по моим долям в чужих).
- Проект без долей → `my_amount = contract_sum` → поведение как сегодня (обратная
  совместимость).

**Б. Финансы участника** — источник `get_my_shares()`:
- Отдельный блок «Мои доли в проектах» (список: проект · моя доля · получено · остаток).
- `my_received` влит в KPI «Получено» (реальный доход); `my_receivable` влит в дебиторку.
- Итог: «Получено» любого юзера = получено по своим проектам + получено по своим долям в чужих.

**В. Баг #8 — стадия «Оплачен» ↔ `paid_amount`.** Durable-фикс на уровне формы проекта:
**при выборе стадии «Оплачен» автозаполнять `paid_amount = contract_sum`** (если меньше;
поле остаётся редактируемым). Зеркально — когда `paid_amount` достигает `contract_sum`,
мягко предлагать стадию «Оплачен» (не насильно). `receivables` менять не нужно — он и так
считает по `paid_amount`. Это согласованнее, чем прятать «Оплачен» из дебиторки (что
скрыло бы реальную недоплату).

**Г. Что НЕ меняется.** Доли **не материализуются в `transactions`** (журнала/начислений
нет — Подход 1). Поэтому вкладка «Финансы» (ручной лист `txs`) и KPI «Баланс за период»
(`periodBalance(txs)` — реальные деньги) **остаются без изменений**. Доли влияют только на
проектные метрики: «Получено», дебиторку и блок «Мои доли».

## Секция 4. UI (`src/App.jsx`, монолит)

**A. Форма проекта — секция «Доли участников»** (~стр. 1656, после полей суммы/оплаты,
паттерн золотистой секции «Контакты заказчика» 1658-1703). Состояние `shares: []`.
- Список строк: участник + значение + тумблер **%/₽** (`share_kind`) + удалить.
- Кнопка «**+ участник**» с выбором типа:
  - **Юзер системы** — autocomplete по `searchApprovedUsers` (стр. 543-547; паттерн
    исполнителя `execQuery`/`selectExecUser`, 1600-1629) → `participant_user_id`.
  - **Заказчик** — клиент проекта (`f.clientId`) или autocomplete `search_clients`
    (`searchClientsByQuery` 499-502) → `participant_client_id`.
  - **Внешнее имя** — текстовый ввод → `participant_name`.
- Под списком — «**Твоя доля (остаток): N ₽ / M%**» + предупреждение при перерасходе.
- Сохранение проекта: синхронизация `project_shares` (replace-all — долей на проект единицы).

**B. Дашборд** (`Dashboard` 2130-2275):
- KPI **«Получено»** (2192) теперь = *моё* получено; `sub «осталось»` = моя дебиторка.
- Новый **блок «Мои доли в проектах»** (паттерн `ReceivablesCard` 2040-2060) в зоне
  «💰 Финансы».
- KPI **«Портфель»** (2191) — без изменений (Σ договоров).

**C. Карточка проекта** (2363-2509, после progress-bar 2414) — мелкий индикатор
`👥 Моя доля: N ₽ (M%)`, только если у проекта есть доли.

**D. Загрузка данных** — в оба `Promise.all` (6569, 6621) добавить `fetchProjectShares(supabase)`
(доли моих проектов) и `getMyShares(supabase)` (мои доли в чужих); прокинуть в
`Dashboard`/`Projects`. На `SIGNED_OUT` — сбросить.

## Секция 5. Миграция существующих данных

- **Backfill долей не нужен** — «проект без долей → `my_amount = contract_sum`» даёт полную
  обратную совместимость (7 существующих проектов = «вся сумма моя», как сейчас). Миграция —
  чистый DDL (таблица + RLS + RPC + grants).
- **Баг #8 у старых проектов**: чинится при первом редактировании (автозаполнение
  `paid = contract` при «Оплачен»). **Автоматический backfill `paid_amount` не делаем**
  (молчаливая правка денег); при желании — опциональный разовый SQL, по умолчанию не запускается.
- **Аддитивность**: таблица ничего не ломает; при откате фронта старый код её игнорирует.

## Секция 6. Тестирование и верификация

- **vitest** (расширяем каркас, 36 тестов) для `dashboardMetrics.js`: остаток-доля,
  получено-пропорция, дебиторка; edge-cases — `contract_sum = 0`, Σ долей > договора,
  проект без долей (= полная сумма), смешанные `%`+`₽`.
- **`verify-rls.sh`** под двумя юзерами: владелец видит/пишет все доли; участник видит
  только свою + `get_my_shares` отдаёт только её; чужой — ничего; участник писать не может.
- **E2E на живой БД/устройстве** («тестировать в работе»): проект с долями (юзер + внешний +
  заказчик) → вход вторым юзером-участником → его доля видна, чужое скрыто → KPI
  «Получено»/дебиторка → баг #8 (стадия «Оплачен» → `paid = contract` → ушёл из дебиторки).
- **Деплой на прод — только по явной команде «деплой».**

## Вне scope (YAGNI)

- Журнал/история отдельных поступлений по договору.
- Трекинг реальных выплат владельцем участникам (взаиморасчёты). «Получено по доле»
  считается пропорционально оплате договора, в предположении, что доля отдаётся участнику.
- Расшаривание участнику всей карточки проекта (заказчик, контакты, полная сумма).
- Realtime-обновление долей между аккаунтами (доли подтягиваются при загрузке/refetch).

## Точки интеграции (из разведки кода)

| Элемент | Путь:строка | Действие |
|---|---|---|
| ProjectForm | `App.jsx:1486-1982` | секция «Доли» после 1656; state `shares` у 1499 |
| Поля суммы/оплаты | `App.jsx:1653,1655` | рядом — индикатор остатка |
| Селект стадии | `App.jsx:1640` | хук бага #8 (автозаполнение paid) |
| `searchApprovedUsers` | `App.jsx:543-547` | autocomplete юзера-участника |
| ClientSelector / `searchClientsByQuery` | `App.jsx:4756-4857, 499-502` | заказчик-участник |
| Dashboard / KpiCard | `App.jsx:2130-2275, 1133-1185, 2192` | «Получено» = моя доля |
| ReceivablesCard | `App.jsx:2040-2060` | паттерн блока «Мои доли» |
| Карточка проекта | `App.jsx:2363-2509, 2400-2414` | индикатор доли |
| Promise.all загрузки | `App.jsx:6569, 6621` | + fetchProjectShares / getMyShares |
