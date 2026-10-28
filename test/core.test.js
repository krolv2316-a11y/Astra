import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDateText, excelSerialToWall, wallFromParts, wallToExcelSerial, buildPeriods, dayFromParts, isoWeekInfo, weekKeyOfDay, fmtDateTime,
} from '../src/core/dates.js';
import { WorkCalendar } from '../src/core/workcal.js';
import { percentile, summarize } from '../src/core/stats.js';
import { fmtSpentAuto, fmtHoursAuto, fmtInt, fmtNum, axisUnit } from '../src/core/format.js';
import { parseSpentCell, parseDateCell } from '../src/core/parse.js';
import { normalizeSettings, parseSettingsJson, defaultSettings } from '../src/core/settings.js';

const HOL = defaultSettings().calendar.holidays;

test('текстовые даты разбираются как настенное время', () => {
  assert.equal(parseDateText('12.01.2026 11:12:07'), wallFromParts(2026, 1, 12, 11, 12, 7));
  assert.equal(parseDateText(' 12.01.2026 11:12 '), wallFromParts(2026, 1, 12, 11, 12, 0));
  assert.equal(parseDateText('12.01.2026'), wallFromParts(2026, 1, 12));
  assert.equal(parseDateText('2026-01-12T11:12:07'), wallFromParts(2026, 1, 12, 11, 12, 7));
  assert.ok(Number.isNaN(parseDateText('31.02.2026 10:00')));
  assert.ok(Number.isNaN(parseDateText('12/01/2026')));
  assert.ok(Number.isNaN(parseDateText('')));
});

test('серийные даты Excel: 12.01.2026 11:12:07 остаётся 11:12:07', () => {
  const serial = 46034 + (11 * 3600 + 12 * 60 + 7) / 86400;
  const ws = excelSerialToWall(serial);
  assert.equal(fmtDateTime(ws, true), '12.01.2026 11:12:07');
  assert.equal(ws, wallFromParts(2026, 1, 12, 11, 12, 7));
  assert.equal(excelSerialToWall(wallToExcelSerial(ws)), ws);
  // Система дат 1904.
  assert.equal(excelSerialToWall(serial - 1462, true), ws);
});

test('ячейки дат: текст, число, мусор', () => {
  assert.deepEqual(parseDateCell(null), { empty: true });
  assert.deepEqual(parseDateCell({ t: 's', v: '  ' }), { empty: true });
  assert.ok(parseDateCell({ t: 's', v: 'вчера' }).bad);
  assert.equal(parseDateCell({ t: 'n', v: 46034.5, date: true }).ws, wallFromParts(2026, 1, 12, 12));
});

test('«Затрачено»: текст Ч+:ММ:СС и доля суток', () => {
  assert.equal(parseSpentCell({ t: 's', v: '96:59:22' }).min, (96 * 3600 + 59 * 60 + 22) / 60);
  assert.equal(parseSpentCell({ t: 's', v: '00:01:48' }).min, 1.8);
  assert.equal(parseSpentCell({ t: 's', v: '00:00:00' }).min, 0);
  assert.equal(parseSpentCell({ t: 'n', v: (96 * 3600 + 59 * 60 + 22) / 86400 }).min, (96 * 3600 + 59 * 60 + 22) / 60);
  assert.equal(parseSpentCell({ t: 'n', v: 1.5 }).min, 36 * 60);
  assert.deepEqual(parseSpentCell(null), { empty: true });
  assert.ok(parseSpentCell({ t: 's', v: '1 час' }).bad);
});

