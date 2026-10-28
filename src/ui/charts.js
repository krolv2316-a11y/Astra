// Графики на Chart.js: столбцы «сотрудники × типы» и линии динамики.

import { Chart, BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { fmtAuto, fmtFull, fmtInt, fmtNum, fmtPct, axisUnit } from '../core/format.js';
import { METRIC_LABEL } from '../core/model.js';

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

const css = () => getComputedStyle(document.documentElement);
export function token(name) {
  return css().getPropertyValue(name).trim();
}

export function seriesColor(idx) {
  if (idx == null || idx < 0) return token('--series-other');
  return token(`--series-${(idx % 8) + 1}`);
}

export function typeColor(type) {
  return type.isOther || type.colorIdx >= 8 ? token('--series-other') : seriesColor(type.colorIdx);
}

// Маркеры и штрихи: линии различаются не только цветом.
const SHAPES = ['circle', 'rect', 'triangle', 'rectRounded'];
const DASHES = [[], [7, 4], [2, 3], [10, 3, 2, 3]];
export function seriesStyle(idx) {
  return { shape: SHAPES[idx % SHAPES.length], dash: DASHES[Math.floor(idx / SHAPES.length) % DASHES.length] };
}

function baseFont() {
  return { family: token('--font'), size: 12 };
}

function tooltipBase() {
  return {
    backgroundColor: '#ffffff',
    titleColor: token('--text'),
    bodyColor: token('--text-2'),
    footerColor: token('--text-muted'),
    borderColor: token('--border-strong'),
    borderWidth: 1,
    padding: 10,
    boxPadding: 4,
    usePointStyle: true,
    titleFont: { ...baseFont(), weight: '600' },
    bodyFont: baseFont(),
    footerFont: { ...baseFont(), size: 11, weight: '400' },
  };
}

function legendBase(onToggle) {
  return {
    position: 'top',
    align: 'start',
    labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14, color: token('--text-2'), font: baseFont() },
    onClick: (e, item, legend) => onToggle(legend.chart.data.datasets[item.datasetIndex].seriesKey),
  };
}

/** Создаёт или обновляет график в контейнере. */
function upsert(holder, config) {
  let chart = holder._chart;
  if (chart && chart.config.type !== config.type) {
    chart.destroy();
    chart = null;
  }
  if (!chart) {
    const canvas = holder.querySelector('canvas');
    chart = new Chart(canvas, config);
    holder._chart = chart;
  } else {
    chart.data = config.data;
    chart.options = config.options;
    chart.update('none');
  }
  return chart;
}

export function destroyChart(holder) {
  if (holder && holder._chart) {
    holder._chart.destroy();
    holder._chart = null;
  }
}

/** Столбцы: сотрудники по оси, сегменты — типы. mode: 'count' | 'pct'. */
export function renderBarChart(holder, { pivot, mode, hidden, onToggle }) {
  const pct = mode === 'pct';
  // Не больше 8 цветов: типы сверх палитры объединяются в серый сегмент вместе с «Прочими».
  const main = pivot.types.filter((t) => !t.isOther && t.colorIdx < 8);
  const rest = pivot.types.filter((t) => t.isOther || t.colorIdx >= 8);
  const groups = main.map((t) => ({ key: t.key, name: t.name, color: typeColor(t), keys: [t.key] }));
  if (rest.length) {
    const extra = rest.filter((t) => !t.isOther).length;
    const name = rest.some((t) => t.isOther) ? (extra ? `Прочие и ещё ${extra} тип(а)` : 'Прочие') : `Другие типы (${extra})`;
    groups.push({ key: '__rest__', name, color: token('--series-other'), keys: rest.map((t) => t.key) });
  }
  const surface = token('--surface');
  const datasets = groups.map((g) => {
    const counts = pivot.emps.map((e) => g.keys.reduce((s, k) => s + pivot.count(e.key, k), 0));
    return {
      label: g.name,
      seriesKey: g.key,
      counts,
      data: counts.map((c, i) => (pct ? (pivot.empTotal.get(pivot.emps[i].key) ? (100 * c) / pivot.empTotal.get(pivot.emps[i].key) : 0) : c)),
      backgroundColor: g.color,
      borderColor: surface,
      borderWidth: { left: 0, right: 2, top: 0, bottom: 0 },
      borderSkipped: false,
      hidden: hidden.has(g.key),
      maxBarThickness: 44,
      categoryPercentage: 0.7,
      barPercentage: 0.9,
    };
  });
  const ink = token('--chart-ink');
  return upsert(holder, {
    type: 'bar',
    data: { labels: pivot.emps.map((e) => e.name), datasets },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: legendBase(onToggle),
        tooltip: {
          ...tooltipBase(),
          callbacks: {
            title: (items) => items[0].label,
            label: (ctx) => {
              const c = ctx.dataset.counts[ctx.dataIndex];
              const total = pivot.empTotal.get(pivot.emps[ctx.dataIndex].key) || 0;
              return `${ctx.dataset.label}: ${fmtInt(c)} шт. (${fmtPct(total ? c / total : 0)})`;
            },
            footer: (items) => `Всего у сотрудника: ${fmtInt(pivot.empTotal.get(pivot.emps[items[0].dataIndex].key) || 0)} шт.`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          beginAtZero: true,
          max: pct ? 100 : undefined,
          grid: { color: token('--chart-grid') },
          border: { color: token('--chart-axis') },
          ticks: { color: ink, font: baseFont(), callback: (v) => (pct ? `${fmtNum(v, 0)} %` : fmtInt(v)) },
          title: { display: true, text: pct ? 'Доля решённых задач сотрудника, %' : 'Решено задач, шт.', color: ink, font: baseFont() },
        },
        y: { stacked: true, grid: { display: false }, border: { color: token('--chart-axis') }, ticks: { color: token('--text'), font: { ...baseFont(), size: 12.5 } } },
      },
    },
  });
}

