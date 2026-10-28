// Экспорт результатов в Excel. Только агрегаты и безопасные поля задач:
// описание, ИНН, компания и прочие клиентские колонки не выгружаются.

import { buildXlsx } from '../core/xlsx-write.js';
import { wallToExcelSerial, isoDay, fmtDay, monthBounds, MONTHS_FULL } from '../core/dates.js';
import { METRICS, METRIC_LABEL, METRIC_SHORT, TOTAL, SMALL_N } from '../core/model.js';
import { filterParts, outlierMethodText, hoursText, sliceText, DYN_TEXT, STEP_TEXT, STAT_TEXT } from './caption.js';
import { qualityIssues } from './quality.js';
import { downloadBlob } from './dom.js';
import { formatDayList } from './settings-ui.js';

const H = (v) => ({ v, s: 'header' });
const num3 = (v) => (v == null || !Number.isFinite(v) ? null : { v, s: 'num3' });
const int = (v) => (v == null ? null : { v, s: 'int' });
const dt = (ws) => (ws == null ? null : { v: wallToExcelSerial(ws), s: 'dt' });
const day = (di) => (di == null ? null : { v: di + 25569, s: 'date' });

function units(state) {
  const h = state.prep.calendarMode ? 'кал. ч' : 'раб. ч';
  return { spent: 'мин', a: h, b: h };
}

function nowText() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function paramsSheet(state) {
  const { prep, dataset: ds, settings, filters: f } = state;
  const rows = [[H('Параметр'), H('Значение')]];
  const add = (k, v) => rows.push([k, v]);
  const sec = (t) => rows.push([{ v: t, s: 'bold' }, null]);
  sec('Отчёт');
  add('Название', 'Статистика решённых задач ОСП');
  add('Дата и время выгрузки', nowText());
  add('Исходный файл', ds.fileName);
  add('Лист', ds.sheetName);
  add('Строк прочитано', int(ds.rowsRead));
  add('Период создания задач в файле', ds.minCreated != null ? `${fmtDay(Math.floor(ds.minCreated / 86400))} – ${fmtDay(Math.floor(ds.maxCreated / 86400))}` : '');
  add('Срез на', prep.sliceDay != null ? fmtDay(prep.sliceDay) : '');
  sec('Фильтры');
  for (const [k, v] of filterParts(state)) add(k, v);
  add('Шаг динамики', STEP_TEXT[f.step]);
  add('Метрика на графиках', STAT_TEXT[f.metric]);
  add('Динамика по сотрудникам', DYN_TEXT[f.dynMode]);
  sec('Методы расчёта');
  add('Часы', hoursText(settings));
  add('Праздники', formatDayList(settings.calendar.holidays).replace(/\n/g, ', '));
  if (settings.calendar.workdays.length) add('Перенесённые рабочие дни', formatDayList(settings.calendar.workdays).replace(/\n/g, ', '));
  add('Порог «Прочие»', `типы, у которых во всей выборке не более ${settings.otherThreshold} задач`);
  add('Выбросы', outlierMethodText(settings));
  add('Пороги выбросов', 'считаются по всей загруженной выборке решённых задач, от фильтров не зависят');
  add('Постановщики-боты', settings.bots.join(', '));
  sec('Определения показателей');
  add('Решённая задача', 'Статус «Завершена» и есть дата закрытия. Месяц/неделя — по дате закрытия.');
  add('Задача в очереди', 'Любой другой статус; в показателях времени не участвует; в периоде — по дате создания.');
  add(`${METRIC_LABEL.spent}, мин`, 'Значение поля «Затрачено» как есть (зафиксированная длительность), без пересчёта в рабочие часы.');
  add(`${METRIC_LABEL.a}, ${units(state).a}`, 'Дата закрытия − дата начала работы; только если обе даты есть.');
  add(`${METRIC_LABEL.b}, ${units(state).b}`, 'Дата закрытия − дата создания.');
  add('Итого', 'Среднее/медиана по всем задачам выбранных сотрудников (пулинг), а не среднее средних.');
  add('Малая выборка', `n < ${SMALL_N}`);
  add('Пустая ячейка', 'нет данных (не ноль)');
  add('Аномалии дат', 'Закрытие раньше создания — исключены из (а) и (б); закрытие раньше начала работы — исключены из (а); в количестве учитываются.');
  return { name: 'Параметры', rows, freezeRow: 1, colWidths: [38, 110], maxColWidth: 110 };
}

