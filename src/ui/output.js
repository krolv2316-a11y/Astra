// Область вывода: качество данных, KPI, графики, таблицы.

import { h, clear, icon, $ } from './dom.js';
import { fmtInt, fmtPct, fmtAuto, fmtFull, NO_DATA, plural } from '../core/format.js';
import { fmtDateTime } from '../core/dates.js';
import { REQUIRED } from '../core/parse.js';
import { METRICS, METRIC_LABEL, METRIC_SHORT } from '../core/model.js';
import { renderBarChart, renderLineChart, destroyChart, typeColor } from './charts.js';
import { filterCaption, sliceText, outlierMethodText } from './caption.js';
import { qualityIssues } from './quality.js';
import { exportCardPng, exportReportPng } from './export-png.js';
import { exportReportXlsx, exportOutliersXlsx } from './export-xlsx.js';

const DYN = [
  { metric: 'spent', id: 'card-dyn-spent', slug: 'zatracheno_dinamika', title: 'Динамика «Затрачено»', hint: 'Зафиксированная длительность из поля «Затрачено», без пересчёта в рабочие часы.' },
  { metric: 'a', id: 'card-dyn-a', slug: 'v_rabote_dinamika', title: 'Динамика «В работе (а)»', hint: 'Дата закрытия − дата начала работы.' },
  { metric: 'b', id: 'card-dyn-b', slug: 'cikl_dinamika', title: 'Динамика «От создания до закрытия (б)»', hint: 'Дата закрытия − дата создания.' },
];

function unitsHint(settings) {
  return settings.calendar.mode === 'calendar' ? 'в календарных часах' : 'в рабочих часах';
}

// ---------------------------------------------------------------------------
// Пустое состояние и ошибки загрузки

function requiredList() {
  return h('div', { class: 'req-cols' }, REQUIRED.map((r) => h('span', null, r.header)));
}

function emptyState() {
  return h(
    'section',
    { class: 'card empty' },
    h(
      'div',
      null,
      h('h2', null, 'Загрузите выгрузку задач'),
      h('p', null, 'Перетащите файл .xlsx в окно или нажмите «Выбрать файл» вверху. Статистика по решённым задачам появится сразу после загрузки.'),
      h(
        'ol',
        null,
        h('li', null, 'Слева — фильтры: сотрудники, типы задач, период, постановщик, режимы динамики.'),
        h('li', null, 'Справа — KPI, распределение по сотрудникам и типам, динамика времени, сводная таблица и задачи-выбросы.'),
        h('li', null, 'Результаты можно скачать в Excel или в PNG.'),
      ),
      h('p', { class: 'privacy' }, 'Файл обрабатывается только в этом окне браузера: данные никуда не отправляются и не сохраняются. Читаются только колонки, перечисленные справа; тексты задач и клиентские реквизиты не читаются и не показываются.'),
    ),
    h(
      'div',
      null,
      h('h3', { style: { fontSize: '14px', marginBottom: '6px' } }, 'Обязательные колонки (заголовки в первой строке)'),
      requiredList(),
      h('p', { class: 'privacy' }, 'Даты — «дд.мм.гггг чч:мм[:сс]» текстом или датами Excel; «Затрачено» — «Ч:ММ:СС» или время Excel. Остальные колонки игнорируются. Нестандартные заголовки можно сопоставить в «Настройках справочников → Колонки файла».'),
    ),
  );
}

