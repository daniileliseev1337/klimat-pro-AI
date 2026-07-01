import { describe, it, expect } from 'vitest';
import { clientTotals, attentionTasks, paymentsByProject, projectRemaining } from './clientMetrics.js';

const projects = [
  { id:'a', name:'A', stage:'В работе', contractSum:100, paidAmount:40, openTaskCount:2 },
  { id:'b', name:'B', stage:'Оплачен',  contractSum:50,  paidAmount:50, openTaskCount:0 },
];
const tasks = [
  { id:'t1', title:'x', status:'В работе',   project_id:'a' },
  { id:'t2', title:'y', status:'На проверке', project_id:'a' },
];
const payments = [
  { project_id:'a', project_name:'A', paid_on:'2026-06-01', amount:40 },
  { project_id:'b', project_name:'B', paid_on:'2026-05-01', amount:50 },
];

describe('clientMetrics', () => {
  it('clientTotals: активные без Оплачен/Архив, суммы, открытые задачи', () => {
    expect(clientTotals(projects)).toEqual({
      activeCount:1, totalContract:150, totalPaid:90, totalRemaining:60, openTasks:2,
    });
  });
  it('projectRemaining: договор минус оплачено, не ниже нуля', () => {
    expect(projectRemaining({ contractSum:100, paidAmount:40 })).toBe(60);
    expect(projectRemaining({ contractSum:30,  paidAmount:50 })).toBe(0);
  });
  it('attentionTasks: только На проверке', () => {
    expect(attentionTasks(tasks).map(t => t.id)).toEqual(['t2']);
  });
  it('paymentsByProject: группировка + total', () => {
    const g = paymentsByProject(payments);
    expect(g['a'].total).toBe(40);
    expect(g['a'].items).toHaveLength(1);
    expect(g['b'].name).toBe('B');
  });
});
