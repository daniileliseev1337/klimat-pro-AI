import { describe, it, expect } from "vitest";
import { normalizeMerchant, categorizeByMcc, categorizeByDict, categorize, classifyOperation, hashOperation, dedupe } from "./bankParsers.js";

describe("normalizeMerchant", () => {
  it("сводит разные точки одной сети к одному ключу", () => {
    expect(normalizeMerchant("MAGNIT MM STANTSIONNYJ 12")).toBe("magnit");
    expect(normalizeMerchant("MAGNIT 7745")).toBe("magnit");
  });
  it("чистит спецсимволы и регистр", () => {
    expect(normalizeMerchant("Pyaterochka 5231")).toBe("pyaterochka");
    expect(normalizeMerchant("  VERNYJ 1300 ")).toBe("vernyj");
  });
  it("пустую строку отдаёт пустым ключом", () => {
    expect(normalizeMerchant("")).toBe("");
    expect(normalizeMerchant("   ")).toBe("");
  });
});

describe("categorizeByMcc", () => {
  it("распознаёт MCC такси", () => {
    expect(categorizeByMcc("YANDEX*4121*TAXI")).toBe("Такси");
  });
  it("распознаёт MCC продуктов", () => {
    expect(categorizeByMcc("YANDEX*5411*LAVKA")).toBe("Питание");
  });
  it("возвращает null без MCC", () => {
    expect(categorizeByMcc("MAGNIT MM STANTSIONNYJ")).toBeNull();
    expect(categorizeByMcc("YANDEX*9999*UNKNOWN")).toBeNull();
  });
});

describe("categorizeByDict", () => {
  it("узнаёт мерчанта по границе слова", () => {
    expect(categorizeByDict("MAGNIT MM STANTSIONNYJ")).toBe("Питание");
    expect(categorizeByDict("VERNYJ 1300")).toBe("Питание");
  });
  it("НЕ ловит подстроку внутри слова (чинит слабость substring)", () => {
    // 'spar' не должен срабатывать внутри 'sparta gym'
    expect(categorizeByDict("SPARTA GYM")).not.toBe("Питание");
    // 'metro' (транспорт) не должен ловить 'METRO CASH AND CARRY'
    expect(categorizeByDict("METRO CASH AND CARRY")).not.toBe("Транспорт");
  });
  it("возвращает null для незнакомого", () => {
    expect(categorizeByDict("SOME UNKNOWN SHOP")).toBeNull();
  });
  it("узнаёт ветклинику (ключ с хвостовым пробелом не ломает матч)", () => {
    expect(categorizeByDict("VET CLINIC")).toBe("Питомцы");
    // false-positive: 'vet' внутри другого слова не должен давать Питомцы
    expect(categorizeByDict("SOVIET UNION SHOP")).not.toBe("Питомцы");
  });
});

describe("hashOperation + dedupe", () => {
  it("одинаковые операции дают одинаковый хеш", () => {
    const a = { date: "2026-07-04", amount: 540, rawDesc: "MAGNIT MM 12" };
    const b = { date: "2026-07-04", amount: 540, rawDesc: "MAGNIT MM 12" };
    expect(hashOperation(a)).toBe(hashOperation(b));
  });
  it("помечает уже существующие как dupe", () => {
    const op = { date: "2026-07-04", amount: 540, rawDesc: "MAGNIT MM 12" };
    const existing = new Set([hashOperation(op)]);
    const [r] = dedupe([op], existing);
    expect(r.dupe).toBe(true);
  });
  it("новую операцию не помечает", () => {
    const op = { date: "2026-07-05", amount: 100, rawDesc: "NEW SHOP" };
    const [r] = dedupe([op], new Set());
    expect(r.dupe).toBe(false);
  });
});

const ME = ["даниил владимирович е", "елисеев даниил"];

describe("classifyOperation", () => {
  it("перевод себе распознаётся по ФИО владельца", () => {
    const r = classifyOperation(
      { rawDesc: "Входящий перевод СБП, Даниил Владимирович Е.", amount: 147000, sign: 1 }, ME);
    expect(r.opType).toBe("self_transfer");
  });
  it("перевод физлицу обезличивается", () => {
    const r = classifyOperation(
      { rawDesc: "Исходящий перевод СБП, Римма Одеговна К., +79001234567", amount: 5000, sign: -1 }, ME);
    expect(r.opType).toBe("peer_transfer");
    expect(r.cleanDesc).not.toMatch(/Римма/);
    expect(r.cleanDesc).not.toMatch(/79001234567/);
  });
  it("техническая операция — капитализация", () => {
    const r = classifyOperation(
      { rawDesc: "Начисление процентов на остаток", amount: 320, sign: 1 }, ME);
    expect(r.opType).toBe("technical");
  });
  it("обычная оплата — payment", () => {
    const r = classifyOperation(
      { rawDesc: "MAGNIT MM STANTSIONNYJ", amount: 540, sign: -1 }, ME);
    expect(r.opType).toBe("payment");
  });
  it("не оставляет ФИО в переводе БЕЗ запятой (I3 PII)", () => {
    const r = classifyOperation(
      { rawDesc: "Исходящий перевод СБП +79001234567 Иванов Иван И.", amount: 3000, sign: -1 },
      ["даниил"]);
    expect(r.opType).toBe("peer_transfer");
    expect(r.cleanDesc).not.toMatch(/Иванов/);
    expect(r.cleanDesc).not.toMatch(/79001234567/);
  });
});

describe("categorize (цепочка)", () => {
  it("слой 1: выученное побеждает всё", () => {
    const learned = new Map([["magnit", "Особое"]]);
    const r = categorize({ rawDesc: "MAGNIT MM 12", type: "expense" }, learned);
    expect(r).toEqual({ category: "Особое", source: "learned" });
  });
  it("слой 2: MCC, если не выучено", () => {
    const r = categorize({ rawDesc: "YANDEX*4121*TAXI", type: "expense" }, new Map());
    expect(r).toEqual({ category: "Такси", source: "mcc" });
  });
  it("слой 3: словарь, если нет MCC", () => {
    const r = categorize({ rawDesc: "VERNYJ 1300", type: "expense" }, new Map());
    expect(r).toEqual({ category: "Питание", source: "dict" });
  });
  it("слой 5: незнакомый → none + Прочие", () => {
    const r = categorize({ rawDesc: "UNKNOWN XYZ", type: "expense" }, new Map());
    expect(r).toEqual({ category: "Прочие расходы", source: "none" });
  });
  it("незнакомый доход → Прочий доход", () => {
    const r = categorize({ rawDesc: "UNKNOWN XYZ", type: "income" }, new Map());
    expect(r).toEqual({ category: "Прочий доход", source: "none" });
  });
});