function loadErrorAlert(actions) {
  const { state } = actions;
  const le = state.loadError;
  const err = le.error;
  const keep = state.dataset ? h('p', { style: { margin: '6px 0 0' } }, `Показаны данные прежнего файла «${state.dataset.fileName}».`) : null;
  const body = [h('h3', null, `Файл «${le.fileName}» не загружен`), h('div', null, err.message)];
  if (err.code === 'missing_columns') {
    body.push(
      h('div', { style: { marginTop: '6px' } }, h('b', null, 'Не найдены колонки: '), h('span', { class: 'cols' }, err.missing.map((m) => h('span', { class: 'col-tag missing' }, m)))),
      h('div', { style: { marginTop: '6px' } }, h('b', null, `Заголовки в файле (лист «${err.sheet}»): `), h('span', { class: 'cols' }, err.found.length ? err.found.map((m) => h('span', { class: 'col-tag' }, m)) : 'нет')),
    );
    if (le.buffer && err.found.length) {
      const selects = {};
      const keyOf = (header) => REQUIRED.find((r) => r.header === header).key;
      const grid = h('div', { class: 'mapping' });
      for (const m of err.missing) {
        const sel = h('select', { 'aria-label': `Колонка для «${m}»` }, h('option', { value: '' }, '— выберите —'), err.found.map((f) => h('option', { value: f }, f)));
        selects[keyOf(m)] = sel;
        grid.append(h('span', null, `«${m}» — это колонка:`), sel);
      }
      body.push(
        h('div', { style: { marginTop: '8px' } }, 'Если нужная колонка называется иначе, сопоставьте её и загрузите файл повторно:'),
        grid,
        h(
          'div',
          { style: { marginTop: '8px' } },
          h(
            'button',
            {
              class: 'btn small primary',
              type: 'button',
              onclick: () => {
                const map = {};
                for (const [k, sel] of Object.entries(selects)) if (sel.value) map[k] = sel.value;
                if (Object.keys(map).length) actions.retryWithMapping(map);
              },
            },
            'Применить сопоставление',
          ),
        ),
      );
    }
  }
  if (keep) body.push(keep);
  body.push(h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn small', type: 'button', onclick: () => actions.dismissError() }, 'Скрыть сообщение')));
  return h('div', { class: 'alert error', role: 'alert' }, icon('error'), h('div', null, body));
}

// ---------------------------------------------------------------------------
// Каркас

function card(id, title, { slug, tools = [], hint } = {}) {
  const pngBtn = slug ? h('button', { class: 'btn small no-export', type: 'button', title: 'Сохранить этот блок как картинку PNG', dataset: { png: slug } }, icon('image'), 'PNG') : null;
  return h(
    'section',
    { class: 'card', id },
    h(
      'div',
      { class: 'card-head' },
      h('div', { style: { minWidth: 0 } }, h('h2', null, title), hint ? h('div', { class: 'sub hint-line' }, hint) : null, h('div', { class: 'sub caption-line' }, '')),
      h('div', { class: 'tools' }, tools, pngBtn),
    ),
    h('div', { class: 'card-body' }),
  );
}

export function renderOutput(actions) {
  const { state } = actions;
  const out = $('#output');
  for (const box of out.querySelectorAll('.chart-box')) destroyChart(box);
  clear(out);
  if (!state.prep) {
    if (state.loadError) out.append(h('div', { style: { marginBottom: '16px' } }, loadErrorAlert(actions)));
    out.append(emptyState());
    return;
  }

  const toolbar = h(
    'div',
    { class: 'out-toolbar' },
    h('div', { class: 'caption', id: 'filterCaption' }, ''),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', id: 'xlsxBtn', onclick: () => exportReportXlsx(actions) }, icon('download'), 'Скачать результаты в Excel'),
      h('button', { class: 'btn', type: 'button', id: 'pngAllBtn', onclick: () => exportReportPng(actions) }, icon('image'), 'Весь отчёт в PNG'),
    ),
  );
  const report = h('div', { class: 'report', id: 'report' });
  report.append(
    h('div', { class: 'report-head' }, h('h2', null, 'Статистика решённых задач ОСП'), h('div', { class: 'muted', id: 'reportMeta' }, '')),
    h('div', { id: 'alerts' }),
    h('details', { class: 'card quality', id: 'quality', open: state.open.quality, ontoggle: (e) => (state.open.quality = e.target.open) }),
    h('div', { class: 'kpis', id: 'kpis' }),
  );

  const barCard = card('card-bar', 'Решённые задачи по сотрудникам и типам', {
    slug: 'reshennye_po_sotrudnikam',
    tools: [
      h(
        'div',
        { class: 'seg no-export', role: 'group', 'aria-label': 'Единицы', dataset: { seg: 'barMode' } },
        h('button', { type: 'button', dataset: { value: 'count' }, onclick: () => actions.setFilter({ barMode: 'count' }) }, 'шт.'),
        h('button', { type: 'button', dataset: { value: 'pct' }, onclick: () => actions.setFilter({ barMode: 'pct' }) }, 'доля %'),
      ),
    ],
  });
  barCard.querySelector('.card-body').append(
    h('div', { class: 'split' }, h('div', { class: 'chart-box', id: 'barBox' }, h('canvas', { role: 'img', 'aria-label': 'Решённые задачи по сотрудникам и типам' })), h('div', { class: 'table-wrap', id: 'pivotTable' })),
  );
  report.append(barCard);

  for (const d of DYN) {
    const c = card(d.id, d.title, { slug: d.slug, hint: d.hint });
    c.querySelector('.card-body').append(
      h('div', { class: 'chart-box', id: `${d.id}-box` }, h('canvas', { role: 'img', 'aria-label': d.title })),
      h(
        'div',
        { class: 'chart-legend-note' },
        h('span', null, '◆ Итого — по всем задачам выбранных сотрудников (не среднее средних)'),
        h('span', { class: 'small-note' }, ''),
        h('span', null, 'разрыв линии — нет данных'),
        h('span', { class: 'no-export' }, 'клик по легенде скрывает серию'),
      ),
      h(
        'details',
        {
          class: 'data-table',
          open: !!state.open.dataTables[d.metric],
          ontoggle: (e) => (state.open.dataTables[d.metric] = e.target.open),
        },
        h('summary', null, icon('chevron', 'chev'), 'Таблица данных графика'),
        h('div', { class: 'table-wrap', id: `${d.id}-table` }),
      ),
    );
    report.append(c);
  }

  const summaryCard = card('card-summary', 'Сводная таблица', { slug: 'svodnaya_tablica', hint: 'Строки: сотрудник → тип задач и «Все». Щёлкните заголовок колонки, чтобы отсортировать.' });
  summaryCard.querySelector('.card-body').append(h('div', { class: 'table-wrap', id: 'summaryTable' }));
  report.append(summaryCard);

  const outCard = card('card-outliers', 'Задачи-выбросы', {
    slug: 'vybrosy',
    tools: [h('button', { class: 'btn small no-export', type: 'button', onclick: () => exportOutliersXlsx(actions) }, icon('download'), 'выгрузить в xlsx')],
  });
  outCard.querySelector('.card-body').append(h('div', { class: 'panel-note', id: 'outliersNote', style: { marginTop: 0, marginBottom: '8px' } }), h('div', { class: 'table-wrap scroll-y', id: 'outliersTable' }));
  report.append(outCard);

  out.append(toolbar, report);
  out.querySelectorAll('[data-png]').forEach((b) => b.addEventListener('click', () => exportCardPng(actions, b.closest('.card'), b.dataset.png)));
  refreshOutput(actions);
}

