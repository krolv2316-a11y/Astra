// Сквозные тесты на синтетической выгрузке: xlsx → разбор → расчёт.
// Ожидания считаются наивно из «истины» генератора, независимо от расчётного ядра.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { generateTasks, buildSynthXlsx, EMPLOYEES, BOT } from './synth.js';
import { loadDataset } from '../src/core/parse.js';
import { prepare, computeView, defaultFilters, OTHER } from '../src/core/model.js';
import { defaultSettings } from '../src/core/settings.js';
import { buildXlsx } from '../src/core/xlsx-write.js';
import { openWorkbook, iterateRows } from '../src/core/xlsx-read.js';
import { percentile, summarize } from '../src/core/stats.js';
import { dayFromParts } from '../src/core/dates.js';

const truth = generateTasks({ n: 1500, seed: 11 });
const textFile = buildSynthXlsx(truth);
const nativeFile = buildSynthXlsx(truth, { native: true });

async function load(u8, opts = {}) {
  const r = await loadDataset(u8, { fileName: 'synthetic.xlsx', yieldEvery: 1e9, ...opts });
  assert.ok(r.ok, JSON.stringify(r.error));
  return r.dataset;
}

// Наивный подсчёт рабочих секунд: проход по минутам с учётом секунд на краях.
const HOL = new Set(defaultSettings().calendar.holidays);
function naiveWorkHours(a, b) {
  let total = 0;
  for (let d = Math.floor(a / 86400); d <= Math.floor(b / 86400); d++) {
    const iso = new Date(d * 86400000).toISOString().slice(0, 10);
    const wd = new Date(d * 86400000).getUTCDay();
    if (wd === 0 || wd === 6 || HOL.has(iso)) continue;
    const s = Math.max(a, d * 86400 + 9 * 3600);
    const e = Math.min(b, d * 86400 + 18 * 3600);
    if (e > s) total += e - s;
  }
  return total / 3600;
}

const isSolved = (t) => t.status === 'Завершена' && t.closed != null;

test('текстовая и нативная выгрузки дают одинаковые данные', async () => {
  const a = await load(textFile);
  const b = await load(nativeFile);
  assert.equal(a.rowsRead, truth.length);
  assert.equal(b.rowsRead, truth.length);
  for (let i = 0; i < truth.length; i++) {
    const t = truth[i];
    for (const ds of [a, b]) {
      const r = ds.tasks[i];
      assert.equal(r.id, t.id);
      assert.equal(r.title, t.title);
      assert.equal(r.created, t.created);
      assert.equal(r.closed, t.closed);
      assert.equal(r.started, t.badStarted ? null : t.started);
      assert.equal(r.spentMin, t.spentSec == null ? null : t.spentSec / 60);
    }
  }
  assert.equal(a.parseIssues.badDates.started.length, 1);
  assert.equal(a.parseIssues.zeroSpent, 1);
  assert.equal(a.parseIssues.duplicates.length, 1);
  assert.deepEqual(a.parseIssues, b.parseIssues);
});

test('чувствительные колонки не попадают в разобранные данные', async () => {
  const ds = await load(textFile);
  const blob = JSON.stringify(ds.tasks);
  assert.ok(!blob.includes('Синтетическое описание'));
  assert.ok(!blob.includes('ООО «Тест'));
  assert.ok(!ds.tasks.some((t) => 'description' in t || 'inn' in t));
});

