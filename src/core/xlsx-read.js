// Минимальный читатель xlsx: zip (fflate) + потоковый разбор XML регулярными выражениями.
// Читает только нужные части книги и только нужные колонки листа.

import { unzipSync } from 'fflate';

export class XlsxError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const decoder = new TextDecoder('utf-8');
const u8str = (u8) => decoder.decode(u8);

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeXml(s) {
  if (s.indexOf('&') < 0 && s.indexOf('_x') < 0) return s;
  let r = s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[e];
  });
  // Excel кодирует управляющие символы как _xHHHH_.
  if (r.indexOf('_x') >= 0) r = r.replace(/_x([0-9a-fA-F]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  return r;
}

const attrRe = new Map();

function attr(attrs, name) {
  let re = attrRe.get(name);
  if (!re) {
    re = new RegExp(`(?:^|\\s)(?:\\w+:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`);
    attrRe.set(name, re);
  }
  const m = re.exec(attrs);
  return m ? decodeXml(m[2] ?? m[3]) : null;
}

function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/');
  parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

function relsPathFor(partPath) {
  const i = partPath.lastIndexOf('/');
  return `${partPath.slice(0, i + 1)}_rels/${partPath.slice(i + 1)}.rels`;
}

function parseRels(xml) {
  const map = new Map();
  const re = /<(?:\w+:)?Relationship\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const id = attr(m[1], 'Id');
    const target = attr(m[1], 'Target');
    const mode = attr(m[1], 'TargetMode');
    if (id && target && mode !== 'External') map.set(id, { target, type: attr(m[1], 'Type') || '' });
  }
  return map;
}

// Встроенные форматы дат/времени Excel.
const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

export function isDateFormat(id, code) {
  if (BUILTIN_DATE_FMT.has(id)) return true;
  if (!code) return false;
  const s = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '')
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, '');
  if (/^general$/i.test(s.trim())) return false;
  return /[dmyhs]/i.test(s);
}

function parseStyles(xml) {
  if (!xml) return [];
  const custom = new Map();
  const nf = /<(?:\w+:)?numFmt\b([^>]*?)\/?>/g;
  let m;
  while ((m = nf.exec(xml))) {
    const id = Number(attr(m[1], 'numFmtId'));
    custom.set(id, attr(m[1], 'formatCode') || '');
  }
  const xfsBlock = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(xml);
  const res = [];
  if (xfsBlock) {
    const xf = /<(?:\w+:)?xf\b([^>]*?)(?:\/>|>)/g;
    while ((m = xf.exec(xfsBlock[1]))) {
      const id = Number(attr(m[1], 'numFmtId') || 0);
      const code = custom.get(id) || '';
      res.push({ numFmtId: id, code, isDate: isDateFormat(id, code) });
    }
  }
  return res;
}

function textOfRuns(inner) {
  // Фонетические подсказки (rPh) к тексту не относятся.
  const clean = inner.indexOf('rPh') >= 0 ? inner.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '') : inner;
  let out = '';
  const re = /<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g;
  let m;
  while ((m = re.exec(clean))) if (m[1]) out += m[1];
  return decodeXml(out);
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const res = [];
  const re = /<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g;
  let m;
  while ((m = re.exec(xml))) res.push(m[1] ? textOfRuns(m[1]) : '');
  return res;
}

