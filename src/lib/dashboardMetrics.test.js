import { describe, it, expect } from 'vitest';
import { periodRange, prevPeriodRange, inPeriod, periodBalance, trendDir, granularityFor, financeSeries, expenseByCategory, receivables, myTasks, shareToAmount, ownerShareAmount, proportionReceived, ownerReceived, mySharesTotals, myProjectIncomeForMonth, selectionTotals, projectIncomeTxs, viewerShareOnProject, portfolioMineTotal } from './dashboardMetrics.js';

const NOW = new Date('2026-06-06T12:00:00');

describe('periodRange', () => {
  it('месяц = текущий календарный месяц', () => {
    expect(periodRange('month', NOW)).toEqual({ from: '2026-06-01', to: '2026-07-01' });
  });
  it('квартал = текущий квартал (Q2 для июня)', () => {
    expect(periodRange('quarter', NOW)).toEqual({ from: '2026-04-01', to: '2026-07-01' });
  });
  it('год = текущий календарный год', () => {
    expect(periodRange('year', NOW)).toEqual({ from: '2026-01-01', to: '2027-01-01' });
  });
  it('всё = признак all + широкие границы', () => {
    expect(periodRange('all', NOW)).toEqual({ from: '0000-01-01', to: '9999-12-31', all: true });
  });
});

describe('prevPeriodRange', () => {
  it('предыдущий месяц', () => {
    expect(prevPeriodRange('month', NOW)).toEqual({ from: '2026-05-01', to: '2026-06-01' });
  });
  it('предыдущий год', () => {
    expect(prevPeriodRange('year', NOW)).toEqual({ from: '2025-01-01', to: '2026-01-01' });
  });
  it('для "всё" предыдущего периода нет', () => {
    expect(prevPeriodRange('all', NOW)).toBeNull();
  });
  it('предыдущий квартал с переходом через год (Q1 → Q4 прошлого)', () => {
    expect(prevPeriodRange('quarter', new Date('2026-02-15T00:00:00')))
      .toEqual({ from: '2025-10-01', to: '2026-01-01' });
  });
});

const TXS = [
  { date: '2026-06-10', type: 'income',  amount: 100 },
  { date: '2026-06-15', type: 'expense', amount: 30 },
  { date: '2026-05-01', type: 'income',  amount: 999 }, // вне июня
];

describe('inPeriod', () => {
  const r = { from: '2026-06-01', to: '2026-07-01' };
  it('включает дату внутри [from,to)', () => expect(inPeriod('2026-06-10', r)).toBe(true));
  it('исключает дату до from', () => expect(inPeriod('2026-05-31', r)).toBe(false));
  it('исключает дату == to (правая граница открыта)', () => expect(inPeriod('2026-07-01', r)).toBe(false));
  it('для all включает всё', () => expect(inPeriod('1999-01-01', { from:'0000-01-01', to:'9999-12-31', all:true })).toBe(true));
});

describe('periodBalance', () => {
  it('считает доход/расход/баланс за период', () => {
    expect(periodBalance(TXS, { from: '2026-06-01', to: '2026-07-01' }))
      .toEqual({ income: 100, expense: 30, balance: 70 });
  });
});

describe('trendDir', () => {
  it('up когда текущий больше прошлого', () => expect(trendDir(70, 50)).toBe('up'));
  it('down когда текущий меньше прошлого', () => expect(trendDir(40, 50)).toBe('down'));
  it('null когда прошлый период недоступен', () => expect(trendDir(70, null)).toBeNull());
});

describe('granularityFor', () => {
  it('месяц → по дням', () => expect(granularityFor('month')).toBe('day'));
  it('квартал → по неделям', () => expect(granularityFor('quarter')).toBe('week'));
  it('год → по месяцам', () => expect(granularityFor('year')).toBe('month'));
  it('всё → по месяцам', () => expect(granularityFor('all')).toBe('month'));
});

