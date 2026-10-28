// Даты хранятся как «настенное» время: секунды от 1970-01-01 00:00:00,
// посчитанные так, будто это UTC. Все вычисления идут через UTC-методы,
// поэтому часовой пояс браузера на результат не влияет.

export const DAY = 86400;

const EXCEL_EPOCH_1900 = Date.UTC(1899, 11, 30) / 1000;
const EXCEL_EPOCH_1900_EARLY = Date.UTC(1899, 11, 31) / 1000;
const EXCEL_EPOCH_1904 = Date.UTC(1904, 0, 1) / 1000;

export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

export function wallFromParts(y, mo, d, h = 0, mi = 0, s = 0) {
  return Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
}

function daysInMonth(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

const RE_RU = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?$/;
const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** Текст «дд.мм.гггг чч:мм[:сс]» (или ISO) → настенные секунды; NaN, если не распознано. */
export function parseDateText(text) {
  const s = String(text).replace(/ /g, ' ').trim();
  let m = RE_RU.exec(s);
  let y, mo, d, h, mi, sec;
  if (m) {
    [d, mo, y] = [+m[1], +m[2], +m[3]];
  } else if ((m = RE_ISO.exec(s))) {
    [y, mo, d] = [+m[1], +m[2], +m[3]];
  } else {
    return NaN;
  }
  h = m[4] ? +m[4] : 0;
  mi = m[5] ? +m[5] : 0;
  sec = m[6] ? +m[6] : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || sec > 59) return NaN;
  return wallFromParts(y, mo, d, h, mi, sec);
}

/** Серийный номер Excel → настенные секунды (с округлением до секунды). */
export function excelSerialToWall(serial, date1904 = false) {
  if (!Number.isFinite(serial)) return NaN;
  const secs = Math.round(serial * DAY);
  if (date1904) return EXCEL_EPOCH_1904 + secs;
  // В системе 1900 Excel считает несуществующее 29.02.1900 (серийный номер 60).
  return (serial < 61 ? EXCEL_EPOCH_1900_EARLY : EXCEL_EPOCH_1900) + secs;
}

export function wallToExcelSerial(ws) {
  return (ws - EXCEL_EPOCH_1900) / DAY;
}

export function dayIndex(ws) {
  return Math.floor(ws / DAY);
}

/** 0 = понедельник … 6 = воскресенье. */
export function dowOfDay(di) {
  return (((di + 3) % 7) + 7) % 7;
}

