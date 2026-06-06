import { describe, it, expect } from 'vitest';
import { periodRange, prevPeriodRange, inPeriod, periodBalance, trendDir, granularityFor, financeSeries, expenseByCategory } from './dashboardMetrics.js';

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