function summarySheet(state) {
  const k = state.view.kpi;
  const u = units(state);
  const excl = state.filters.excludeOutliers;
  const rows = [[H('Показатель'), H('Значение')]];
  rows.push(['Всего задач', int(k.total)], ['Решено', int(k.solved)], ['В очереди', int(k.queue)]);
  for (const s of k.queueByStatus) rows.push([`  в очереди: ${s.status}`, int(s.n)]);
  if (k.unclassified) rows.push(['«Завершена» без даты закрытия', int(k.unclassified)]);
  rows.push([null, null]);
  rows.push([H('Показатель времени'), H('Среднее'), H('Медиана'), H('n'), H('Выбросов'), H(excl ? 'Среднее с выбросами' : 'Среднее без выбросов'), H(excl ? 'Медиана с выбросами' : 'Медиана без выбросов'), H(excl ? 'n с выбросами' : 'n без выбросов')]);
  for (const m of METRICS) {
    const x = k.metrics[m];
    rows.push([`${METRIC_LABEL[m]}, ${u[m]}`, num3(x.main.mean), num3(x.main.median), int(x.main.n), int(x.outliers), num3(x.alt.mean), num3(x.alt.median), int(x.alt.n)]);
  }
  rows.push([null, null], [excl ? 'Выбросы исключены из расчёта' : 'Выбросы учтены в расчёте', null]);
  return { name: 'Сводка', rows, freezeRow: 1, colWidths: [44, 14, 14, 10, 12, 22, 22, 16] };
}

function crossSheet(state) {
  const p = state.view.pivot;
  const rows = [[H('Тип задач'), ...p.emps.map((e) => H(`${e.name}, шт.`)), H('Всего, шт.')]];
  for (const t of p.types) rows.push([t.isOther ? `${t.name} (n ≤ ${state.settings.otherThreshold} на всей выборке)` : t.name, ...p.emps.map((e) => int(p.count(e.key, t.key))), int(p.typeTotal.get(t.key))]);
  rows.push([{ v: 'Итого', s: 'bold' }, ...p.emps.map((e) => int(p.empTotal.get(e.key))), int(p.total)]);
  rows.push([]);
  rows.push([H('Тип задач'), ...p.emps.map((e) => H(`${e.name}, доля`)), H('Всего, доля')]);
  for (const t of p.types) {
    rows.push([
      t.name,
      ...p.emps.map((e) => {
        const tot = p.empTotal.get(e.key);
        return tot ? { v: p.count(e.key, t.key) / tot, s: 'pct' } : null;
      }),
      p.total ? { v: p.typeTotal.get(t.key) / p.total, s: 'pct' } : null,
    ]);
  }
  const otherT = p.types.find((t) => t.isOther);
  if (otherT) rows.push([], [`«Прочие» включают: ${otherT.members.join('; ')}`]);
  return { name: 'Сотрудники×Типы', rows, freezeRow: 1, freezeCol: 1, skipWidthRows: otherT ? [rows.length - 1] : [] };
}

function indicatorsSheet(state) {
  const u = units(state);
  const head = [H('Сотрудник'), H('Тип задач'), H('Решено, шт.')];
  for (const m of METRICS) head.push(H(`${METRIC_SHORT[m]} ср., ${u[m]}`), H(`${METRIC_SHORT[m]} мед., ${u[m]}`), H(`${METRIC_SHORT[m]} n`));
  const rows = [head];
  const line = (emp, type, r) => {
    const row = [emp, type, int(r.solved)];
    for (const m of METRICS) row.push(num3(r[m].mean), num3(r[m].median), int(r[m].n));
    rows.push(row);
  };
  for (const g of state.view.summary) {
    const emp = g.isAll ? 'Все сотрудники' : g.head.name;
    line(emp, 'Все типы', g.head);
    for (const c of g.children) line(emp, c.type, c);
  }
  return { name: 'Показатели', rows, freezeRow: 1, autoFilter: { row: 0 } };
}