test('нет обязательной колонки → понятная ошибка со списками', async () => {
  const broken = buildSynthXlsx(truth.slice(0, 20), { dropColumn: 'Исполнитель' });
  const r = await loadDataset(broken, { fileName: 'broken.xlsx' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'missing_columns');
  assert.deepEqual(r.error.missing, ['Исполнитель']);
  assert.ok(r.error.found.includes('Постановщик'));
  // Сопоставление нестандартного заголовка.
  const renamed = buildXlsx([{ name: 'Лист1', rows: [['ID', 'Название', 'Постановщик', 'Ответственный', 'Статус', 'Дата создания', 'Дата начала работы', 'Дата закрытия', 'Затрачено'], ['1', 'Тип', 'А', 'Б', 'Завершена', '01.10.2026 10:00', '', '01.10.2026 11:00', '']] }]);
  assert.equal((await loadDataset(renamed)).ok, false);
  const ok = await loadDataset(renamed, { columnMap: { executor: 'Ответственный' } });
  assert.ok(ok.ok);
  assert.equal(ok.dataset.tasks[0].executor, 'Б');
});

test('пустой файл, не xlsx, только заголовки, лист не первый', async () => {
  assert.equal((await loadDataset(new Uint8Array(0))).error.code, 'empty');
  assert.equal((await loadDataset(new TextEncoder().encode('ID;Название\n1;2'))).error.code, 'not_xlsx');
  const headersOnly = buildXlsx([{ name: 'Лист1', rows: [['ID', 'Название', 'Постановщик', 'Исполнитель', 'Статус', 'Дата создания', 'Дата начала работы', 'Дата закрытия', 'Затрачено']] }]);
  assert.equal((await loadDataset(headersOnly)).error.code, 'no_rows');
  const twoSheets = buildXlsx([
    { name: 'Инфо', rows: [['Выгрузка задач'], ['сформирована автоматически']] },
    { name: 'Данные', rows: [['ID', 'Название', 'Постановщик', 'Исполнитель', 'Статус', 'Дата создания', 'Дата начала работы', 'Дата закрытия', 'Затрачено'], ['7', 'Тип', 'А', 'Б', 'Завершена', '01.10.2026 10:00', '', '01.10.2026 11:00', '00:05:00']] },
  ]);
  const r = await loadDataset(twoSheets);
  assert.ok(r.ok);
  assert.equal(r.dataset.sheetName, 'Данные');
});

test('счётчики по сотрудникам и типам, «Прочие», очередь', async () => {
  const ds = await load(textFile);
  const prep = prepare(ds, defaultSettings());
  const v = computeView(prep, defaultFilters());
  const totalPerTitle = new Map();
  for (const t of truth) totalPerTitle.set(t.title, (totalPerTitle.get(t.title) || 0) + 1);
  const typeOf = (title) => (totalPerTitle.get(title) <= 5 ? OTHER : title);
  assert.equal(v.kpi.total, truth.length);
  assert.equal(v.kpi.solved, truth.filter(isSolved).length);
  assert.equal(v.kpi.queue, truth.filter((t) => t.status !== 'Завершена').length);
  assert.equal(v.kpi.unclassified, 1);
  assert.equal(v.kpi.solved + v.kpi.queue + v.kpi.unclassified, v.kpi.total);
  for (const e of v.pivot.emps) {
    for (const ty of v.pivot.types) {
      const exp = truth.filter((t) => isSolved(t) && t.executor === e.name && typeOf(t.title) === ty.name).length;
      assert.equal(v.pivot.count(e.key, ty.key), exp, `${e.name} × ${ty.name}`);
    }
  }
  // Тип с 5 решёнными + 1 в очереди не уходит в «Прочие».
  assert.ok(prep.types.some((t) => t.name === 'Произвести регистрацию заявки партнера' && !t.isOther));
  const other = prep.types.find((t) => t.isOther);
  assert.ok(other.members.includes('ТЕСТ Произвести верификацию Клиента'));
  assert.equal(prep.types[prep.types.length - 1].isOther, true);
  // Сотрудники отсортированы по имени, не по количеству.
  assert.deepEqual(prep.employees.map((e) => e.name), [...EMPLOYEES].sort((a, b) => a.localeCompare(b, 'ru')));
});

test('показатели времени: среднее, медиана, n совпадают с наивным расчётом', async () => {
  const ds = await load(nativeFile);
  const prep = prepare(ds, defaultSettings());
  const v = computeView(prep, defaultFilters());
  const solved = truth.filter(isSolved);
  const spent = solved.filter((t) => t.spentSec != null).map((t) => t.spentSec / 60);
  const a = solved.filter((t) => t.started != null && !t.badStarted && t.closed >= t.started).map((t) => naiveWorkHours(t.started, t.closed));
  const b = solved.map((t) => naiveWorkHours(t.created, t.closed));
  const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `${x} ≠ ${y}`);
  for (const [m, vals] of [['spent', spent], ['a', a], ['b', b]]) {
    const exp = summarize(vals);
    const got = v.kpi.metrics[m].main;
    assert.equal(got.n, exp.n, m);
    near(got.mean, exp.mean);
    near(got.median, exp.median);
  }
  // Аномалия «закрытие раньше начала» исключена из (а), но задача посчитана.
  assert.equal(prep.quality.closedBeforeStarted.length, 1);
});