export function partsOfDay(di) {
  const dt = new Date(di * DAY * 1000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function dayFromParts(y, m, d) {
  return Math.floor(Date.UTC(y, m - 1, d) / 1000 / DAY);
}

const p2 = (n) => String(n).padStart(2, '0');

export function fmtDay(di) {
  const { y, m, d } = partsOfDay(di);
  return `${p2(d)}.${p2(m)}.${y}`;
}

export function fmtDate(ws) {
  return ws == null || !Number.isFinite(ws) ? '' : fmtDay(dayIndex(ws));
}

export function fmtDateTime(ws, withSeconds = false) {
  if (ws == null || !Number.isFinite(ws)) return '';
  const dt = new Date(ws * 1000);
  const base = `${p2(dt.getUTCDate())}.${p2(dt.getUTCMonth() + 1)}.${dt.getUTCFullYear()} ${p2(dt.getUTCHours())}:${p2(dt.getUTCMinutes())}`;
  return withSeconds ? `${base}:${p2(dt.getUTCSeconds())}` : base;
}

/** ISO-представление дня (гггг-мм-дд) — для input[type=date] и имён файлов. */
export function isoDay(di) {
  const { y, m, d } = partsOfDay(di);
  return `${y}-${p2(m)}-${p2(d)}`;
}

export function parseIsoDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return dayFromParts(y, mo, d);
}

/** Разбор даты «дд.мм.гггг» или «гггг-мм-дд» → индекс дня или null. */
export function parseDayText(s) {
  const t = String(s || '').trim();
  const iso = parseIsoDay(t);
  if (iso != null) return iso;
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (!m) return null;
  const [d, mo, y] = [+m[1], +m[2], +m[3]];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return dayFromParts(y, mo, d);
}

// ---- Периоды динамики -------------------------------------------------------

/** Ключ месяца: y*12 + (m-1). */
export function monthKeyOfDay(di) {
  const { y, m } = partsOfDay(di);
  return y * 12 + (m - 1);
}

export function monthBounds(key) {
  const y = Math.floor(key / 12);
  const m = (key % 12) + 1;
  const start = dayFromParts(y, m, 1);
  const end = start + daysInMonth(y, m) - 1;
  return { y, m, start, end };
}

/** Ключ ISO-недели = индекс дня её понедельника. */
export function weekKeyOfDay(di) {
  return di - dowOfDay(di);
}

export function isoWeekInfo(mondayDi) {
  const thursday = mondayDi + 3;
  const { y } = partsOfDay(thursday);
  const jan1 = dayFromParts(y, 1, 1);
  const week = Math.floor((thursday - jan1) / 7) + 1;
  return { isoYear: y, week, start: mondayDi, end: mondayDi + 6 };
}

function ddmm(di) {
  const { m, d } = partsOfDay(di);
  return `${p2(d)}.${p2(m)}`;
}

/**
 * Список периодов между днями [fromDi, toDi] включительно.
 * sliceDi — день среза: период, который ещё не закончился к срезу, помечается неполным.
 * cutFrom/cutTo — границы пользовательского фильтра: период, обрезанный ими, тоже неполный.
 */
export function buildPeriods(step, fromDi, toDi, { sliceDi = null, cutFrom = null, cutTo = null } = {}) {
  const out = [];
  if (fromDi == null || toDi == null || toDi < fromDi) return out;
  const multiYear = partsOfDay(fromDi).y !== partsOfDay(toDi).y;
  if (step === 'week') {
    for (let k = weekKeyOfDay(fromDi); k <= toDi; k += 7) {
      const info = isoWeekInfo(k);
      const yearPart = multiYear ? ` ${info.isoYear}` : '';
      const p = {
        key: k,
        start: info.start,
        end: info.end,
        label: `Нед. ${info.week}${yearPart} (${ddmm(info.start)}–${ddmm(info.end)})`,
        axis: [`Нед. ${info.week}${yearPart}`, `${ddmm(info.start)}–${ddmm(info.end)}`],
        short: `${info.isoYear}-W${p2(info.week)}`,
      };
      out.push(p);
    }
  } else {
    for (let k = monthKeyOfDay(fromDi), last = monthKeyOfDay(toDi); k <= last; k++) {
      const b = monthBounds(k);
      out.push({
        key: k,
        start: b.start,
        end: b.end,
        label: `${MONTHS_FULL[b.m - 1][0].toUpperCase()}${MONTHS_FULL[b.m - 1].slice(1)} ${b.y}`,
        axis: [`${MONTHS_SHORT[b.m - 1][0].toUpperCase()}${MONTHS_SHORT[b.m - 1].slice(1)} ${b.y}`],
        short: `${p2(b.m)}.${b.y}`,
      });
    }
  }
  for (const p of out) {
    let note = null;
    const limit = Math.min(sliceDi ?? Infinity, cutTo ?? Infinity);
    if (limit < p.end) note = `по ${fmtDay(limit)}`;
    if (cutFrom != null && cutFrom > p.start) note = note ? `${fmtDay(cutFrom)}–${fmtDay(limit)}` : `с ${fmtDay(cutFrom)}`;
    p.incomplete = note != null;
    p.incompleteNote = note;
    if (p.incomplete) {
      p.label += ' — неполный период';
      p.axis = [...p.axis, 'неполный', 'период'];
    }
  }
  return out;
}
