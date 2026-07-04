// Умный импорт выписки Яндекс Банка v2. Чистые функции — покрыты vitest.

// Нормализация описания в ключ мерчанта: разные точки сети → один ключ.
export function normalizeMerchant(rawDesc) {
  const tokens = (rawDesc || "")
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(t => t.length >= 2 && !/^\d+$/.test(t));
  return tokens[0] || "";
}
