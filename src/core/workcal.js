// Рабочий календарь: длительность интервала в рабочих секундах
// (сумма пересечений с рабочими окнами рабочих дней) или в календарных секундах.

import { DAY, dowOfDay, parseIsoDay } from './dates.js';

export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h * 3600 + mi * 60;
}

function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function countIn(sorted, from, to) {
  if (to < from) return 0;
  return lowerBound(sorted, to + 1) - lowerBound(sorted, from);
}

export class WorkCalendar {
  /**
   * @param {{dayStart:string, dayEnd:string, holidays:string[], workdays?:string[], mode:'work'|'calendar'}} cfg
   * holidays — праздничные дни (гггг-мм-дд), workdays — перенесённые рабочие выходные.
   */
  constructor(cfg) {
    this.mode = cfg.mode === 'calendar' ? 'calendar' : 'work';
    this.startSec = parseHHMM(cfg.dayStart) ?? 9 * 3600;
    this.endSec = parseHHMM(cfg.dayEnd) ?? 18 * 3600;
    if (this.endSec <= this.startSec) {
      this.startSec = 9 * 3600;
      this.endSec = 18 * 3600;
    }
    this.daySec = this.endSec - this.startSec;
    const hol = new Set((cfg.holidays || []).map(parseIsoDay).filter((d) => d != null));
    const extra = new Set((cfg.workdays || []).map(parseIsoDay).filter((d) => d != null));
    this.holidays = hol;
    this.extraWorkdays = extra;
    // Для подсчёта целых рабочих дней важны только праздники в будни и рабочие выходные.
    this.weekdayHolidays = [...hol].filter((d) => dowOfDay(d) < 5 && !extra.has(d)).sort((a, b) => a - b);
    this.weekendWorkdays = [...extra].filter((d) => dowOfDay(d) >= 5 && !hol.has(d)).sort((a, b) => a - b);
  }

  /** Длина рабочего дня в часах (в календарном режиме — 24). */
  get dayHours() {
    return this.mode === 'calendar' ? 24 : this.daySec / 3600;
  }

  isWorkday(di) {
    if (this.extraWorkdays.has(di) && !this.holidays.has(di)) return true;
    if (this.holidays.has(di)) return false;
    return dowOfDay(di) < 5;
  }

  /** Число рабочих дней в диапазоне дней [a, b]. */
  workdaysBetween(a, b) {
    if (b < a) return 0;
    const n = b - a + 1;
    const weeks = Math.floor(n / 7);
    let weekdays = weeks * 5;
    for (let d = a + weeks * 7; d <= b; d++) if (dowOfDay(d) < 5) weekdays++;
    return weekdays - countIn(this.weekdayHolidays, a, b) + countIn(this.weekendWorkdays, a, b);
  }

  overlapInDay(di, fromSec, toSec) {
    if (!this.isWorkday(di)) return 0;
    const s = Math.max(fromSec, this.startSec);
    const e = Math.min(toSec, this.endSec);
    return e > s ? e - s : 0;
  }

  /** Секунды между двумя настенными моментами (a ≤ b), с точностью до секунды. */
  seconds(a, b) {
    if (a == null || b == null || b <= a) return 0;
    if (this.mode === 'calendar') return b - a;
    const da = Math.floor(a / DAY);
    const db = Math.floor(b / DAY);
    const sa = a - da * DAY;
    const sb = b - db * DAY;
    if (da === db) return this.overlapInDay(da, sa, sb);
    return this.overlapInDay(da, sa, DAY) + this.overlapInDay(db, 0, sb) + this.workdaysBetween(da + 1, db - 1) * this.daySec;
  }

  hours(a, b) {
    return this.seconds(a, b) / 3600;
  }
}
