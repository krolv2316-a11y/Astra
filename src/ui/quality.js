// Проверки качества данных: перечень предупреждений по файлу.

import { fmtInt, plural } from '../core/format.js';

const FIRST = 10;

function ids(list) {
  if (!list || !list.length) return '';
  const shown = list.slice(0, FIRST).join(', ');
  return list.length > FIRST ? `ID: ${shown} и ещё ${fmtInt(list.length - FIRST)}` : `ID: ${shown}`;
}

const tasksWord = (n) => plural(n, 'задача', 'задачи', 'задач');

/** [{ level: 'warn' | 'info', title, detail, ids }] */
/** titles = false — без исходных названий задач (для экспорта: в них бывают реквизиты клиентов). */
export function qualityIssues(prep, { titles = true } = {}) {
  const ds = prep.dataset;
  const pi = ds.parseIssues;
  const q = prep.quality;
  const out = [];
  const colNames = { created: 'Дата создания', started: 'Дата начала работы', closed: 'Дата закрытия' };
  for (const k of ['created', 'started', 'closed']) {
    const l = pi.badDates[k];
    if (l.length) out.push({ level: 'warn', title: `Нераспознанные значения в колонке «${colNames[k]}»: ${fmtInt(l.length)}`, detail: 'Значение считается отсутствующим.', ids: ids(l) });
  }
  if (pi.badDates.spent.length) {
    out.push({ level: 'warn', title: `Нераспознанные значения «Затрачено»: ${fmtInt(pi.badDates.spent.length)}`, detail: 'Ожидается формат Ч:ММ:СС; значение считается отсутствующим.', ids: ids(pi.badDates.spent) });
  }
  if (pi.duplicates.length) {
    const extra = pi.duplicates.reduce((s, d) => s + d.n - 1, 0);
    out.push({ level: 'warn', title: `Повторяющиеся ID: ${fmtInt(pi.duplicates.length)} (лишних строк: ${fmtInt(extra)})`, detail: 'Каждая строка считается отдельной задачей.', ids: ids(pi.duplicates.map((d) => d.id)) });
  }
  if (q.closedBeforeCreated.length) {
    out.push({ level: 'warn', title: `Закрытие раньше создания: ${fmtInt(q.closedBeforeCreated.length)} ${tasksWord(q.closedBeforeCreated.length)}`, detail: 'Учтены в количестве, исключены из показателей «В работе (а)» и «Цикл (б)».', ids: ids(q.closedBeforeCreated) });
  }
  if (q.closedBeforeStarted.length) {
    out.push({ level: 'warn', title: `Закрытие раньше начала работы: ${fmtInt(q.closedBeforeStarted.length)} ${tasksWord(q.closedBeforeStarted.length)}`, detail: 'Учтены в количестве, исключены из показателя «В работе (а)».', ids: ids(q.closedBeforeStarted) });
  }
  if (q.completedNoClose.length) {
    out.push({ level: 'warn', title: `Статус «Завершена» без даты закрытия: ${fmtInt(q.completedNoClose.length)}`, detail: 'Не считаются решёнными и не входят в очередь; учтены во «Всего задач».', ids: ids(q.completedNoClose) });
  }
  if (q.uncoveredYears.length) {
    out.push({ level: 'warn', title: `Праздничный календарь не покрывает ${q.uncoveredYears.length > 1 ? 'годы' : 'год'} ${q.uncoveredYears.join(', ')}`, detail: 'Для этих дат праздники не учитываются. Добавьте их в «Настройках справочников → Рабочий календарь».' });
  }
  if (pi.zeroSpent) {
    out.push({ level: 'info', title: `«Затрачено» = 00:00:00: ${fmtInt(pi.zeroSpent)} ${tasksWord(pi.zeroSpent)}`, detail: 'Учитываются как ноль (пустое значение — «нет данных»).' });
  }
  if (q.noExecutor) {
    out.push({ level: 'info', title: `Строк без исполнителя: ${fmtInt(q.noExecutor)}`, detail: 'Вне периметра, в расчётах не участвуют.' });
  }
  if (prep.hidden.tasks) {
    out.push({ level: 'info', title: `Скрыто через настройки типов: ${fmtInt(prep.hidden.tasks)} ${tasksWord(prep.hidden.tasks)}`, detail: titles ? prep.hidden.titles.map((t) => `«${t.title}» — ${fmtInt(t.n)}`).join('; ') : `Скрытых исходных названий: ${fmtInt(prep.hidden.titles.length)}.` });
  }
  return out;
}
