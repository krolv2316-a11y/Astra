// Состояние приложения и действия. Данные файла живут только в памяти этой вкладки.

import { loadDataset } from '../core/parse.js';
import { prepare, computeView, defaultFilters } from '../core/model.js';
import { loadStoredSettings, storeSettings, normalizeSettings, defaultSettings, clearStoredSettings } from '../core/settings.js';
import { renderUpload } from './upload.js';
import { renderPanel, refreshPanel } from './panel.js';
import { renderOutput, refreshOutput } from './output.js';
import { h, $ } from './dom.js';

export const state = {
  settings: defaultSettings(),
  storageOk: true,
  dataset: null,
  prep: null,
  view: null,
  filters: defaultFilters(),
  loading: false,
  loadError: null, // { fileName, error, buffer } — последняя неудачная загрузка
  hidden: { bar: new Set(), spent: new Set(), a: new Set(), b: new Set() },
  sort: { summary: { col: null, dir: 1 }, outliers: { col: 'closed', dir: -1 } },
  open: { quality: false, dataTables: {} },
};

let frame = 0;

function computeNow() {
  state.view = state.prep ? computeView(state.prep, state.filters) : null;
}

/** Пересчёт и перерисовка после смены фильтров (склеивается в один кадр). */
export function update() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    computeNow();
    refreshPanel(actions);
    refreshOutput(actions);
  });
}

function renderAll() {
  computeNow();
  renderUpload(actions);
  renderPanel(actions);
  renderOutput(actions);
}

// Перенос выбора фильтров при смене настроек (ключи зависят от отображаемых имён).
function remap(oldList, newList, selected, field) {
  if (!selected) return null;
  const originals = new Set();
  for (const x of oldList) if (selected.has(x.key)) x[field].forEach((o) => originals.add(o));
  const next = new Set();
  for (const x of newList) if (x[field].some((o) => originals.has(o))) next.add(x.key);
  return next.size === newList.length ? null : next;
}

function reprepare() {
  const old = state.prep;
  state.prep = state.dataset ? prepare(state.dataset, state.settings) : null;
  if (old && state.prep) {
    state.filters.employees = remap(old.employees, state.prep.employees, state.filters.employees, 'originals');
    state.filters.types = remap(old.types, state.prep.types, state.filters.types, 'members');
  }
}

let toastTimer = null;
export function toast(message) {
  let el = $('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status' });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3500);
}

function showLoading(on, title = 'Загрузка файла') {
  const box = $('#loading');
  box.hidden = !on;
  $('#loadingTitle').textContent = title;
  if (on) {
    $('#loadingBar').style.width = '0%';
    $('#loadingStep').textContent = 'Подготовка…';
  }
}

function progress(p, step) {
  $('#loadingBar').style.width = `${Math.round(p * 100)}%`;
  if (step) $('#loadingStep').textContent = step;
}

async function runLoad(buffer, fileName, fileSize) {
  state.loading = true;
  showLoading(true, `Загрузка «${fileName}»`);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  let res;
  try {
    res = await loadDataset(new Uint8Array(buffer), { fileName, fileSize, columnMap: state.settings.columns, onProgress: progress });
  } catch (e) {
    res = { ok: false, error: { code: 'internal', message: `Не удалось обработать файл: ${e && e.message ? e.message : e}` } };
  }
  if (res.ok) {
    progress(1, 'Расчёт показателей');
    await new Promise((r) => setTimeout(r, 0));
    state.dataset = res.dataset;
    state.prep = null;
    state.filters = defaultFilters();
    state.hidden = { bar: new Set(), spent: new Set(), a: new Set(), b: new Set() };
    state.loadError = null;
    reprepare();
  } else {
    // Прежняя выборка остаётся нетронутой.
    state.loadError = { fileName, fileSize, error: res.error, buffer: res.error.code === 'missing_columns' ? buffer : null };
  }
  state.loading = false;
  showLoading(false);
  renderAll();
  // Счётчик завершённых загрузок (для автоматических проверок).
  document.body.dataset.loads = String(Number(document.body.dataset.loads || 0) + 1);
}

export const actions = {
  state,
  update,
  toast,

  async loadFile(file) {
    if (!file || state.loading) return;
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (e) {
      state.loadError = { fileName: file.name, error: { code: 'read', message: 'Браузер не смог прочитать файл.' } };
      renderAll();
      return;
    }
    await runLoad(buffer, file.name, file.size);
  },

  /** Повторная загрузка того же файла с сопоставлением колонок. */
  async retryWithMapping(map) {
    const le = state.loadError;
    if (!le || !le.buffer) return;
    const s = normalizeSettings(state.settings);
    s.columns = { ...s.columns, ...map };
    state.settings = s;
    state.storageOk = storeSettings(s) && state.storageOk;
    await runLoad(le.buffer, le.fileName, le.fileSize);
  },

  dismissError() {
    state.loadError = null;
    renderAll();
  },

  clearData() {
    state.dataset = null;
    state.prep = null;
    state.view = null;
    state.loadError = null;
    state.filters = defaultFilters();
    renderAll();
  },

  setFilter(patch) {
    Object.assign(state.filters, patch);
    update();
  },

  toggleSeries(chart, key) {
    const set = state.hidden[chart];
    if (set.has(key)) set.delete(key);
    else set.add(key);
    refreshOutput(actions);
  },

  /** Изменение настроек справочников: сохранить, пересчитать всё. */
  setSettings(next, { rerenderPanel = false } = {}) {
    state.settings = normalizeSettings(next);
    if (state.storageOk) state.storageOk = storeSettings(state.settings);
    reprepare();
    computeNow();
    if (rerenderPanel) renderPanel(actions);
    else refreshPanel(actions);
    renderOutput(actions);
    renderUpload(actions);
  },

  resetSettings() {
    clearStoredSettings();
    actions.setSettings(defaultSettings(), { rerenderPanel: true });
  },
};

export function init() {
  const { settings, storage } = loadStoredSettings();
  state.settings = settings;
  state.storageOk = storage;
  renderAll();
  // Перетаскивание файла в любое место окна.
  let depth = 0;
  const dz = () => $('.dropzone');
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth++;
    dz()?.classList.add('drag');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) dz()?.classList.remove('drag');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    dz()?.classList.remove('drag');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) actions.loadFile(file);
  });
}