describe('financeSeries (год, помесячно)', () => {
  const txs = [
    { date: '2026-01-15', type: 'income',  amount: 100 },
    { date: '2026-01-20', type: 'expense', amount: 40 },
    { date: '2026-03-05', type: 'income',  amount: 60 },
  ];
  const range = { from: '2026-01-01', to: '2027-01-01' };
  const series = financeSeries(txs, range, 'month');
  it('даёт 12 месячных точек', () => expect(series.length).toBe(12));
  it('январь: inc=100, exp=40', () => {
    expect(series[0].inc).toBe(100);
    expect(series[0].exp).toBe(40);
  });
  it('накопительный баланс растёт корректно', () => {
    expect(series[0].cumBalance).toBe(60);   // 100-40
    expect(series[2].cumBalance).toBe(120);  // +60 в марте, февраль пустой
  });
});

describe('financeSeries (all — границы из данных)', () => {
  const txs = [
    { date: '2025-11-10', type: 'income', amount: 10 },
    { date: '2026-02-10', type: 'income', amount: 20 },
  ];
  const series = financeSeries(txs, { from:'0000-01-01', to:'9999-12-31', all:true }, 'month');
  it('не генерирует тысячи бакетов, охватывает только данные', () => {
    expect(series.length).toBe(4); // ноя, дек, янв, фев
    expect(series[series.length - 1].cumBalance).toBe(30);
  });
  it('пустые txs → пустой ряд', () => {
    expect(financeSeries([], { from:'0000-01-01', to:'9999-12-31', all:true }, 'month')).toEqual([]);
  });
  it('последняя транзакция 31-го числа не порождает лишний пустой бакет (I-1 регрессия)', () => {
    // 2026-01-31: если сначала setMonth(+1) → 31 фев → 3 мар → setDate(1) → 1 мар (лишний бакет).
    // Правильный порядок: setDate(1) затем setMonth(+1) → 1 фев → эндпоинт именно февраль.
    const txs = [
      { date: '2025-12-05', type: 'income', amount: 50 },
      { date: '2026-01-31', type: 'income', amount: 70 },
    ];
    const series = financeSeries(txs, { from:'0000-01-01', to:'9999-12-31', all:true }, 'month');
    // Ожидаем ровно 2 бакета: дек-2025 и янв-2026. Лишний фев (или мар) не должен появляться.
    expect(series.length).toBe(2);
    expect(series[0].label).toBe('дек');
    expect(series[1].label).toBe('янв');
  });
});

describe('expenseByCategory', () => {
  const range = { from: '2026-06-01', to: '2026-07-01' };
  const txs = [
    { date: '2026-06-02', type: 'expense', amount: 50, category: 'Жильё / аренда' },
    { date: '2026-06-03', type: 'expense', amount: 20, category: 'Транспорт' },
    { date: '2026-06-04', type: 'expense', amount: 30, category: 'Жильё / аренда' },
    { date: '2026-06-05', type: 'income',  amount: 999, category: 'Проектирование' }, // не расход
    { date: '2026-05-31', type: 'expense', amount: 999, category: 'Транспорт' },       // вне периода
  ];
  it('группирует расходы по категориям и сортирует по убыванию', () => {
    expect(expenseByCategory(txs, range)).toEqual([
      { name: 'Жильё / аренда', value: 80 },
      { name: 'Транспорт', value: 20 },
    ]);
  });
  it('сворачивает хвост в «Прочее» при превышении maxSlices', () => {
    const many = ['A','B','C','D','E','F','G'].map((c, i) => ({
      date: '2026-06-10', type: 'expense', amount: (7 - i), category: c,
    }));
    const res = expenseByCategory(many, range, 6);
    expect(res.length).toBe(6);
    expect(res[5]).toEqual({ name: 'Прочее', value: 3 }); // F(2)+G(1) свёрнуты в Прочее
  });
  it('пустой результат при отсутствии расходов', () => {
    expect(expenseByCategory([], range)).toEqual([]);
  });
});

