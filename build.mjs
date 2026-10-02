// Сборка сайта: данные из Apps Script → статические страницы в dist/.
// Локальная проверка без сети: DATA_FILE=пример.json node build.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'dist');
const CACHE = path.join(ROOT, '.cache', 'img');
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'site.config.json'), 'utf8'));

const BASE = normBase(process.env.BASE_PATH ?? config.basePath ?? '/');
const ORIGIN = (() => {
  const u = process.env.SITE_URL || config.siteUrl || '';
  try { return u ? new URL(u).origin : ''; } catch { return ''; }
})();
const TZ = config.timeZone || 'Europe/Riga';
const TITLE = config.title || 'Библиотека';
const VERSION = Date.now().toString(36);

// ───────────── Данные ─────────────

async function loadData() {
  if (process.env.DATA_FILE) {
    return JSON.parse(await fs.readFile(process.env.DATA_FILE, 'utf8'));
  }
  const res = await fetch(config.exportUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Экспорт ответил ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Экспорт вернул ошибку: ${data.error}`);
  return data;
}

function buildModel(data) {
  const byOrder = (a, b) => (a.order - b.order) || a.name.localeCompare(b.name, 'ru');
  const raw = (data.collections || []).map((c) => ({
    id: String(c.id),
    name: String(c.name || c.id),
    description: String(c.description || ''),
    parent: String(c.parent || ''),
    cover: String(c.cover || ''),
    order: Number(c.order) || 0,
  }));
  const rawIds = new Set(raw.map((c) => c.id));
  raw.forEach((c) => { if (c.parent && !rawIds.has(c.parent)) c.parent = ''; });

  const tops = raw.filter((c) => !c.parent).sort(byOrder);
  tops.forEach((c, i) => {
    c.num = String(i + 1).padStart(2, '0');
    c.children = raw.filter((k) => k.parent === c.id).sort(byOrder);
    c.children.forEach((k, j) => {
      k.num = `${c.num}.${j + 1}`;
      k.parentCol = c;
      k.children = [];
    });
  });
  const ordered = tops.flatMap((c) => [c, ...c.children]);
  const colById = new Map(ordered.map((c) => [c.id, c]));

  const cards = (data.cards || [])
    .filter((c) => Number(c.id))
    .map((c) => ({
      ...c,
      id: Number(c.id),
      num: pad3(c.id),
      title: String(c.title || ''),
      description: String(c.description || ''),
      cols: (c.collections || []).map(String).filter((id) => colById.has(id)),
      tags: (c.tags || []).map(String),
      files: c.files || [],
    }))
    .sort((a, b) => b.id - a.id);

  for (const c of ordered) {
    const ids = new Set([c.id, ...c.children.map((k) => k.id)]);
    c.cards = cards.filter((card) => card.cols.some((id) => ids.has(id)));
  }

  return { tops, ordered, colById, cards, generatedAt: data.generatedAt };
}

// ───────────── Картинки ─────────────

async function fetchDriveImage(id) {
  const cached = path.join(CACHE, id);
  try { return await fs.readFile(cached); } catch {}
  const url = `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`;
  const res = await fetch(url, { redirect: 'follow' });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('image/')) throw new Error(`${res.status} ${type}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(cached, buf);
  return buf;
}

async function processImage(id) {
  try {
    const src = await fetchDriveImage(id);
    const { data: base, info } = await sharp(src, { failOn: 'none' })
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });
    const dir = path.join(OUT, 'img');
    await fs.mkdir(dir, { recursive: true });
    await sharp(base).webp({ quality: 80 }).toFile(path.join(dir, `${id}-1600.webp`));
    await sharp(base).resize({ width: 800 }).webp({ quality: 78 }).toFile(path.join(dir, `${id}-800.webp`));
    await sharp(base).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 82 }).toFile(path.join(dir, `${id}-og.jpg`));
    return { w: info.width, h: info.height };
  } catch (err) {
    console.warn(`Картинка ${id} пропущена: ${err.message}`);
    return null;
  }
}

// ───────────── Помощники ─────────────

function normBase(b) {
  let s = String(b || '').trim();
  if (!s.startsWith('/')) s = '/' + s;
  if (!s.endsWith('/')) s += '/';
  return s;
}
const href = (p = '') => BASE + p;
const abs = (p = '') => (ORIGIN ? ORIGIN + BASE + p : '');
const pad3 = (n) => { const s = String(n); return s.length >= 3 ? s : s.padStart(3, '0'); };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const nCards = (n) => `${n} ${plural(n, 'карточка', 'карточки', 'карточек')}`;
const nFiles = (n) => `${n} ${plural(n, 'файл', 'файла', 'файлов')}`;
const nCols = (n) => `${n} ${plural(n, 'коллекция', 'коллекции', 'коллекций')}`;

const dateFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : dateFmt.format(d);
}

function fmtSize(bytes) {
  const b = Number(bytes);
  if (!b) return '';
  const units = [['ГБ', 1024 ** 3], ['МБ', 1024 ** 2], ['КБ', 1024]];
  for (const [u, v] of units) {
    if (b >= v) {
      const x = b / v;
      return `${(x >= 10 ? Math.round(x) : Math.round(x * 10) / 10).toString().replace('.', ',')} ${u}`;
    }
  }
  return `${b} Б`;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function richText(text) {
  const linkify = (s) => s.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, (u) =>
    `<a href="${u}" rel="noopener">${u}</a>`);
  return text.trim().split(/\n{2,}/).map((p) =>
    `<p>${linkify(esc(p)).replace(/\n/g, '<br>')}</p>`).join('\n');
}

function excerpt(text, max = 160) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

const icon = {
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  link: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  down: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  ext: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/></svg>',
};

// ───────────── Шаблоны ─────────────

function layout({ title, description = '', ogImage = '', path: p = '', body, model, active = null, hasList = false, bodyClass = '' }) {
  const fullTitle = title ? `${title} — ${TITLE}` : TITLE;
  const og = [
    `<meta property="og:title" content="${esc(title || TITLE)}">`,
    `<meta property="og:site_name" content="${esc(TITLE)}">`,
    `<meta property="og:type" content="website">`,
    description ? `<meta property="og:description" content="${esc(description)}">` : '',
    abs(p) ? `<meta property="og:url" content="${esc(abs(p))}">` : '',
    ogImage && abs(ogImage) ? `<meta property="og:image" content="${esc(abs(ogImage))}">\n<meta name="twitter:card" content="summary_large_image">` : '',
  ].filter(Boolean).join('\n');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ''}
${og}
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap">
<link rel="stylesheet" href="${href('assets/site.css')}?v=${VERSION}">
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">К содержимому</a>
<header class="top">
<a class="top-home" href="${href()}">${esc(TITLE)}</a>
${hasList ? `<button class="icon-btn" type="button" data-search-toggle aria-label="Поиск" aria-expanded="false" aria-controls="search">${icon.search}</button>` : ''}
</header>
${hasList ? `<div class="searchbar" id="search" hidden><label class="sr-only" for="q">Поиск по карточкам</label><input id="q" type="search" placeholder="Название, описание или тег" autocomplete="off" data-search></div>` : ''}
<div class="shell">
${sidebar(model, active)}
<main id="main" class="main">
${body}
</main>
</div>
${hasList ? sheetMarkup() : ''}
<div class="toast" data-toast role="status" aria-live="polite" hidden></div>
<script src="${href('assets/site.js')}?v=${VERSION}" defer></script>
</body>
</html>
`;
}

function colRow(c, { active, compact = false } = {}) {
  const sub = !!c.parentCol;
  const isActive = active === c.id;
  return `<a class="crow${sub ? ' crow--sub' : ''}${isActive ? ' is-active' : ''}" href="${href(`col/${c.id}/`)}"${isActive ? ' aria-current="page"' : ''}>
<span class="crow-num">${c.num}</span><span class="crow-name">${esc(c.name)}</span><span class="crow-count">${c.cards.length}</span>
</a>`;
}

function sidebar(model, active) {
  const all = active === '' ;
  return `<aside class="side" aria-label="Коллекции">
<div class="side-label">Коллекции</div>
<nav>
<a class="crow${all ? ' is-active' : ''}" href="${href()}"${all ? ' aria-current="page"' : ''}><span class="crow-num">—</span><span class="crow-name">Все карточки</span><span class="crow-count">${model.cards.length}</span></a>
${model.ordered.map((c) => colRow(c, { active })).join('\n')}
</nav>
</aside>`;
}

function sheetMarkup() {
  return `<div class="backdrop" data-backdrop hidden></div>
