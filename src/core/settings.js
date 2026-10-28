// Настройки справочников: значения по умолчанию, нормализация, импорт/экспорт.
// В localStorage хранятся только они — никогда не данные файла.

import { parseHHMM } from './workcal.js';
import { parseDayText, isoDay } from './dates.js';

export const SETTINGS_VERSION = 1;
export const STORAGE_KEY = 'osp-dashboard.settings.v1';

export const DEFAULT_HOLIDAYS_2026 = [
  '2026-01-01', '2026-01-02', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  '2026-02-23', '2026-03-09', '2026-05-01', '2026-05-11', '2026-06-12', '2026-11-04', '2026-12-31',
];

export const METRICS = ['spent', 'a', 'b'];

export function defaultSettings() {
  return {
    version: SETTINGS_VERSION,
    employees: {},
    types: {},
    otherThreshold: 5,
    bots: ['Астра Бот(ОПиК)'],
    calendar: {
      dayStart: '09:00',
      dayEnd: '18:00',
      mode: 'work',
      holidays: [...DEFAULT_HOLIDAYS_2026],
      workdays: [],
    },
    outliers: {
      method: 'percentile',
      p: 99,
      k: 3,
      minGroup: 20,
      manual: {
        spent: { value: 60, unit: 'min' },
        a: { value: 5, unit: 'day' },
        b: { value: 10, unit: 'day' },
      },
    },
    columns: {},
  };
}

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, lo, hi, def) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : def;
};

function normDays(list) {
  const out = new Set();
  for (const v of Array.isArray(list) ? list : []) {
    const d = parseDayText(v);
    if (d != null) out.add(isoDay(d));
  }
  return [...out].sort();
}

/** Приводит произвольный объект к корректным настройкам (недостающее берётся из умолчаний). */
export function normalizeSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const s = defaultSettings();
  if (raw.employees && typeof raw.employees === 'object') {
    for (const [k, v] of Object.entries(raw.employees)) {
      const name = str(v);
      if (str(k) && name) s.employees[str(k)] = name;
    }
  }
  if (raw.types && typeof raw.types === 'object') {
    for (const [k, v] of Object.entries(raw.types)) {
      if (!str(k) || !v || typeof v !== 'object') continue;
      const e = { display: str(v.display), group: str(v.group), hidden: !!v.hidden };
      if (e.display || e.group || e.hidden) s.types[str(k)] = e;
    }
  }
  s.otherThreshold = Math.round(num(raw.otherThreshold, 0, 100000, d.otherThreshold));
  if (Array.isArray(raw.bots)) s.bots = [...new Set(raw.bots.map((b) => str(b)).filter(Boolean))];
  const c = raw.calendar || {};
  s.calendar.dayStart = parseHHMM(c.dayStart) != null ? str(c.dayStart) : d.calendar.dayStart;
  s.calendar.dayEnd = parseHHMM(c.dayEnd) != null ? str(c.dayEnd) : d.calendar.dayEnd;
  if (parseHHMM(s.calendar.dayEnd) <= parseHHMM(s.calendar.dayStart)) {
    s.calendar.dayStart = d.calendar.dayStart;
    s.calendar.dayEnd = d.calendar.dayEnd;
  }
  s.calendar.mode = c.mode === 'calendar' ? 'calendar' : 'work';
  if (Array.isArray(c.holidays)) s.calendar.holidays = normDays(c.holidays);
  if (Array.isArray(c.workdays)) s.calendar.workdays = normDays(c.workdays);
  const o = raw.outliers || {};
  s.outliers.method = ['percentile', 'iqr', 'manual'].includes(o.method) ? o.method : d.outliers.method;
  s.outliers.p = num(o.p, 50, 99.99, d.outliers.p);
  s.outliers.k = num(o.k, 0.5, 100, d.outliers.k);
  s.outliers.minGroup = Math.round(num(o.minGroup, 1, 100000, d.outliers.minGroup));
  for (const m of METRICS) {
    const mm = (o.manual && o.manual[m]) || {};
    const units = m === 'spent' ? ['min', 'hour'] : ['hour', 'day'];
    s.outliers.manual[m] = {
      value: num(mm.value, 0, 1e7, d.outliers.manual[m].value),
      unit: units.includes(mm.unit) ? mm.unit : d.outliers.manual[m].unit,
    };
  }
  if (raw.columns && typeof raw.columns === 'object') {
    for (const [k, v] of Object.entries(raw.columns)) if (str(k) && str(v)) s.columns[str(k)] = str(v);
  }
  return s;
}

export function serializeSettings(s) {
  return JSON.stringify({ app: 'osp-dashboard', ...normalizeSettings(s) }, null, 2);
}

/** Разбор JSON настроек при импорте. Бросает ошибку с понятным текстом. */
export function parseSettingsJson(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error('Файл настроек не является корректным JSON.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('В файле нет объекта настроек.');
  const known = ['employees', 'types', 'otherThreshold', 'bots', 'calendar', 'outliers', 'columns'];
  if (!known.some((k) => k in raw)) throw new Error('Файл не похож на настройки дашборда ОСП.');
  return normalizeSettings(raw);
}

export function loadStoredSettings() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return { settings: defaultSettings(), storage: false };
    const text = ls.getItem(STORAGE_KEY);
    // Проверяем, что запись вообще возможна (в приватном режиме может быть запрещена).
    ls.setItem(`${STORAGE_KEY}.probe`, '1');
    ls.removeItem(`${STORAGE_KEY}.probe`);
    if (!text) return { settings: defaultSettings(), storage: true };
    return { settings: normalizeSettings(JSON.parse(text)), storage: true };
  } catch (e) {
    return { settings: defaultSettings(), storage: false };
  }
}

export function storeSettings(s) {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(s)));
    return true;
  } catch (e) {
    return false;
  }
}

export function clearStoredSettings() {
  try {
    globalThis.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (e) {
    return false;
  }
}
