// Приёмочная проверка в браузере (Playwright + Chromium) на синтетических файлах.
// Запуск: npm run build && npm run fixtures -- --big && npm run e2e
// Скриншоты — в docs/screenshots, выгрузки — во временную папку.

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = pathToFileURL(path.join(root, 'osp-dashboard.html')).href;
const fx = (n) => path.join(root, 'test', 'fixtures', n);
const shots = path.join(root, 'docs', 'screenshots');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'osp-e2e-'));
mkdirSync(shots, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();

async function openPage({ width = 1440, height = 900, timezoneId = 'Europe/Moscow' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'ru-RU', timezoneId, acceptDownloads: true });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(html);
  return { context, page, requests, errors };
}

async function upload(page, file) {
  const before = await page.evaluate(() => Number(document.body.dataset.loads || 0));
  await page.setInputFiles('#upload input[type=file]', file);
  await page.waitForFunction((n) => Number(document.body.dataset.loads || 0) > n, before, { timeout: 120000 });
  await page.waitForTimeout(150);
}

const kpiText = (page) => page.$eval('#kpis', (el) => el.innerText);
const tableText = (page, sel) => page.$eval(sel, (el) => el.innerText);
const chartInfo = (page, box) =>
  page.$eval(box, (el) => {
    const c = el._chart;
    if (!c) return null;
    return { labels: c.data.labels.map((l) => (Array.isArray(l) ? l.join(' ') : l)), datasets: c.data.datasets.map((d) => d.label), yTitle: c.options.scales.y.title && c.options.scales.y.title.text };
  });
const noHScroll = (page) =>
  page.evaluate(() => {
    const d = document.documentElement;
    const out = document.querySelector('#output');
    return { page: d.scrollWidth <= d.clientWidth, output: !out || out.scrollWidth <= out.clientWidth + 1, pageW: d.scrollWidth, clientW: d.clientWidth };
  });

