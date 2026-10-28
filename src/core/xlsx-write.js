// Минимальный генератор xlsx: строки inline, числа числами, стили, ширина колонок,
// закрепление заголовков и автофильтр. Без внешних зависимостей, кроме fflate (zip).

import { zipSync, strToU8 } from 'fflate';
import { colLetter } from './xlsx-read.js';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Порядок совпадает с <cellXfs> ниже.
export const STYLE = {
  default: 0,
  header: 1,
  num3: 2,
  int: 3,
  dt: 4,
  date: 5,
  pct: 6,
  dur: 7,
  title: 8,
  wrap: 9,
  bold: 10,
  num1: 11,
  dts: 12,
};

const STYLES_XML = `${XML_HEAD}<styleSheet xmlns="${NS}">
<numFmts count="7">
<numFmt numFmtId="164" formatCode="0.000"/>
<numFmt numFmtId="165" formatCode="dd.mm.yyyy hh:mm"/>
<numFmt numFmtId="166" formatCode="dd.mm.yyyy"/>
<numFmt numFmtId="167" formatCode="0.0%"/>
<numFmt numFmtId="168" formatCode="[h]:mm:ss"/>
<numFmt numFmtId="169" formatCode="0.0"/>
<numFmt numFmtId="170" formatCode="dd.mm.yyyy hh:mm:ss"/>
</numFmts>
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="13"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9DFE7"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FF8A97AB"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="169" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="170" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function esc(s) {
  return String(s)
    .replace(BAD_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sheetName(name, used) {
  let n = String(name || 'Лист').replace(/[[\]:*?/\\]/g, '_').replace(/^'+|'+$/g, '').trim() || 'Лист';
  n = n.slice(0, 31);
  let candidate = n;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i++})`;
    candidate = n.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function normCell(c) {
  if (c == null) return null;
  if (typeof c === 'object' && !(c instanceof Date)) return c.v == null ? (c.s ? { v: null, s: c.s } : null) : c;
  return { v: c };
}

function cellXml(ref, cell) {
  const s = cell.s != null ? (typeof cell.s === 'number' ? cell.s : STYLE[cell.s] ?? 0) : 0;
  const sAttr = s ? ` s="${s}"` : '';
  const v = cell.v;
  if (v == null) return s ? `<c r="${ref}"${sAttr}/>` : '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return s ? `<c r="${ref}"${sAttr}/>` : '';
    return `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
  }
  if (typeof v === 'boolean') return `<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
  const text = String(v).slice(0, 32767);
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

function textLen(cell) {
  if (!cell || cell.v == null) return 0;
  const v = cell.v;
  if (typeof v === 'number') {
    if (cell.s === 'dt' || cell.s === STYLE.dt) return 16;
    if (cell.s === 'dts' || cell.s === STYLE.dts) return 19;
    if (cell.s === 'date' || cell.s === STYLE.date) return 10;
    if (cell.s === 'dur' || cell.s === STYLE.dur) return 9;
    return Math.min(14, String(Math.round(v * 1000) / 1000).length + 1);
  }
  return String(v)
    .split('\n')
    .reduce((m, line) => Math.max(m, line.length), 0);
}

function worksheetXml(sheet, index) {
  const rows = sheet.rows.map((r) => (r || []).map(normCell));
  const ncols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const widths = [];
  for (let c = 0; c < ncols; c++) {
    if (sheet.colWidths && sheet.colWidths[c] != null) {
      widths.push(sheet.colWidths[c]);
      continue;
    }
    let w = 0;
    rows.forEach((r, ri) => {
      const cell = r[c];
      if (!cell) return;
      // Длинные заголовки переносятся, поэтому учитываем их частично.
      const isHeader = cell.s === 'header' || cell.s === STYLE.header;
      const len = isHeader ? Math.min(textLen(cell), 18) : textLen(cell);
      if (sheet.skipWidthRows && sheet.skipWidthRows.includes(ri)) return;
      w = Math.max(w, len);
    });
    widths.push(Math.max(8, Math.min(sheet.maxColWidth || 60, w + 2)));
  }
  const freeze = sheet.freezeRow || 0;
  const freezeCol = sheet.freezeCol || 0;
  let views = `<sheetView workbookViewId="0"${index === 0 ? ' tabSelected="1"' : ''}`;
  if (freeze || freezeCol) {
    const tl = `${colLetter(freezeCol)}${freeze + 1}`;
    const pane = freeze && freezeCol ? 'bottomRight' : freeze ? 'bottomLeft' : 'topRight';
    views += `><pane${freezeCol ? ` xSplit="${freezeCol}"` : ''}${freeze ? ` ySplit="${freeze}"` : ''} topLeftCell="${tl}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${tl}" sqref="${tl}"/></sheetView>`;
  } else {
    views += '/>';
  }
  const lastRef = `${colLetter(Math.max(0, ncols - 1))}${Math.max(1, rows.length)}`;
  const parts = [
    `${XML_HEAD}<worksheet xmlns="${NS}" xmlns:r="${NS_R}">`,
    `<dimension ref="A1:${lastRef}"/>`,
    `<sheetViews>${views}</sheetViews>`,
    '<sheetFormatPr defaultRowHeight="15"/>',
  ];
  if (ncols) {
    parts.push('<cols>');
    widths.forEach((w, i) => parts.push(`<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(2)}" customWidth="1"/>`));
    parts.push('</cols>');
  }
  parts.push('<sheetData>');
  rows.forEach((r, ri) => {
    const cells = r.map((cell, ci) => (cell ? cellXml(`${colLetter(ci)}${ri + 1}`, cell) : '')).join('');
    if (cells) parts.push(`<row r="${ri + 1}">${cells}</row>`);
  });
  parts.push('</sheetData>');
  let filterRef = null;
  if (sheet.autoFilter) {
    const { row = 0, fromCol = 0, toCol = ncols - 1, toRow = rows.length - 1 } = sheet.autoFilter;
    if (toRow > row && toCol >= fromCol) {
      filterRef = `${colLetter(fromCol)}${row + 1}:${colLetter(toCol)}${toRow + 1}`;
      parts.push(`<autoFilter ref="${filterRef}"/>`);
    }
  }
  parts.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
  parts.push('</worksheet>');
  return { xml: parts.join(''), filterRef };
}

/**
 * sheets: [{ name, rows: [[cell]], freezeRow, freezeCol, autoFilter, colWidths }]
 * cell: null | string | number | boolean | { v, s } (s — ключ STYLE).
 */
export function buildXlsx(sheets) {
  const used = new Set();
  const files = {};
  const names = [];
  const defined = [];
  sheets.forEach((sheet, i) => {
    const name = sheetName(sheet.name, used);
    names.push(name);
    const { xml, filterRef } = worksheetXml(sheet, i);
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml);
    if (filterRef) {
      const abs = filterRef.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
      defined.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(name.replace(/'/g, "''"))}'!${abs}</definedName>`);
    }
  });
  files['[Content_Types].xml'] = strToU8(
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>',
  );
  files['_rels/.rels'] = strToU8(
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>',
  );
  files['docProps/app.xml'] = strToU8(
    `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>`,
  );
  files['xl/workbook.xml'] = strToU8(
    `${XML_HEAD}<workbook xmlns="${NS}" xmlns:r="${NS_R}">` +
      '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
      names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets>' +
      (defined.length ? `<definedNames>${defined.join('')}</definedNames>` : '') +
      '</workbook>',
  );
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
  );
  files['xl/styles.xml'] = strToU8(STYLES_XML);
  return zipSync(files, { level: 6 });
}