test('рабочие часы: выходные, праздники, границы дня', () => {
  const cal = new WorkCalendar({ dayStart: '09:00', dayEnd: '18:00', holidays: HOL, mode: 'work' });
  // Пятница 17:00 → понедельник 10:00 = 2 ч.
  assert.equal(cal.hours(wallFromParts(2026, 10, 23, 17), wallFromParts(2026, 10, 26, 10)), 2);
  // Внутри одного дня, до начала и после конца рабочего окна.
  assert.equal(cal.hours(wallFromParts(2026, 10, 26, 7), wallFromParts(2026, 10, 26, 20)), 9);
  assert.equal(cal.hours(wallFromParts(2026, 10, 26, 19), wallFromParts(2026, 10, 27, 8)), 0);
  // Новогодние каникулы: 30.12.2025 17:00 → 12.01.2026 10:00 = 1 + 9 (31.12.2025) + 1 = 11 ч.
  assert.equal(cal.hours(wallFromParts(2025, 12, 30, 17), wallFromParts(2026, 1, 12, 10)), 11);
  // 04.11.2026 — праздник.
  assert.equal(cal.hours(wallFromParts(2026, 11, 3, 17), wallFromParts(2026, 11, 5, 10)), 2);
  // Точность до секунды.
  assert.equal(cal.seconds(wallFromParts(2026, 10, 26, 9, 0, 0), wallFromParts(2026, 10, 26, 9, 0, 37)), 37);
  // Календарный режим.
  const cc = new WorkCalendar({ dayStart: '09:00', dayEnd: '18:00', holidays: HOL, mode: 'calendar' });
  assert.equal(cc.hours(wallFromParts(2026, 10, 23, 17), wallFromParts(2026, 10, 26, 10)), 65);
  assert.equal(cc.dayHours, 24);
  // Перенесённый рабочий выходной.
  const cw = new WorkCalendar({ dayStart: '09:00', dayEnd: '18:00', holidays: [], workdays: ['2026-10-24'], mode: 'work' });
  assert.equal(cw.hours(wallFromParts(2026, 10, 23, 17), wallFromParts(2026, 10, 26, 10)), 11);
});

test('рабочие часы совпадают с наивным подсчётом по дням', () => {
  const cal = new WorkCalendar({ dayStart: '08:30', dayEnd: '17:45', holidays: HOL, workdays: ['2026-03-14'], mode: 'work' });
  const hol = new Set(HOL);
  const naive = (a, b) => {
    let total = 0;
    for (let d = Math.floor(a / 86400); d <= Math.floor(b / 86400); d++) {
      const dt = new Date(d * 86400000);
      const iso = dt.toISOString().slice(0, 10);
      const wd = dt.getUTCDay();
      const work = iso === '2026-03-14' || (wd !== 0 && wd !== 6 && !hol.has(iso));
      if (!work) continue;
      const s = Math.max(a, d * 86400 + 8.5 * 3600);
      const e = Math.min(b, d * 86400 + 17.75 * 3600);
      if (e > s) total += e - s;
    }
    return total;
  };
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const base = wallFromParts(2025, 12, 1);
  for (let i = 0; i < 3000; i++) {
    const a = base + Math.floor(rnd() * 400 * 86400);
    const b = a + Math.floor(rnd() * rnd() * 60 * 86400);
    assert.equal(cal.seconds(a, b), naive(a, b), `интервал ${fmtDateTime(a, true)} — ${fmtDateTime(b, true)}`);
  }
});

test('перцентиль как PERCENTILE.INC / numpy, медиана, среднее', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.99).toFixed(6), '3.970000');
  assert.equal(percentile([5], 0.99), 5);
  assert.equal(percentile([10, 1, 7, 3, 9], 0.5), 7);
  assert.deepEqual(summarize([1, 2, 3, 4]), { n: 4, mean: 2.5, median: 2.5 });
  assert.deepEqual(summarize([]), { n: 0, mean: null, median: null });
});