// ---------------------------------------------------------------------------
{
  const { page, requests, errors, context } = await openPage();
  await page.screenshot({ path: path.join(shots, 'empty_1440x900.png') });

  await upload(page, fx('not_really.xlsx'));
  check('не xlsx → понятное сообщение', (await page.textContent('#output')).includes('не является книгой Excel'));
  await upload(page, fx('empty.xlsx'));
  check('пустой файл → понятное сообщение', (await page.textContent('#output')).includes('Файл пустой'));

  const t0 = Date.now();
  await upload(page, fx('synthetic_text.xlsx'));
  check('загрузка синтетической выгрузки (3 262 строки)', await page.$('#report'), `${Date.now() - t0} мс`);
  const kpiTextFile = await kpiText(page);
  const summaryTextFile = await tableText(page, '#summaryTable');
  const headerInfo = await page.textContent('#upload');
  check('блок загрузки: имя, строки, период создания, срез', /synthetic_text\.xlsx/.test(headerInfo) && /строк прочитано: 3\s262/.test(headerInfo) && /период создания: 12\.01\.2026/.test(headerInfo) && /срез на 28\.10\.2026/.test(headerInfo), headerInfo.replace(/\s+/g, ' ').slice(0, 160));

  // Ошибка структуры: прежние данные не теряются.
  await upload(page, fx('synthetic_no_executor.xlsx'));
  const outText = await page.textContent('#output');
  check('нет колонки «Исполнитель» → ошибка со списком', outText.includes('Не найдены колонки') && outText.includes('Исполнитель') && outText.includes('Заголовки в файле'));
  check('прежняя выборка осталась на экране', (await kpiText(page)) === kpiTextFile && outText.includes('Показаны данные прежнего файла'));
  await page.click('text=Скрыть сообщение');

  // Нативные даты/время Excel дают тот же результат.
  await upload(page, fx('synthetic_native.xlsx'));
  check('нативные типы Excel = текстовые (KPI)', (await kpiText(page)) === kpiTextFile);
  check('нативные типы Excel = текстовые (сводная таблица)', (await tableText(page, '#summaryTable')) === summaryTextFile);

  // Конфиденциальность: в DOM нет описаний и клиентских полей.
  const bodyText = await page.evaluate(() => document.body.innerText);
  check('описание и клиентские поля не показываются', !bodyText.includes('Синтетическое описание') && !bodyText.includes('ООО «Тест') && !/77\d{8}/.test(bodyText));

  // Переключатели.
  const monthInfo = await chartInfo(page, '#card-dyn-spent-box');
  check('месяцы: все периоды на оси, последний неполный', monthInfo.labels[0] === 'Янв 2026' && monthInfo.labels.at(-1) === 'Окт 2026 неполный период', `${monthInfo.labels.length} подписей`);
  await page.click('[data-seg="step"] button[data-value="week"]');
  await page.waitForTimeout(200);
  const weekInfo = await chartInfo(page, '#card-dyn-spent-box');
  check('недели: подписи «Нед. N (дд.мм–дд.мм)», последняя неполная', weekInfo.labels.length > 40 && weekInfo.labels.at(-1).startsWith('Нед. 44 26.10–01.11 неполный'), weekInfo.labels.at(-1));
  await page.click('[data-seg="step"] button[data-value="month"]');
  await page.click('[data-seg="metric"] button[data-value="median"]');
  await page.waitForTimeout(200);
  check('метрика «Медиана» на оси', (await chartInfo(page, '#card-dyn-a-box')).yTitle.startsWith('Медиана'));
  await page.click('[data-seg="metric"] button[data-value="mean"]');
  await page.click('[data-seg="dynMode"] button[data-value="total"]');
  await page.waitForTimeout(200);
  check('динамика «Итого» — одна линия', (await chartInfo(page, '#card-dyn-b-box')).datasets.join() === 'Итого');
  await page.click('[data-seg="dynMode"] button[data-value="lines"]');
  await page.waitForTimeout(200);
  check('динамика «Линиями» — по сотрудникам', (await chartInfo(page, '#card-dyn-b-box')).datasets.length === 3);
  await page.click('[data-seg="dynMode"] button[data-value="both"]');

  const kpiBefore = await kpiText(page);
  await page.check('#excludeOutliers');
  await page.waitForTimeout(200);
  const kpiExcl = await kpiText(page);
  check('«Исключать выбросы» пересчитывает KPI', kpiExcl !== kpiBefore && kpiExcl.includes('(исключены)'));
  check('таблица выбросов видна при исключении', (await page.$$('#outliers tbody tr')).length > 0);
  await page.uncheck('#excludeOutliers');

  const solvedAll = await page.$eval('#kpis .kpi:nth-child(2) .k-value', (el) => el.textContent);
  await page.click('#empList label:first-child input');
  await page.waitForTimeout(200);
  const solvedOne = await page.$eval('#kpis .kpi:nth-child(2) .k-value', (el) => el.textContent);
  check('снятие сотрудника пересчитывает «Решено»', solvedOne !== solvedAll, `${solvedAll} → ${solvedOne}`);
  await page.click('#filters .links button:first-child');

  await page.fill('#periodFrom', '01.05.2026');
  await page.press('#periodFrom', 'Enter');
  await page.fill('#periodTo', '31.07.2026');
  await page.press('#periodTo', 'Enter');
  await page.waitForTimeout(200);
  const perInfo = await chartInfo(page, '#card-dyn-spent-box');
  check('период 01.05–31.07: три месяца на оси', perInfo.labels.join('|') === 'Май 2026|Июн 2026|Июл 2026', perInfo.labels.join('|'));
  await page.click('text=Весь период >> nth=0');
  await page.click('[data-seg="author"] button[data-value="bots"]');
  await page.waitForTimeout(200);
  check('фильтр «Только боты» отражён в подписи', (await page.textContent('#filterCaption')).includes('Постановщик: только боты'));
  await page.click('[data-seg="author"] button[data-value="all"]');

  // Настройки справочников: переименование сотрудника и типа.
  await page.click('details.settings > summary');
  await page.fill('input[aria-label="Отображаемое имя для Иванова Анна"]', 'А. Иванова');
  await page.fill('input[aria-label="Отображаемое название для Произвести распределение лида"]', 'Распределение лида');
  await page.waitForTimeout(900);
  const barInfo = await page.$eval('#barBox', (el) => ({ labels: el._chart.data.labels, ds: el._chart.data.datasets.map((d) => d.label) }));
  check('переименование видно на графике', barInfo.labels.includes('А. Иванова') && barInfo.ds.includes('Распределение лида'));
  check('переименование видно в таблицах', (await tableText(page, '#summaryTable')).includes('А. Иванова') && (await tableText(page, '#pivotTable')).includes('Распределение лида'));
  check('переименование видно в легенде линий', (await chartInfo(page, '#card-dyn-spent-box')).datasets.includes('А. Иванова'));
  const stored = await page.evaluate(() => localStorage.getItem('osp-dashboard.settings.v1'));
  check('в localStorage только настройки', stored && stored.includes('А. Иванова') && !stored.includes('Синтетическое') && !stored.includes('30013'), `${stored.length} символов`);

  // Скрытие тестового типа.
  await page.check('.map-item:has-text("ТЕСТ Произвести верификацию Клиента") input[type=checkbox]');
  await page.waitForTimeout(400);
  check('скрытие типа убирает задачи из расчёта', (await page.textContent('#quality summary')) && (await page.textContent('#quality')).includes('Скрыто через настройки типов'));

  // Экспорт Excel.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#xlsxBtn')]);
  const xlsxPath = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(xlsxPath);
  check('имя файла Excel', /^osp_statistika_2026-10-28\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const py = execFileSync('python3', ['-I', '-c', `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1])
out = {'sheets': wb.sheetnames}
s = wb['Сводка']
out['solved'] = s['B3'].value
out['solved_type'] = type(s['B3'].value).__name__
out['freeze'] = s.freeze_panes
dyn = wb['Динамика']
out['dyn_header'] = [c.value for c in dyn[1]]
out['dyn_emps'] = sorted({r[4].value for r in dyn.iter_rows(min_row=2)})
out['mean_type'] = type(dyn['G6'].value).__name__
txt = json.dumps([[c.value for c in row] for ws in wb for row in ws.iter_rows()], default=str, ensure_ascii=False)
out['sensitive'] = any(x in txt for x in ['Синтетическое', 'ООО «Тест', 'ИНН'])
out['renamed'] = 'А. Иванова' in txt and 'Распределение лида' in txt
print(json.dumps(out, ensure_ascii=False))
`, xlsxPath]).toString();
  const x = JSON.parse(py);
  const screenSolved = Number((await page.$eval('#kpis .kpi:nth-child(2) .k-value', (el) => el.textContent)).replace(/\s/g, ''));
  check('Excel: все листы', ['Параметры', 'Сводка', 'Сотрудники×Типы', 'Показатели', 'Динамика', 'Выбросы', 'Качество данных'].every((n) => x.sheets.includes(n)), x.sheets.join(', '));
  check('Excel: числа числами и совпадают с экраном', x.solved === screenSolved && x.solved_type === 'int', `${x.solved} (${x.solved_type}) = ${screenSolved}`);
  check('Excel: закреплены заголовки, единицы в заголовках', x.freeze === 'A2' && x.dyn_header.some((hh) => /мин$/.test(hh)) && x.dyn_header.some((hh) => /раб\. ч$/.test(hh)), x.dyn_header.join(' | '));
  check('Excel: нет чувствительных полей, есть переименования', !x.sensitive && x.renamed);
  // LibreOffice открывает файл без ошибок (конвертация в csv).
  try {
    execFileSync('soffice', ['--headless', '--convert-to', 'csv', '--outdir', tmp, xlsxPath], { timeout: 120000, stdio: 'pipe' });
    check('Excel: LibreOffice открывает файл', readFileSync(xlsxPath.replace(/\.xlsx$/, '.csv'), 'utf8').includes('Статистика решённых задач ОСП'));
  } catch (e) {
    check('Excel: LibreOffice открывает файл', false, String(e.message).slice(0, 200));
  }

  const [dlo] = await Promise.all([page.waitForEvent('download'), page.click('text=выгрузить в xlsx')]);
  check('выгрузка выбросов в xlsx', /^osp_vybrosy_2026-10-28\.xlsx$/.test(dlo.suggestedFilename()), dlo.suggestedFilename());

  // PNG: блок и весь отчёт.
  const [dp] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#card-dyn-spent [data-png]')]);
  const pngPath = path.join(tmp, dp.suggestedFilename());
  await dp.saveAs(pngPath);
  const png = readFileSync(pngPath);
  const cardW = await page.$eval('#card-dyn-spent', (el) => el.getBoundingClientRect().width);
  const pw = png.readUInt32BE(16);
  check('PNG графика: имя, формат, масштаб ×2', dp.suggestedFilename() === 'osp_zatracheno_dinamika_2026-10-28.png' && png.slice(1, 4).toString() === 'PNG' && Math.abs(pw - cardW * 2) <= 4, `${dp.suggestedFilename()}, ${pw}×${png.readUInt32BE(20)}`);
  writeFileSync(path.join(shots, 'export_zatracheno_dinamika.png'), png);
  const [dr] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('#pngAllBtn')]);
  const repPath = path.join(tmp, dr.suggestedFilename());
  await dr.saveAs(repPath);
  const rep = readFileSync(repPath);
  check('PNG всего отчёта', dr.suggestedFilename() === 'osp_otchet_2026-10-28.png' && rep.readUInt32BE(20) > 3000, `${rep.readUInt32BE(16)}×${rep.readUInt32BE(20)}`);

  // Настройки: экспорт в JSON → сброс → импорт.
  const [dj] = await Promise.all([page.waitForEvent('download'), page.click('text=Экспорт настроек (JSON)')]);
  const jsonPath = path.join(tmp, dj.suggestedFilename());
  await dj.saveAs(jsonPath);
  const json = readFileSync(jsonPath, 'utf8');
  check('экспорт настроек в JSON', json.includes('"А. Иванова"') && json.includes('"Распределение лида"') && !json.includes('Синтетическое'));
  page.once('dialog', (d) => d.accept());
  await page.click('text=Сбросить к умолчанию');
  await page.waitForTimeout(300);
  const afterReset = (await page.$eval('#barBox', (el) => el._chart.data.labels)).includes('А. Иванова');
  await page.setInputFiles('details.settings input[type=file]', jsonPath);
  await page.waitForTimeout(400);
  const afterImport = (await page.$eval('#barBox', (el) => el._chart.data.labels)).includes('А. Иванова');
  check('сброс и импорт настроек из JSON', !afterReset && afterImport);

  // Сброс настроек для чистых скриншотов.
  page.once('dialog', (d) => d.accept());
  await page.click('text=Сбросить к умолчанию');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, 'dashboard_1440x900.png') });
  const hs = await noHScroll(page);
  check('1440×900: нет горизонтальной прокрутки', hs.page && hs.output, JSON.stringify(hs));

  check('сеть: только локальный файл', requests.every((u) => /^(file:|data:|blob:|about:)/.test(u)), `${requests.length} запросов: ${[...new Set(requests.map((u) => u.split(':')[0]))].join(', ')}`);
  check('нет ошибок в консоли', errors.length === 0, errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------------------
// 1280×720 и другой часовой пояс.
{
  const a = await openPage({ width: 1280, height: 720, timezoneId: 'America/Los_Angeles' });
  await upload(a.page, fx('synthetic_text.xlsx'));
  await a.page.screenshot({ path: path.join(shots, 'dashboard_1280x720.png') });
  const hs = await noHScroll(a.page);
  check('1280×720: нет горизонтальной прокрутки', hs.page && hs.output, JSON.stringify(hs));
  const header = await a.page.$eval('.topbar', (el) => el.getBoundingClientRect().height);
  check('блок загрузки не выше ~110 px', header <= 110, `${Math.round(header)} px`);
  const b = await openPage({ width: 1280, height: 720, timezoneId: 'Asia/Vladivostok' });
  await upload(b.page, fx('synthetic_native.xlsx'));
  check('часовой пояс не влияет на результат', (await kpiText(a.page)) === (await kpiText(b.page)) && (await tableText(a.page, '#outliersTable')) === (await tableText(b.page, '#outliersTable')));
  // Скриншоты нижних блоков.
  await a.page.$eval('#card-dyn-spent', (el) => el.scrollIntoView());
  await a.page.screenshot({ path: path.join(shots, 'dynamics_1280x720.png') });
  await a.page.$eval('#card-summary', (el) => el.scrollIntoView());
  await a.page.screenshot({ path: path.join(shots, 'summary_1280x720.png') });
  check('нет ошибок в консоли (1280×720)', a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].join(' | '));
  await a.context.close();
  await b.context.close();
}

