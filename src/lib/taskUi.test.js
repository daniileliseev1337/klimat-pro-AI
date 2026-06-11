import { describe, it, expect } from "vitest";
import { dueState, dueSuffix, tasksAttention, PRIORITY_ORDER, DUE_COLORS } from "./taskUi.js";

const T = "2026-06-11"; // «сегодня» всегда передаётся снаружи — функции чистые

describe("dueState", () => {
  it("нет срока -> none", () => expect(dueState(null, T)).toEqual({ level: "none", days: null }));
  it("пустая строка -> none", () => expect(dueState("", T)).toEqual({ level: "none", days: null }));
  it("кривая дата -> none", () => expect(dueState("oops", T).level).toBe("none"));
  it("вчера -> overdue, days=-1", () => expect(dueState("2026-06-10", T)).toEqual({ level: "overdue", days: -1 }));
  it("сегодня -> soon, days=0", () => expect(dueState("2026-06-11", T)).toEqual({ level: "soon", days: 0 }));
  it("через 3 дня -> soon (порог включительно)", () => expect(dueState("2026-06-14", T).level).toBe("soon"));
  it("через 4 дня -> ok", () => expect(dueState("2026-06-15", T).level).toBe("ok"));
  it("кастомный порог", () => expect(dueState("2026-06-15", T, 7).level).toBe("soon"));
});

describe("dueSuffix", () => {
  it("null -> ''", () => expect(dueSuffix(null)).toBe(""));
  it("0 -> сегодня", () => expect(dueSuffix(0)).toBe("сегодня"));
  it("2 -> через 2 дн", () => expect(dueSuffix(2)).toBe("через 2 дн"));
  it("-2 -> −2 дн (компактно, как в мокапе B)", () => expect(dueSuffix(-2)).toBe("−2 дн"));
});

describe("PRIORITY_ORDER / DUE_COLORS", () => {
  it("Высокий раньше Обычного раньше Низкого", () => {
    expect(PRIORITY_ORDER["Высокий"]).toBeLessThan(PRIORITY_ORDER["Обычный"]);
    expect(PRIORITY_ORDER["Обычный"]).toBeLessThan(PRIORITY_ORDER["Низкий"]);
  });
  it("все уровни имеют цвет", () => {
    for (const k of ["none", "ok", "soon", "overdue"]) expect(DUE_COLORS[k]).toMatch(/^#/);
  });
});

describe("tasksAttention", () => {
  const mk = (o) => ({ status: "В работе", dueDate: null, hasOpenQuestion: false, ...o });
  it("просроченная активная считается", () => expect(tasksAttention([mk({ dueDate: "2026-06-01" })], T)).toBe(1));
  it("открытый вопрос считается", () => expect(tasksAttention([mk({ hasOpenQuestion: true })], T)).toBe(1));
  it("Готово/Отменена не считаются", () =>
    expect(tasksAttention([mk({ status: "Готово", dueDate: "2026-06-01" }), mk({ status: "Отменена", hasOpenQuestion: true })], T)).toBe(0));
  it("две причины в одной задаче = 1", () => expect(tasksAttention([mk({ dueDate: "2026-06-01", hasOpenQuestion: true })], T)).toBe(1));
  it("пустой список = 0", () => expect(tasksAttention([], T)).toBe(0));
  it("soon (срок близко, не просрочен) — НЕ требует внимания", () =>
    expect(tasksAttention([mk({ dueDate: "2026-06-13" })], T)).toBe(0));
});