export function colIndexFromRef(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

export function colLetter(idx) {
  let s = '';
  let n = idx + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Открывает книгу. Возвращает описание листов и функции для ленивого чтения.
 */
export function openWorkbook(u8) {
  if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
  if (u8.length === 0) throw new XlsxError('empty', 'Файл пустой (0 байт).');
  if (!(u8[0] === 0x50 && u8[1] === 0x4b)) {
    throw new XlsxError('not_xlsx', 'Файл не является книгой Excel в формате .xlsx.');
  }
  let meta;
  try {
    meta = unzipSync(u8, {
      filter: (f) => /^(_rels\/\.rels|\[Content_Types\]\.xml|xl\/.*(workbook[^/]*\.xml|\.rels|styles\.xml|sharedStrings\.xml))$/i.test(f.name),
    });
  } catch (e) {
    throw new XlsxError('not_xlsx', 'Не удалось распаковать файл: он повреждён или это не .xlsx.');
  }
  const get = (p) => {
    const key = Object.keys(meta).find((k) => k.toLowerCase() === p.toLowerCase());
    return key ? u8str(meta[key]) : null;
  };
  let wbPath = 'xl/workbook.xml';
  const rootRels = get('_rels/.rels');
  if (rootRels) {
    for (const r of parseRels(rootRels).values()) {
      if (/officeDocument$/.test(r.type)) wbPath = resolvePath('', r.target);
    }
  }
  const wbXml = get(wbPath);
  if (!wbXml) {
    if (get('[Content_Types].xml') == null) throw new XlsxError('not_xlsx', 'Файл не является книгой Excel в формате .xlsx.');
    throw new XlsxError('not_xlsx', 'В файле не найдена книга Excel (workbook.xml). Возможно, это другой формат (.xls, .ods, .csv).');
  }
  const rels = parseRels(get(relsPathFor(wbPath)) || '');
  const date1904 = /<(?:\w+:)?workbookPr\b[^>]*\bdate1904\s*=\s*["'](1|true)["']/i.test(wbXml);
  const sheets = [];
  const re = /<(?:\w+:)?sheet\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(wbXml))) {
    const name = attr(m[1], 'name') || `Лист${sheets.length + 1}`;
    const rid = attr(m[1], 'id');
    const rel = rid && rels.get(rid);
    if (!rel || !/worksheet$/.test(rel.type)) continue;
    sheets.push({ name, path: resolvePath(wbPath, rel.target) });
  }
  let sstPath = null;
  let stylesPath = null;
  for (const r of rels.values()) {
    if (/sharedStrings$/.test(r.type)) sstPath = resolvePath(wbPath, r.target);
    if (/styles$/.test(r.type)) stylesPath = resolvePath(wbPath, r.target);
  }
  let shared = null;
  let styles = null;
  const ctx = {
    date1904,
    get shared() {
      if (!shared) shared = parseSharedStrings(sstPath ? get(sstPath) : get('xl/sharedStrings.xml'));
      return shared;
    },
    get styles() {
      if (!styles) styles = parseStyles(stylesPath ? get(stylesPath) : get('xl/styles.xml'));
      return styles;
    },
  };
  function sheetXml(sheet) {
    const files = unzipSync(u8, { filter: (f) => f.name.toLowerCase() === sheet.path.toLowerCase() });
    const key = Object.keys(files)[0];
    if (!key) throw new XlsxError('not_xlsx', `Лист «${sheet.name}» отсутствует в архиве.`);
    return u8str(files[key]);
  }
  return { sheets, date1904, ctx, sheetXml };
}

/** Значение ячейки: { t: 's'|'n'|'b'|'e', v, date: bool } или null для пустой. */
function cellValue(attrs, inner, ctx) {
  const t = attr(attrs, 't') || 'n';
  if (t === 'inlineStr') {
    const is = /<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/.exec(inner || '');
    const v = is ? textOfRuns(is[1]) : '';
    return v === '' ? null : { t: 's', v };
  }
  const vm = inner ? /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner) : null;
  if (!vm) return null;
  const raw = vm[1];
  switch (t) {
    case 's': {
      const v = ctx.shared[Number(raw)];
      return v == null || v === '' ? null : { t: 's', v };
    }
    case 'str':
      return raw === '' ? null : { t: 's', v: decodeXml(raw) };
    case 'b':
      return { t: 'b', v: raw === '1' || raw === 'true' };
    case 'e':
      return { t: 'e', v: decodeXml(raw) };
    case 'd':
      return { t: 'd', v: decodeXml(raw) };
    default: {
      const num = Number(raw);
      if (!Number.isFinite(num)) return { t: 's', v: decodeXml(raw) };
      const s = attr(attrs, 's');
      const st = s != null ? ctx.styles[Number(s)] : null;
      return { t: 'n', v: num, date: !!(st && st.isDate) };
    }
  }
}

const ROW_RE = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
const CELL_RE = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;

function cellsOfRow(inner, ctx, wanted) {
  const out = new Map();
  if (!inner) return out;
  CELL_RE.lastIndex = 0;
  let pos = 0;
  let m;
  while ((m = CELL_RE.exec(inner))) {
    const ref = attr(m[1], 'r');
    const col = ref ? colIndexFromRef(ref) : pos;
    pos = col + 1;
    if (wanted && !wanted.has(col)) continue;
    const v = cellValue(m[1], m[2], ctx);
    if (v) out.set(col, v);
  }
  return out;
}

/**
 * Итератор по строкам листа. Каждая строка: { r: номер строки Excel, cells: Map(col → value) }.
 * wanted — Set индексов колонок (null = все).
 */
export function* iterateRows(xml, ctx, wanted = null) {
  const rowRe = new RegExp(ROW_RE.source, 'g');
  let m;
  let seq = 0;
  while ((m = rowRe.exec(xml))) {
    const rAttr = attr(m[1], 'r');
    const r = rAttr ? Number(rAttr) : seq + 1;
    seq = r;
    yield { r, cells: cellsOfRow(m[2], ctx, wanted), progress: rowRe.lastIndex / xml.length };
  }
}

/** Значение ячейки как текст (для заголовков). */
export function cellText(c) {
  if (!c) return '';
  if (c.t === 'b') return c.v ? 'ИСТИНА' : 'ЛОЖЬ';
  return String(c.v);
}
