// Экспорт в PNG: блок или весь отчёт, масштаб ×2, белый фон.

import html2canvas from 'html2canvas';
import { boostCharts } from './charts.js';
import { downloadBlob, $ } from './dom.js';
import { isoDay } from '../core/dates.js';

function fileName(state, slug) {
  const day = state.prep && state.prep.sliceDay != null ? isoDay(state.prep.sliceDay) : 'bez_sreza';
  return `osp_${slug}_${day}.png`;
}

async function capture(el, { full = false } = {}) {
  const restore = boostCharts(el, 2);
  const width = el.scrollWidth;
  try {
    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: false,
      allowTaint: false,
      imageTimeout: 0,
      windowWidth: document.documentElement.clientWidth,
      windowHeight: full ? Math.max(el.scrollHeight + 200, window.innerHeight) : window.innerHeight,
      scrollX: 0,
      scrollY: 0,
      onclone: (doc) => {
        doc.documentElement.classList.add('exporting');
        doc.body.classList.add('exporting');
        // В копии снимаем ограничения прокрутки, чтобы попал весь контент.
        const style = doc.createElement('style');
        style.textContent = `html,body{height:auto!important;overflow:visible!important}.app{height:auto!important;display:block!important}.body{display:block!important}.panel,.topbar,.footer{display:none!important}.output{overflow:visible!important;height:auto!important;padding:0!important}#report{width:${width}px}`;
        doc.head.appendChild(style);
        // Свёрнутые блоки в картинку не попадают (html2canvas не учитывает <details>).
        doc.querySelectorAll('details:not([open])').forEach((d) => {
          if (d.classList.contains('quality')) [...d.children].forEach((c) => c.tagName !== 'SUMMARY' && c.remove());
          else d.remove();
        });
      },
    });
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG не сформирован'))), 'image/png'));
  } finally {
    restore();
  }
}

async function run(actions, el, slug, opts) {
  const btns = document.querySelectorAll('button');
  btns.forEach((b) => b.setAttribute('aria-busy', 'true'));
  actions.toast('Готовлю PNG…');
  try {
    const blob = await capture(el, opts);
    const name = fileName(actions.state, slug);
    downloadBlob(blob, name);
    actions.toast(`Сохранено: ${name}`);
  } catch (e) {
    actions.toast(`Не удалось сохранить PNG: ${e && e.message ? e.message : e}`);
  } finally {
    btns.forEach((b) => b.removeAttribute('aria-busy'));
  }
}

export function exportCardPng(actions, card, slug) {
  return run(actions, card, slug, { full: true });
}

export function exportReportPng(actions) {
  return run(actions, $('#report'), 'otchet', { full: true });
}
