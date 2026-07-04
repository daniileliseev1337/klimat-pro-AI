import { describe, it, expect } from "vitest";
import { normalizeMerchant } from "./bankParsers.js";

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