// ---------------------------------------------------------------------------
// Заполнение

export function refreshOutput(actions) {
  const { state } = actions;
  if (!state.prep || !$('#report')) return renderOutput(actions);
  const v = state.view;
  const caption = filterCaption(state);
  const slice = sliceText(state.prep);
  $('#filterCaption').textContent = caption;
  $('#reportMeta').textContent = `${slice} · файл «${state.dataset.fileName}» · ${caption}`;
  for (const el of document.querySelectorAll('#report .caption-line')) el.textContent = `${caption} · ${slice}`;
  for (const el of document.querySelectorAll('#report .small-note')) {
    el.replaceChildren(h('span', { class: 'hollow' }), `полый маркер — малая выборка (n < ${state.settings.smallN})`);
  }

  const alerts = clear($('#alerts'));
  if (state.loadError) alerts.append(loadErrorAlert(actions));

  renderQuality(actions);
  renderKpis(actions);
  renderBar(actions);
  for (const d of DYN) renderDyn(actions, d);
  renderSummary(actions);
  renderOutliers(actions);
  const bm = document.querySelector('[data-seg="barMode"]');
  if (bm) for (const b of bm.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === v.filters.barMode));
}

// ---------- Качество данных ----------

function renderQuality(actions) {
  const { state } = actions;
  const prep = state.prep;
  const v = state.view;
  const el = clear($('#quality'));
  const issues = qualityIssues(prep);
  const warns = issues.filter((i) => i.level === 'warn').length;
  const q = v.quality;
  const gaps = q.noSpentMonths.length + q.noStartedMonths.length;
  el.classList.toggle('has-warn', warns > 0);
  const summaryText = [
    'Качество данных',
    warns ? `${warns} ${plural(warns, 'предупреждение', 'предупреждения', 'предупреждений')}` : 'без предупреждений',
    gaps ? `месяцев без данных: «Затрачено» — ${q.noSpentMonths.length}, «Дата начала работы» — ${q.noStartedMonths.length}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  el.append(h('summary', null, icon(warns ? 'warn' : 'info'), h('span', null, summaryText), icon('chevron', 'chev')));

  const list = h('div', { class: 'issues' });
  if (!issues.length) list.append(h('div', { class: 'issue ok' }, icon('ok'), h('div', null, 'Структура и значения в порядке: аномалий не найдено.')));
  for (const i of issues) {
    list.append(h('div', { class: `issue ${i.level}` }, icon(i.level === 'warn' ? 'warn' : 'info'), h('div', null, h('div', null, i.title), i.detail ? h('div', { class: 'ids' }, i.detail) : null, i.ids ? h('div', { class: 'ids' }, i.ids) : null)));
  }
  const monthNames = (l) => l.map((r) => r.label).join(', ');
  if (q.noSpentMonths.length) list.append(h('div', { class: 'issue info' }, icon('info'), h('div', null, `Месяцы без «Затрачено» (нет данных, не ноль): ${monthNames(q.noSpentMonths)}`)));
  if (q.noStartedMonths.length) list.append(h('div', { class: 'issue info' }, icon('info'), h('div', null, `Месяцы без «Дата начала работы»: ${monthNames(q.noStartedMonths)}`)));

  const fillCell = (filled, total) => {
    if (!total) return h('td', { class: 'n nodata' }, NO_DATA);
    const share = filled / total;
    return h(
      'td',
      { class: `n${filled === 0 ? ' nodata' : ''}`, title: `${fmtInt(filled)} из ${fmtInt(total)}` },
      h('span', { class: 'fill-bar' }, h('i', { style: { width: `${Math.round(share * 100)}%` } })),
      filled === 0 ? 'нет данных' : fmtPct(share, 0),
    );
  };
  const table = h(
    'table',
    { class: 't wrap-head' },
    h('thead', null, h('tr', null, h('th', null, 'Месяц закрытия'), h('th', { class: 'n' }, 'Решено'), h('th', { class: 'n' }, 'Заполнено «Затрачено»'), h('th', { class: 'n' }, 'Заполнена «Дата начала работы»'))),
    h(
      'tbody',
      null,
      q.months.map((r) => h('tr', null, h('td', null, r.label), h('td', { class: 'n' }, r.solved ? fmtInt(r.solved) : '0'), fillCell(r.spent, r.solved), fillCell(r.started, r.solved))),
    ),
  );
  el.append(
    h(
      'div',
      { class: 'quality-body' },
      h('div', null, h('div', { class: 'panel-note', style: { marginTop: 0, marginBottom: '6px' } }, 'Проверки по всему файлу:'), list),
      h('div', null, h('div', { class: 'panel-note', style: { marginTop: 0, marginBottom: '6px' } }, 'Заполнение по месяцам закрытия (решённые задачи текущей выборки):'), h('div', { class: 'table-wrap' }, table)),
    ),
  );
}

// ---------- KPI ----------

function kpiCount(title, value, lines, tip) {
  return h('div', { class: 'card kpi', title: tip || '' }, h('div', { class: 'k-title' }, title), h('div', { class: 'k-value num' }, fmtInt(value)), lines);
}

function kpiTime(actions, m) {
  const { state } = actions;
  const k = state.view.kpi.metrics[m];
  const dh = state.prep.dayHours;
  const cal = state.prep.calendarMode;
  const excl = state.filters.excludeOutliers;
  const main = k.main;
  const value = main.n
    ? h('div', { class: 'k-value num', title: `Среднее: ${fmtFull(m, main.mean, cal)}` }, fmtAuto(m, main.mean, dh, cal), h('small', null, 'среднее'))
    : h('div', { class: 'k-value k-nodata' }, NO_DATA);
  const line = main.n
    ? h('div', { class: 'k-line' }, 'медиана ', h('b', { title: fmtFull(m, main.median, cal) }, fmtAuto(m, main.median, dh, cal)), ' · n = ', h('b', null, fmtInt(main.n)))
    : h('div', { class: 'k-line' }, 'n = 0');
  const alt = k.alt;
  const altText = alt.n ? fmtAuto(m, alt.mean, dh, cal) : NO_DATA;
  const outLine = excl
    ? h('div', { class: 'k-out', title: alt.n ? `Среднее с выбросами: ${fmtFull(m, alt.mean, cal)}` : '' }, `выбросов: ${fmtInt(k.outliers)} (исключены); среднее с ними: ${altText}`)
    : h('div', { class: 'k-out', title: alt.n ? `Среднее без выбросов: ${fmtFull(m, alt.mean, cal)}` : '' }, `выбросов: ${fmtInt(k.outliers)}; среднее без них: ${altText}`);
  const tips = {
    spent: 'Поле «Затрачено» как есть (зафиксированная длительность), только решённые задачи.',
    a: `Дата закрытия − дата начала работы, ${unitsHint(state.settings)}; только если обе даты есть.`,
    b: `Дата закрытия − дата создания, ${unitsHint(state.settings)}.`,
  };
  return h('div', { class: 'card kpi time', title: tips[m] }, h('div', { class: 'k-title' }, METRIC_LABEL[m]), value, line, outLine);
}

function renderKpis(actions) {
  const { state } = actions;
  const k = state.view.kpi;
  const el = clear($('#kpis'));
  const breakdown = (items) => h('div', { class: 'kpi-breakdown' }, items.map((i) => h('span', null, `${i.label}: `, h('b', null, fmtInt(i.n)))));
  el.append(
    kpiCount(
      'Всего задач',
      k.total,
      [
        h('div', { class: 'k-line' }, `решено ${fmtInt(k.solved)} · в очереди ${fmtInt(k.queue)}`),
        k.unclassified ? h('div', { class: 'k-line' }, `«Завершена» без даты закрытия: ${fmtInt(k.unclassified)}`) : null,
      ],
      'Решённые — по дате закрытия в периоде; задачи в очереди — по дате создания.',
    ),
    kpiCount('Решено', k.solved, [h('div', { class: 'k-line' }, k.total ? `${fmtPct(k.solved / k.total)} от всех задач выборки` : '—'), h('div', { class: 'k-line muted' }, 'статус «Завершена» и есть дата закрытия')]),
    kpiCount('В очереди', k.queue, [
      k.queue ? breakdown(k.queueByStatus.map((s) => ({ label: s.status, n: s.n }))) : h('div', { class: 'k-line muted' }, 'нет задач в очереди'),
      k.queue ? breakdown(k.queueByEmp.map((s) => ({ label: s.name, n: s.n }))) : null,
    ], 'Любой статус, кроме «Завершена». В показателях времени и на графиках не участвуют.'),
    kpiTime(actions, 'spent'),
    kpiTime(actions, 'a'),
    kpiTime(actions, 'b'),
  );
}

// ---------- Сотрудники × типы ----------

function renderBar(actions) {
  const { state } = actions;
  const v = state.view;
  const p = v.pivot;
  const box = $('#barBox');
  const tableBox = clear($('#pivotTable'));
  if (!p.total) {
    destroyChart(box);
    box.style.height = '160px';
    let msg = box.querySelector('.chart-empty');
    if (!msg) box.append((msg = h('div', { class: 'chart-empty' }, 'Нет решённых задач по выбранным фильтрам')));
    box.querySelector('canvas').hidden = true;
    tableBox.append(h('div', { class: 'muted' }, 'Нет данных'));
    return;
  }
  box.querySelector('.chart-empty')?.remove();
  box.querySelector('canvas').hidden = false;
  box.style.height = `${Math.max(180, p.emps.length * 58 + 110)}px`;
  renderBarChart(box, { pivot: p, mode: v.filters.barMode, hidden: state.hidden.bar, onToggle: (k) => actions.toggleSeries('bar', k) });

  const pct = v.filters.barMode === 'pct';
  const cell = (n, total) =>
    h('td', { class: 'n', title: pct ? `${fmtInt(n)} шт.` : total ? fmtPct(n / total) : '' }, pct ? (total ? fmtPct(n / total) : '—') : fmtInt(n));
  tableBox.append(
    h(
      'table',
      { class: 't' },
      h('thead', null, h('tr', null, h('th', null, 'Тип'), p.emps.map((e) => h('th', { class: 'n' }, e.name)), h('th', { class: 'n' }, 'Всего'))),
      h(
        'tbody',
        null,
        p.types.map((t) =>
          h(
            'tr',
            null,
            h('td', { title: t.isOther ? t.members.join('\n') : '' }, h('span', { class: 'swatch-cell', style: { background: typeColor(t) } }), t.isOther ? `${t.name} (n ≤ ${state.settings.otherThreshold} на всей выборке)` : t.name),
            p.emps.map((e) => cell(p.count(e.key, t.key), p.empTotal.get(e.key))),
            cell(p.typeTotal.get(t.key), p.total),
          ),
        ),
        h('tr', { class: 'total' }, h('td', null, 'Итого'), p.emps.map((e) => h('td', { class: 'n' }, pct ? '100 %' : fmtInt(p.empTotal.get(e.key)))), h('td', { class: 'n' }, pct ? '100 %' : fmtInt(p.total))),
      ),
    ),
  );
}

// ---------- Динамика ----------

export function dynSeries(state) {
  const mode = state.filters.dynMode;
  return state.view.dyn.series.filter((s) => (s.isTotal ? mode !== 'lines' : mode !== 'total'));
}

function renderDyn(actions, d) {
  const { state } = actions;
  const v = state.view;
  const box = $(`#${d.id}-box`);
  const series = dynSeries(state);
  const any = series.some((s) => s.cells.some((c) => c[d.metric].n > 0));
  if (!v.dyn.periods.length || !any) {
    destroyChart(box);
    if (!box.querySelector('.chart-empty')) box.append(h('div', { class: 'chart-empty' }, v.solved.length ? `Нет данных «${METRIC_SHORT[d.metric]}» за выбранный период` : 'Нет решённых задач по выбранным фильтрам'));
    box.querySelector('canvas').hidden = true;
  } else {
    box.querySelector('.chart-empty')?.remove();
    box.querySelector('canvas').hidden = false;
    renderLineChart(box, {
      metric: d.metric,
      periods: v.dyn.periods,
      series,
      stat: v.filters.metric,
      hidden: state.hidden[d.metric],
      onToggle: (k) => actions.toggleSeries(d.metric, k),
      dayHours: state.prep.dayHours,
      calendarMode: state.prep.calendarMode,
      smallN: state.settings.smallN,
    });
  }
  const tbox = clear($(`#${d.id}-table`));
  if (!v.dyn.periods.length) return;
  const m = d.metric;
  const dh = state.prep.dayHours;
  const cal = state.prep.calendarMode;
  const head1 = h('tr', { class: 'group' }, h('th', { rowspan: '2' }, 'Период'), series.map((s) => h('th', { colspan: '3' }, s.name)));
  const head2 = h('tr', null, series.map(() => [h('th', { class: 'n sep' }, 'n'), h('th', { class: 'n' }, 'среднее'), h('th', { class: 'n' }, 'медиана')]));
  const rows = v.dyn.periods.map((p, i) =>
    h(
      'tr',
      null,
      h('td', { title: p.incomplete ? `неполный период (${p.incompleteNote})` : '' }, p.label.replace(' — неполный период', ''), p.incomplete ? h('span', { class: 'badge-small' }, 'неполный') : null),
      series.map((s) => {
        const c = s.cells[i][m];
        if (!c.n) return [h('td', { class: 'n sep' }, '0'), h('td', { class: 'n nodata', colspan: '2' }, NO_DATA)];
        return [
          h('td', { class: 'n sep' }, fmtInt(c.n), c.n < state.settings.smallN ? h('span', { class: 'badge-small', title: 'малая выборка' }, 'мало') : null),
          h('td', { class: 'n', title: fmtFull(m, c.mean, cal) }, fmtAuto(m, c.mean, dh, cal)),
          h('td', { class: 'n', title: fmtFull(m, c.median, cal) }, fmtAuto(m, c.median, dh, cal)),
        ];
      }),
    ),
  );
  tbox.append(h('table', { class: 't' }, h('thead', null, head1, head2), h('tbody', null, rows)));
}

// ---------- Сводная таблица ----------

const SUM_COLS = [
  { key: 'solved', label: 'Решено', get: (r) => r.solved },
  ...METRICS.flatMap((m) => [
    { key: `${m}.mean`, metric: m, label: 'ср.', get: (r) => r[m].mean },
    { key: `${m}.median`, metric: m, label: 'мед.', get: (r) => r[m].median },
    { key: `${m}.n`, metric: m, label: 'n', get: (r) => r[m].n },
  ]),
];

function compare(a, b, dir) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return typeof a === 'string' ? dir * a.localeCompare(b, 'ru') : dir * (a - b);
}