/**
 * Линии динамики показателя.
 * series: [{ key, name, isTotal, colorIdx, cells }], periods: [...], stat: 'mean' | 'median'.
 */
export function renderLineChart(holder, { metric, periods, series, stat, hidden, onToggle, dayHours, calendarMode, smallN }) {
  let max = 0;
  for (const s of series) for (const c of s.cells) if (c[metric].n && c[metric][stat] > max) max = c[metric][stat];
  const unit = axisUnit(metric, max, dayHours, calendarMode);
  const surface = token('--surface');
  const datasets = series.map((s, i) => {
    const color = s.isTotal ? token('--series-total') : seriesColor(s.colorIdx);
    const st = s.isTotal ? { shape: 'rectRot', dash: [] } : seriesStyle(s.colorIdx);
    const small = s.cells.map((c) => c[metric].n > 0 && c[metric].n < smallN);
    return {
      label: s.name,
      seriesKey: s.key,
      cells: s.cells,
      data: s.cells.map((c) => (c[metric].n ? c[metric][stat] * unit.factor : null)),
      borderColor: color,
      backgroundColor: color,
      borderWidth: s.isTotal ? 3 : 2,
      borderDash: st.dash,
      pointStyle: st.shape,
      pointRadius: small.map((sm) => (sm ? 5 : s.isTotal ? 4.5 : 3.5)),
      pointHoverRadius: 6,
      pointBorderWidth: 2,
      pointBackgroundColor: small.map((sm) => (sm ? surface : color)),
      pointBorderColor: color,
      spanGaps: false,
      tension: 0,
      hidden: hidden.has(s.key),
      order: s.isTotal ? 0 : i + 1,
    };
  });
  const ink = token('--chart-ink');
  const statLabel = stat === 'median' ? 'Медиана' : 'Среднее';
  return upsert(holder, {
    type: 'line',
    data: { labels: periods.map((p) => p.axis), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: legendBase(onToggle),
        tooltip: {
          ...tooltipBase(),
          callbacks: {
            title: (items) => {
              const p = periods[items[0].dataIndex];
              return p.incomplete ? [p.label.replace(' — неполный период', ''), `неполный период (${p.incompleteNote})`] : p.label;
            },
            label: (ctx) => {
              const c = ctx.dataset.cells[ctx.dataIndex][metric];
              const lines = [
                `${ctx.dataset.label}`,
                `  среднее: ${fmtAuto(metric, c.mean, dayHours, calendarMode)} (${fmtFull(metric, c.mean, calendarMode)})`,
                `  медиана: ${fmtAuto(metric, c.median, dayHours, calendarMode)} (${fmtFull(metric, c.median, calendarMode)})`,
                `  n = ${fmtInt(c.n)}${c.n < smallN ? ' — малая выборка' : ''}`,
              ];
              return lines;
            },
            footer: (items) => {
              const i = items[0].dataIndex;
              const chart = items[0].chart;
              const missing = chart.data.datasets
                .filter((d, di) => chart.isDatasetVisible(di) && d.cells[i][metric].n === 0)
                .map((d) => d.label);
              return missing.length ? `нет данных: ${missing.join(', ')}` : '';
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: token('--chart-axis') },
          ticks: {
            color: (ctx) => (periods[ctx.index] && periods[ctx.index].incomplete ? token('--text-muted') : ink),
            font: baseFont(),
            maxRotation: 0,
            autoSkip: true,
            autoSkipPadding: 10,
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: token('--chart-grid') },
          border: { display: false },
          ticks: { color: ink, font: baseFont(), callback: (v) => fmtNum(v, Number.isInteger(v) ? 0 : 1) },
          title: { display: true, text: `${statLabel} «${METRIC_LABEL[metric]}», ${unit.unit}`, color: ink, font: baseFont() },
        },
      },
    },
  });
}

/** Временно повышает чёткость графиков (для PNG ×2). Возвращает функцию отката. */
export function boostCharts(root, ratio = 2) {
  const charts = [...root.querySelectorAll('.chart-box')].map((b) => b._chart).filter(Boolean);
  for (const c of charts) {
    c.options.devicePixelRatio = ratio;
    c.resize();
  }
  return () => {
    for (const c of charts) {
      c.options.devicePixelRatio = undefined;
      c.resize();
    }
  };
}