function dynamicsSheet(state) {
  const u = units(state);
  const v = state.view;
  const head = [H('Период'), H('Начало'), H('Конец'), H('Неполный период'), H('Сотрудник'), H('Решено, шт.')];
  for (const m of METRICS) head.push(H(`${METRIC_SHORT[m]} ср., ${u[m]}`), H(`${METRIC_SHORT[m]} мед., ${u[m]}`), H(`${METRIC_SHORT[m]} n`));
  const rows = [head];
  // Все сотрудники выборки и «Итого» — независимо от режима отображения линий.
  const series = v.dyn.series;
  v.dyn.periods.forEach((p, i) => {
    for (const s of series) {
      const c = s.cells[i];
      const row = [p.label.replace(' — неполный период', ''), day(p.start), day(p.end), p.incomplete ? `да (${p.incompleteNote})` : 'нет', s.isTotal ? TOTAL : s.name, int(c.solved)];
      for (const m of METRICS) row.push(num3(c[m].mean), num3(c[m].median), int(c[m].n));
      rows.push(row);
    }
  });
  return { name: 'Динамика', rows, freezeRow: 1, autoFilter: { row: 0 } };
}

function outliersSheet(state) {
  const u = units(state);
  const head = [H('ID'), H('Тип задач'), H('Исполнитель'), H('Создана'), H('Начало работы'), H('Закрыта'), H(`Затрачено, ${u.spent}`), H(`В работе (а), ${u.a}`), H(`Цикл (б), ${u.b}`), H('Выброс по'), H(`Порог «Затрачено», ${u.spent}`), H(`Порог (а), ${u.a}`), H(`Порог (б), ${u.b}`)];
  const rows = [head];
  const sorted = [...state.view.outliers].sort((a, b) => b.closed - a.closed);
  for (const r of sorted) {
    rows.push([
      /^\d+$/.test(r.id) ? Number(r.id) : r.id,
      r.type,
      r.emp,
      dt(r.created),
      dt(r.started),
      dt(r.closed),
      num3(r.spent),
      num3(r.a),
      num3(r.b),
      r.flags.map((m) => METRIC_SHORT[m]).join(', '),
      r.flags.includes('spent') ? num3(r.thr.spent) : null,
      r.flags.includes('a') ? num3(r.thr.a) : null,
      r.flags.includes('b') ? num3(r.thr.b) : null,
    ]);
  }
  return { name: 'Выбросы', rows, freezeRow: 1, autoFilter: { row: 0 } };
}

function qualitySheet(state) {
  const q = state.view.quality;
  const rows = [[H('Месяц закрытия'), H('Решено, шт.'), H('Заполнено «Затрачено», шт.'), H('Доля «Затрачено»'), H('Заполнена «Дата начала работы», шт.'), H('Доля «Дата начала работы»')]];
  for (const r of q.months) {
    const b = monthBounds(r.key);
    rows.push([
      `${MONTHS_FULL[b.m - 1]} ${b.y}`,
      int(r.solved),
      int(r.spent),
      r.solved ? (r.spent ? { v: r.spent / r.solved, s: 'pct' } : 'нет данных') : null,
      int(r.started),
      r.solved ? (r.started ? { v: r.started / r.solved, s: 'pct' } : 'нет данных') : null,
    ]);
  }
  rows.push([]);
  const start = rows.length;
  rows.push([H('Проверка по всему файлу'), H('Подробности'), H('ID')]);
  const issues = qualityIssues(state.prep);
  if (!issues.length) rows.push(['Аномалий не найдено', null, null]);
  for (const i of issues) rows.push([i.title, i.detail || '', i.ids || '']);
  return { name: 'Качество данных', rows, freezeRow: 1, colWidths: [46, 40, 26, 18, 30, 24], skipWidthRows: Array.from({ length: rows.length - start }, (_, i) => start + i) };
}

function fileStamp(state) {
  return state.prep.sliceDay != null ? isoDay(state.prep.sliceDay) : 'bez_sreza';
}

export function buildReportSheets(state) {
  return [paramsSheet(state), summarySheet(state), crossSheet(state), indicatorsSheet(state), dynamicsSheet(state), outliersSheet(state), qualitySheet(state)];
}

export function exportReportXlsx(actions) {
  const { state } = actions;
  if (!state.view) return;
  const u8 = buildXlsx(buildReportSheets(state));
  const name = `osp_statistika_${fileStamp(state)}.xlsx`;
  downloadBlob(new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  actions.toast(`Сохранено: ${name} (${sliceText(state.prep)})`);
}

export function exportOutliersXlsx(actions) {
  const { state } = actions;
  if (!state.view) return;
  const u8 = buildXlsx([outliersSheet(state), paramsSheet(state)]);
  const name = `osp_vybrosy_${fileStamp(state)}.xlsx`;
  downloadBlob(new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  actions.toast(`Сохранено: ${name}`);
}

