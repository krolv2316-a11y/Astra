// Синтетические файлы для проверки в браузере (в репозиторий не попадают: *.xlsx в .gitignore).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateTasks, buildSynthXlsx } from '../test/synth.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
mkdirSync(dir, { recursive: true });
const tasks = generateTasks({ n: 3250, seed: 2026 });
const files = {
  'synthetic_text.xlsx': buildSynthXlsx(tasks),
  'synthetic_native.xlsx': buildSynthXlsx(tasks, { native: true }),
  'synthetic_no_executor.xlsx': buildSynthXlsx(tasks.slice(0, 50), { dropColumn: 'Исполнитель' }),
  'not_really.xlsx': new TextEncoder().encode('ID;Название\n1;Тест\n'),
  'empty.xlsx': new Uint8Array(0),
};
if (process.argv.includes('--big')) files['synthetic_50k.xlsx'] = buildSynthXlsx(generateTasks({ n: 50000, seed: 50 }));
for (const [name, data] of Object.entries(files)) {
  writeFileSync(path.join(dir, name), data);
  console.log(`${name}: ${data.length} байт`);
}
