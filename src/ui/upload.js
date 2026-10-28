// Блок загрузки в шапке: выбор/перетаскивание файла, сведения о файле, статус проверки.

import { h, clear, icon, $ } from './dom.js';
import { fmtInt, fmtBytes, plural } from '../core/format.js';
import { fmtDate, fmtDay } from '../core/dates.js';
import { sliceText } from './caption.js';
import { qualityIssues } from './quality.js';

export function renderUpload(actions) {
  const { state } = actions;
  const root = clear($('#upload'));
  const input = h('input', {
    type: 'file',
    accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    hidden: true,
    onchange: (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) actions.loadFile(f);
    },
  });
  const pick = () => input.click();
  const dz = h(
    'div',
    {
      class: 'dropzone',
      tabindex: '0',
      role: 'button',
      'aria-label': 'Выбрать или перетащить файл .xlsx',
      onclick: pick,
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      },
    },
    icon('upload'),
    h('span', { class: 'hint' }, state.dataset ? 'Другой файл .xlsx' : 'Перетащите .xlsx сюда или'),
    h('span', { class: 'btn primary small' }, 'Выбрать файл'),
    input,
  );
  root.append(dz);

  const ds = state.dataset;
  const info = h('div', { class: 'file-info' });
  if (ds) {
    const issues = state.prep ? qualityIssues(state.prep).filter((i) => i.level === 'warn').length : 0;
    const status = state.loadError
      ? h('span', { class: 'chip error' }, icon('error'), 'Новый файл не загружен')
      : issues
        ? h('span', { class: 'chip warn', title: `Структура в порядке; ${issues} ${plural(issues, 'предупреждение', 'предупреждения', 'предупреждений')} — подробности в блоке «Качество данных»` }, icon('warn'), `${issues} ${plural(issues, 'предупреждение', 'предупреждения', 'предупреждений')}`)
        : h('span', { class: 'chip ok' }, icon('ok'), 'Структура в порядке');
    info.append(
      h('div', { class: 'name-row' }, h('div', { class: 'name', title: ds.fileName }, ds.fileName || 'Файл без имени'), status),
      h(
        'div',
        { class: 'meta' },
        `${fmtBytes(ds.fileSize)} · строк прочитано: ${fmtInt(ds.rowsRead)} · лист «${ds.sheetName}»`,
      ),
      h(
        'div',
        { class: 'meta' },
        ds.minCreated != null ? `период создания: ${fmtDate(ds.minCreated)}–${fmtDate(ds.maxCreated)} · ` : '',
        state.prep ? sliceText(state.prep) : '',
      ),
    );
    root.append(info, h('button', { class: 'btn ghost', type: 'button', onclick: () => actions.clearData(), title: 'Убрать загруженные данные из памяти страницы' }, icon('x'), 'Очистить'));
  } else if (state.loadError) {
    info.append(
      h('div', { class: 'name', title: state.loadError.fileName }, state.loadError.fileName || 'Файл'),
      h('div', { class: 'meta' }, h('span', { class: 'chip error' }, icon('error'), 'Ошибка: файл не загружен')),
    );
    root.append(info);
  } else {
    info.append(h('div', { class: 'meta muted' }, 'Нужен файл выгрузки задач ОСП в формате .xlsx'));
    root.append(info);
  }

  // Подзаголовок в шапке: срез и имя файла.
  $('#subtitle').textContent = ds && state.prep ? `${sliceText(state.prep)} · ${ds.fileName}` : 'Загрузите выгрузку задач в формате .xlsx';
  if (ds && state.prep && state.prep.sliceDay != null) document.title = `ОСП · срез ${fmtDay(state.prep.sliceDay)}`;
}
