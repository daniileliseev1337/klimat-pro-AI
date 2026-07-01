// Чистые расчёты для вкладок заказчика. Вход — данные из безопасных проекций
// (get_my_client_projects / get_my_project_payments / get_tasks). Без React/Supabase.
const CLOSED_STAGES = ['Оплачен', 'Архив'];

export function projectRemaining(p) {
  return Math.max(0, (+p.contractSum || 0) - (+p.paidAmount || 0));
}

export function clientTotals(projects = []) {
  return projects.reduce((acc, p) => {
    const closed = CLOSED_STAGES.includes(p.stage);
    acc.totalContract += (+p.contractSum || 0);
    acc.totalPaid     += (+p.paidAmount  || 0);
    acc.totalRemaining += projectRemaining(p);
    acc.openTasks     += (+p.openTaskCount || 0);
    if (!closed) acc.activeCount += 1;
    return acc;
  }, { activeCount:0, totalContract:0, totalPaid:0, totalRemaining:0, openTasks:0 });
}

export function attentionTasks(tasks = []) {
  return tasks.filter(t => t.status === 'На проверке');
}

export function paymentsByProject(payments = []) {
  const out = {};
  for (const pay of payments) {
    const k = pay.project_id;
    if (!out[k]) out[k] = { name: pay.project_name, items: [], total: 0 };
    out[k].items.push({ paid_on: pay.paid_on, amount: +pay.amount || 0 });
    out[k].total += (+pay.amount || 0);
  }
  return out;
}
