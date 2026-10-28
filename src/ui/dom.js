// Мини-помощники для построения DOM без фреймворка.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

/** SVG-иконка из набора (stroke-иконки 20×20). */
const ICONS = {
  upload: 'M10 13V3m0 0L6 7m4-4 4 4M4 13v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3',
  download: 'M10 3v10m0 0-4-4m4 4 4-4M4 13v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3',
  image: 'M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm0 8 4-4 4 4 2-2 4 4M13 7.5h.01',
  file: 'M11 2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7l-5-5Zm0 0v5h5',
  x: 'M5 5l10 10M15 5 5 15',
  warn: 'M10 3 2 17h16L10 3Zm0 5v4m0 3h.01',
  error: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 4v5m0 3h.01',
  ok: 'M4 10.5 8 14l8-8',
  info: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 7v5m0-8h.01',
  chevron: 'M7 5l5 5-5 5',
  sort: 'M7 8l3-3 3 3M7 12l3 3 3-3',
  sortUp: 'M6 12l4-4 4 4',
  sortDown: 'M6 8l4 4 4-4',
  table: 'M3 4h14v12H3V4Zm0 4h14M3 12h14M8 4v12',
  gear: 'M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm6.5 3a6.5 6.5 0 0 0-.1-1.1l1.6-1.3-1.5-2.6-2 .7a6.5 6.5 0 0 0-1.9-1.1L12.3 2H9.3l-.3 2a6.5 6.5 0 0 0-1.9 1.1l-2-.7-1.5 2.6 1.6 1.3a6.5 6.5 0 0 0 0 2.2l-1.6 1.3 1.5 2.6 2-.7a6.5 6.5 0 0 0 1.9 1.1l.3 2h3l.3-2a6.5 6.5 0 0 0 1.9-1.1l2 .7 1.5-2.6-1.6-1.3c.1-.4.1-.7.1-1.1Z',
};

export function icon(name, cls = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${cls}`.trim());
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.info);
  svg.appendChild(p);
  return svg;
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Скачивание Blob без сетевых запросов. */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1500);
}