describe('receivables', () => {
  const projects = [
    { id: 1, name: 'A', stage: 'В работе',  contractSum: 1000, paidAmount: 400 }, // 600
    { id: 2, name: 'B', stage: 'Архив',     contractSum: 500,  paidAmount: 0 },   // архив — исключить
    { id: 3, name: 'C', stage: 'Оплачен',   contractSum: 200,  paidAmount: 200 }, // 0 — исключить
    { id: 4, name: 'D', stage: 'Договор подписан', contractSum: 300, paidAmount: 50 }, // 250
  ];
  const r = receivables(projects);
  it('итог = сумма остатков по не-архивным с остатком > 0', () => expect(r.total).toBe(850));
  it('items отсортированы по убыванию остатка', () => {
    expect(r.items).toEqual([
      { id: 1, name: 'A', remaining: 600 },
      { id: 4, name: 'D', remaining: 250 },
    ]);
  });
  it('пустой портфель → нули', () => expect(receivables([])).toEqual({ total: 0, items: [] }));
});

describe('myTasks', () => {
  const today = '2026-06-06';
  const tasks = [
    { id: 1, status: 'В работе',   dueDate: '2026-06-01', title: 'просрочена' },
    { id: 2, status: 'Готово',     dueDate: '2026-06-01', title: 'готова — исключить' },
    { id: 3, status: 'Новая',      dueDate: '2026-06-06', title: 'сегодня' },
    { id: 4, status: 'На проверке',dueDate: '2026-06-20', title: 'будущая — не в блоке' },
    { id: 5, status: 'Отменена',   dueDate: '2026-06-01', title: 'отменена — исключить' },
    { id: 6, status: 'Новая',      dueDate: null,         title: 'без срока — не в блоке' },
  ];
  const r = myTasks(tasks, today);
  it('просроченные — активные с dueDate < today', () => {
    expect(r.overdue.map(t => t.id)).toEqual([1]);
  });
  it('сегодняшние — активные с dueDate == today', () => {
    expect(r.today.map(t => t.id)).toEqual([3]);
  });
  it('счётчики', () => expect(r.counts).toEqual({ overdue: 1, today: 1 }));
  it('исключает Готово/Отменена/будущие/без срока из обоих списков', () => {
    const ids = [...r.overdue, ...r.today].map(t => t.id);
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(4);
    expect(ids).not.toContain(5);
    expect(ids).not.toContain(6);
  });
});

describe('shareToAmount', () => {
  it('percent: 30% от 100000 = 30000', () => {
    expect(shareToAmount({ shareKind: 'percent', shareValue: 30 }, 100000)).toBe(30000);
  });
  it('amount: фиксированная сумма возвращается как есть', () => {
    expect(shareToAmount({ shareKind: 'amount', shareValue: 40000 }, 100000)).toBe(40000);
  });
  it('percent от нулевого договора = 0', () => {
    expect(shareToAmount({ shareKind: 'percent', shareValue: 50 }, 0)).toBe(0);
  });
});

describe('ownerShareAmount (остаток владельца)', () => {
  const p = { contractSum: 100000 };
  it('нет долей других → вся сумма договора', () => {
    expect(ownerShareAmount(p, [])).toBe(100000);
  });
  it('один участник 30% → остаток 70000', () => {
    expect(ownerShareAmount(p, [{ shareKind: 'percent', shareValue: 30 }])).toBe(70000);
  });
  it('смешанно % и сумма: 30% + 20000 → остаток 50000', () => {
    expect(ownerShareAmount(p, [
      { shareKind: 'percent', shareValue: 30 },
      { shareKind: 'amount', shareValue: 20000 },
    ])).toBe(50000);
  });
  it('перерасход долей > договора → остаток не ниже 0', () => {
    expect(ownerShareAmount(p, [{ shareKind: 'amount', shareValue: 150000 }])).toBe(0);
  });
});

describe('proportionReceived', () => {
  it('оплачено 40% договора → по доле 70000 получено 28000', () => {
    expect(proportionReceived(40000, 70000, 100000)).toBe(28000);
  });
  it('договор 0 → 0 (без деления на ноль)', () => {
    expect(proportionReceived(0, 50000, 0)).toBe(0);
  });
  it('полностью оплачено → получено = вся доля', () => {
    expect(proportionReceived(100000, 70000, 100000)).toBe(70000);
  });
});

