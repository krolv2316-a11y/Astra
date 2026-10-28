// Сверка с эталоном из раздела 12 задания на реальной выгрузке.
// Запуск (файл остаётся локальным и в репозиторий не попадает):
//   node scripts/verify-reference.mjs "Выгрузка ОСП 28.10.2026.xlsx"
// Настройки по умолчанию: рабочие часы, праздники 2026, «Прочие» N = 5, выбросы P99, без фильтров.

import { readFileSync } from 'node:fs';
import { loadDataset } from '../src/core/parse.js';
import { prepare, computeView, defaultFilters } from '../src/core/model.js';
import { defaultSettings } from '../src/core/settings.js';

const file = process.argv[2];
if (!file) {
  console.error('Укажите путь к выгрузке: node scripts/verify-reference.mjs "Выгрузка ОСП 28.10.2026.xlsx"');
  process.exit(2);
}

const res = await loadDataset(new Uint8Array(readFileSync(file)), { fileName: file, yieldEvery: 1e9 });
if (!res.ok) {
  console.error('Файл не загружен:', res.error);
  process.exit(2);
}
const prep = prepare(res.dataset, defaultSettings());
const f = defaultFilters();
const v = computeView(prep, f);

let pass = 0;
let fail = 0;
function cmp(name, expected, actual, tol = 0) {
  const ok = actual != null && (tol ? Math.abs(actual - expected) <= tol + 1e-9 : actual === expected);
  if (ok) pass++;
  else fail++;
  const fmt = (x) => (x == null ? '—' : typeof x === 'number' && !Number.isInteger(x) ? x.toFixed(4) : String(x));
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(64)} эталон ${fmt(expected).padStart(10)}  факт ${fmt(actual).padStart(10)}`);
}

const emp = (part) => prep.employees.find((e) => e.name.includes(part));
const typeK = (name) => prep.types.find((t) => t.name === name);
const K = emp('Круглова');
const A = emp('Андреева');
if (!K || !A) console.log('Внимание: не найдены сотрудники «Круглова»/«Андреева»; найдены:', prep.employees.map((e) => e.name).join(', '));

console.log('\n== Общее');
cmp('Строк', 3288, res.dataset.rowsRead);
cmp('Решено', 3255, v.kpi.solved);
cmp('В очереди', 33, v.kpi.queue);
const st = (s) => (v.kpi.queueByStatus.find((x) => x.status.toLowerCase() === s.toLowerCase()) || {}).n ?? 0;
cmp('В очереди: Ждёт выполнения', 31, st('Ждёт выполнения'));
cmp('В очереди: Выполняется', 2, st('Выполняется'));
const qe = (e) => (e ? (v.kpi.queueByEmp.find((x) => x.name === e.name) || {}).n ?? 0 : null);
cmp('В очереди: Андреева', 29, qe(A));
cmp('В очереди: Круглова', 4, qe(K));

console.log('\n== Решено по сотрудникам и типам');
const cross = [
  ['Произвести распределение лида', 1854, 656, 2510],
  ['Произвести верификацию Клиента', 355, 116, 471],
  ['Создать регистрацию сделки в 1С', 90, 97, 187],
  ['Авторизация партнера', 36, 29, 65],
  ['Произвести регистрацию заявки партнера', 2, 3, 5],
  ['Прочие', 11, 6, 17],
];
for (const [name, k, a, all] of cross) {
  const t = typeK(name);
  cmp(`${name} — Круглова`, k, t && K ? v.pivot.count(K.key, t.key) : null);
  cmp(`${name} — Андреева`, a, t && A ? v.pivot.count(A.key, t.key) : null);
  cmp(`${name} — всего`, all, t ? v.pivot.typeTotal.get(t.key) : null);
}
cmp('Итого — Круглова', 2348, K ? v.pivot.empTotal.get(K.key) : null);
cmp('Итого — Андреева', 907, A ? v.pivot.empTotal.get(A.key) : null);

console.log('\n== Показатели (среднее / медиана / n)');
const metricsRows = [
  ['Все', () => v.summary.find((g) => g.isAll).head, [5.808, 1.8, 2176], [1.271, 0.028, 2602], [8.947, 5.14, 3255]],
  ['Круглова', () => v.summary.find((g) => K && g.head.key === K.key).head, [2.158, 1.583, 1332], [0.877, 0.025, 1758], [7.964, 4.142, 2348]],
  ['Андреева', () => v.summary.find((g) => A && g.head.key === A.key).head, [11.569, 2.35, 844], [2.093, 0.036, 844], [11.492, 8.772, 907]],
];
const allGroup = v.summary.find((g) => g.isAll);
const byType = (name) => () => allGroup.children.find((c) => c.type === name);
metricsRows.push(
  ['Авторизация партнера', byType('Авторизация партнера'), [12.323, 9.3, 63], [1.712, 0.165, 64], [16.664, 11.761, 65]],
  ['Верификация Клиента', byType('Произвести верификацию Клиента'), [2.701, 2.067, 295], [0.592, 0.033, 351], [11.152, 7.396, 471]],
  ['Распределение лида', byType('Произвести распределение лида'), [5.706, 1.667, 1636], [0.15, 0.025, 2002], [7.457, 4.419, 2510]],
  ['Регистрация заявки партнера', byType('Произвести регистрацию заявки партнера'), [3.658, 2.6, 4], [0.098, 0.086, 4], [3.482, 2.371, 5]],
  ['Регистрация сделки в 1С', byType('Создать регистрацию сделки в 1С'), [7.796, 3.267, 165], [15.2, 5.0, 167], [19.053, 10.572, 187]],
  ['Прочие', byType('Прочие'), [33.051, 18.15, 13], [10.787, 5.397, 14], [28.793, 20.476, 17]],
);
for (const [name, get, ...exp] of metricsRows) {
  let row = null;
  try {
    row = get();
  } catch (e) {
    row = null;
  }
  ['spent', 'a', 'b'].forEach((m, i) => {
    const [mean, median, n] = exp[i];
    cmp(`${name} — ${m} среднее`, mean, row ? row[m].mean : null, 0.001);
    cmp(`${name} — ${m} медиана`, median, row ? row[m].median : null, 0.001);
    cmp(`${name} — ${m} n`, n, row ? row[m].n : null);
  });
}

console.log('\n== Динамика по месяцу закрытия (все сотрудники)');
const total = v.dyn.series.find((s) => s.isTotal);
const months = [
  ['01.2026', 206, null, 0, null, 0, 0.904],
  ['02.2026', 315, null, 0, 0.015, 9, 4.136],
  ['03.2026', 221, null, 0, 0.772, 211, 6.917],
  ['04.2026', 349, 2.966, 134, 0.172, 339, 6.222],
  ['05.2026', 221, 3.428, 199, 1.59, 200, 20.749],
  ['06.2026', 457, 3.257, 440, 0.301, 440, 9.117],
  ['07.2026', 293, 1.997, 257, 0.604, 257, 4.568],
  ['08.2026', 287, 4.168, 267, 1.457, 267, 6.936],
  ['09.2026', 482, 2.784, 473, 3.425, 473, 13.327],
  ['10.2026', 424, 17.693, 406, 1.162, 406, 12.805],
];
for (const [label, solved, sMean, sN, aMean, aN, bMean] of months) {
  const i = v.dyn.periods.findIndex((p) => p.short === label);
  const c = i >= 0 ? total.cells[i] : null;
  cmp(`${label} решено`, solved, c ? c.solved : null);
  cmp(`${label} Затрачено n`, sN, c ? c.spent.n : null);
  if (sMean != null) cmp(`${label} Затрачено среднее`, sMean, c ? c.spent.mean : null, 0.001);
  cmp(`${label} В работе (а) n`, aN, c ? c.a.n : null);
  if (aMean != null) cmp(`${label} В работе (а) среднее`, aMean, c ? c.a.mean : null, 0.001);
  cmp(`${label} Цикл (б) среднее`, bMean, c ? c.b.mean : null, 0.001);
}
const oct = v.dyn.periods.find((p) => p.short === '10.2026');
cmp('10.2026 помечен как неполный период', true, oct ? oct.incomplete : null);

console.log('\n== Выбросы (P99 по типу)');
const outCount = (m, e) => v.outliers.filter((o) => o.flags.includes(m) && (!e || o.emp === e.name)).length;
cmp('Выбросы Затрачено', 26, outCount('spent'));
cmp('Выбросы Затрачено — Андреева', 21, A ? outCount('spent', A) : null);
cmp('Выбросы Затрачено — Круглова', 5, K ? outCount('spent', K) : null);
cmp('Выбросы В работе (а)', 31, outCount('a'));
cmp('Выбросы Цикл (б)', 35, outCount('b'));
cmp('Среднее без выбросов: Затрачено', 2.665, v.kpi.metrics.spent.alt.mean, 0.001);
cmp('Среднее без выбросов: (а)', 0.948, v.kpi.metrics.a.alt.mean, 0.001);
cmp('Среднее без выбросов: (б)', 8.36, v.kpi.metrics.b.alt.mean, 0.001);
const big = v.outliers.find((o) => o.id === '38405');
cmp('ID 38405 в таблице выбросов (Затрачено, мин)', 5819.367, big ? big.spent : null, 0.001);

console.log(`\nИтого: ${pass} совпало, ${fail} расхождений.`);
process.exit(fail ? 1 : 0);
