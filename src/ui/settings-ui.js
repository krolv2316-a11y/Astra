// Блок «Настройки справочников» в левой панели.

import { h, icon, debounce, downloadBlob } from './dom.js';
import { REQUIRED, normKey, normSpaces } from '../core/parse.js';
import { serializeSettings, parseSettingsJson, normalizeSettings } from '../core/settings.js';
import { fmtDay, parseDayText, isoDay, parseIsoDay } from '../core/dates.js';
import { fmtInt } from '../core/format.js';

let openState = { root: false };

function clone(s) {
  return normalizeSettings(JSON.parse(JSON.stringify(s)));
}

/** «01.01.2026, 05.01.2026–09.01.2026» → массив ISO-дат. Возвращает { days, bad }. */
export function parseDayList(text) {
  const days = new Set();
  const bad = [];
  for (const raw of String(text).split(/[\n,;]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const range = part.split(/\s*[–—-]\s*(?=\d{1,2}\.\d{1,2}\.\d{4}$)/);
    if (range.length === 2) {
      const a = parseDayText(range[0]);
      const b = parseDayText(range[1]);
      if (a == null || b == null || b < a || b - a > 366) {
        bad.push(part);
        continue;
      }
      for (let d = a; d <= b; d++) days.add(isoDay(d));
    } else {
      const d = parseDayText(part);
      if (d == null) bad.push(part);
      else days.add(isoDay(d));
    }
  }
  return { days: [...days].sort(), bad };
}

/** Компактная запись: подряд идущие дни — диапазоном. */
export function formatDayList(list) {
  const ds = list.map(parseIsoDay).filter((d) => d != null).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < ds.length; i++) {
    let j = i;
    while (j + 1 < ds.length && ds[j + 1] === ds[j] + 1) j++;
    out.push(j - i >= 2 ? `${fmtDay(ds[i])}–${fmtDay(ds[j])}` : j > i ? `${fmtDay(ds[i])}\n${fmtDay(ds[j])}` : fmtDay(ds[i]));
    i = j;
  }
  return out.join('\n');
}

function sec(title, ...content) {
  return h('div', { class: 'set-sec' }, h('h4', null, title), ...content);
}