function sortHeader(label, key, sortState, onSort, cls = 'n') {
  const active = sortState.col === key;
  return h(
    'th',
    {
      class: `${cls} sortable`,
      'aria-sort': active ? (sortState.dir > 0 ? 'ascending' : 'descending') : 'none',
      tabindex: '0',
      onclick: () => onSort(key),
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSort(key);
        }
      },
    },
    label,
    h('span', { class: 'sort-ind' }, active ? (sortState.dir > 0 ? '▲' : '▼') : ''),
  );
}

function renderSummary(actions) {
  const { state } = actions;
  const v = state.view;
  const box = clear($('#summaryTable'));
  const st = state.sort.summary;
  const dh = state.prep.dayHours;
  const cal = state.prep.calendarMode;
  const onSort = (key) => {
    if (st.col === key) st.dir = -st.dir;
    else {
      st.col = key;
      st.dir = key === 'name' ? 1 : -1;
    }
    renderSummary(actions);
  };
  const col = SUM_COLS.find((c) => c.key === st.col);
  const sorter = (a, b) => (st.col === 'name' ? compare(a.type ?? a.name, b.type ?? b.name, st.dir) : col ? compare(col.get(a), col.get(b), st.dir) : 0);
  let groups = v.summary.filter((g) => !g.isAll);
  const allGroup = v.summary.find((g) => g.isAll);
  if (st.col) groups = [...groups].sort((a, b) => sorter(a.head, b.head));

  const metricCells = (r) =>
    METRICS.map((m) => {
      const s = r[m];
      if (!s.n) return [h('td', { class: 'n sep nodata', colspan: '2' }, NO_DATA), h('td', { class: 'n' }, '0')];
      return [
        h('td', { class: 'n sep', title: fmtFull(m, s.mean, cal) }, fmtAuto(m, s.mean, dh, cal)),
        h('td', { class: 'n', title: fmtFull(m, s.median, cal) }, fmtAuto(m, s.median, dh, cal)),
        h('td', { class: 'n' }, fmtInt(s.n)),
      ];
    });
  const rowsOf = (g, isAll) => {
    const children = st.col ? [...g.children].sort(sorter) : g.children;
    return [
      h('tr', { class: `lvl0${isAll ? ' all' : ''}` }, h('td', null, isAll ? 'Все сотрудники' : g.head.name), h('td', { class: 'n' }, fmtInt(g.head.solved)), metricCells(g.head)),
      children.map((r) => h('tr', { class: `lvl1${isAll ? ' all' : ''}` }, h('td', null, r.type), h('td', { class: 'n' }, fmtInt(r.solved)), metricCells(r))),
    ];
  };
  if (!v.solved.length) {
    box.append(h('div', { class: 'muted' }, 'Нет решённых задач по выбранным фильтрам'));
    return;
  }
  const unit = (m) => (m === 'spent' ? 'мин' : cal ? 'кал. ч' : 'раб. ч');
  box.append(
    h(
      'table',
      { class: 't', id: 'summary' },
      h(
        'thead',
        null,
        h(
          'tr',
          { class: 'group' },
          sortHeader('Сотрудник → тип', 'name', st, onSort, ''),
          h('th', { rowspan: '1' }, ''),
          METRICS.map((m) => h('th', { colspan: '3', title: `Единица в подсказках: ${unit(m)}` }, METRIC_SHORT[m])),
        ),
        h(
          'tr',
          null,
          h('th', null, ''),
          sortHeader('Решено', 'solved', st, onSort),
          SUM_COLS.slice(1).map((c) => sortHeader(c.label, c.key, st, onSort, c.label === 'ср.' ? 'n sep' : 'n')),
        ),
      ),
      h('tbody', null, groups.map((g) => rowsOf(g, false)), allGroup ? rowsOf(allGroup, true) : null),
    ),
  );
}

