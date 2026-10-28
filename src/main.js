// Точка входа: всё приложение собирается в один HTML-файл.
import { init } from './ui/app.js';

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
