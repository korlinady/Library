# Библиотека

Статический сайт на GitHub Pages. Данные берутся из Google-таблицы через Apps Script.

- `site.config.json` — название сайта и адрес экспорта.
- `build.mjs` — сборка: скачивает данные и обложки, делает страницы в `dist/`.
- `assets/` — стили и скрипт сайта.
- `.github/workflows/build.yml` — сборка и публикация. Запускается при изменении файлов,
  вручную (Actions → «Сборка сайта» → Run workflow) и сигналом из Apps Script.

Локальная проверка: `npm install`, потом `node build.mjs` (или `DATA_FILE=пример.json node build.mjs` без сети).