test('ISO-недели и периоды с неполным последним', () => {
  const mon = dayFromParts(2026, 10, 26);
  assert.equal(weekKeyOfDay(dayFromParts(2026, 11, 1)), mon);
  assert.equal(isoWeekInfo(mon).week, 44);
  assert.equal(isoWeekInfo(weekKeyOfDay(dayFromParts(2026, 1, 1))).week, 1);
  const slice = dayFromParts(2026, 10, 28);
  const weeks = buildPeriods('week', dayFromParts(2026, 10, 1), slice, { sliceDi: slice });
  const last = weeks[weeks.length - 1];
  assert.equal(last.label, 'Нед. 44 (26.10–01.11) — неполный период');
  assert.ok(last.incomplete);
  assert.ok(!weeks[0].incomplete);
  const months = buildPeriods('month', dayFromParts(2026, 1, 12), slice, { sliceDi: slice });
  assert.equal(months.length, 10);
  assert.equal(months[9].short, '10.2026');
  assert.ok(months[9].incomplete);
  assert.equal(months[9].axis.join(' '), 'Окт 2026 неполный период');
  assert.ok(!months[8].incomplete);
  // Обрезка пользовательским периодом.
  const cut = buildPeriods('month', dayFromParts(2026, 3, 15), dayFromParts(2026, 5, 10), { sliceDi: slice, cutFrom: dayFromParts(2026, 3, 15), cutTo: dayFromParts(2026, 5, 10) });
  assert.deepEqual(cut.map((p) => p.incomplete), [true, false, true]);
});

test('форматирование длительностей и чисел', () => {
  assert.equal(fmtSpentAuto(5819 + 22 / 60), '96 ч 59 мин');
  assert.equal(fmtSpentAuto(5.808), '5,8 мин');
  assert.equal(fmtSpentAuto(0.5), '30 сек');
  assert.equal(fmtHoursAuto(0.028, 9), '1,7 мин');
  assert.equal(fmtHoursAuto(5.14, 9), '5,1 ч');
  assert.equal(fmtHoursAuto(20.749, 9), '2,3 раб. дн.');
  assert.equal(fmtHoursAuto(0.005, 9), '18 сек');
  assert.equal(fmtHoursAuto(null, 9), 'нет данных');
  assert.equal(fmtInt(3288), '3 288');
  assert.equal(fmtInt(906), '906');
  assert.equal(fmtInt(12345), '12\u00a0345');
  assert.equal(fmtNum(5.8075, 3), '5,808');
  assert.deepEqual(axisUnit('a', 0.5, 9), { factor: 60, unit: 'мин' });
  assert.equal(axisUnit('b', 20, 9).unit, 'раб. ч');
  assert.equal(axisUnit('b', 60, 9).unit, 'раб. дн.');
});

test('настройки: нормализация и импорт', () => {
  const s = normalizeSettings({ otherThreshold: '7', calendar: { dayStart: '10:00', dayEnd: '09:00', holidays: ['01.01.2027', 'мусор', '2027-01-02'] }, bots: [' Бот ', 'Бот'] });
  assert.equal(s.otherThreshold, 7);
  assert.equal(s.calendar.dayStart, '09:00');
  assert.deepEqual(s.calendar.holidays, ['2027-01-01', '2027-01-02']);
  assert.deepEqual(s.bots, ['Бот']);
  assert.throws(() => parseSettingsJson('{'), /JSON/);
  assert.throws(() => parseSettingsJson('{"foo":1}'), /не похож/);
  assert.equal(parseSettingsJson('{"otherThreshold": 3}').otherThreshold, 3);
  assert.equal(normalizeSettings({}).smallN, 5);
  assert.equal(normalizeSettings({ smallN: '10' }).smallN, 10);
  assert.equal(normalizeSettings({ smallN: 0 }).smallN, 5);
});

test('медиана через отбор совпадает с сортировкой', async () => {
  const { median } = await import('../src/core/stats.js');
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 500; i++) {
    const n = 1 + Math.floor(rnd() * 60);
    const arr = Array.from({ length: n }, () => Math.floor(rnd() * 10) / (rnd() < 0.5 ? 1 : 3));
    assert.equal(median(arr), percentile(arr, 0.5));
  }
});
