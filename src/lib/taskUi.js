// Чистая логика вкладки «Задачи» (без React/Supabase) — светофор срока и сводка.
// «Сегодня» всегда передаётся параметром (тестируемость, как в dashboardMetrics.js).

export const DUE_SOON_DAYS = 3; // порог «жёлтого» (≤ N дней до срока)

export const DUE_COLORS = {
  none: "#62646b",     // срока нет
  ok: "#6ee7a8",       // времени достаточно
  soon: "#e8c860",     // ≤ DUE_SOON_DAYS дней
  overdue: "#f8a3a3",  // просрочено
};

export const PRIORITY_ORDER = { "Высокий": 0, "Обычный": 1, "Низкий": 2 };

// dueDate/today — строки 'YYYY-MM-DD'. Возврат: { level, days } (days < 0 = просрочено).
export function dueState(dueDate, today, soonDays = DUE_SOON_DAYS) {
  if (!dueDate) return { level: "none", days: null };
  const d = Date.parse(dueDate + "T00:00:00Z");
  const t = Date.parse(today + "T00:00:00Z");
  if (Number.isNaN(d) || Number.isNaN(t)) return { level: "none", days: null };
  const days = Math.round((d - t) / 86400000);
  if (days < 0) return { level: "overdue", days };
  if (days <= soonDays) return { level: "soon", days };
  return { level: "ok", days };
}

// Человеческий хвост к дате: 'сегодня' / 'через 2 дн' / '−2 дн' (минус — U+2212, как в мокапе).
export function dueSuffix(days) {
  if (days == null) return "";
  if (days === 0) return "сегодня";
  if (days < 0) return `−${-days} дн`;
  return `через ${days} дн`;
}

// Сводка шапки: активные задачи, просроченные ИЛИ с открытым вопросом.
export function tasksAttention(tasks, today) {
  return tasks.filter(task =>
    task.status !== "Готово" && task.status !== "Отменена" &&
    (dueState(task.dueDate, today).level === "overdue" || !!task.hasOpenQuestion)
  ).length;
}
