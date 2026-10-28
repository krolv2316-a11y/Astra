// Генератор синтетической выгрузки той же структуры, что и реальная (39 колонок).
// Имена, тексты и ИНН вымышленные. Используется в автотестах и для e2e-проверки.

import { buildXlsx } from '../src/core/xlsx-write.js';
import { wallFromParts, wallToExcelSerial, dayIndex, dowOfDay } from '../src/core/dates.js';

export const HEADERS = [
  'ID', 'Название', 'Описание', 'Стадия канбана', 'Статус', 'Постановщик', 'Исполнитель', 'Соисполнители',
  'Наблюдатели', 'Дата создания', 'Дата начала работы', 'Дата закрытия', 'Крайний срок', 'Затрачено',
  'Плановая длительность', 'Приоритет', 'Проект', 'Теги', 'Компания', 'ИНН клиента', 'Лид', 'Сделка', 'CRM',
  'Контакт', 'Регион', 'Канал', 'Источник', 'Сумма', 'Валюта', 'Комментарии', 'Оценка', 'Чек-лист',
  'Дата изменения', 'Изменил', 'Родительская задача', 'Подзадачи', 'Учёт времени', 'Результат', 'Файлы',
];

export const EMPLOYEES = ['Иванова Анна', 'Петрова Мария', 'Сидоров Илья'];
export const BOT = 'Астра Бот(ОПиК)';
const HUMANS = ['Орлов Пётр', 'Смирнова Елена', 'Кузнецов Олег'];

