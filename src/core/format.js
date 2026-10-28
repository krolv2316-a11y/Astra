// Форматирование чисел и длительностей по-русски: запятая, неразрывный пробел в тысячах.

const NBSP = ' ';

export function fmtInt(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = String(Math.round(Math.abs(n)));
  const grouped = s.length > 3 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) : s;
  return (n < 0 ? '−' : '') + grouped;
}

export function fmtNum(x, digits = 1) {
  if (x == null || !Number.isFinite(x)) return '—';
  const neg = x < 0;
  const fixed = Math.abs(x).toFixed(digits);
  const [i, f] = fixed.split('.');
  const grouped = i.length > 3 ? i.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) : i;
  return (neg ? '−' : '') + grouped + (f ? `,${f}` : '');
}

export function fmtPct(share, digits = 1) {
  if (share == null || !Number.isFinite(share)) return '—';
  return `${fmtNum(share * 100, digits)}${NBSP}%`;
}

export const NO_DATA = 'нет данных';

/** Единицы показателей времени. */
export function hourUnit(calendarMode) {
  return calendarMode ? 'кал. ч' : 'раб. ч';
}

function dayUnit(calendarMode) {
  return calendarMode ? 'дн.' : 'раб. дн.';
}

/**
 * Автоформат длительности в часах (показатели (а) и (б)):
 * < 1 мин → сек; < 60 мин → мин; < 1 рабочего дня → ч; иначе → раб. дн.
 */
export function fmtHoursAuto(h, dayHours, calendarMode = false) {
  if (h == null || !Number.isFinite(h)) return NO_DATA;
  const sec = h * 3600;
  if (sec < 59.5) return `${Math.round(sec)}${NBSP}сек`;
  const min = h * 60;
  if (min < 59.95) return `${fmtNum(min, 1)}${NBSP}мин`;
  if (h < dayHours - 0.05) return `${fmtNum(h, 1)}${NBSP}ч`;
  return `${fmtNum(h / dayHours, 1)}${NBSP}${dayUnit(calendarMode)}`;
}

/** Автоформат «Затрачено» (минуты): < 1 мин → сек; < 60 мин → мин; дальше «Ч ч ММ мин». */
export function fmtSpentAuto(min) {
  if (min == null || !Number.isFinite(min)) return NO_DATA;
  if (min < 59.5 / 60) return `${Math.round(min * 60)}${NBSP}сек`;
  if (min < 59.95) return `${fmtNum(min, 1)}${NBSP}мин`;
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}${NBSP}ч ${String(m).padStart(2, '0')}${NBSP}мин`;
}

/** Полное значение с единицей (для подсказок): 3 знака после запятой. */
export function fmtFull(metric, v, calendarMode = false) {
  if (v == null || !Number.isFinite(v)) return NO_DATA;
  return metric === 'spent' ? `${fmtNum(v, 3)}${NBSP}мин` : `${fmtNum(v, 3)}${NBSP}${hourUnit(calendarMode)}`;
}

export function fmtAuto(metric, v, dayHours, calendarMode = false) {
  return metric === 'spent' ? fmtSpentAuto(v) : fmtHoursAuto(v, dayHours, calendarMode);
}

/**
 * Единица оси графика по диапазону данных. Возвращает { factor, unit }:
 * значение на оси = значение в базовой единице × factor.
 */
export function axisUnit(metric, maxValue, dayHours, calendarMode = false) {
  const max = Number.isFinite(maxValue) ? maxValue : 0;
  if (metric === 'spent') {
    if (max < 1) return { factor: 60, unit: 'сек' };
    if (max < 180) return { factor: 1, unit: 'мин' };
    return { factor: 1 / 60, unit: 'ч' };
  }
  if (max < 1) return { factor: 60, unit: 'мин' };
  if (max < 5 * dayHours) return { factor: 1, unit: hourUnit(calendarMode) };
  return { factor: 1 / dayHours, unit: dayUnit(calendarMode) };
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n}${NBSP}Б`;
  if (n < 1024 * 1024) return `${fmtNum(n / 1024, 0)}${NBSP}КБ`;
  return `${fmtNum(n / 1024 / 1024, 1)}${NBSP}МБ`;
}