<section class="sheet" data-sheet role="dialog" aria-labelledby="sheet-title" hidden>
<div class="sheet-handle" data-drag aria-hidden="true"><span></span></div>
<div class="card-bar" data-drag>
<span class="card-bar-num" data-sheet-num></span>
<div class="card-bar-actions">
<button class="icon-btn" type="button" data-copy aria-label="Скопировать ссылку на карточку">${icon.link}</button>
<button class="icon-btn" type="button" data-sheet-close aria-label="Закрыть">${icon.close}</button>
</div>
</div>
<div class="sheet-body" data-sheet-body></div>
</section>`;
}

function picture(id, model, { sizes, eager = false, alt = '' } = {}) {
  const img = model.images.get(id);
  if (!img) return '';
  return `<img src="${href(`img/${id}-800.webp`)}" srcset="${href(`img/${id}-800.webp`)} 800w, ${href(`img/${id}-1600.webp`)} 1600w" sizes="${sizes}" width="${img.w}" height="${img.h}" alt="${esc(alt)}"${eager ? '' : ' loading="lazy" decoding="async"'}>`;
}

function tile(card, model) {
  const n = card.files.length;
  const search = [card.title, card.description, card.tags.join(' ')].join(' ').toLowerCase();
  return `<a class="tile" href="${href(`c/${card.num}/`)}" data-cols="${esc(card.cols.join(' '))}" data-search="${esc(search)}">
<div class="tile-img">${picture(card.cover, model, { sizes: '(min-width: 640px) 240px, 50vw' })}</div>
<div class="tile-body">
<div class="tile-meta"><span>№ ${card.num}</span><span>${n ? nFiles(n) : '—'}</span></div>
<span class="tile-title">${esc(card.title)}</span>
</div>
</a>`;
}

function cardList(cards, model, { label, chips = '' }) {
  if (!cards.length) {
    return `<section class="list">
<div class="bar"><h2 class="bar-label">${esc(label)}</h2><span>0</span></div>
<p class="empty">Карточек пока нет. Новые появятся здесь сразу после публикации.</p>
</section>`;
  }
  return `<section class="list" data-list>
${chips}
<div class="bar bar--tools">
<h2 class="bar-label">${esc(label)} · <span data-count>${cards.length}</span></h2>
<div class="tools">
<button type="button" data-sort aria-label="Сначала старые">Новые ↓</button>
<button type="button" data-view="grid" aria-pressed="true">Сетка</button>
<button type="button" data-view="list" aria-pressed="false">Список</button>
</div>
</div>
<div class="grid-wrap"><div class="grid" data-grid data-view="grid">
${cards.map((c) => tile(c, model)).join('\n')}
</div></div>
<p class="empty" data-empty hidden>Ничего не найдено. Попробуйте другое слово.</p>
</section>`;
}

function homePage(model) {
  const updated = fmtDate(model.generatedAt);
  const meta = [nCards(model.cards.length), nCols(model.tops.length), updated && `обн. ${updated}`].filter(Boolean).join(' · ');
  const index = model.ordered.length
    ? model.ordered.map((c) => colRow(c)).join('\n')
    : '<p class="empty empty--tight">Коллекций пока нет.</p>';
  const body = `<section class="hero">
<h1 class="hero-title">${esc(TITLE)}</h1>
<p class="meta">${esc(meta)}</p>
${config.description ? `<p class="lede">${esc(config.description)}</p>` : ''}
</section>
<section class="index-inline" aria-labelledby="index-label">
<div class="bar"><h2 class="bar-label" id="index-label">Коллекции</h2><span>${String(model.tops.length).padStart(2, '0')}</span></div>
<nav>${index}</nav>
</section>
${cardList(model.cards, model, { label: 'Все карточки' })}`;
  return layout({ title: '', description: config.description || '', body, model, active: '', hasList: true, bodyClass: 'page-home' });
}

function collectionPage(c, model) {
  const parent = c.parentCol;
  const crumbs = parent
    ? `<a href="${href()}">Коллекции</a> / <a href="${href(`col/${parent.id}/`)}">${parent.num}</a> / ${c.num}`
    : `<a href="${href()}">Коллекции</a> / ${c.num}`;
  const subs = c.children.length;
  const meta = [nCards(c.cards.length), subs ? `${subs} ${plural(subs, 'подколлекция', 'подколлекции', 'подколлекций')}` : ''].filter(Boolean).join(' · ');
  const chips = subs && c.cards.length
    ? `<div class="chips" role="group" aria-label="Подколлекции">
<button class="chip" type="button" data-filter="" aria-pressed="true">Все <span class="chip-n">${c.cards.length}</span></button>
${c.children.map((k) => `<button class="chip" type="button" data-filter="${esc(k.id)}" aria-pressed="false"><span class="chip-n">${k.num}</span> ${esc(k.name)} <span class="chip-n">${k.cards.length}</span></button>`).join('\n')}
</div>`
    : '';
  const body = `<section class="hero hero--col">