export const TYPES = [
  { title: 'Произвести распределение лида', w: 60, spent: [0.5, 4], work: [0.005, 0.2] },
  { title: 'Произвести верификацию Клиента', w: 15, spent: [1, 6], work: [0.01, 2] },
  { title: 'Создать регистрацию сделки в 1С', w: 6, spent: [2, 15], work: [1, 30] },
  { title: 'Авторизация партнера', w: 3, spent: [5, 25], work: [0.05, 4] },
];
const RARE = [
  { title: 'Произвести регистрацию заявки партнера', n: 6, spent: [1, 5], work: [0.05, 0.2] },
  { title: 'ТЕСТ Произвести верификацию Клиента', n: 1, spent: [1, 2], work: [0.01, 0.1] },
  { title: 'Проверить дубли контрагента', n: 3, spent: [5, 40], work: [1, 20] },
  { title: 'Обновить реквизиты клиента', n: 2, spent: [5, 40], work: [1, 20] },
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const p2 = (n) => String(n).padStart(2, '0');

export function fmtWallText(ws) {
  const d = new Date(ws * 1000);
  return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

export function fmtSpentText(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${p2(h)}:${p2(m)}:${p2(s)}`;
}

/**
 * Генерирует задачи. Возвращает массив «истины»: значения, из которых строится файл.
 * opts.anomalies — добавить аномалии для блока качества данных.
 */
export function generateTasks({ n = 1200, seed = 7, anomalies = true } = {}) {
  const r = rng(seed);
  const uni = (a, b) => a + (b - a) * r();
  const logUni = (a, b) => Math.exp(uni(Math.log(a), Math.log(b)));
  const start = wallFromParts(2026, 1, 12, 9, 0, 0);
  const end = wallFromParts(2026, 10, 28, 17, 0, 0);
  const tasks = [];
  const totalW = TYPES.reduce((s, t) => s + t.w, 0);
  let id = 30000;

  const makeTask = (type) => {
    id += 1 + Math.floor(r() * 3);
    let created = Math.floor(uni(start, end));
    // В основном рабочее время.
    const di = dayIndex(created);
    if (dowOfDay(di) >= 5 && r() < 0.8) created += (7 - dowOfDay(di)) * 86400;
    const tod = created % 86400;
    if (tod < 8 * 3600 || tod > 19 * 3600) created = di * 86400 + Math.floor(uni(9, 18) * 3600);
    if (created > end) created = end - Math.floor(r() * 86400 * 3);
    const month = new Date(created * 1000).getUTCMonth() + 1;
    // Третий сотрудник появляется с июня.
    const emps = month >= 6 ? EMPLOYEES : EMPLOYEES.slice(0, 2);
    const executor = emps[Math.floor(r() * emps.length)];
    const author = r() < 0.7 ? BOT : HUMANS[Math.floor(r() * HUMANS.length)];
    const delay = Math.floor(logUni(60, 3 * 86400));
    const work = Math.floor(type.work ? logUni(type.work[0] * 3600, type.work[1] * 3600) : 600);
    let started = created + delay;
    let closed = started + work;
    let status = 'Завершена';
    if (closed > end) {
      status = r() < 0.5 ? 'Ждёт выполнения' : 'Выполняется';
      closed = null;
      if (status === 'Ждёт выполнения') started = null;
    } else if (r() < 0.012) {
      status = r() < 0.8 ? 'Ждёт выполнения' : 'Выполняется';
      closed = null;
      if (status === 'Ждёт выполнения') started = null;
    }
    // «Дата начала работы» отсутствует в январе и почти вся в феврале.
    if (started != null && (month === 1 || (month === 2 && r() < 0.95))) started = null;
    let spentSec = Math.round(logUni(type.spent[0] * 60, type.spent[1] * 60));
    const closedMonth = closed ? new Date(closed * 1000).getUTCMonth() + 1 : 12;
    if (closedMonth <= 3 || (closedMonth === 4 && r() < 0.62) || r() < 0.04) spentSec = null;
    return {
      id: String(id),
      title: type.title,
      author,
      executor,
      status,
      created,
      started,
      closed,
      spentSec,
      description: `Синтетическое описание задачи ${id}`,
      inn: String(7700000000 + Math.floor(r() * 99999999)),
      company: `ООО «Тест ${Math.floor(r() * 500)}»`,
    };
  };

  for (let i = 0; i < n; i++) {
    let x = r() * totalW;
    let type = TYPES[0];
    for (const t of TYPES) {
      if ((x -= t.w) <= 0) {
        type = t;
        break;
      }
    }
    tasks.push(makeTask(type));
  }
  for (const rare of RARE) for (let i = 0; i < rare.n; i++) tasks.push(makeTask(rare));
  // У одной из редких задач статус «в очереди», чтобы тип с 5 решёнными не ушёл в «Прочие».
  const reg = tasks.filter((t) => t.title === RARE[0].title);
  reg[0].status = 'Ждёт выполнения';
  reg[0].closed = null;
  reg[0].started = null;
  for (const t of reg.slice(1)) {
    if (t.status !== 'Завершена') {
      t.status = 'Завершена';
      t.started = t.created + 120;
      t.closed = t.created + 900;
    }
  }

  // Заметный выброс по «Затрачено», как ID 38405 в эталоне.
  const big = tasks.find((t) => t.title === TYPES[0].title && t.status === 'Завершена' && t.closed > wallFromParts(2026, 10, 1) && t.executor === EMPLOYEES[1]);
  if (big) big.spentSec = 96 * 3600 + 59 * 60 + 22;

  if (anomalies) {
    const solved = tasks.filter((t) => t.status === 'Завершена' && t.started != null && t.closed > wallFromParts(2026, 6, 1));
    // Закрытие раньше начала работы.
    solved[0].started = solved[0].closed + 3600;
    // Нулевое «Затрачено».
    solved[1].spentSec = 0;
    // Дубль ID.
    solved[3].id = solved[2].id;
    // «Завершена» без даты закрытия.
    solved[4].closed = null;
    // Нераспознанная дата.
    solved[5].badStarted = '31.02.2026 10:00';
  }
  return tasks;
}

/** Строки листа для xlsx. native = true: даты и «Затрачено» числами Excel со стилями. */
export function tasksToRows(tasks, { native = false, dropColumn = null } = {}) {
  const headers = HEADERS.filter((h) => h !== dropColumn);
  const rows = [headers.map((h) => ({ v: h, s: 'bold' }))];
  const dateCell = (ws) => (ws == null ? null : native ? { v: wallToExcelSerial(ws), s: 'dts' } : fmtWallText(ws));
  const spentCell = (sec) => (sec == null ? null : native ? { v: sec / 86400, s: 'dur' } : fmtSpentText(sec));
  for (const t of tasks) {
    const val = {
      ID: native ? Number(t.id) : t.id,
      'Название': t.title,
      'Описание': t.description,
      'Стадия канбана': t.status === 'Завершена' ? 'Завершено' : 'В работе',
      'Статус': t.status,
      'Постановщик': t.author,
      'Исполнитель': t.executor,
      'Соисполнители': '',
      'Наблюдатели': '',
      'Дата создания': dateCell(t.created),
      'Дата начала работы': t.badStarted ? t.badStarted : dateCell(t.started),
      'Дата закрытия': dateCell(t.closed),
      'Затрачено': spentCell(t.spentSec),
      'Компания': t.company,
      'ИНН клиента': t.inn,
      'Приоритет': 'Средний',
      'Дата изменения': dateCell(t.closed ?? t.created),
    };
    rows.push(headers.map((h) => (h in val ? val[h] : null)));
  }
  return rows;
}

export function buildSynthXlsx(tasks, opts = {}) {
  return buildXlsx([{ name: opts.sheetName || 'Лист1', rows: tasksToRows(tasks, opts), freezeRow: 1 }]);
}
