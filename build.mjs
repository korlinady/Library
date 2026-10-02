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
  // Apps Script иногда отвечает ошибкой на один запрос, особенно сразу после
  // того, как сам запустил сборку. Поэтому несколько попыток с паузами.
  const delays = [0, 10, 30, 60];
  let lastError;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) {
      console.log(`Повтор через ${delays[i]} с…`);
      await new Promise((r) => setTimeout(r, delays[i] * 1000));
    }
    try {
      const res = await fetch(config.exportUrl, { redirect: 'follow', signal: AbortSignal.timeout(90_000) });
      const text = await res.text();
      if (!res.ok) throw new Error(`Экспорт ответил ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 300)}`);
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Экспорт вернул не JSON: ${text.replace(/\s+/g, ' ').slice(0, 300)}`); }
      if (!data.ok) throw new Error(`Экспорт вернул ошибку: ${data.error}`);
      return data;
    } catch (err) {
      lastError = err;
      console.warn(`Попытка ${i + 1}: ${err.message}`);
    }
  }
  throw lastError;
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

// Один и тот же тег всегда получает один и тот же цвет из 8
function tagTone(tag) {
  let h = 0;
  for (const ch of String(tag).toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 8;
}
const tagHref = (tag) => href(`?q=${encodeURIComponent('#' + tag)}`);

const icon = {
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  link: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  down: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10.5 11v5M13.5 11v5"/></svg>',
  pencil: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
  eye: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  ext: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/></svg>',
};

// ───────────── Шаблоны ─────────────

function layout({ title, description = '', ogImage = '', path: p = '', body, model, active = null, hasList = false, bodyClass = '', colId = '' }) {
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
<body class="${bodyClass}" data-script-url="${esc(scriptUrl())}" data-base="${esc(BASE)}" data-tz="${esc(TZ)}" data-site-title="${esc(TITLE)}"${colId ? ` data-col-id="${esc(colId)}"` : ''}>
<a class="skip" href="#main">К содержимому</a>
<header class="top">
<a class="top-home" href="${href()}">${esc(TITLE)}</a>
<div class="top-actions">
${hasList ? `<button class="icon-btn" type="button" data-search-toggle aria-label="Поиск" aria-expanded="false" aria-controls="search">${icon.search}</button>` : ''}
<a class="icon-btn" href="${href('admin/')}" data-admin hidden aria-label="Новая карточка">${icon.plus}</a>
</div>
</header>
${hasList ? `<div class="searchbar" id="search" hidden><label class="sr-only" for="q">Поиск по карточкам</label><input id="q" type="search" placeholder="Название, описание или #тег" autocomplete="off" data-search></div>` : ''}
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
  return `<a class="crow${sub ? ' crow--sub' : ''}${isActive ? ' is-active' : ''}" href="${href(`col/${c.id}/`)}" data-col="${esc(c.id)}"${sub ? ` data-parent="${esc(c.parentCol.id)}"` : ''}${isActive ? ' aria-current="page"' : ''}>
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
<div class="col-admin" data-admin hidden><button class="link-btn" type="button" data-new-col>+ Новая коллекция</button></div>
</aside>`;
}

function sheetMarkup() {
  return `<div class="backdrop" data-backdrop hidden></div>
<section class="sheet" data-sheet role="dialog" aria-labelledby="sheet-title" hidden>
<div class="sheet-handle" data-drag aria-hidden="true"><span></span></div>
<div class="card-bar" data-drag>
<span class="card-bar-num" data-sheet-num></span>
<div class="card-bar-actions">
<button class="icon-btn" type="button" data-visibility="card" data-admin hidden aria-label="Скрыть от всех">${icon.eye}</button>
<button class="icon-btn" type="button" data-delete data-admin hidden aria-label="Удалить карточку">${icon.trash}</button>
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
  const tags = card.tags.map((t) => t.toLowerCase()).join('|');
  return `<a class="tile" href="${href(`c/${card.num}/`)}" data-id="${card.id}" data-cols="${esc(card.cols.join(' '))}" data-tags="${esc(tags)}" data-search="${esc(search)}">
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
<div class="col-admin" data-admin hidden><button class="link-btn" type="button" data-new-col>+ Новая коллекция</button></div>
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
${c.children.map((k) => `<button class="chip" type="button" data-filter="${esc(k.id)}" aria-pressed="false"><span class="chip-n">${k.num}</span> <span class="chip-name" data-col-name="${esc(k.id)}">${esc(k.name)}</span> <span class="chip-n">${k.cards.length}</span></button>`).join('\n')}
</div>`
    : '';
  const body = `<section class="hero hero--col">
<p class="crumbs">${crumbs}</p>
<div class="title-row">
<h1 class="hero-title" data-title-text data-col-name="${esc(c.id)}">${esc(c.name)}</h1>
<div class="title-actions">
<button class="icon-btn" type="button" data-visibility="collection" data-id="${esc(c.id)}" data-admin hidden aria-label="Скрыть от всех">${icon.eye}</button>
<button class="icon-btn" type="button" data-rename="collection" data-id="${esc(c.id)}" data-admin hidden aria-label="Изменить название и описание коллекции">${icon.pencil}</button>
</div>
</div>
<p class="lede" data-col-desc="${esc(c.id)}"${c.description ? '' : ' hidden'}>${esc(c.description)}</p>
<p class="meta">${esc(meta)}</p>
${parent ? '' : `<div class="col-admin col-admin--hero" data-admin hidden><button class="link-btn" type="button" data-new-col data-parent="${esc(c.id)}">+ Подколлекция</button></div>`}
</section>
${cardList(c.cards, model, { label: 'Карточки', chips })}`;
  return layout({
    title: c.name, description: excerpt(c.description), path: `col/${c.id}/`,
    ogImage: c.cover && model.images.get(c.cover) ? `img/${c.cover}-og.jpg` : '',
    body, model, active: c.id, hasList: true, bodyClass: 'page-col', colId: c.id,
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
    card.tags.length && ['Теги', `<span class="tags">${card.tags.map((t) =>
      `<a class="tag tag--${tagTone(t)}" href="${tagHref(t)}" data-tag="${esc(t)}">${esc(t)}</a>`).join('')}</span>`],
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

  return `<article class="card" data-num="${card.num}" data-id="${card.id}" data-title="${esc(card.title)}">
<figure class="card-cover${cover ? '' : ' card-cover--empty'}">${cover}</figure>
<div class="title-row card-title-row">
<h1 class="card-title" data-title-text>${esc(card.title)}</h1>
<button class="icon-btn" type="button" data-rename="card" data-id="${card.id}" data-admin hidden aria-label="Переименовать карточку">${icon.pencil}</button>
</div>
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
<button class="icon-btn" type="button" data-visibility="card" data-admin hidden aria-label="Скрыть от всех">${icon.eye}</button>
<button class="icon-btn" type="button" data-delete data-admin hidden aria-label="Удалить карточку">${icon.trash}</button>
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
  const body = `<div data-not-found><section class="hero">
<h1 class="hero-title">Нет такой страницы</h1>
<p class="lede">Возможно, карточку скрыли или ссылка набрана с ошибкой.</p>
<p><a class="link" href="${href()}">Перейти ко всем карточкам</a></p>
</section></div>`;
  return layout({ title: 'Нет такой страницы', body, model, active: null, hasList: true, bodyClass: 'page-404' });
}

// ───────────── Форма /admin ─────────────

function scriptUrl() {
  if (config.scriptUrl) return config.scriptUrl;
  try {
    const u = new URL(config.exportUrl);
    u.search = '';
    return u.href;
  } catch {
    return '';
  }
}

function adminPage() {
  const ic = {
    camera: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    gallery: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="5" width="16" height="14"/><path d="M4 16l5-5 4 4 3-3 4 4"/></svg>',
    chevron: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  };
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Новая карточка — ${esc(TITLE)}</title>
<link rel="manifest" href="${href('manifest.webmanifest')}">
<link rel="apple-touch-icon" href="${href('icons/apple-touch-icon.png')}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${esc(TITLE)}">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&display=swap">
<link rel="stylesheet" href="${href('assets/site.css')}?v=${VERSION}">
<link rel="stylesheet" href="${href('assets/admin.css')}?v=${VERSION}">
</head>
<body class="admin" data-script-url="${esc(scriptUrl())}" data-base="${esc(BASE)}">
<header class="top admin-top">
<a class="admin-link" href="${href()}">На сайт</a>
<span class="admin-title">Новая карточка</span>
<button class="admin-link admin-link--end" type="button" data-rebuild hidden>Обновить сайт</button>
</header>

<main id="main" class="admin-main">

<section class="screen" data-screen="loading">
<p class="empty">Загружаем коллекции…</p>
</section>

<section class="screen" data-screen="key" hidden>
<form class="admin-form" data-key-form>
<h1 class="admin-h1">Вход</h1>
<p class="lede">Вставь секретный ключ из журнала Apps Script. Он сохранится на этом устройстве, и вводить его снова не придётся.</p>
<div class="field">
<label class="field-label" for="key">Ключ</label>
<input class="input" id="key" type="password" autocomplete="current-password" required>
</div>
<p class="form-error" data-key-error hidden></p>
<button class="btn-primary" type="submit">Войти</button>
</form>
</section>

<section class="screen" data-screen="form" hidden>
<form class="admin-form" data-card-form novalidate>

<div class="field">
<span class="field-label">Обложка</span>
<div class="cover-empty" data-cover-empty>
<div class="cover-buttons">
<label class="btn-outline"><input class="sr-only" type="file" accept="image/*" capture="environment" data-cover-input>${ic.camera}Камера</label>
<label class="btn-outline"><input class="sr-only" type="file" accept="image/*" data-cover-input>${ic.gallery}Галерея</label>
</div>
<span class="hint">Сожмётся до 1600 px</span>
</div>
<div class="cover-filled" data-cover-filled hidden>
<img class="cover-preview" data-cover-preview alt="">
<div class="cover-meta">
<span class="hint" data-cover-status></span>
<button class="link-btn" type="button" data-cover-remove>Убрать</button>
</div>
</div>
<label class="check"><input type="checkbox" data-field="keepOriginal"> Приложить оригинал фото к файлам</label>
</div>

<div class="field">
<label class="field-label" for="f-title">Название</label>
<input class="input" id="f-title" type="text" placeholder="Как называется" data-field="title" autocomplete="off">
</div>

<div class="field">
<span class="field-label" id="cols-label">Коллекции</span>
<div class="box">
<div data-picked></div>
<button class="box-row box-toggle" type="button" data-picker-toggle aria-expanded="false" aria-controls="picker">
<span data-picker-label>Выбрать</span>${ic.chevron}
</button>
<div class="picker" id="picker" data-picker role="group" aria-labelledby="cols-label" hidden></div>
</div>
<button class="link-btn" type="button" data-newcol-toggle aria-expanded="false" aria-controls="newcol">+ Новая коллекция</button>
<div class="subform" id="newcol" data-newcol hidden>
<div class="field">
<label class="field-label" for="nc-name">Название коллекции</label>
<input class="input" id="nc-name" type="text" autocomplete="off">
</div>
<div class="field">
<label class="field-label" for="nc-parent">Внутри коллекции</label>
<select class="input" id="nc-parent"></select>
</div>
<label class="check"><input type="checkbox" id="nc-hidden"> Видна только мне</label>
<p class="form-error" data-newcol-error hidden></p>
<div class="row-btns">
<button class="btn-outline" type="button" data-newcol-create>Создать</button>
<button class="link-btn" type="button" data-newcol-cancel>Отмена</button>
</div>
</div>
</div>

<div class="field">
<label class="field-label" for="f-desc">Описание</label>
<textarea class="input textarea" id="f-desc" placeholder="Что это и зачем" data-field="description"></textarea>
</div>

<div class="field">
<label class="field-label" for="f-link">Ссылка на источник</label>
<input class="input" id="f-link" type="url" inputmode="url" placeholder="https://" data-field="link" autocomplete="off">
</div>

<div class="field">
<span class="field-label">Файлы</span>
<div class="files" data-files></div>
<div class="two-btns">
<label class="btn-outline"><input class="sr-only" type="file" multiple data-files-input>+ Файл</label>
<button class="btn-outline" type="button" data-drive-toggle aria-expanded="false" aria-controls="drive">+ Ссылка на Drive</button>
</div>
<div class="subform" id="drive" data-drive hidden>
<div class="field">
<label class="field-label" for="d-url">Ссылка на файл или папку</label>
<input class="input" id="d-url" type="url" inputmode="url" placeholder="https://drive.google.com/…" autocomplete="off">
</div>
<div class="field">
<label class="field-label" for="d-title">Название (необязательно)</label>
<input class="input" id="d-title" type="text" placeholder="Подставится из Drive" autocomplete="off">
</div>
<p class="form-error" data-drive-error hidden></p>
<div class="row-btns">
<button class="btn-outline" type="button" data-drive-add>Добавить</button>
<button class="link-btn" type="button" data-drive-cancel>Отмена</button>
</div>
</div>
<span class="hint">Больше 30 МБ — только ссылкой на Drive</span>
</div>

<div class="field">
<label class="field-label" for="f-tags">Теги</label>
<input class="input" id="f-tags" type="text" placeholder="Через запятую" data-field="tags" autocomplete="off">
</div>

<label class="check check--big"><input type="checkbox" data-field="star"> В избранное</label>
<label class="check check--big"><input type="checkbox" data-field="hidden"> Видна только мне</label>

<button class="link-btn link-btn--mute" type="button" data-logout>Выйти на этом устройстве</button>

<div class="publish-bar">
<p class="form-error" data-form-error hidden></p>
<button class="btn-primary" type="submit" data-publish>Опубликовать</button>
<span class="hint hint--center">Появится на сайте через 1–2 минуты</span>
</div>
</form>
</section>

<section class="screen" data-screen="done" hidden>
<div class="admin-form">
<h1 class="admin-h1">Опубликовано</h1>
<p class="lede" data-done-text></p>
<a class="btn-outline btn-outline--wide" data-done-link href="#">Открыть карточку</a>
<button class="btn-primary" type="button" data-done-again>Добавить ещё</button>
</div>
</section>

</main>
<div class="toast" data-toast role="status" aria-live="polite" hidden></div>
<script src="${href('assets/admin.js')}?v=${VERSION}" defer></script>
</body>
</html>
`;
}

async function writeAppAssets() {
  const manifest = {
    name: `${TITLE} — новая карточка`,
    short_name: TITLE,
    start_url: href('admin/'),
    scope: BASE,
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: href('icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
      { src: href('icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
      { src: href('icons/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  await write('manifest.webmanifest', JSON.stringify(manifest, null, 2));

  // Иконка: каталожная карточка — рамка и строки на чёрном
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#0a0a0a"/>
<rect x="136" y="148" width="240" height="216" fill="none" stroke="#ffffff" stroke-width="12"/>
<rect x="136" y="148" width="240" height="56" fill="#ffffff"/>
<rect x="168" y="244" width="176" height="10" fill="#ffffff"/>
<rect x="168" y="280" width="176" height="10" fill="#ffffff"/>
<rect x="168" y="316" width="112" height="10" fill="#ffffff"/>
</svg>`;
  const dir = path.join(OUT, 'icons');
  await fs.mkdir(dir, { recursive: true });
  const src = Buffer.from(svg);
  await sharp(src).resize(512, 512).png().toFile(path.join(dir, 'icon-512.png'));
  await sharp(src).resize(192, 192).png().toFile(path.join(dir, 'icon-192.png'));
  await sharp(src).resize(180, 180).png().toFile(path.join(dir, 'apple-touch-icon.png'));
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
  await write('admin/index.html', adminPage());
  await writeAppAssets();
  await write('.nojekyll', '');
  await write('data.json', JSON.stringify(data));

  await fs.cp(path.join(ROOT, 'assets'), path.join(OUT, 'assets'), { recursive: true });

  console.log(`Готово: ${nCards(model.cards.length)}, ${nCols(model.ordered.length)}, картинок: ${model.images.size}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
