// Чистые расчёты для дашборда (этап 6.5). Без React/Supabase — только данные.
// Транзакция: { date:'YYYY-MM-DD', type:'income'|'expense', amount:number, category }
// Проект: { id, name, stage, contractSum, paidAmount, ... }
// Задача: { assignedTo, status, dueDate:'YYYY-MM-DD'|null, title, ... }

const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`; // m,d — 1-индексные

// Границы периода [from, to) в строках 'YYYY-MM-DD'. now — для детерминизма в тестах.
export function periodRange(period, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-индекс
  if (period === 'month') {
    const ny = m === 11 ? y + 1 : y, nm = m === 11 ? 0 : m + 1;
    return { from: ymd(y, m + 1, 1), to: ymd(ny, nm + 1, 1) };
  }
  if (period === 'quarter') {
    const qStart = Math.floor(m / 3) * 3;       // 0,3,6,9
    const ny = qStart + 3 > 11 ? y + 1 : y;
    const nm = (qStart + 3) % 12;
    return { from: ymd(y, qStart + 1, 1), to: ymd(ny, nm + 1, 1) };
  }
  if (period === 'year') {
    return { from: ymd(y, 1, 1), to: ymd(y + 1, 1, 1) };
  }
  return { from: '0000-01-01', to: '9999-12-31', all: true };
}

// Предыдущий аналогичный период (для тренда). null для 'all'.
export function prevPeriodRange(period, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === 'month') {
    const py = m === 0 ? y - 1 : y, pm = m === 0 ? 11 : m - 1;
    return { from: ymd(py, pm + 1, 1), to: ymd(y, m + 1, 1) };
  }
  if (period === 'quarter') {
    const qStart = Math.floor(m / 3) * 3;
    const pStart = qStart - 3;
    const py = pStart < 0 ? y - 1 : y;
    const pm = (pStart + 12) % 12;
    return { from: ymd(py, pm + 1, 1), to: ymd(y, qStart + 1, 1) };
  }
  if (period === 'year') {
    return { from: ymd(y - 1, 1, 1), to: ymd(y, 1, 1) };
  }
  return null;
}

export function inPeriod(dateStr, range) {
  if (!dateStr) return false;
  if (range.all) return true;
  return dateStr >= range.from && dateStr < range.to;
}

export function periodBalance(txs, range) {
  let income = 0, expense = 0;
  for (const t of txs) {
    if (!inPeriod(t.date, range)) continue;
    const a = Number(t.amount) || 0;
    if (t.type === 'income') income += a; else expense += a;
  }
  return { income, expense, balance: income - expense };
}

// 'up' | 'down' | null. null означает «индикатор тренда не показываем»:
// и когда предыдущего периода нет (prev == null), и когда значения равны.
export function trendDir(cur, prev) {
  if (prev == null) return null;
  if (cur > prev) return 'up';
  if (cur < prev) return 'down';
  return null;
}

export function granularityFor(period) {
  if (period === 'month') return 'day';
  if (period === 'quarter') return 'week';
  return 'month'; // year, all
}

const MONTHS_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

function bucketLabel(d, gran) {
  if (gran === 'month') return MONTHS_SHORT[d.getMonth()];
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`; // day, week
}

// Временной ряд по бакетам. Для all границы берём из самих txs (min..max),
// иначе генерация от 0000 года породила бы миллионы бакетов.
export function financeSeries(txs, range, granularity) {
  let startStr = range.from, endStr = range.to;
  if (range.all) {
    if (!txs.length) return [];
    const dates = txs.map(t => t.date).filter(Boolean).sort();
    startStr = dates[0].slice(0, 8) + '01';            // первое число месяца первой транзакции
    const last = new Date(dates[dates.length - 1] + 'T00:00:00');
    last.setDate(1); last.setMonth(last.getMonth() + 1); // первое число следующего месяца после последней
    endStr = ymd(last.getFullYear(), last.getMonth() + 1, 1);
  }
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  const buckets = [];
  let cur = new Date(start);
  while (cur < end) {
    let next = new Date(cur);
    if (granularity === 'day') next.setDate(next.getDate() + 1);
    else if (granularity === 'week') next.setDate(next.getDate() + 7);
    else next.setMonth(next.getMonth() + 1);
    if (next > end) next = new Date(end);
    buckets.push({ start: new Date(cur), end: new Date(next), label: bucketLabel(cur, granularity), inc: 0, exp: 0 });
    cur = next;
  }
  for (const t of txs) {
    if (!t.date) continue;
    const d = new Date(t.date + 'T00:00:00');
    if (d < start || d >= end) continue;
    const b = buckets.find(b => d >= b.start && d < b.end);
    if (!b) continue;
    const a = Number(t.amount) || 0;
    if (t.type === 'income') b.inc += a; else b.exp += a;
  }
  let cum = 0;
  return buckets.map(b => { cum += b.inc - b.exp; return { label: b.label, inc: b.inc, exp: b.exp, cumBalance: cum }; });
}

export function expenseByCategory(txs, range, maxSlices = 6) {
  const map = new Map();
  for (const t of txs) {
    if (t.type !== 'expense' || !inPeriod(t.date, range)) continue;
    const cat = t.category || 'Прочие расходы';
    map.set(cat, (map.get(cat) || 0) + (Number(t.amount) || 0));
  }
  const sorted = [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  if (sorted.length <= maxSlices) return sorted;
  const head = sorted.slice(0, maxSlices - 1);
  const tail = sorted.slice(maxSlices - 1);
  const other = tail.reduce((s, x) => s + x.value, 0);
  return [...head, { name: 'Прочее', value: other }];
}

export function receivables(projects) {
  const items = [];
  for (const p of projects) {
    if (p.stage === 'Архив') continue;
    const remaining = (Number(p.contractSum) || 0) - (Number(p.paidAmount) || 0);
    if (remaining > 0) items.push({ id: p.id, name: p.name, remaining });
  }
  items.sort((a, b) => b.remaining - a.remaining);
  return { total: items.reduce((s, x) => s + x.remaining, 0), items };
}

const TASK_DONE = ['Готово', 'Отменена'];

// tasks предполагаются уже «моими» (загружены с фильтром assignedTo на сервере).
// Возвращает только просроченные (dueDate < today) и сегодняшние (dueDate === today) активные задачи.
// Будущие задачи намеренно не включаются — блок дашборда показывает только требующие внимания сейчас.
export function myTasks(tasks, today) {
  const active = tasks.filter(t => !TASK_DONE.includes(t.status) && t.dueDate);
  const overdue = active.filter(t => t.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const todayList = active.filter(t => t.dueDate === today);
  return { overdue, today: todayList, counts: { overdue: overdue.length, today: todayList.length } };
}
