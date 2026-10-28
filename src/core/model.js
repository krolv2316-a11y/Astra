// Расчётное ядро: подготовка выборки по настройкам справочников (prepare)
// и агрегаты под текущие фильтры (computeView). Чистые функции, без DOM.

import { WorkCalendar } from './workcal.js';
import { summarize, sortNum, percentileSorted, medianInPlace } from './stats.js';
import { normKey } from './parse.js';
import { dayIndex, partsOfDay, buildPeriods, monthKeyOfDay, weekKeyOfDay, monthBounds, MONTHS_SHORT } from './dates.js';
import { METRICS } from './settings.js';

export { METRICS };
export const OTHER = 'Прочие';
export const TOTAL = 'Итого';
export const ALL = 'Все';
export const METRIC_LABEL = { spent: 'Затрачено', a: 'В работе (а)', b: 'От создания до закрытия (б)' };
export const METRIC_SHORT = { spent: 'Затрачено', a: 'В работе (а)', b: 'Цикл (б)' };
export const SMALL_N = 5;

function thresholdOf(sorted, o) {
  if (!sorted.length) return Infinity;
  if (o.method === 'iqr') {
    const q1 = percentileSorted(sorted, 0.25);
    const q3 = percentileSorted(sorted, 0.75);
    return q3 + o.k * (q3 - q1);
  }
  return percentileSorted(sorted, o.p / 100);
}

function manualThreshold(metric, o, dayHours) {
  const m = o.manual[metric];
  if (metric === 'spent') return m.unit === 'hour' ? m.value * 60 : m.value;
  return m.unit === 'day' ? m.value * dayHours : m.value;
}

/**
 * Подготовка: периметр, типы (переименование, группы, «Прочие», скрытые), сотрудники,
 * показатели времени, пороги и флаги выбросов (по ВСЕЙ выборке, не зависят от фильтров).
 */
