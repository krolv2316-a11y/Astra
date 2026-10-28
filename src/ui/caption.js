// Подписи фильтров и методов — для графиков, PNG и Excel.

import { fmtDay } from '../core/dates.js';
import { fmtNum } from '../core/format.js';

export function periodText(prep, f) {
  const from = f.from ?? prep.minCloseDay;
  const to = f.to ?? prep.maxCloseDay;
  if (from == null || to == null) return 'нет решённых задач';
  return `${fmtDay(from)} – ${fmtDay(to)}`;
}

function listText(all, selected, noun) {
  if (!selected) return `все (${all.length})`;
  if (selected.size === 0) return 'не выбраны';
  const names = all.filter((x) => selected.has(x.key)).map((x) => x.name);
  if (names.length === all.length) return `все (${all.length})`;
  if (names.length <= 3) return names.join(', ');
  return `${names.length} из ${all.length} ${noun}`;
}

export const AUTHOR_TEXT = { all: 'все', bots: 'только боты', nobots: 'без ботов' };
export const DYN_TEXT = { lines: 'отдельными линиями', total: 'итого', both: 'линии и итого' };
export const STEP_TEXT = { month: 'месяцы', week: 'недели' };
export const STAT_TEXT = { mean: 'среднее', median: 'медиана' };

export function outlierMethodText(settings) {
  const o = settings.outliers;
  if (o.method === 'iqr') return `Q3 + ${fmtNum(o.k, 1)}×IQR внутри типа (тип < ${o.minGroup} значений — порог по всей выборке)`;
  if (o.method === 'manual') {
    const m = o.manual;
    const u = { min: 'мин', hour: 'ч', day: 'дн.' };
    return `ручной порог: Затрачено > ${fmtNum(m.spent.value, 1)} ${u[m.spent.unit]}, (а) > ${fmtNum(m.a.value, 1)} ${u[m.a.unit]}, (б) > ${fmtNum(m.b.value, 1)} ${u[m.b.unit]}`;
  }
  return `больше ${fmtNum(o.p, o.p % 1 ? 1 : 0)}-го перцентиля внутри типа (тип < ${o.minGroup} значений — порог по всей выборке)`;
}

export function outlierShort(settings) {
  const o = settings.outliers;
  if (o.method === 'iqr') return `IQR×${fmtNum(o.k, 1)}`;
  if (o.method === 'manual') return 'ручной порог';
  return `P${fmtNum(o.p, o.p % 1 ? 1 : 0)} по типу`;
}

export function hoursText(settings) {
  const c = settings.calendar;
  return c.mode === 'calendar' ? 'календарные часы' : `рабочие часы ${c.dayStart}–${c.dayEnd}, пн–пт, без праздников`;
}

/** Части подписи фильтров: [[название, значение], ...]. */
export function filterParts(state) {
  const { prep, filters: f, settings } = state;
  return [
    ['Сотрудники', listText(prep.employees, f.employees, 'сотрудников')],
    ['Типы', listText(prep.types, f.types, 'типов')],
    ['Период закрытия', periodText(prep, f)],
    ['Постановщик', AUTHOR_TEXT[f.author]],
    ['Выбросы', f.excludeOutliers ? `исключены (${outlierShort(settings)})` : `учтены (${outlierShort(settings)})`],
    ['Часы', settings.calendar.mode === 'calendar' ? 'календарные' : 'рабочие'],
  ];
}

export function filterCaption(state) {
  return filterParts(state)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}

export function sliceText(prep) {
  return prep.sliceDay != null ? `срез на ${fmtDay(prep.sliceDay)}` : 'срез не определён';
}
