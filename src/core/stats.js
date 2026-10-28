// Простые статистики. Перцентиль — линейная интерполяция, как PERCENTILE.INC / numpy по умолчанию.

export function sortNum(arr) {
  return Float64Array.from(arr).sort();
}

export function percentileSorted(sorted, p) {
  const n = sorted.length;
  if (!n) return NaN;
  if (n === 1) return sorted[0];
  const h = (n - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function percentile(arr, p) {
  return percentileSorted(sortNum(arr), p);
}

// k-я порядковая статистика (0-based) без полной сортировки; массив переставляется.
function select(a, k) {
  let lo = 0;
  let hi = a.length - 1;
  while (hi > lo) {
    const mid = (lo + hi) >> 1;
    // Медиана трёх как опорный элемент.
    if (a[mid] < a[lo]) [a[mid], a[lo]] = [a[lo], a[mid]];
    if (a[hi] < a[lo]) [a[hi], a[lo]] = [a[lo], a[hi]];
    if (a[hi] < a[mid]) [a[hi], a[mid]] = [a[mid], a[hi]];
    const pivot = a[mid];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k];
  }
  return a[k];
}

export function median(values) {
  return values.length ? medianInPlace(Float64Array.from(values)) : null;
}

/** Медиана Float64Array; массив переставляется. */
export function medianInPlace(a) {
  const n = a.length;
  if (!n) return null;
  const upper = select(a, n >> 1);
  if (n % 2) return upper;
  // Нижняя середина — максимум левой части после разбиения.
  let lower = -Infinity;
  for (let i = 0; i < n >> 1; i++) if (a[i] > lower) lower = a[i];
  return lower + 0.5 * (upper - lower);
}

/** { n, mean, median } для массива чисел; при n = 0 mean/median = null. */
export function summarize(values) {
  const n = values.length;
  if (!n) return { n: 0, mean: null, median: null };
  let sum = 0;
  for (const v of values) sum += v;
  return { n, mean: sum / n, median: median(values) };
}