// ---------- Выбросы ----------

const OUT_COLS = [
  { key: 'id', label: 'ID', get: (r) => (/^\d+$/.test(r.id) ? Number(r.id) : r.id), cls: '' },
  { key: 'type', label: 'Тип', get: (r) => r.type, cls: '' },
  { key: 'emp', label: 'Исполнитель', get: (r) => r.emp, cls: '' },
  { key: 'created', label: 'Создана', get: (r) => r.created, cls: '' },
  { key: 'closed', label: 'Закрыта', get: (r) => r.closed, cls: '' },
  { key: 'spent', label: 'Затрачено', get: (r) => r.spent },
  { key: 'a', label: 'В работе (а)', get: (r) => r.a },
  { key: 'b', label: 'Цикл (б)', get: (r) => r.b },
  { key: 'flags', label: 'Выброс по', get: (r) => r.flags.length, cls: '' },
];

function renderOutliers(actions) {
  const { state } = actions;
  const v = state.view;
  const box = clear($('#outliersTable'));
  const st = state.sort.outliers;
  const dh = state.prep.dayHours;
  const cal = state.prep.calendarMode;
  const counts = METRICS.map((m) => `${METRIC_SHORT[m]} — ${fmtInt(v.outliers.filter((o) => o.flags.includes(m)).length)}`).join(', ');
  $('#outliersNote').textContent = `${fmtInt(v.outliers.length)} ${plural(v.outliers.length, 'задача', 'задачи', 'задач')} (${counts}). Метод: ${outlierMethodText(state.settings)}. Таблица не зависит от переключателя «Исключать выбросы»; описание и клиентские поля не показываются.`;
  if (!v.outliers.length) {
    box.append(h('div', { class: 'muted' }, 'Выбросов в текущей выборке нет.'));
    return;
  }
  const onSort = (key) => {
    if (st.col === key) st.dir = -st.dir;
    else {
      st.col = key;
      st.dir = ['id', 'type', 'emp'].includes(key) ? 1 : -1;
    }
    renderOutliers(actions);
  };
  const col = OUT_COLS.find((c) => c.key === st.col) || OUT_COLS[4];
  const rows = [...v.outliers].sort((a, b) => compare(col.get(a), col.get(b), st.dir) || compare(a.closed, b.closed, -1));
  const metricCell = (r, m) => {
    const val = r[m];
    const flagged = r.flags.includes(m);
    const thr = r.thr[m];
    return h(
      'td',
      { class: `n${val == null ? ' nodata' : ''}${flagged ? ' flag' : ''}`, title: val == null ? NO_DATA : `${fmtFull(m, val, cal)}${flagged ? `; порог ${fmtFull(m, thr, cal)}` : ''}` },
      val == null ? '—' : fmtAuto(m, val, dh, cal),
    );
  };
  box.append(
    h(
      'table',
      { class: 't', id: 'outliers' },
      h('thead', null, h('tr', null, OUT_COLS.map((c) => sortHeader(c.label, c.key, st, onSort, c.cls ?? 'n')))),
      h(
        'tbody',
        null,
        rows.map((r) =>
          h(
            'tr',
            null,
            h('td', null, r.id),
            h('td', null, r.type),
            h('td', null, r.emp),
            h('td', { style: { whiteSpace: 'nowrap' } }, fmtDateTime(r.created)),
            h('td', { style: { whiteSpace: 'nowrap' } }, fmtDateTime(r.closed)),
            metricCell(r, 'spent'),
            metricCell(r, 'a'),
            metricCell(r, 'b'),
            h('td', null, r.flags.map((m) => METRIC_SHORT[m]).join(', ')),
          ),
        ),
      ),
    ),
  );
}

