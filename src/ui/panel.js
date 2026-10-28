// Левая панель: фильтры и режимы показа. Применяются мгновенно.

import { h, clear, $ } from './dom.js';
import { fmtInt } from '../core/format.js';
import { fmtDay, parseDayText, monthBounds, monthKeyOfDay, MONTHS_FULL } from '../core/dates.js';
import { typeColor, seriesColor } from './charts.js';
import { renderSettings } from './settings-ui.js';
import { outlierShort } from './caption.js';

let builtFor = undefined;

function seg(name, options, current, onPick) {
  return h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': name, dataset: { seg: name } },
    options.map(([value, label, title]) =>
      h('button', { type: 'button', 'aria-pressed': String(value === current), dataset: { value }, title: title || label, onclick: () => onPick(value) }, label),
    ),
  );
}

function updateSeg(root, name, current) {
  const el = root.querySelector(`[data-seg="${name}"]`);
  if (!el) return;
  for (const b of el.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === current));
}

function checklist(id, items, getSelected, setSelected, { other = null } = {}) {
  const list = h('div', { class: 'checklist', id });
  for (const it of items) {
    const cb = h('input', {
      type: 'checkbox',
      onchange: () => {
        const all = items.map((x) => x.key);
        const sel = getSelected();
        const cur = new Set(sel || all);
        if (cb.checked) cur.add(it.key);
        else cur.delete(it.key);
        setSelected(cur.size === all.length ? null : cur);
      },
    });
    const row = h(
      'label',
      { class: `check${it.key === other ? ' other' : ''}`, dataset: { key: it.key }, title: it.title || it.name },
      cb,
      h('span', { class: 'label' }, it.swatch ? h('span', { class: 'swatch', style: { background: it.swatch } }) : null, it.name),
      h('span', { class: 'count' }, ''),
    );
    list.append(row);
  }
  return list;
}

function refreshChecklist(root, id, selected, counts) {
  const list = root.querySelector(`#${id}`);
  if (!list) return;
  for (const row of list.children) {
    const key = row.dataset.key;
    const n = counts.get(key) || 0;
    row.querySelector('input').checked = !selected || selected.has(key);
    row.querySelector('.count').textContent = fmtInt(n);
    row.classList.toggle('zero', n === 0);
  }
}

function section(title, links, ...content) {
  return h('section', { class: 'panel-sec' }, h('h3', null, h('span', null, title), links ? h('span', { class: 'links' }, links) : null), ...content);
}

/** Полная перерисовка панели: фильтры и блок настроек справочников. */
export function renderPanel(actions) {
  const panel = clear($('#panel'));
  panel.append(h('div', { id: 'filters' }), renderSettings(actions));
  renderFilters(actions);
}

