// Загрузка выгрузки: поиск листа с заголовками, проверка структуры, разбор значений.
// Разбираются только ячейки обязательных колонок: тексты задач и клиентские
// реквизиты не читаются вовсе, поэтому не могут попасть ни на экран, ни в экспорт.

import { openWorkbook, iterateRows, cellText, XlsxError } from './xlsx-read.js';
import { parseDateText, excelSerialToWall, dayIndex, partsOfDay } from './dates.js';

export const REQUIRED = [
  { key: 'id', header: 'ID' },
  { key: 'title', header: 'Название' },
  { key: 'author', header: 'Постановщик' },
  { key: 'executor', header: 'Исполнитель' },
  { key: 'status', header: 'Статус' },
  { key: 'created', header: 'Дата создания' },
  { key: 'started', header: 'Дата начала работы' },
  { key: 'closed', header: 'Дата закрытия' },
  { key: 'spent', header: 'Затрачено' },
];

export function normSpaces(s) {
  return String(s ?? '')
    .replace(/[   \t\r\n]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function normKey(s) {
  return normSpaces(s).toLowerCase().replace(/ё/g, 'е');
}

/**
 * Сопоставление заголовков: сначала пользовательская подстановка из настроек, потом стандартное имя.
 * columnMap: { key: 'заголовок в файле' }.
 */
export function matchHeaders(headers, columnMap = {}) {
  const index = new Map();
  headers.forEach((h, i) => {
    const k = normKey(h);
    if (k && !index.has(k)) index.set(k, i);
  });
  const cols = {};
  const missing = [];
  for (const { key, header } of REQUIRED) {
    const alt = columnMap && columnMap[key] ? normKey(columnMap[key]) : null;
    let idx = alt && index.has(alt) ? index.get(alt) : undefined;
    if (idx === undefined && index.has(normKey(header))) idx = index.get(normKey(header));
    if (idx === undefined) missing.push(header);
    else cols[key] = idx;
  }
  return { cols, missing };
}

function headerRow(xml, ctx) {
  // Заголовки — первая непустая строка (в норме это строка 1).
  let n = 0;
  for (const row of iterateRows(xml, ctx)) {
    if (row.cells.size) {
      const maxCol = Math.max(...row.cells.keys());
      const headers = [];
      for (let c = 0; c <= maxCol; c++) headers.push(normSpaces(cellText(row.cells.get(c))));
      return { r: row.r, headers };
    }
    if (++n > 20) break;
  }
  return null;
}

/** Разбор даты из ячейки. Возвращает { ws } | { empty } | { bad }. */
export function parseDateCell(c, date1904) {
  if (!c) return { empty: true };
  if (c.t === 'n') {
    // Число в колонке даты считаем серийным номером Excel (формат ячейки может быть любым).
    if (c.v <= 0 || c.v > 2958465) return { bad: true };
    return { ws: excelSerialToWall(c.v, date1904) };
  }
  if (c.t === 'd') {
    const ws = parseDateText(String(c.v).replace(/Z$/, ''));
    return Number.isFinite(ws) ? { ws } : { bad: true };
  }
  if (c.t === 's') {
    const s = normSpaces(c.v);
    if (!s) return { empty: true };
    const ws = parseDateText(s);
    return Number.isFinite(ws) ? { ws } : { bad: true };
  }
  return { bad: true };
}

const RE_SPENT = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/;

/** «Затрачено»: текст Ч+:ММ:СС или доля суток Excel → минуты. */
export function parseSpentCell(c) {
  if (!c) return { empty: true };
  if (c.t === 'n') {
    if (c.v < 0) return { bad: true };
    return { min: Math.round(c.v * 86400) / 60 };
  }
  if (c.t === 's') {
    const s = normSpaces(c.v);
    if (!s) return { empty: true };
    const m = RE_SPENT.exec(s);
    if (!m) return { bad: true };
    const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + (m[3] ? Number(m[3]) : 0);
    return { min: sec / 60 };
  }
  return { bad: true };
}

function idText(c) {
  if (!c) return '';
  if (c.t === 'n') return Number.isInteger(c.v) ? String(c.v) : String(c.v);
  return normSpaces(cellText(c));
}

function textOf(c) {
  return c ? normSpaces(cellText(c)) : '';
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Основная функция загрузки.
 * Возвращает { ok: true, dataset } или { ok: false, error: { code, message, missing, found, sheet } }.
 */
export async function loadDataset(input, { fileName = '', fileSize = 0, columnMap = {}, onProgress = () => {}, yieldEvery = 2000 } = {}) {
  let wb;
  try {
    onProgress(0.02, 'Распаковка файла');
    await tick();
    wb = openWorkbook(input);
  } catch (e) {
    if (e instanceof XlsxError) return { ok: false, error: { code: e.code, message: e.message } };
    return { ok: false, error: { code: 'not_xlsx', message: 'Не удалось прочитать файл как .xlsx.' } };
  }
  if (!wb.sheets.length) return { ok: false, error: { code: 'no_sheets', message: 'В книге нет листов.' } };

  // Ищем лист с обязательными заголовками: сначала первый, затем остальные.
  let chosen = null;
  let firstInfo = null;
  for (let i = 0; i < wb.sheets.length; i++) {
    onProgress(0.05, `Чтение листа «${wb.sheets[i].name}»`);
    await tick();
    let xml;
    try {
      xml = wb.sheetXml(wb.sheets[i]);
    } catch (e) {
      continue;
    }
    const hr = headerRow(xml, wb.ctx);
    const info = { sheet: wb.sheets[i], xml, hr, match: hr ? matchHeaders(hr.headers, columnMap) : null };
    if (i === 0) firstInfo = info;
    if (info.match && info.match.missing.length === 0) {
      chosen = info;
      break;
    }
    if (i > 0) info.xml = null;
  }
  if (!chosen) {
    if (!firstInfo || !firstInfo.hr) {
      return { ok: false, error: { code: 'empty', message: 'Файл не содержит данных: на первом листе нет ни заголовков, ни строк.' } };
    }
    return {
      ok: false,
      error: {
        code: 'missing_columns',
        message: 'В файле нет обязательных колонок.',
        missing: firstInfo.match.missing,
        found: firstInfo.hr.headers.filter(Boolean),
        sheet: firstInfo.sheet.name,
      },
    };
  }

  const { cols } = chosen.match;
  const wanted = new Set(Object.values(cols));
  const tasks = [];
  const bad = { created: [], started: [], closed: [], spent: [] };
  let zeroSpent = 0;
  let count = 0;
  onProgress(0.1, 'Разбор строк');
  await tick();
  const date1904 = wb.date1904;
  for (const row of iterateRows(chosen.xml, wb.ctx, wanted)) {
    if (row.r <= chosen.hr.r) continue;
    if (!row.cells.size) continue;
    const g = (k) => row.cells.get(cols[k]);
    const t = {
      row: row.r,
      id: idText(g('id')),
      title: textOf(g('title')),
      author: textOf(g('author')),
      executor: textOf(g('executor')),
      status: textOf(g('status')),
      created: null,
      started: null,
      closed: null,
      spentMin: null,
    };
    for (const k of ['created', 'started', 'closed']) {
      const r = parseDateCell(g(k), date1904);
      if (r.bad) bad[k].push(t.id || `строка ${row.r}`);
      else if (!r.empty) t[k] = r.ws;
    }
    const sp = parseSpentCell(g('spent'));
    if (sp.bad) bad.spent.push(t.id || `строка ${row.r}`);
    else if (!sp.empty) {
      t.spentMin = sp.min;
      if (sp.min === 0) zeroSpent++;
    }
    tasks.push(t);
    if (++count % yieldEvery === 0) {
      onProgress(0.1 + 0.85 * row.progress, `Разбор строк: ${count.toLocaleString('ru-RU')}`);
      await tick();
    }
  }
  chosen.xml = null;
  if (!tasks.length) {
    return { ok: false, error: { code: 'no_rows', message: 'В файле есть заголовки, но нет ни одной строки с данными.' } };
  }
  onProgress(0.97, 'Проверка данных');
  await tick();

  // Сводные проверки по файлу.
  const ids = new Map();
  for (const t of tasks) if (t.id) ids.set(t.id, (ids.get(t.id) || 0) + 1);
  const duplicates = [...ids.entries()].filter(([, n]) => n > 1).map(([id, n]) => ({ id, n }));
  let minCreated = Infinity;
  let maxCreated = -Infinity;
  let maxClosed = -Infinity;
  const years = new Set();
  for (const t of tasks) {
    if (t.created != null) {
      minCreated = Math.min(minCreated, t.created);
      maxCreated = Math.max(maxCreated, t.created);
      years.add(partsOfDay(dayIndex(t.created)).y);
    }
    if (t.closed != null) {
      maxClosed = Math.max(maxClosed, t.closed);
      years.add(partsOfDay(dayIndex(t.closed)).y);
    }
    if (t.started != null) years.add(partsOfDay(dayIndex(t.started)).y);
  }
  const slice = Math.max(maxCreated, maxClosed);
  onProgress(1, 'Готово');
  return {
    ok: true,
    dataset: {
      fileName,
      fileSize,
      sheetName: chosen.sheet.name,
      sheetIndex: wb.sheets.indexOf(chosen.sheet),
      headerRow: chosen.hr.r,
      headers: chosen.hr.headers.filter(Boolean),
      columnsUsed: Object.fromEntries(REQUIRED.map(({ key }) => [key, chosen.hr.headers[cols[key]]])),
      rowsRead: tasks.length,
      tasks,
      parseIssues: { badDates: bad, zeroSpent, duplicates },
      years: [...years].sort(),
      minCreated: Number.isFinite(minCreated) ? minCreated : null,
      maxCreated: Number.isFinite(maxCreated) ? maxCreated : null,
      slice: Number.isFinite(slice) ? slice : null,
    },
  };
}