export function renderSettings(actions) {
  const { state } = actions;
  const prep = state.prep;
  // Правки копятся и применяются пачкой: быстрый ввод в разные поля не теряется.
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    const list = pending;
    pending = [];
    const s = clone(state.settings);
    for (const m of list) m(s);
    actions.setSettings(s);
  };
  const flushLater = debounce(flush, 400);
  const apply = (mutate) => {
    pending.push(mutate);
    flush();
  };
  const applyLater = (mutate) => {
    pending.push(mutate);
    flushLater();
  };

  const body = h('div', { class: 'settings-body' });

  // Сотрудники
  const empKeyIn = (obj, name) => Object.keys(obj).find((x) => normKey(x) === normKey(name)) ?? name;
  if (prep) {
    const originals = [...new Set(prep.dataset.tasks.map((t) => t.executor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    body.append(
      sec(
        'Сотрудники: исходное ФИО → отображаемое имя',
        originals.map((orig) =>
          h(
            'div',
            { class: 'map-item' },
            h('div', { class: 'orig' }, h('b', null, orig)),
            h('input', {
              type: 'text',
              value: state.settings.employees[empKeyIn(state.settings.employees, orig)] || '',
              placeholder: orig,
              'aria-label': `Отображаемое имя для ${orig}`,
              oninput: (e) =>
                applyLater((s) => {
                  const v = normSpaces(e.target.value);
                  const k = empKeyIn(s.employees, orig);
                  if (v) s.employees[k] = v;
                  else delete s.employees[k];
                }),
            }),
          ),
        ),
        h('p', { class: 'hint' }, 'Одинаковые отображаемые имена объединяются в одного сотрудника.'),
      ),
    );

    // Типы задач
    const counts = new Map();
    for (const t of prep.dataset.tasks) if (t.executor) counts.set(t.title, (counts.get(t.title) || 0) + 1);
    const titles = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b, 'ru'));
    // Ключ настроек ищем без учёта регистра и лишних пробелов — так же, как при расчёте.
    const keyIn = (obj, title) => Object.keys(obj).find((x) => normKey(x) === normKey(title)) ?? title;
    const typeCfg = (s, title) => {
      const k = keyIn(s.types, title);
      return s.types[k] || (s.types[k] = { display: '', group: '', hidden: false });
    };
    const cleanup = (s, title) => {
      const k = keyIn(s.types, title);
      const e = s.types[k];
      if (e && !e.display && !e.group && !e.hidden) delete s.types[k];
    };
    const cfgOf = (title) => {
      const k = normKey(title);
      const key = Object.keys(state.settings.types).find((x) => normKey(x) === k);
      return (key && state.settings.types[key]) || { display: '', group: '', hidden: false };
    };
    body.append(
      sec(
        'Типы задач',
        h(
          'div',
          { class: 'inline-grid' },
          h('label', { for: 'otherN' }, 'Порог «Прочие», N'),
          h('input', {
            id: 'otherN',
            type: 'number',
            min: '0',
            step: '1',
            value: String(state.settings.otherThreshold),
            oninput: (e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 0) applyLater((s) => (s.otherThreshold = Math.round(n)));
            },
          }),
        ),
        h('p', { class: 'hint' }, 'Типы, у которых во всей выборке не более N задач, объединяются в «Прочие». 0 — не объединять.'),
        h(
          'div',
          { class: 'inline-grid' },
          h('label', { for: 'smallN' }, 'Малая выборка: n <'),
          h('input', {
            id: 'smallN',
            type: 'number',
            min: '1',
            step: '1',
            value: String(state.settings.smallN),
            oninput: (e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 1) applyLater((s) => (s.smallN = Math.round(n)));
            },
          }),
        ),
        h('p', { class: 'hint' }, 'Точки динамики с меньшим числом наблюдений рисуются полым маркером.'),
        titles.map((title) => {
          const c = cfgOf(title);
          return h(
            'div',
            { class: 'map-item' },
            h('div', { class: 'orig' }, h('b', null, title), ` · ${fmtInt(counts.get(title))}`),
            h('input', {
              type: 'text',
              value: c.display,
              placeholder: 'Отображаемое название',
              'aria-label': `Отображаемое название для ${title}`,
              oninput: (e) =>
                applyLater((s) => {
                  typeCfg(s, title).display = normSpaces(e.target.value);
                  cleanup(s, title);
                }),
            }),
            h(
              'div',
              { class: 'map-row' },
              h('input', {
                type: 'text',
                value: c.group,
                placeholder: 'Группа (для объединения)',
                'aria-label': `Группа для ${title}`,
                list: 'typeGroups',
                oninput: (e) =>
                  applyLater((s) => {
                    typeCfg(s, title).group = normSpaces(e.target.value);
                    cleanup(s, title);
                  }),
              }),
              h(
                'label',
                null,
                h('input', {
                  type: 'checkbox',
                  checked: !!c.hidden,
                  onchange: (e) =>
                    apply((s) => {
                      typeCfg(s, title).hidden = e.target.checked;
                      cleanup(s, title);
                    }),
                }),
                'скрыть',
              ),
            ),
          );
        }),
        h('datalist', { id: 'typeGroups' }, [...new Set(Object.values(state.settings.types).map((t) => t.group).filter(Boolean))].map((g) => h('option', { value: g }))),
        h('p', { class: 'hint' }, 'Типы с одинаковой группой объединяются в один. «Скрыть» исключает задачи типа из всех расчётов.'),
      ),
    );
  } else {
    body.append(
      sec('Сотрудники и типы задач', h('p', { class: 'hint' }, 'Списки появятся после загрузки файла. Сохранённые переименования применятся автоматически к файлу с теми же исходными названиями.')),
      sec(
        'Порог «Прочие», N',
        h('input', {
          type: 'number',
          min: '0',
          value: String(state.settings.otherThreshold),
          oninput: (e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 0) applyLater((s) => (s.otherThreshold = Math.round(n)));
          },
        }),
      ),
    );
  }

  // Боты
  const authorCounts = new Map();
  if (prep) for (const t of prep.dataset.tasks) if (t.author) authorCounts.set(t.author, (authorCounts.get(t.author) || 0) + 1);
  const topAuthors = [...authorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const botsArea = h('textarea', {
    rows: '3',
    'aria-label': 'Постановщики-боты, по одному в строке',
    oninput: (e) =>
      applyLater((s) => {
        s.bots = e.target.value.split('\n').map((x) => normSpaces(x)).filter(Boolean);
      }),
  });
  botsArea.value = state.settings.bots.join('\n');
  body.append(
    sec(
      'Постановщики-боты',
      botsArea,
      h('p', { class: 'hint' }, 'По одному в строке, регистр не важен.'),
      topAuthors.length
        ? h(
            'p',
            { class: 'hint' },
            'Частые постановщики в файле: ',
            topAuthors.map(([a, n], i) => [
              i ? ', ' : '',
              h(
                'button',
                {
                  class: 'linkbtn',
                  type: 'button',
                  title: 'Добавить в список ботов',
                  onclick: () =>
                    apply((s) => {
                      if (!s.bots.some((b) => normKey(b) === normKey(a))) s.bots.push(a);
                    }),
                },
                a,
              ),
              ` (${fmtInt(n)})`,
            ]),
          )
        : null,
    ),
  );

  // Рабочий календарь
  const cal = state.settings.calendar;
  const holArea = h('textarea', { rows: '5', 'aria-label': 'Праздничные дни' });
  holArea.value = formatDayList(cal.holidays);
  const holNote = h('p', { class: 'hint' }, 'Даты дд.мм.гггг по одной в строке или через запятую; диапазон: 05.01.2026–09.01.2026.');
  holArea.addEventListener('input', () => {
    const { days, bad } = parseDayList(holArea.value);
    holNote.textContent = bad.length ? `Не распознано: ${bad.join(', ')}` : `Праздничных дней: ${days.length}.`;
    if (!bad.length) applyLater((s) => (s.calendar.holidays = days));
  });
  const wdArea = h('textarea', { rows: '2', 'aria-label': 'Рабочие выходные дни' });
  wdArea.value = formatDayList(cal.workdays);
  wdArea.addEventListener('input', () => {
    const { days, bad } = parseDayList(wdArea.value);
    if (!bad.length) applyLater((s) => (s.calendar.workdays = days));
  });
  const timeInput = (key, label) =>
    h('input', {
      type: 'time',
      value: cal[key],
      'aria-label': label,
      onchange: (e) => apply((s) => (s.calendar[key] = e.target.value)),
    });
  const modeSel = h(
    'select',
    { 'aria-label': 'Режим часов', onchange: (e) => apply((s) => (s.calendar.mode = e.target.value)) },
    h('option', { value: 'work', selected: cal.mode === 'work' }, 'рабочие часы'),
    h('option', { value: 'calendar', selected: cal.mode === 'calendar' }, 'календарные часы'),
  );
  body.append(
    sec(
      'Рабочий календарь',
      h('div', { class: 'inline-grid' }, h('span', null, 'Начало дня'), timeInput('dayStart', 'Начало рабочего дня'), h('span', null, 'Конец дня'), timeInput('dayEnd', 'Конец рабочего дня'), h('span', null, 'Считать'), modeSel),
      h('p', { class: 'hint' }, 'Будни без перерыва; выходные и праздники не учитываются. Календарные часы — простая разница дат.'),
      h('h4', { style: { marginTop: '8px' } }, 'Праздники'),
      holArea,
      holNote,
      h('h4', { style: { marginTop: '8px' } }, 'Перенесённые рабочие дни (сб/вс)'),
      wdArea,
    ),
  );

  // Выбросы
  const o = state.settings.outliers;
  const numIn = (value, onSet, attrs = {}) =>
    h('input', {
      type: 'number',
      value: String(value),
      step: 'any',
      ...attrs,
      oninput: (e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) applyLater((s) => onSet(s, n));
      },
    });
  const unitSel = (metric, units) =>
    h(
      'select',
      { 'aria-label': 'Единица порога', onchange: (e) => apply((s) => (s.outliers.manual[metric].unit = e.target.value)) },
      units.map(([v, l]) => h('option', { value: v, selected: o.manual[metric].unit === v }, l)),
    );
  const methodSel = h(
    'select',
    { 'aria-label': 'Метод выбросов', onchange: (e) => apply((s) => (s.outliers.method = e.target.value)) },
    h('option', { value: 'percentile', selected: o.method === 'percentile' }, 'Перцентиль P внутри типа'),
    h('option', { value: 'iqr', selected: o.method === 'iqr' }, 'Q3 + k × IQR внутри типа'),
    h('option', { value: 'manual', selected: o.method === 'manual' }, 'Ручной порог'),
  );
  body.append(
    sec(
      'Выбросы',
      methodSel,
      h(
        'div',
        { class: 'inline-grid', style: { marginTop: '6px' } },
        h('span', null, 'P'),
        numIn(o.p, (s, n) => (s.outliers.p = n), { min: '50', max: '99.99' }),
        h('span', null, 'k'),
        numIn(o.k, (s, n) => (s.outliers.k = n), { min: '0.5' }),
        h('span', null, 'Мин. задач в типе'),
        numIn(o.minGroup, (s, n) => (s.outliers.minGroup = Math.round(n)), { min: '1', step: '1' }),
      ),
      h('p', { class: 'hint' }, 'Выброс — значение строго больше порога. Если в типе меньше указанного числа значений, берётся порог по всей выборке.'),
      h('h4', { style: { marginTop: '8px' } }, 'Ручные пороги'),
      h(
        'div',
        { class: 'inline-grid' },
        h('span', null, 'Затрачено >'),
        h('div', { class: 'map-row' }, numIn(o.manual.spent.value, (s, n) => (s.outliers.manual.spent.value = n), { min: '0' }), unitSel('spent', [['min', 'мин'], ['hour', 'ч']])),
        h('span', null, 'В работе (а) >'),
        h('div', { class: 'map-row' }, numIn(o.manual.a.value, (s, n) => (s.outliers.manual.a.value = n), { min: '0' }), unitSel('a', [['hour', 'ч'], ['day', 'дн.']])),
        h('span', null, 'Цикл (б) >'),
        h('div', { class: 'map-row' }, numIn(o.manual.b.value, (s, n) => (s.outliers.manual.b.value = n), { min: '0' }), unitSel('b', [['hour', 'ч'], ['day', 'дн.']])),
      ),
    ),
  );

  // Колонки файла
  const found = prep ? prep.dataset.headers : state.loadError && state.loadError.error.found ? state.loadError.error.found : [];
  body.append(
    sec(
      'Колонки файла',
      h('p', { class: 'hint', style: { marginTop: 0 } }, 'Если в выгрузке колонка называется иначе, укажите её заголовок. Пусто — стандартное имя.'),
      h(
        'div',
        { class: 'inline-grid' },
        REQUIRED.map(({ key, header }) => [
          h('span', null, header),
          h('input', {
            type: 'text',
            value: state.settings.columns[key] || '',
            placeholder: header,
            list: 'foundHeaders',
            'aria-label': `Заголовок колонки «${header}» в файле`,
            oninput: (e) =>
              applyLater((s) => {
                const v = normSpaces(e.target.value);
                if (v) s.columns[key] = v;
                else delete s.columns[key];
              }),
          }),
        ]),
      ),
      h('datalist', { id: 'foundHeaders' }, found.map((x) => h('option', { value: x }))),
      h('p', { class: 'hint' }, 'Сопоставление применяется при следующей загрузке файла.'),
    ),
  );

  // Кнопки
  const importInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    hidden: true,
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const s = parseSettingsJson(await file.text());
        actions.setSettings(s, { rerenderPanel: true });
        actions.toast('Настройки импортированы');
      } catch (err) {
        actions.toast(err.message);
      }
    },
  });
  body.append(
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn small', type: 'button', onclick: () => {
        if (window.confirm('Сбросить все настройки справочников к значениям по умолчанию?')) actions.resetSettings();
      } }, 'Сбросить к умолчанию'),
      h('button', { class: 'btn small', type: 'button', onclick: () => downloadBlob(new Blob([serializeSettings(state.settings)], { type: 'application/json' }), 'osp-dashboard-settings.json') }, 'Экспорт настроек (JSON)'),
      h('button', { class: 'btn small', type: 'button', onclick: () => importInput.click() }, 'Импорт настроек (JSON)'),
      importInput,
    ),
    h('p', { class: 'storage-note' }, state.storageOk ? 'Настройки сохраняются в этом браузере (только настройки, не данные файла).' : 'Хранилище браузера недоступно (например, приватный режим): настройки действуют до закрытия страницы. Используйте экспорт в JSON.'),
  );

  const details = h(
    'details',
    { class: 'settings', open: openState.root, ontoggle: (e) => (openState.root = e.target.open) },
    h('summary', null, h('span', { class: 'icon-wrap' }, icon('gear')), 'Настройки справочников', icon('chevron', 'chev')),
    body,
  );
  return details;
}