describe('ownerReceived', () => {
  const projects = [
    { id: 'p1', stage: 'В работе', contractSum: 100000, paidAmount: 40000 },
    { id: 'p2', stage: 'В работе', contractSum: 50000,  paidAmount: 50000 },
    { id: 'p3', stage: 'Архив',    contractSum: 80000,  paidAmount: 80000 },
  ];
  const sharesByProject = { p1: [{ shareKind: 'percent', shareValue: 30 }] };
  it('сумма полученного по моим долям, архив исключён', () => {
    expect(ownerReceived(projects, sharesByProject)).toBe(28000 + 50000);
  });
  it('без долей (старое поведение) = сумма paidAmount неархивных', () => {
    expect(ownerReceived(projects, {})).toBe(40000 + 50000);
  });
});

describe('receivables с долями', () => {
  const projects = [
    { id: 'p1', name: 'A', stage: 'В работе', contractSum: 100000, paidAmount: 40000 },
  ];
  it('доля другого 30% → моя 70000, получено 28000, остаток 42000', () => {
    const r = receivables(projects, { p1: [{ shareKind: 'percent', shareValue: 30 }] });
    expect(r.total).toBe(42000);
    expect(r.items[0]).toEqual({ id: 'p1', name: 'A', remaining: 42000 });
  });
  it('обратная совместимость: без 2-го аргумента = договор − оплачено', () => {
    const r = receivables(projects);
    expect(r.total).toBe(60000);
  });
});

describe('mySharesTotals', () => {
  it('суммирует my_received и my_receivable из get_my_shares', () => {
    const myShares = [
      { projectName: 'X', myAmount: 30000, myReceived: 12000, myReceivable: 18000 },
      { projectName: 'Y', myAmount: 50000, myReceived: 50000, myReceivable: 0 },
    ];
    expect(mySharesTotals(myShares)).toEqual({ received: 62000, receivable: 18000 });
  });
  it('пустой список → нули', () => {
    expect(mySharesTotals([])).toEqual({ received: 0, receivable: 0 });
  });
});

describe('ownerId-фильтр (C1: не считать чужие проекты)', () => {
  const projects = [
    { id: 'p1', stage: 'В работе', contractSum: 100000, paidAmount: 100000, ownerId: 'me' },
    { id: 'p2', stage: 'В работе', contractSum: 50000,  paidAmount: 50000,  ownerId: 'other' },
  ];
  it('ownerReceived с ownerId считает только свои', () => {
    expect(ownerReceived(projects, {}, 'me')).toBe(100000);
  });
  it('ownerReceived без ownerId (обратная совместимость) считает все', () => {
    expect(ownerReceived(projects, {})).toBe(150000);
  });
  it('receivables с ownerId считает только свои', () => {
    const r = receivables([
      { id: 'p1', name: 'A', stage: 'В работе', contractSum: 100000, paidAmount: 0, ownerId: 'me' },
      { id: 'p2', name: 'B', stage: 'В работе', contractSum: 50000, paidAmount: 0, ownerId: 'other' },
    ], {}, 'me');
    expect(r.total).toBe(100000);
    expect(r.items.length).toBe(1);
  });
});

describe('myProjectIncomeForMonth', () => {
  const projects = [{ id: 'p1', ownerId: 'me', stage: 'В работе', contractSum: 100, paidAmount: 50 }];
  const shares = { p1: [] };
  const pays = { p1: [{ amount: 30, paidOn: '2026-06-10' }, { amount: 20, paidOn: '2026-05-01' }] };
  it('суммирует мою долю платежей за месяц', () => {
    expect(myProjectIncomeForMonth(pays, projects, shares, 'me', '2026-06')).toBe(30);
  });
  it('игнорирует чужие проекты', () => {
    const other = [{ id: 'p1', ownerId: 'someone', stage: 'В работе', contractSum: 100, paidAmount: 50 }];
    expect(myProjectIncomeForMonth(pays, other, shares, 'me', '2026-06')).toBe(0);
  });
  it('contract=0 → 0', () => {
    const z = [{ id: 'p1', ownerId: 'me', stage: 'В работе', contractSum: 0, paidAmount: 0 }];
    expect(myProjectIncomeForMonth(pays, z, shares, 'me', '2026-06')).toBe(0);
  });
  it('учитывает долю: участник 40% → владелец получает 60% платежа', () => {
    const sh = { p1: [{ shareKind: 'percent', shareValue: 40 }] };
    expect(myProjectIncomeForMonth(pays, projects, sh, 'me', '2026-06')).toBeCloseTo(18);
  });
});