test('выбросы: P99 по типу, при < 20 значений — порог по всей выборке', async () => {
  const ds = await load(textFile);
  const prep = prepare(ds, defaultSettings());
  const solved = prep.tasks.filter((t) => t.kind === 'solved');
  for (const m of ['spent', 'a', 'b']) {
    const all = solved.filter((t) => t[m] != null);
    const global = percentile(all.map((t) => t[m]), 0.99);
    const byType = new Map();
    for (const t of all) byType.set(t.typeKey, [...(byType.get(t.typeKey) || []), t[m]]);
    for (const t of all) {
      const vals = byType.get(t.typeKey);
      const thr = vals.length >= 20 ? percentile(vals, 0.99) : global;
      assert.equal(t.out[m], t[m] > thr, `${m} ${t.id}`);
    }
  }
  const v = computeView(prep, defaultFilters());
  const big = v.outliers.find((o) => Math.abs(o.spent - (96 * 60 + 59 + 22 / 60)) < 1e-9);
  assert.ok(big, 'задача с 96:59:22 в таблице выбросов');
  assert.ok(big.flags.includes('spent'));
  // Переключатель исключает выбросы из выборки показателя.
  const k = v.kpi.metrics.spent;
  const v2 = computeView(prep, { ...defaultFilters(), excludeOutliers: true });
  assert.equal(v2.kpi.metrics.spent.main.n, k.main.n - k.outliers);
  assert.equal(v2.kpi.metrics.spent.main.mean, k.alt.mean);
  assert.equal(v2.outliers.length, v.outliers.length);
  assert.equal(v2.kpi.solved, v.kpi.solved);
  // IQR и ручной порог.
  const s2 = defaultSettings();
  s2.outliers.method = 'manual';
  s2.outliers.manual.spent = { value: 1, unit: 'hour' };
  const p2 = prepare(ds, s2);
  for (const t of p2.tasks) if (t.kind === 'solved' && t.spent != null) assert.equal(t.out.spent, t.spent > 60);
  const s3 = defaultSettings();
  s3.outliers.method = 'iqr';
  assert.ok(prepare(ds, s3).tasks.some((t) => t.out.a));
});

test('динамика: все месяцы, пулинг «Итого», неполный период, пропуски', async () => {
  const ds = await load(textFile);
  const prep = prepare(ds, defaultSettings());
  const v = computeView(prep, defaultFilters());
  const months = v.dyn.periods;
  assert.equal(months[0].short, '01.2026');
  assert.equal(months[months.length - 1].short, '10.2026');
  assert.ok(months[months.length - 1].incomplete);
  const total = v.dyn.series.find((s) => s.isTotal);
  assert.equal(total.cells.reduce((s, c) => s + c.solved, 0), v.kpi.solved);
  // «Затрачено» за январь–март отсутствует: n = 0, среднего нет (не ноль).
  for (let i = 0; i < 3; i++) {
    assert.equal(total.cells[i].spent.n, 0);
    assert.equal(total.cells[i].spent.mean, null);
  }
  // «Итого» — среднее по всем задачам, а не среднее средних.
  const oct = months.length - 1;
  const octVals = prep.tasks.filter((t) => t.kind === 'solved' && t.monthKey === months[oct].key && t.spent != null).map((t) => t.spent);
  assert.equal(total.cells[oct].spent.mean, summarize(octVals).mean);
  // Третий сотрудник появляется с июня: до этого у него нет точек.
  const third = v.dyn.series.find((s) => s.name === 'Сидоров Илья');
  assert.ok(third.cells.slice(0, 5).every((c) => c.solved === 0));
  // Недели.
  const w = computeView(prep, { ...defaultFilters(), step: 'week' });
  assert.ok(w.dyn.periods.length > 40);
  assert.match(w.dyn.periods[w.dyn.periods.length - 1].label, /^Нед\. 44 \(26\.10–01\.11\)/);
});

