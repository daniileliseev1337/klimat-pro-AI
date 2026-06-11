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

// --- Доли оплаты (кластер #1/#2) ---
// Доля участника в рублях. share = { shareKind:'percent'|'amount', shareValue:number }.
export function shareToAmount(share, contractSum) {
  const v = Number(share.shareValue) || 0;
  if (share.shareKind === 'amount') return v;
  return (Number(contractSum) || 0) * v / 100;
}

// Доля владельца по проекту = договор минус сумма долей других участников (не ниже 0).
export function ownerShareAmount(project, shares = []) {
  const contract = Number(project.contractSum) || 0;
  const others = shares.reduce((s, sh) => s + shareToAmount(sh, contract), 0);
  return Math.max(0, contract - others);
}

// Сколько из доли (amount) уже получено, пропорционально оплате договора.
export function proportionReceived(paidAmount, amount, contractSum) {
  const c = Number(contractSum) || 0;
  if (c <= 0) return 0;
  return (Number(paidAmount) || 0) * (Number(amount) || 0) / c;
}

// KPI «Получено» владельца: сумма полученного по ЕГО доле в своих проектах (архив исключён).
export function ownerReceived(projects, sharesByProject = {}, ownerId = null) {
  let total = 0;
  for (const p of projects) {
    if (p.stage === 'Архив') continue;
    if (ownerId != null && p.ownerId !== ownerId) continue;
    const amount = ownerShareAmount(p, sharesByProject[p.id] || []);
    total += proportionReceived(p.paidAmount, amount, p.contractSum);
  }
  return total;
}

export function receivables(projects, sharesByProject = {}, ownerId = null) {
  const items = [];
  for (const p of projects) {
    if (p.stage === 'Архив') continue;
    if (ownerId != null && p.ownerId !== ownerId) continue;
    const amount = ownerShareAmount(p, sharesByProject[p.id] || []);
    const received = proportionReceived(p.paidAmount, amount, p.contractSum);
    const remaining = amount - received;
    if (remaining > 0) items.push({ id: p.id, name: p.name, remaining });
  }
  items.sort((a, b) => b.remaining - a.remaining);
  return { total: items.reduce((s, x) => s + x.remaining, 0), items };
}

// Итоги по моим долям в чужих проектах (вход — результат get_my_shares, уже в camelCase).
export function mySharesTotals(myShares = []) {
  let received = 0, receivable = 0;
  for (const s of myShares) {
    received += Number(s.myReceived) || 0;
    receivable += Number(s.myReceivable) || 0;
  }
  return { received, receivable };
}

// Моя доля проектных платежей за месяц 'YYYY-MM' — только мои проекты (где ownerId),
// архив исключён. paymentsByProject: { [projectId]: [{ amount:number, paidOn:'YYYY-MM-DD' }] }.
// Доля владельца берётся теми же функциями, что и ownerReceived (пропорция от платежа).
export function myProjectIncomeForMonth(paymentsByProject = {}, projects = [], sharesByProject = {}, ownerId = null, monthStr = '') {
  let total = 0;
  for (const p of projects) {
    if (ownerId != null && p.ownerId !== ownerId) continue;
    if (p.stage === 'Архив') continue;
    const contract = Number(p.contractSum) || 0;
    if (contract <= 0) continue;
    const myShare = ownerShareAmount(p, sharesByProject[p.id] || []);
    for (const pay of (paymentsByProject[p.id] || [])) {
      if (!pay.paidOn || !pay.paidOn.startsWith(monthStr)) continue;
      total += (Number(pay.amount) || 0) * myShare / contract;
    }
  }
  return total;
}

// Сколько ВЛАДЕЛЕЦ имеет от портфеля (замечание B): сумма его остатка по своим неархивным
// проектам + его доли в чужих проектах (myShares.myAmount). KPI «Портфель» = весь объём договоров,
// а это — «сколько из него моё».
export function portfolioMineTotal(projects = [], sharesByProject = {}, ownerId = null, myShares = []) {
  let total = 0;
  for (const p of projects) {
    if (p.stage === 'Архив') continue;
    if (ownerId != null && p.ownerId !== ownerId) continue;
    total += ownerShareAmount(p, sharesByProject[p.id] || []);
  }
  for (const s of myShares) total += Number(s.myAmount) || 0;
  return total;
}

// Доля ЗРИТЕЛЯ на проекте — для индикатора «Моя доля» на карточке. Владелец → его
// остаток (договор минус доли других); участник-юзер → ИМЕННО его строка доли, НЕ остаток
// владельца (это и был баг A); иначе (не владелец и нет своей доли, либо нет зрителя) → null.
export function viewerShareOnProject(project, shares = [], viewerId = null) {
  const contract = Number(project.contractSum) || 0;
  if (contract <= 0 || viewerId == null) return null;
  if (project.ownerId === viewerId) {
    const others = shares.reduce((s, sh) => s + shareToAmount(sh, contract), 0);
    const amount = Math.max(0, contract - others);
    return { amount, percent: Math.round(amount / contract * 100), isOwner: true };
  }
  const mine = shares.find(sh => sh.participantUserId === viewerId);
  if (!mine) return null;
  const amount = shareToAmount(mine, contract);
  return { amount, percent: Math.round(amount / contract * 100), isOwner: false };
}

// Проектные платежи (моя доля владельца) → псевдо-доходные транзакции для общего
// финансового потока дашборда/аналитики: { date:paidOn, type:'income', amount:моя доля, category }.
// Считается ТЕМИ ЖЕ долями-пропорциями, что и myProjectIncomeForMonth/ownerReceived
// (только мои неархивные проекты с договором). Подмешивается к txs перед periodBalance/
// financeSeries — KPI, график и вкладка «Финансы» остаются согласованы.
export function projectIncomeTxs(paymentsByProject = {}, projects = [], sharesByProject = {}, ownerId = null) {
  const out = [];
  for (const p of projects) {
    if (ownerId != null && p.ownerId !== ownerId) continue;
    if (p.stage === 'Архив') continue;
    const contract = Number(p.contractSum) || 0;
    if (contract <= 0) continue;
    const myShare = ownerShareAmount(p, sharesByProject[p.id] || []);
    for (const pay of (paymentsByProject[p.id] || [])) {
      if (!pay.paidOn) continue;
      out.push({ date: pay.paidOn, type: 'income', amount: (Number(pay.amount) || 0) * myShare / contract, category: 'Проектные доходы' });
    }
  }
  return out;
}

// Сводка по выбранным проектам (моя доля владельца). breakdown — построчно {id, name, received}.
export function selectionTotals(selectedProjects = [], sharesByProject = {}, ownerId = null) {
  let received = 0, remaining = 0, contract = 0;
  const breakdown = [];
  for (const p of selectedProjects) {
    const c = Number(p.contractSum) || 0;
    const myShare = ownerShareAmount(p, sharesByProject[p.id] || []);
    const rec = proportionReceived(p.paidAmount, myShare, c);
    received += rec;
    remaining += Math.max(0, myShare - rec);
    contract += c;
    breakdown.push({ id: p.id, name: p.name, received: rec });
  }
  return { received, remaining, contract, breakdown };
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