describe('selectionTotals', () => {
  it('суммирует получено/остаток/договор + разбивка', () => {
    const sel = [
      { id: 'a', name: 'A', contractSum: 100, paidAmount: 50 },
      { id: 'b', name: 'B', contractSum: 200, paidAmount: 0 },
    ];
    const r = selectionTotals(sel, {}, 'me');
    expect(r.contract).toBe(300);
    expect(r.received).toBe(50);
    expect(r.remaining).toBe(250);
    expect(r.breakdown).toEqual([{ id: 'a', name: 'A', received: 50 }, { id: 'b', name: 'B', received: 0 }]);
  });
  it('пустой выбор → нули', () => {
    expect(selectionTotals([], {}, 'me')).toEqual({ received: 0, remaining: 0, contract: 0, breakdown: [] });
  });
});

describe('projectIncomeTxs (проектные платежи → псевдо-доходы для дашборда/аналитики)', () => {
  const projects = [
    { id: 'p1', ownerId: 'me',    stage: 'В работе', contractSum: 100, paidAmount: 50 },
    { id: 'p2', ownerId: 'other', stage: 'В работе', contractSum: 100, paidAmount: 50 }, // чужой
    { id: 'p3', ownerId: 'me',    stage: 'Архив',    contractSum: 100, paidAmount: 50 }, // архив
    { id: 'p4', ownerId: 'me',    stage: 'В работе', contractSum: 0,   paidAmount: 0 },  // contract=0
  ];
  const shares = {};
  const pays = {
    p1: [{ amount: 30, paidOn: '2026-06-10' }, { amount: 20, paidOn: '2026-05-01' }],
    p2: [{ amount: 99, paidOn: '2026-06-10' }],
    p3: [{ amount: 77, paidOn: '2026-06-10' }],
    p4: [{ amount: 11, paidOn: '2026-06-10' }],
  };

  it('возвращает псевдо-доходы только по моим неархивным проектам с договором', () => {
    const out = projectIncomeTxs(pays, projects, shares, 'me');
    // только p1 (2 платежа); p2 чужой, p3 архив, p4 contract=0 — отброшены
    expect(out).toEqual([
      { date: '2026-06-10', type: 'income', amount: 30, category: 'Проектные доходы' },
      { date: '2026-05-01', type: 'income', amount: 20, category: 'Проектные доходы' },
    ]);
  });

  it('учитывает долю владельца: участник 40% → 60% платежа', () => {
    const sh = { p1: [{ shareKind: 'percent', shareValue: 40 }] };
    const out = projectIncomeTxs({ p1: [{ amount: 30, paidOn: '2026-06-10' }] }, projects, sh, 'me');
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBeCloseTo(18); // 30 * 60/100
  });

  it('игнорирует платежи без paidOn', () => {
    const out = projectIncomeTxs({ p1: [{ amount: 30, paidOn: null }] }, projects, shares, 'me');
    expect(out).toEqual([]);
  });

  it('пустой вход → пустой массив', () => {
    expect(projectIncomeTxs({}, [], {}, 'me')).toEqual([]);
  });

  // ЗОЛОТОЕ СВОЙСТВО: сумма псевдо-доходов за месяц == myProjectIncomeForMonth за тот же месяц.
  // Гарантирует, что дашборд/аналитика согласованы с вкладкой «Финансы».
  it('согласованность с myProjectIncomeForMonth за месяц', () => {
    const month = '2026-06';
    const range = { from: '2026-06-01', to: '2026-07-01' };
    const sh = { p1: [{ shareKind: 'percent', shareValue: 40 }] };
    const fromTxs = projectIncomeTxs(pays, projects, sh, 'me')
      .filter(t => inPeriod(t.date, range))
      .reduce((s, t) => s + t.amount, 0);
    const fromFinance = myProjectIncomeForMonth(pays, projects, sh, 'me', month);
    expect(fromTxs).toBeCloseTo(fromFinance);
  });

  // Воспроизведение бага: «Баланс за период» на дашборде должен включать проектный доход.
  it('periodBalance([...txs, ...projectIncomeTxs]) включает проектный доход (репро бага #3)', () => {
    const txs = []; // ручных транзакций нет — как у владельца
    const range = { from: '2026-06-01', to: '2026-07-01' };
    const allTxs = [...txs, ...projectIncomeTxs(pays, projects, shares, 'me')];
    expect(periodBalance(allTxs, range).income).toBe(30); // раньше было бы 0
  });
});