test('фильтры: сотрудник, тип, период, постановщик, фасетные счётчики', async () => {
  const ds = await load(textFile);
  const prep = prepare(ds, defaultSettings());
  const emp = prep.employees[0];
  const ty = prep.types[0];
  const from = dayFromParts(2026, 5, 1);
  const to = dayFromParts(2026, 7, 31);
  const f = { ...defaultFilters(), employees: new Set([emp.key]), types: new Set([ty.key]), from, to, author: 'nobots' };
  const v = computeView(prep, f);
  const inP = (ws) => ws != null && Math.floor(ws / 86400) >= from && Math.floor(ws / 86400) <= to;
  const exp = truth.filter((t) => isSolved(t) && t.executor === emp.name && t.title === ty.name && t.author !== BOT && inP(t.closed)).length;
  assert.equal(v.kpi.solved, exp);
  const expQueue = truth.filter((t) => t.status !== 'Завершена' && t.executor === emp.name && t.title === ty.name && t.author !== BOT && inP(t.created)).length;
  assert.equal(v.kpi.queue, expQueue);
  // Счётчик сотрудника не зависит от фильтра по сотрудникам.
  const other = prep.employees[1];
  const expOther = truth.filter((t) => isSolved(t) && t.executor === other.name && t.title === ty.name && t.author !== BOT && inP(t.closed)).length;
  assert.equal(v.empCounts.get(other.key) || 0, expOther);
  const bots = computeView(prep, { ...defaultFilters(), author: 'bots' });
  assert.equal(bots.kpi.total, truth.filter((t) => t.author === BOT).length);
});

test('настройки справочников: переименование, группы, скрытие, календарные часы', async () => {
  const ds = await load(textFile);
  const s = defaultSettings();
  s.employees['Иванова Анна'] = 'А. Иванова';
  s.types['Произвести верификацию Клиента'] = { display: 'Верификация', group: '', hidden: false };
  s.types['Авторизация партнера'] = { display: '', group: 'Партнёры', hidden: false };
  s.types['Произвести регистрацию заявки партнера'] = { display: '', group: 'Партнёры', hidden: false };
  s.types['ТЕСТ Произвести верификацию Клиента'] = { display: '', group: '', hidden: true };
  const prep = prepare(ds, s);
  assert.ok(prep.employees.some((e) => e.name === 'А. Иванова'));
  assert.ok(prep.types.some((t) => t.name === 'Верификация'));
  const partners = prep.types.find((t) => t.name === 'Партнёры');
  assert.equal(partners.total, truth.filter((t) => t.title === 'Авторизация партнера' || t.title === 'Произвести регистрацию заявки партнера').length);
  assert.equal(prep.hidden.tasks, 1);
  assert.ok(!prep.types.find((t) => t.isOther).members.includes('ТЕСТ Произвести верификацию Клиента'));
  const v = computeView(prep, defaultFilters());
  assert.equal(v.kpi.total, truth.length - 1);
  // Календарные часы.
  s.calendar.mode = 'calendar';
  const pc = prepare(ds, s);
  const t = pc.tasks.find((x) => x.kind === 'solved' && x.b != null);
  assert.equal(t.b, (t.src.closed - t.src.created) / 3600);
});

test('экспортный xlsx читается обратно: числа числами', () => {
  const u8 = buildXlsx([{ name: 'Сводка', freezeRow: 1, rows: [[{ v: 'Показатель', s: 'header' }, { v: 'Значение', s: 'header' }], ['Среднее', { v: 5.808, s: 'num3' }], ['n', { v: 2176, s: 'int' }], ['Текст <&>"', null]] }]);
  const wb = openWorkbook(u8);
  const rows = [...iterateRows(wb.sheetXml(wb.sheets[0]), wb.ctx)];
  assert.equal(rows[1].cells.get(1).t, 'n');
  assert.equal(rows[1].cells.get(1).v, 5.808);
  assert.equal(rows[2].cells.get(1).v, 2176);
  assert.equal(rows[3].cells.get(0).v, 'Текст <&>"');
});

test('результат не зависит от часового пояса', () => {
  const script = fileURLToPath(new URL('./tz-probe.mjs', import.meta.url));
  const outs = ['UTC', 'America/Los_Angeles', 'Asia/Vladivostok'].map((tz) => execFileSync(process.execPath, [script], { env: { ...process.env, TZ: tz } }).toString());
  assert.equal(outs[1], outs[0]);
  assert.equal(outs[2], outs[0]);
});