<p class="crumbs">${crumbs}</p>
<h1 class="hero-title">${esc(c.name)}</h1>
${c.description ? `<p class="lede">${esc(c.description)}</p>` : ''}
<p class="meta">${esc(meta)}</p>
</section>
${cardList(c.cards, model, { label: 'Карточки', chips })}`;
  return layout({
    title: c.name, description: excerpt(c.description), path: `col/${c.id}/`,
    ogImage: c.cover && model.images.get(c.cover) ? `img/${c.cover}-og.jpg` : '',
    body, model, active: c.id, hasList: true, bodyClass: 'page-col',
  });
}

function cardArticle(card, model) {
  const cols = card.cols.map((id) => model.colById.get(id)).map((c) => {
    const name = c.parentCol ? `${c.parentCol.name} / ${c.name}` : c.name;
    return `<a href="${href(`col/${c.id}/`)}"><span class="mono">${c.num}</span> ${esc(name)}</a>`;
  });
  const facts = [
    cols.length && ['Коллекции', `<span class="fact-list">${cols.join('')}</span>`],
    card.created && ['Добавлено', `<span class="mono">${fmtDate(card.created)}</span>`],
    card.tags.length && ['Теги', esc(card.tags.join(', '))],
    card.link && ['Источник', `<a href="${esc(card.link)}" rel="noopener">${esc(hostOf(card.link))} ↗</a>`],
  ].filter(Boolean);

  const files = card.files.map((f) => {
    const isUpload = f.kind === 'upload';
    const url = isUpload && f.driveId
      ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(f.driveId)}`
      : f.url;
    return `<a class="file" href="${esc(url)}" rel="noopener"${isUpload ? '' : ' target="_blank"'}>
<span class="file-type">${esc(f.type || 'FILE')}</span>
<span class="file-name">${esc(f.title)}</span>
<span class="file-size">${esc(fmtSize(f.size))}</span>
<span class="file-icon" aria-label="${isUpload ? 'Скачать' : 'Открыть на Drive'}">${isUpload ? icon.down : icon.ext}</span>
</a>`;
  });

  const cover = model.images.get(card.cover)
    ? picture(card.cover, model, { sizes: '(min-width: 1024px) 480px, 100vw', eager: true, alt: card.title })
    : '';

  return `<article class="card" data-num="${card.num}">
<figure class="card-cover${cover ? '' : ' card-cover--empty'}">${cover}</figure>
<h1 class="card-title">${esc(card.title)}</h1>
${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
${card.description ? `<section class="card-desc"><h2 class="section-label">Описание</h2>${richText(card.description)}</section>` : ''}
${files.length ? `<section class="card-files"><div class="bar"><h2 class="bar-label">Файлы</h2><span>${String(files.length).padStart(2, '0')}</span></div>${files.join('\n')}</section>` : ''}
<p class="card-path">/c/${card.num}</p>
</article>`;
}

function cardPage(card, model) {
  const body = `<div class="card-page">
<div class="card-bar">
<span class="card-bar-num">№ ${card.num}</span>
<div class="card-bar-actions">
<button class="icon-btn" type="button" data-copy aria-label="Скопировать ссылку на карточку">${icon.link}</button>
<a class="icon-btn" href="${href()}" aria-label="Закрыть">${icon.close}</a>
</div>
</div>
${cardArticle(card, model)}
</div>`;
  return layout({
    title: card.title, description: excerpt(card.description), path: `c/${card.num}/`,
    ogImage: model.images.get(card.cover) ? `img/${card.cover}-og.jpg` : '',
    body, model, active: null, bodyClass: 'page-card',
  });
}

function notFoundPage(model) {
  const body = `<section class="hero">
<h1 class="hero-title">Нет такой страницы</h1>
<p class="lede">Возможно, карточку скрыли или ссылка набрана с ошибкой.</p>
<p><a class="link" href="${href()}">Перейти ко всем карточкам</a></p>
</section>`;
  return layout({ title: 'Нет такой страницы', body, model, active: null });
}

// ───────────── Запись ─────────────

async function write(rel, content) {
  const file = path.join(OUT, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function main() {
  const data = await loadData();
  const model = buildModel(data);

  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  model.images = new Map();
  const imageIds = new Set([...model.cards.map((c) => c.cover), ...model.ordered.map((c) => c.cover)].filter(Boolean));
  for (const id of imageIds) {
    const res = await processImage(id);
    if (res) model.images.set(id, res);
  }

  await write('index.html', homePage(model));
  for (const c of model.ordered) await write(`col/${c.id}/index.html`, collectionPage(c, model));
  for (const card of model.cards) await write(`c/${card.num}/index.html`, cardPage(card, model));
  await write('404.html', notFoundPage(model));
  await write('.nojekyll', '');
  await write('data.json', JSON.stringify(data));

  await fs.cp(path.join(ROOT, 'assets'), path.join(OUT, 'assets'), { recursive: true });

  console.log(`Готово: ${nCards(model.cards.length)}, ${nCols(model.ordered.length)}, картинок: ${model.images.size}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
