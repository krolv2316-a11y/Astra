// Печатает ключевые показатели синтетической выгрузки; запускается с разными TZ.
import { generateTasks, buildSynthXlsx } from './synth.js';
import { loadDataset } from '../src/core/parse.js';
import { prepare, computeView, defaultFilters } from '../src/core/model.js';
import { defaultSettings } from '../src/core/settings.js';

const tasks = generateTasks({ n: 300, seed: 3 });
const out = [];
for (const native of [false, true]) {
  const r = await loadDataset(buildSynthXlsx(tasks, { native }), { yieldEvery: 1e9 });
  const v = computeView(prepare(r.dataset, defaultSettings()), { ...defaultFilters(), step: 'week' });
  out.push(r.dataset.tasks[0].created, v.kpi.metrics, v.dyn.periods.map((p) => p.label));
}
process.stdout.write(JSON.stringify(out));