describe('viewerShareOnProject (доля ЗРИТЕЛЯ на карточке проекта, баг A)', () => {
  const project = { id: 'p1', ownerId: 'owner', contractSum: 100000 };
  const shares = [
    { participantUserId: 'alice', shareKind: 'percent', shareValue: 40 },          // 40000
    { participantUserId: null, participantName: 'Внешний', shareKind: 'amount', shareValue: 10000 },
  ];
  it('владелец видит свой ОСТАТОК', () => {
    expect(viewerShareOnProject(project, shares, 'owner')).toEqual({ amount: 50000, percent: 50, isOwner: true });
  });
  it('участник-юзер видит СВОЮ долю, а не остаток владельца (суть бага A)', () => {
    expect(viewerShareOnProject(project, shares, 'alice')).toEqual({ amount: 40000, percent: 40, isOwner: false });
  });
  it('не-участник (нет своей строки, не владелец) → null', () => {
    expect(viewerShareOnProject(project, shares, 'bob')).toBeNull();
  });
  it('contract=0 → null', () => {
    expect(viewerShareOnProject({ id: 'p', ownerId: 'owner', contractSum: 0 }, shares, 'owner')).toBeNull();
  });
  it('участник с долей-суммой: процент считается от договора', () => {
    const r = viewerShareOnProject(project, [{ participantUserId: 'carol', shareKind: 'amount', shareValue: 25000 }], 'carol');
    expect(r).toEqual({ amount: 25000, percent: 25, isOwner: false });
  });
  it('viewerId не задан → null (нет зрителя)', () => {
    expect(viewerShareOnProject(project, shares, null)).toBeNull();
  });
});

describe('portfolioMineTotal (сколько Я имею от портфеля, замечание B)', () => {
  const projects = [
    { id: 'p1', ownerId: 'me',    stage: 'В работе', contractSum: 100000 }, // моя доля = остаток
    { id: 'p2', ownerId: 'me',    stage: 'Архив',    contractSum: 50000 },  // архив — исключить
    { id: 'p3', ownerId: 'other', stage: 'В работе', contractSum: 80000 },  // чужой — не как владелец
  ];
  const sharesByProject = { p1: [{ shareKind: 'percent', shareValue: 30 }] }; // участник 30% → мой остаток 70000
  const myShares = [{ projectName: 'X', myAmount: 18000, myReceived: 0, myReceivable: 18000 }]; // моя доля в чужом
  it('сумма моих остатков по своим неархивным + мои доли в чужих', () => {
    expect(portfolioMineTotal(projects, sharesByProject, 'me', myShares)).toBe(70000 + 18000);
  });
  it('без долей и без чужих = сумма договоров своих неархивных', () => {
    expect(portfolioMineTotal([{ id: 'a', ownerId: 'me', stage: 'В работе', contractSum: 40000 }], {}, 'me', [])).toBe(40000);
  });
  it('пустой портфель → 0', () => {
    expect(portfolioMineTotal([], {}, 'me', [])).toBe(0);
  });
});