export function prepare(dataset, settings) {
  const cal = new WorkCalendar(settings.calendar);
  const calendarMode = cal.mode === 'calendar';
  const dayHours = cal.dayHours;
  const botSet = new Set(settings.bots.map(normKey));
  const typeCfg = new Map(Object.entries(settings.types).map(([k, v]) => [normKey(k), v]));
  const empCfg = new Map(Object.entries(settings.employees).map(([k, v]) => [normKey(k), v]));

  const tasks = [];
  let noExecutor = 0;
  const hiddenByTitle = new Map();
  const labelInfo = new Map(); // ключ ярлыка → { name, total, members:Set }
  const empInfo = new Map();
  const statusNames = new Map();
  const anomalies = { closedBeforeCreated: [], closedBeforeStarted: [], completedNoClose: [] };

  for (const s of dataset.tasks) {
    if (!s.executor) {
      noExecutor++;
      continue;
    }
    const titleKey = normKey(s.title);
    const tc = typeCfg.get(titleKey);
    if (tc && tc.hidden) {
      hiddenByTitle.set(s.title, (hiddenByTitle.get(s.title) || 0) + 1);
      continue;
    }
    const label = (tc && (tc.group || tc.display)) || s.title || '(без названия)';
    const labelKey = normKey(label);
    let li = labelInfo.get(labelKey);
    if (!li) labelInfo.set(labelKey, (li = { name: label, total: 0, members: new Set() }));
    li.total++;
    li.members.add(s.title || '(без названия)');

    const empName = empCfg.get(normKey(s.executor)) || s.executor;
    const empKey = normKey(empName);
    let ei = empInfo.get(empKey);
    if (!ei) empInfo.set(empKey, (ei = { key: empKey, name: empName, originals: new Set(), total: 0, solved: 0 }));
    ei.originals.add(s.executor);
    ei.total++;

    const statusKey = normKey(s.status);
    if (!statusNames.has(statusKey)) statusNames.set(statusKey, s.status || '(пусто)');
    const kind = statusKey === 'завершена' ? (s.closed != null ? 'solved' : 'unclassified') : 'queue';
    if (kind === 'solved') ei.solved++;
    if (kind === 'unclassified') anomalies.completedNoClose.push(s.id);

    const badCreated = s.created != null && s.closed != null && s.closed < s.created;
    const badStarted = s.started != null && s.closed != null && s.closed < s.started;
    if (badCreated) anomalies.closedBeforeCreated.push(s.id);
    if (badStarted) anomalies.closedBeforeStarted.push(s.id);

    const t = {
      src: s,
      id: s.id,
      kind,
      statusKey,
      labelKey,
      typeKey: null,
      empKey,
      isBot: botSet.has(normKey(s.author)),
      createdDay: s.created != null ? dayIndex(s.created) : null,
      closedDay: kind === 'solved' ? dayIndex(s.closed) : null,
      spent: null,
      a: null,
      b: null,
      out: { spent: false, a: false, b: false },
      anomaly: badCreated || badStarted,
    };
    if (kind === 'solved') {
      t.spent = s.spentMin;
      // Задачи с закрытием раньше создания/начала работы считаются в количестве,
      // но исключаются из интервальных показателей.
      if (s.started != null && !badStarted && !badCreated) t.a = cal.hours(s.started, s.closed);
      if (s.created != null && !badCreated) t.b = cal.hours(s.created, s.closed);
      t.monthKey = monthKeyOfDay(t.closedDay);
      t.weekKey = weekKeyOfDay(t.closedDay);
    }
    tasks.push(t);
  }

  // Типы: всё, что встречается во всей выборке не более N раз, уходит в «Прочие».
  const N = settings.otherThreshold;
  const otherKey = normKey(OTHER);
  const typeMap = new Map();
  for (const [labelKey, li] of labelInfo) {
    const isOther = labelKey === otherKey || li.total <= N;
    const key = isOther ? otherKey : labelKey;
    let ti = typeMap.get(key);
    if (!ti) typeMap.set(key, (ti = { key, name: isOther ? OTHER : li.name, isOther, total: 0, solved: 0, members: new Set() }));
    ti.total += li.total;
    li.members.forEach((m) => ti.members.add(m));
  }
  const labelToType = new Map();
  for (const [labelKey, li] of labelInfo) labelToType.set(labelKey, labelKey === otherKey || li.total <= N ? otherKey : labelKey);
  for (const t of tasks) {
    t.typeKey = labelToType.get(t.labelKey);
    if (t.kind === 'solved') typeMap.get(t.typeKey).solved++;
  }
  const types = [...typeMap.values()]
    .map((ti) => ({ ...ti, members: [...ti.members].sort((a, b) => a.localeCompare(b, 'ru')) }))
    .sort((a, b) => (a.isOther - b.isOther) || b.solved - a.solved || b.total - a.total || a.name.localeCompare(b.name, 'ru'));
  types.forEach((t, i) => {
    t.order = i;
  });
  // Цвета по постоянному порядку (не меняются от фильтров); «Прочие» — нейтральный серый.
  let slot = 0;
  for (const t of types) t.colorIdx = t.isOther ? -1 : slot++;

  const employees = [...empInfo.values()]
    .map((e) => ({ ...e, originals: [...e.originals] }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  employees.forEach((e, i) => {
    e.order = i;
    e.colorIdx = i;
  });

  // Пороги выбросов по всей выборке решённых задач, отдельно по типам.
  const o = settings.outliers;
  const thresholds = {};
  for (const m of METRICS) {
    const all = [];
    const byType = new Map();
    for (const t of tasks) {
      if (t.kind !== 'solved' || t[m] == null) continue;
      all.push(t[m]);
      if (!byType.has(t.typeKey)) byType.set(t.typeKey, []);
      byType.get(t.typeKey).push(t[m]);
    }
    const entry = { global: Infinity, byType: new Map(), source: new Map() };
    if (o.method === 'manual') {
      entry.global = manualThreshold(m, o, dayHours);
      for (const k of byType.keys()) {
        entry.byType.set(k, entry.global);
        entry.source.set(k, 'manual');
      }
    } else {
      entry.global = thresholdOf(sortNum(all), o);
      for (const [k, vals] of byType) {
        const own = vals.length >= o.minGroup;
        entry.byType.set(k, own ? thresholdOf(sortNum(vals), o) : entry.global);
        entry.source.set(k, own ? 'type' : 'global');
      }
    }
    thresholds[m] = entry;
    for (const t of tasks) {
      if (t.kind === 'solved' && t[m] != null) t.out[m] = t[m] > entry.byType.get(t.typeKey);
    }
  }
  // Плотные массивы значений и флагов для быстрых агрегатов (порядок как в METRICS).
  for (const t of tasks) {
    t.mv = [t.spent ?? NaN, t.a ?? NaN, t.b ?? NaN];
    t.mo = [t.out.spent, t.out.a, t.out.b];
  }

  let minCloseDay = Infinity;
  let maxCloseDay = -Infinity;
  let minCreatedDay = Infinity;
  let maxCreatedDay = -Infinity;
  for (const t of tasks) {
    if (t.closedDay != null) {
      minCloseDay = Math.min(minCloseDay, t.closedDay);
      maxCloseDay = Math.max(maxCloseDay, t.closedDay);
    }
    if (t.createdDay != null) {
      minCreatedDay = Math.min(minCreatedDay, t.createdDay);
      maxCreatedDay = Math.max(maxCreatedDay, t.createdDay);
    }
  }
  const fin = (x) => (Number.isFinite(x) ? x : null);

  // Покрытие праздничного календаря годами из данных.
  const holidayYears = new Set(settings.calendar.holidays.map((d) => Number(d.slice(0, 4))));
  const uncoveredYears = calendarMode ? [] : dataset.years.filter((y) => !holidayYears.has(y));

  return {
    dataset,
    settings,
    cal,
    calendarMode,
    dayHours,
    tasks,
    types,
    typeByKey: new Map(types.map((t) => [t.key, t])),
    employees,
    empByKey: new Map(employees.map((e) => [e.key, e])),
    statusNames,
    thresholds,
    sliceDay: dataset.slice != null ? dayIndex(dataset.slice) : null,
    minCloseDay: fin(minCloseDay),
    maxCloseDay: fin(maxCloseDay),
    minCreatedDay: fin(minCreatedDay),
    maxCreatedDay: fin(maxCreatedDay),
    hidden: {
      titles: [...hiddenByTitle.entries()].map(([title, n]) => ({ title, n })),
      tasks: [...hiddenByTitle.values()].reduce((a, b) => a + b, 0),
    },
    quality: { ...anomalies, noExecutor, uncoveredYears },
  };
}

export function defaultFilters() {
  return {
    employees: null, // null = все
    types: null,
    from: null,
    to: null,
    author: 'all',
    dynMode: 'both',
    step: 'month',
    metric: 'mean',
    excludeOutliers: false,
    barMode: 'count',
  };
}

// mode: 'all' — все значения, 'clean' — без выбросов.
function metricSummary(list, i, excl) {
  const len = list.length;
  const buf = new Float64Array(len);
  let n = 0;
  let sum = 0;
  for (let j = 0; j < len; j++) {
    const t = list[j];
    const v = t.mv[i];
    if (v === v && !(excl && t.mo[i])) {
      buf[n++] = v;
      sum += v;
    }
  }
  if (!n) return { n: 0, mean: null, median: null };
  return { n, mean: sum / n, median: medianInPlace(buf.subarray(0, n)) };
}

function metricsOf(list, excl) {
  return { solved: list.length, spent: metricSummary(list, 0, excl), a: metricSummary(list, 1, excl), b: metricSummary(list, 2, excl) };
}

/** Все агрегаты для страницы и экспорта при данных фильтрах. */
export function computeView(prep, f) {
  const inRange = (d) => d != null && (f.from == null || d >= f.from) && (f.to == null || d <= f.to);
  const noPeriod = f.from == null && f.to == null;
  const passEmp = (t) => !f.employees || f.employees.has(t.empKey);
  const passType = (t) => !f.types || f.types.has(t.typeKey);
  const passAuthor = (t) => f.author === 'all' || (f.author === 'bots' ? t.isBot : !t.isBot);
  const passPeriod = (t) => (t.kind === 'solved' ? inRange(t.closedDay) : t.createdDay == null ? noPeriod : inRange(t.createdDay));

  // Счётчики для чекбоксов (фасеты): все фильтры, кроме своего.
  const empCounts = new Map();
  const typeCounts = new Map();
  const selected = [];
  for (const t of prep.tasks) {
    const pa = passAuthor(t);
    const pp = passPeriod(t);
    if (!pa || !pp) continue;
    const pe = passEmp(t);
    const pt = passType(t);
    if (t.kind === 'solved') {
      if (pt) empCounts.set(t.empKey, (empCounts.get(t.empKey) || 0) + 1);
      if (pe) typeCounts.set(t.typeKey, (typeCounts.get(t.typeKey) || 0) + 1);
    }
    if (pe && pt) selected.push(t);
  }

  const solved = selected.filter((t) => t.kind === 'solved');
  const queue = selected.filter((t) => t.kind === 'queue');
  const unclassified = selected.filter((t) => t.kind === 'unclassified');
  const excl = !!f.excludeOutliers;

  const queueByStatus = new Map();
  for (const t of queue) queueByStatus.set(t.statusKey, (queueByStatus.get(t.statusKey) || 0) + 1);
  const queueByEmp = new Map();
  for (const t of queue) queueByEmp.set(t.empKey, (queueByEmp.get(t.empKey) || 0) + 1);

  const kpi = {
    total: selected.length,
    solved: solved.length,
    queue: queue.length,
    unclassified: unclassified.length,
    queueByStatus: [...queueByStatus.entries()].map(([k, n]) => ({ status: prep.statusNames.get(k), n })).sort((a, b) => b.n - a.n),
    queueByEmp: [...queueByEmp.entries()]
      .map(([k, n]) => ({ name: prep.empByKey.get(k).name, order: prep.empByKey.get(k).order, n }))
      .sort((a, b) => a.order - b.order),
    metrics: {},
  };
  METRICS.forEach((m, i) => {
    const all = metricSummary(solved, i, false);
    const clean = metricSummary(solved, i, true);
    kpi.metrics[m] = { main: excl ? clean : all, alt: excl ? all : clean, outliers: all.n - clean.n };
  });

  // Сотрудники и типы в текущей выборке (порядок постоянный).
  const empKeys = new Set(solved.map((t) => t.empKey));
  const typeKeys = new Set(solved.map((t) => t.typeKey));
  const emps = prep.employees.filter((e) => empKeys.has(e.key));
  const types = prep.types.filter((t) => typeKeys.has(t.key));

  // Группировки одним проходом.
  const byEmp = new Map();
  const byType = new Map();
  const byEmpType = new Map();
  const push = (map, k, t) => {
    const l = map.get(k);
    if (l) l.push(t);
    else map.set(k, [t]);
  };
  for (const t of solved) {
    push(byEmp, t.empKey, t);
    push(byType, t.typeKey, t);
    push(byEmpType, `${t.empKey}\u0000${t.typeKey}`, t);
  }
  const listOf = (map, k) => map.get(k) || [];

  // Сотрудники × типы.
  const pivot = {
    emps,
    types,
    count: (ek, tk) => listOf(byEmpType, `${ek}\u0000${tk}`).length,
    empTotal: new Map(emps.map((e) => [e.key, listOf(byEmp, e.key).length])),
    typeTotal: new Map(types.map((ty) => [ty.key, listOf(byType, ty.key).length])),
    total: solved.length,
  };

  // Динамика по дате закрытия.
  let dyn = { periods: [], series: [] };
  if (prep.minCloseDay != null) {
    const from = Math.max(f.from ?? -Infinity, prep.minCloseDay);
    const to = Math.min(f.to ?? Infinity, prep.maxCloseDay);
    const periods = buildPeriods(f.step, from, to, { sliceDi: prep.sliceDay, cutFrom: f.from, cutTo: f.to });
    const keyOf = f.step === 'week' ? (t) => t.weekKey : (t) => t.monthKey;
    const idx = new Map(periods.map((p, i) => [p.key, i]));
    const buckets = (list) => {
      const b = periods.map(() => []);
      for (const t of list) {
        const i = idx.get(keyOf(t));
        if (i != null) b[i].push(t);
      }
      return b.map((l) => metricsOf(l, excl));
    };
    const series = emps.map((e) => ({ key: e.key, name: e.name, isTotal: false, colorIdx: e.colorIdx, cells: buckets(listOf(byEmp, e.key)) }));
    series.push({ key: '__total__', name: TOTAL, isTotal: true, colorIdx: -1, cells: buckets(solved) });
    dyn = { periods, series };
  }

  // Сводная таблица: сотрудник → тип и «Все».
  const summary = [];
  const groupRows = (key, name, list, typeList) => {
    const head = { key, name, type: null, level: 0, ...metricsOf(list, excl) };
    const children = types
      .map((ty) => {
        const l = typeList(ty.key);
        return l.length ? { key: `${key}/${ty.key}`, name, type: ty.name, typeKey: ty.key, level: 1, ...metricsOf(l, excl) } : null;
      })
      .filter(Boolean);
    return { head, children };
  };
  for (const e of emps) summary.push(groupRows(e.key, e.name, listOf(byEmp, e.key), (tk) => listOf(byEmpType, `${e.key}\u0000${tk}`)));
  summary.push({ ...groupRows('__all__', ALL, solved, (tk) => listOf(byType, tk)), isAll: true });

  // Задачи-выбросы (таблица всегда видна и не зависит от переключателя).
  const outliers = solved
    .filter((t) => t.out.spent || t.out.a || t.out.b)
    .map((t) => ({
      id: t.id,
      type: prep.typeByKey.get(t.typeKey).name,
      typeKey: t.typeKey,
      emp: prep.empByKey.get(t.empKey).name,
      created: t.src.created,
      started: t.src.started,
      closed: t.src.closed,
      spent: t.spent,
      a: t.a,
      b: t.b,
      flags: METRICS.filter((m) => t.out[m]),
      thr: Object.fromEntries(METRICS.map((m) => [m, prep.thresholds[m].byType.get(t.typeKey)])),
    }));

  // Качество данных по месяцам закрытия (по текущей выборке).
  const monthly = new Map();
  for (const t of solved) {
    let r = monthly.get(t.monthKey);
    if (!r) monthly.set(t.monthKey, (r = { key: t.monthKey, solved: 0, spent: 0, started: 0 }));
    r.solved++;
    if (t.spent != null) r.spent++;
    if (t.src.started != null) r.started++;
  }
  const qMonths = [];
  if (solved.length) {
    const keys = [...monthly.keys()];
    const lo = Math.min(...keys);
    const hi = Math.max(...keys);
    for (let k = lo; k <= hi; k++) {
      const b = monthBounds(k);
      const r = monthly.get(k) || { key: k, solved: 0, spent: 0, started: 0 };
      qMonths.push({ ...r, label: `${MONTHS_SHORT[b.m - 1]} ${b.y}`, short: `${String(b.m).padStart(2, '0')}.${b.y}` });
    }
  }

  return {
    filters: f,
    selected,
    solved,
    kpi,
    empCounts,
    typeCounts,
    pivot,
    dyn,
    summary,
    outliers,
    quality: {
      months: qMonths,
      noSpentMonths: qMonths.filter((r) => r.solved > 0 && r.spent === 0),
      noStartedMonths: qMonths.filter((r) => r.solved > 0 && r.started === 0),
    },
  };
}

/** Год/месяц дня — вспомогательно для подписей. */
export function yearOfDay(di) {
  return partsOfDay(di).y;
}
