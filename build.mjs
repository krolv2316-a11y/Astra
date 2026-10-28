// Сборка одного автономного файла osp-dashboard.html из src/.
// Всё (JS-библиотеки, стили, иконки) встраивается внутрь; внешних ссылок нет.

import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const now = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const buildDate = process.env.BUILD_DATE || `${p2(now.getDate())}.${p2(now.getMonth() + 1)}.${now.getFullYear()}`;

const js = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome100', 'edge100', 'firefox100', 'safari15'],
  write: false,
  legalComments: 'none',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_DATE__: JSON.stringify(buildDate) },
});
const css = await transform(readFileSync(path.join(root, 'src/styles.css'), 'utf8'), { loader: 'css', minify: true });

// Лицензии встроенных библиотек (MIT требует сохранять уведомление).
const libs = [
  ['chart.js', 'LICENSE.md'],
  ['fflate', 'LICENSE'],
  ['html2canvas', 'LICENSE'],
];
const licenses = libs
  .map(([name, file]) => {
    const p = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
    const text = readFileSync(path.join(root, 'node_modules', name, file), 'utf8').trim();
    return `${name} ${p.version}\n${text}`;
  })
  .join('\n\n----\n\n')
  .replace(/--/g, '- -');

let code = js.outputFiles[0].text;
// Встраивание в <script>: не допускаем преждевременного закрытия тега.
code = code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

let html = readFileSync(path.join(root, 'src/index.html'), 'utf8');
// Плейсхолдеры подставляем до вставки кода, чтобы не задеть строки внутри библиотек.
html = html.replace(/__VERSION__/g, pkg.version).replace(/__BUILD_DATE__/g, buildDate);
html = html
  .replace('/*__CSS__*/', () => css.code.trim())
  .replace('/*__JS__*/', () => code.trim());
// Лицензии — комментарием перед последним </html> (в коде библиотек тоже встречается эта строка).
const end = html.lastIndexOf('</html>');
html = `${html.slice(0, end)}<!--\nВстроенные библиотеки и их лицензии:\n\n${licenses}\n-->\n${html.slice(end)}`;

// Проверка автономности: никаких внешних адресов в атрибутах загрузки ресурсов.
const external = html.match(/<(script|link|img|iframe)\b[^>]*\b(src|href)\s*=\s*["']?(https?:)?\/\//gi);
if (external) {
  console.error('Найдены внешние ресурсы:', external);
  process.exit(1);
}

const out = path.join(root, 'osp-dashboard.html');
writeFileSync(out, html);
console.log(`osp-dashboard.html: ${(html.length / 1024).toFixed(0)} КБ, версия ${pkg.version}, сборка ${buildDate}`);