// ---------------------------------------------------------------------------
// Большой файл: индикатор загрузки и время.
try {
  readFileSync(fx('synthetic_50k.xlsx'));
  const { page, context, errors } = await openPage();
  const t0 = Date.now();
  await page.setInputFiles('#upload input[type=file]', fx('synthetic_50k.xlsx'));
  const sawLoading = await page.waitForFunction(() => !document.querySelector('#loading').hidden, null, { timeout: 5000 }).then(() => true, () => false);
  await page.waitForFunction(() => document.querySelector('#loading').hidden && document.querySelector('#report'), null, { timeout: 120000 });
  const loadMs = Date.now() - t0;
  const t1 = Date.now();
  await page.click('[data-seg="step"] button[data-value="week"]');
  await page.waitForFunction(() => document.querySelector('#card-dyn-spent-box')._chart.data.labels.length > 40);
  const switchMs = Date.now() - t1;
  check('50 000 строк: индикатор загрузки и время', sawLoading && loadMs < 30000, `загрузка ${loadMs} мс, переключение на недели ${switchMs} мс`);
  check('50 000 строк: без ошибок', errors.length === 0, errors.join(' | '));
  await context.close();
} catch (e) {
  check('50 000 строк', false, `нет файла или ошибка: ${e.message}`);
}

await browser.close();
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(tmp, 'e2e-results.json'), JSON.stringify(results, null, 2));
console.log(`\nИтого: ${results.length - failed.length} из ${results.length} проверок пройдено. Выгрузки: ${tmp}`);
process.exit(failed.length ? 1 : 0);