/** Перерисовка только фильтров (блок настроек не трогаем, чтобы не сбивать ввод). */
function renderFilters(actions) {
  const { state } = actions;
  const prep = state.prep;
  const f = state.filters;
  const root = clear($('#filters'));
  builtFor = prep;

  const setF = (patch) => actions.setFilter(patch);
  const noData = (text) => h('div', { class: 'panel-note' }, text);

  // 1. Сотрудники
  if (prep) {
    const emps = prep.employees.map((e) => ({ key: e.key, name: e.name, title: e.originals.join(', '), swatch: seriesColor(e.colorIdx) }));
    root.append(
      section(
        'Сотрудники',
        [h('button', { class: 'linkbtn', type: 'button', onclick: () => setF({ employees: null }) }, 'Выбрать всех'), h('button', { class: 'linkbtn', type: 'button', onclick: () => setF({ employees: new Set() }) }, 'Сбросить')],
        checklist('empList', emps, () => state.filters.employees, (v) => setF({ employees: v })),
        h('div', { class: 'panel-note' }, 'Число — решённые задачи с учётом остальных фильтров.'),
      ),
    );
    const otherType = prep.types.find((t) => t.isOther);
    const types = prep.types.map((t) => ({
      key: t.key,
      name: t.name,
      swatch: typeColor(t),
      title: t.isOther ? `Типы, у которых во всей выборке не более ${state.settings.otherThreshold} задач:\n${t.members.join('\n')}` : t.members.length > 1 ? `Объединены:\n${t.members.join('\n')}` : t.name,
    }));
    root.append(
      section(
        'Типы задач',
        [h('button', { class: 'linkbtn', type: 'button', onclick: () => setF({ types: null }) }, 'Выбрать все'), h('button', { class: 'linkbtn', type: 'button', onclick: () => setF({ types: new Set() }) }, 'Сбросить')],
        checklist('typeList', types, () => state.filters.types, (v) => setF({ types: v }), { other: otherType ? otherType.key : null }),
        otherType ? h('div', { class: 'panel-note' }, `«Прочие» — типы, у которых во всей выборке не более ${state.settings.otherThreshold} задач (${otherType.members.length} шт.). Наведите курсор, чтобы увидеть список.`) : null,
      ),
    );
  } else {
    root.append(section('Сотрудники', null, noData('Появятся после загрузки файла.')), section('Типы задач', null, noData('Появятся после загрузки файла.')));
  }

  // 3. Период (поля в формате дд.мм.гггг независимо от языка браузера)
  const dateInput = (id, label, key) => {
    const input = h('input', {
      type: 'text',
      id,
      placeholder: 'дд.мм.гггг',
      inputmode: 'numeric',
      autocomplete: 'off',
      'aria-label': label,
      disabled: !prep,
      onchange: (e) => {
        const raw = e.target.value.trim();
        if (!raw) {
          e.target.classList.remove('invalid');
          return setF({ [key]: null });
        }
        const d = parseDayText(raw);
        if (d == null) {
          e.target.classList.add('invalid');
          actions.toast('Введите дату в формате дд.мм.гггг');
          return;
        }
        e.target.classList.remove('invalid');
        setF({ [key]: d });
      },
      onkeydown: (e) => {
        if (e.key === 'Enter') e.target.blur();
      },
    });
    return input;
  };
  const quick = h('select', {
    id: 'periodQuick',
    'aria-label': 'Быстрый выбор периода',
    disabled: !prep || prep.minCloseDay == null,
    onchange: (e) => {
      const val = e.target.value;
      e.target.value = '';
      if (val === 'all') return setF({ from: null, to: null });
      const key = Number(val);
      if (!Number.isFinite(key)) return;
      const b = monthBounds(key);
      setF({ from: Math.max(b.start, prep.minCloseDay), to: Math.min(b.end, prep.maxCloseDay) });
    },
  });
  quick.append(h('option', { value: '' }, 'Быстрый выбор…'), h('option', { value: 'all' }, 'Весь период'));
  if (prep && prep.minCloseDay != null) {
    for (let k = monthKeyOfDay(prep.maxCloseDay); k >= monthKeyOfDay(prep.minCloseDay); k--) {
      const b = monthBounds(k);
      const partial = prep.sliceDay != null && prep.sliceDay < b.end;
      quick.append(h('option', { value: String(k) }, `${MONTHS_FULL[b.m - 1][0].toUpperCase()}${MONTHS_FULL[b.m - 1].slice(1)} ${b.y}${partial ? ' (неполный)' : ''}`));
    }
  }
  root.append(
    section(
      'Период по дате закрытия',
      [h('button', { class: 'linkbtn', type: 'button', onclick: () => setF({ from: null, to: null }) }, 'Весь период')],
      h('div', { class: 'daterow' }, h('span', null, 'с'), dateInput('periodFrom', 'Дата закрытия с', 'from'), h('span', null, 'по'), dateInput('periodTo', 'Дата закрытия по', 'to'), h('span', null, ''), quick),
      h('div', { class: 'panel-note', id: 'periodNote' }, ''),
    ),
  );

  // 4. Постановщик
  root.append(
    section(
      'Постановщик',
      null,
      seg('author', [['all', 'Все'], ['bots', 'Только боты'], ['nobots', 'Без ботов']], f.author, (v) => setF({ author: v })),
      h('div', { class: 'panel-note', id: 'botNote' }, ''),
    ),
  );
  // 5–7. Динамика
  root.append(
    section('Динамика по сотрудникам', null, seg('dynMode', [['lines', 'Линиями', 'Отдельная линия на каждого сотрудника'], ['total', 'Итого', 'Одна линия по всем выбранным сотрудникам'], ['both', 'Вместе', 'Линии сотрудников и итого']], f.dynMode, (v) => setF({ dynMode: v }))),
    section('Шаг динамики', null, seg('step', [['month', 'Месяцы'], ['week', 'Недели']], f.step, (v) => setF({ step: v }))),
    section('Метрика на графиках динамики', null, seg('metric', [['mean', 'Среднее'], ['median', 'Медиана']], f.metric, (v) => setF({ metric: v }))),
  );
  // 8. Выбросы
  const sw = h('input', { type: 'checkbox', id: 'excludeOutliers', role: 'switch', onchange: (e) => setF({ excludeOutliers: e.target.checked }) });
  root.append(
    section(
      'Выбросы',
      null,
      h('label', { class: 'switch' }, sw, h('span', null, 'Исключать выбросы из расчётов')),
      h('div', { class: 'panel-note', id: 'outlierNote' }, ''),
    ),
  );

  refreshPanel(actions);
}

export function refreshPanel(actions) {
  const { state } = actions;
  if (!$('#filters')) return renderPanel(actions);
  if (builtFor !== state.prep) return renderFilters(actions);
  const root = $('#filters');
  const f = state.filters;
  const v = state.view;
  const prep = state.prep;
  if (prep && v) {
    refreshChecklist(root, 'empList', f.employees, v.empCounts);
    refreshChecklist(root, 'typeList', f.types, v.typeCounts);
  }
  const fromI = $('#periodFrom', root);
  const toI = $('#periodTo', root);
  for (const [el, val] of [[fromI, f.from], [toI, f.to]]) {
    if (el && document.activeElement !== el) {
      el.value = val != null ? fmtDay(val) : '';
      el.classList.remove('invalid');
    }
  }
  const pn = $('#periodNote', root);
  if (pn) {
    let text = prep && prep.minCloseDay != null ? `Закрытия в файле: ${fmtDay(prep.minCloseDay)} – ${fmtDay(prep.maxCloseDay)}. ` : '';
    text += 'Задачи в очереди отбираются по дате создания.';
    if (f.from != null && f.to != null && f.from > f.to) text = 'Начало периода позже конца — задач нет. ' + text;
    pn.textContent = text;
  }
  for (const k of ['author', 'dynMode', 'step', 'metric']) updateSeg(root, k, f[k]);
  const bn = $('#botNote', root);
  if (bn) {
    const bots = state.settings.bots;
    const n = prep ? prep.tasks.filter((t) => t.isBot).length : null;
    bn.textContent = bots.length ? `Боты: ${bots.join(', ')}${n != null ? ` — ${fmtInt(n)} задач в файле` : ''}. Список — в настройках справочников.` : 'Список ботов пуст — задайте его в настройках справочников.';
  }
  const sw = $('#excludeOutliers', root);
  if (sw) sw.checked = !!f.excludeOutliers;
  const on = $('#outlierNote', root);
  if (on) on.textContent = `Метод: ${outlierShort(state.settings)}. Пороги считаются по всей загруженной выборке и не зависят от фильтров. Задачи-выбросы всегда видны в отдельной таблице.`;
}

