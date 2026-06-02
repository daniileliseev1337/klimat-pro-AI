// Построчный diff (git-стиль) — чистая функция, без зависимостей.
// Алгоритм: классический LCS по строкам (динамика), затем восстановление
// последовательности сегментов. Возвращает массив сегментов в порядке нового
// текста с вкраплением удалённых строк на их позиции.
//
// Вход:  oldText, newText — строки (целые тексты ТЗ).
// Выход: [{ type, text }] где type ∈ 'equal' | 'del' | 'add', text — одна строка.
//   'equal' — строка есть в обоих; 'del' — была в old, удалена; 'add' — добавлена в new.

function splitLines(s) {
  // Нормализуем переводы строк, не теряем пустые строки в середине.
  if (s == null) return [];
  const norm = String(s).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Пустой текст -> ноль строк (нет смысла в одной пустой строке-сегменте).
  if (norm === "") return [];
  return norm.split("\n");
}

export function diffLines(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length, m = b.length;

  // LCS-таблица длин. (n+1)x(m+1).
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Восстановление: идём с начала, формируем сегменты в естественном порядке.
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "equal", text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) { out.push({ type: "del", text: a[i] }); i++; }
  while (j < m) { out.push({ type: "add", text: b[j] }); j++; }
  return out;
}
