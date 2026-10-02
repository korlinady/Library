(() => {
  // ═════════ Помощники ═════════

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pad3 = (n) => { const s = String(n); return s.length >= 3 ? s : s.padStart(3, '0'); };
  const pad2 = (n) => String(n).padStart(2, '0');

  const BODY = document.body;
  const SCRIPT_URL = BODY.dataset.scriptUrl;
  const BASE = BODY.dataset.base || '/';
  const TZ = BODY.dataset.tz || 'Europe/Riga';
  const SITE_TITLE = BODY.dataset.siteTitle || document.title;
  const desktop = window.matchMedia('(min-width: 1024px)');

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  const nCards = (n) => `${n} ${plural(n, 'карточка', 'карточки', 'карточек')}`;
  const nFiles = (n) => `${n} ${plural(n, 'файл', 'файла', 'файлов')}`;
  const nSubs = (n) => `${n} ${plural(n, 'подколлекция', 'подколлекции', 'подколлекций')}`;
  const dateFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : dateFmt.format(d); };
  function fmtSize(bytes) {
    const b = Number(bytes);
    if (!b) return '';
    for (const [u, v] of [['ГБ', 1024 ** 3], ['МБ', 1024 ** 2], ['КБ', 1024]]) {
      if (b >= v) { const x = b / v; return `${(x >= 10 ? Math.round(x) : Math.round(x * 10) / 10).toString().replace('.', ',')} ${u}`; }
    }
    return `${b} Б`;
  }
  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
  function richText(text) {
    const linkify = (s) => s.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]]/g, (u) => `<a href="${u}" rel="noopener">${u}</a>`);
    return text.trim().split(/\n{2,}/).map((p) => `<p>${linkify(esc(p)).replace(/\n/g, '<br>')}</p>`).join('\n');
  }
  function tagTone(tag) {
    let h = 0;
    for (const ch of String(tag).toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h % 8;
  }

  const svg = (d, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${d}</svg>`;
  const EYE_OFF = '<path d="M3 3l18 18M10.6 5.1A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.4 6.4C3.7 8.2 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.5 4.9-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
  const ICON = {
    eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: svg(EYE_OFF),
    eyeOffSmall: svg(EYE_OFF, 14),
    pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>'),
    edit: svg('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'),
    trash: svg('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10.5 11v5M13.5 11v5"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    down: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', 18),
    ext: svg('<path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/>', 18),
  };

  // Какая это страница — по адресу, с которым её открыли
  const ROUTE = (() => {
    const p = location.pathname;
    const rest = p.startsWith(BASE) ? decodeURIComponent(p.slice(BASE.length)) : '';
    let m;
    if (rest === '' || rest === 'index.html') return { type: 'home' };
    if ((m = rest.match(/^c\/(\d+)\/?(index\.html)?$/))) return { type: 'card', id: Number(m[1]) };
    if ((m = rest.match(/^col\/([^/]+)\/?(index\.html)?$/))) return { type: 'col', id: m[1] };
    return { type: 'other' };
  })();

  // ═════════ Уведомление ═════════

  const toast = $('[data-toast]');
  let toastTimer;
  function say(text) {
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }
  try {
    const flash = sessionStorage.getItem('library:flash');
    if (flash) { sessionStorage.removeItem('library:flash'); setTimeout(() => say(flash), 300); }
  } catch {}

  // ═════════ Админ ═════════

  const KEY_STORE = 'library:key';
  const LIVE_STORE = 'library:live';
  let adminKey = store.get(KEY_STORE);
  const showAdmin = (root = document) => {
    if (adminKey) $$('[data-admin]', root).forEach((el) => { el.hidden = false; });
  };
  showAdmin();

  const RETRYABLE = new Set(['listAll', 'renameCard', 'updateCollection', 'setHidden', 'publish']);

  async function apiOnce(action, payload, timeout) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      let res;
      try {
        res = await fetch(SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ key: adminKey, action }, payload)),
          signal: ctrl.signal,
        });
      } catch {
        const err = new Error(ctrl.signal.aborted ? 'Скрипт не ответил вовремя. Попробуй ещё раз.' : 'Нет связи со скриптом. Проверь интернет.');
        err.retryable = true;
        throw err;
      }
      let data;
      try { data = await res.json(); } catch {
        const err = new Error(ctrl.signal.aborted ? 'Скрипт не ответил вовремя. Попробуй ещё раз.' : 'Скрипт ответил не так, как ожидалось.');
        err.retryable = ctrl.signal.aborted;
        throw err;
      }
      if (!data.ok) {
        if (data.error === 'unauthorized') {
          adminKey = null;
          store.del(KEY_STORE);
          store.del(LIVE_STORE);
          $$('[data-admin]').forEach((el) => { el.hidden = true; });
          throw new Error('Ключ не подходит. Войди заново в форме /admin.');
        }
        throw new Error(data.error || 'Неизвестная ошибка.');
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function api(action, payload) {
    const timeout = action === 'listAll' ? 20000 : 60000;
    const tries = RETRYABLE.has(action) ? 2 : 1;
    let last;
    for (let i = 0; i < tries; i++) {
      if (i > 0 && action !== 'listAll') say('Скрипт отвечает медленно, пробую ещё раз…');
      try {
        return await apiOnce(action, payload, timeout);
      } catch (err) {
        last = err;
        if (!err.retryable) throw err;
      }
    }
    if (action === 'createCollection' && /вовремя/.test(last.message)) {
      last.message = 'Скрипт не ответил за минуту. Коллекция могла создаться — обнови страницу и проверь.';
    }
    if (action === 'deleteCard' || action === 'deleteCollection') {
      if (/вовремя/.test(last.message)) last.message = 'Скрипт не ответил за минуту. Обнови страницу и проверь, удалилось ли.';
    }
    throw last;
  }

  // ═════════ Копирование ссылки ═════════

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const url = btn.dataset.copy ? new URL(btn.dataset.copy, location.href).href : location.href;
    try {
      await navigator.clipboard.writeText(url);
      say('Ссылка скопирована');
    } catch {
      window.prompt('Ссылка на карточку', url);
    }
  });

  // ═════════ Списки ═════════

  let query = '';
  let appliers = [];
  const applyAll = () => {
    appliers = appliers.filter((f) => f.list.isConnected);
    appliers.forEach((f) => f());
  };

  function matches(tile) {
    if (!query) return true;
    if (query.startsWith('#')) {
      const tag = query.slice(1).trim();
      return !tag || (tile.dataset.tags || '').split('|').includes(tag);
    }
    return (tile.dataset.search || '').includes(query);
  }

  function initList(list) {
    const grid = list && $('[data-grid]', list);
    if (!grid || list.dataset.ready) return;
    list.dataset.ready = '1';
    const count = $('[data-count]', list);
    const empty = $('[data-empty]', list);
    const sortBtn = $('[data-sort]', list);
    let filter = '';
    let newest = true;

    const apply = () => {
      let visible = 0;
      for (const t of $$('.tile', grid)) {
        const okFilter = !filter || (t.dataset.cols || '').split(' ').includes(filter);
        t.hidden = !(okFilter && matches(t));
        if (!t.hidden) visible++;
      }
      if (count) count.textContent = visible;
      if (empty) empty.hidden = visible > 0;
    };
    apply.list = list;
    appliers.push(apply);

    const setView = (v) => {
      grid.dataset.view = v;
      $$('[data-view]', list).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
      store.set('view', v);
    };
    setView(store.get('view') === 'list' ? 'list' : 'grid');
    $$('[data-view]', list).forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

    sortBtn?.addEventListener('click', () => {
      newest = !newest;
      grid.append(...$$('.tile', grid).reverse());
      sortBtn.textContent = newest ? 'Новые ↓' : 'Старые ↑';
      sortBtn.setAttribute('aria-label', newest ? 'Сначала старые' : 'Сначала новые');
    });

    list.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-filter]');
      if (!chip) return;
      filter = chip.dataset.filter;
      $$('[data-filter]', list).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      apply();
    });
    apply();
  }
  $$('[data-list]').forEach(initList);

  // ═════════ Поиск и теги ═════════

  const searchToggle = $('[data-search-toggle]');
  const searchBar = $('#search');
  const searchInput = $('[data-search]');
  searchToggle?.addEventListener('click', () => {
    const open = searchBar.hidden;
    searchBar.hidden = !open;
    searchToggle.setAttribute('aria-expanded', String(open));
    if (open) searchInput.focus();
    else { searchInput.value = ''; query = ''; applyAll(); }
  });
  searchInput?.addEventListener('input', () => {
    query = searchInput.value.trim().toLowerCase();
    applyAll();
  });
  function setSearch(text) {
    if (!searchInput) return;
    searchBar.hidden = false;
    searchToggle.setAttribute('aria-expanded', 'true');
    searchInput.value = text;
    query = text.trim().toLowerCase();
    applyAll();
    const list = $('[data-list]');
    if (list) list.scrollIntoView({ block: 'start' });
  }
  const initialQ = new URLSearchParams(location.search).get('q');
  if (initialQ) setSearch(initialQ);

  let closeSheet = null;
  let sheetCardId = null;

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-tag]');
    if (!a || !searchInput || ROUTE.type !== 'home') return;
    e.preventDefault();
    if (closeSheet) closeSheet();
    setSearch('#' + a.dataset.tag);
    history.replaceState(history.state, '', BASE + '?q=' + encodeURIComponent('#' + a.dataset.tag));
  });

  // ═════════ Данные из таблицы (только для админа) ═════════

  let model = null;          // свежие данные: всё, включая скрытое
  let builtCovers = new Set(); // обложки, уже собранные на сайте
  let liveJSON = '';

  function buildModel(data) {
    const byOrder = (a, b) => ((Number(a.order) || 0) - (Number(b.order) || 0)) || String(a.name).localeCompare(String(b.name), 'ru');
    const pub = (data.public.collections || []).map((c) => Object.assign({}, c, { priv: false, selfHidden: false }));
    const hid = (data.hidden.collections || []).map((c) => Object.assign({}, c, { priv: true, selfHidden: !!c.selfHidden }));
    const all = pub.concat(hid);
    const ids = new Set(all.map((c) => c.id));
    all.forEach((c) => { c.parent = c.parent && ids.has(c.parent) ? c.parent : ''; });

    const tops = pub.filter((c) => !c.parent).sort(byOrder).concat(hid.filter((c) => !c.parent).sort(byOrder));
    const ordered = [];
    tops.forEach((c, i) => {
      c.num = pad2(i + 1);
      c.parentCol = null;
      c.children = pub.filter((k) => k.parent === c.id).sort(byOrder).concat(hid.filter((k) => k.parent === c.id).sort(byOrder));
      ordered.push(c);
      c.children.forEach((k, j) => {
        k.num = `${c.num}.${j + 1}`;
        k.parentCol = c;
        k.children = [];
        ordered.push(k);
      });
    });
    const colById = new Map(ordered.map((c) => [c.id, c]));
    const mem = data.hidden.memberships || {};
    const cards = (data.public.cards || []).map((c) => Object.assign({}, c, { priv: false, selfHidden: false, collections: (c.collections || []).concat(mem[c.id] || []) }))
      .concat((data.hidden.cards || []).map((c) => Object.assign({}, c, { priv: true, selfHidden: !!c.selfHidden })))
      .map((c) => Object.assign(c, { id: Number(c.id), tags: c.tags || [], files: c.files || [], collections: (c.collections || []).filter((x) => colById.has(x)) }))
      .sort((a, b) => b.id - a.id);
    ordered.forEach((c) => {
      const set = new Set([c.id, ...c.children.map((k) => k.id)]);
      c.cards = cards.filter((x) => x.collections.some((y) => set.has(y)));
    });
    return { ordered, tops, colById, cards, cardById: new Map(cards.map((c) => [c.id, c])) };
  }

  const imgSrc = (id, w) => builtCovers.has(id)
    ? `${BASE}img/${id}-${w > 800 ? 1600 : 800}.webp`
    : `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w}`;

  // ═════════ Шаблоны (повторяют сборку) ═════════

  function tileHTML(c) {
    const n = c.files.length;
    const tags = c.tags.map((t) => t.toLowerCase()).join('|');
    const search = [c.title, c.description, c.tags.join(' ')].join(' ').toLowerCase();
    const img = c.cover ? `<img src="${imgSrc(c.cover, 800)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
    return `<a class="tile${c.priv ? ' tile--private' : ''}" href="${BASE}c/${pad3(c.id)}/" data-id="${c.id}" data-cols="${esc(c.collections.join(' '))}" data-tags="${esc(tags)}" data-search="${esc(search)}"${c.priv ? ' data-private="1"' : ''}>
<div class="tile-img">${img}</div>
<div class="tile-body">
<div class="tile-meta"><span>№ ${pad3(c.id)}</span><span class="tile-files">${n ? nFiles(n) : '—'}</span></div>
<span class="tile-title">${esc(c.title)}</span>
</div>
</a>`;
  }

  const visLabel = (self) => (self ? 'Показать всем' : 'Скрыть от всех');
  const visBtn = (kind, id, self) => `<button class="icon-btn" type="button" data-visibility="${kind}" data-id="${esc(id)}" data-admin hidden aria-label="${visLabel(self)}" title="${visLabel(self)}">${self ? ICON.eye : ICON.eyeOff}</button>`;
  const note = (text) => (text ? `<p class="private-note">${ICON.eyeOffSmall} ${esc(text)}</p>` : '');
  const cardNote = (c) => (c.priv ? (c.selfHidden ? 'Видна только тебе.' : 'Видна только тебе: все её коллекции скрыты.') : '');
  const colNote = (c) => (c.priv ? (c.selfHidden ? 'Видна только тебе.' : 'Видна только тебе: скрыта коллекция, в которой она лежит.') : '');

  function articleHTML(c) {
    const cols = c.collections.map((id) => model.colById.get(id)).filter(Boolean).map((k) =>
      `<a href="${BASE}col/${encodeURIComponent(k.id)}/"><span class="mono">${esc(k.num)}</span> ${esc(k.parentCol ? `${k.parentCol.name} / ${k.name}` : k.name)}</a>`);
    const facts = [
      cols.length && ['Коллекции', `<span class="fact-list">${cols.join('')}</span>`],
      c.created && ['Добавлено', `<span class="mono">${fmtDate(c.created)}</span>`],
      c.tags.length && ['Теги', `<span class="tags">${c.tags.map((t) =>
        `<a class="tag tag--${tagTone(t)}" href="${BASE}?q=${encodeURIComponent('#' + t)}" data-tag="${esc(t)}">${esc(t)}</a>`).join('')}</span>`],
      c.link && ['Источник', `<a href="${esc(c.link)}" rel="noopener">${esc(hostOf(c.link))} ↗</a>`],
    ].filter(Boolean);
    const files = c.files.map((f) => {
      const up = f.kind === 'upload';
      const url = up && f.driveId ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(f.driveId)}` : f.url;
      return `<a class="file" href="${esc(url)}" rel="noopener"${up ? '' : ' target="_blank"'}>
<span class="file-type">${esc(f.type || 'FILE')}</span>
<span class="file-name">${esc(f.title)}</span>
<span class="file-size">${esc(fmtSize(f.size))}</span>
<span class="file-icon" aria-label="${up ? 'Скачать' : 'Открыть на Drive'}">${up ? ICON.down : ICON.ext}</span>
</a>`;
    });
    const cover = c.cover ? `<img src="${imgSrc(c.cover, 1600)}" alt="${esc(c.title)}" referrerpolicy="no-referrer">` : '';
    return `<article class="card" data-num="${pad3(c.id)}" data-id="${c.id}" data-title="${esc(c.title)}">
<figure class="card-cover${cover ? '' : ' card-cover--empty'}">${cover}</figure>
<div class="title-row card-title-row">
<h1 class="card-title" data-title-text>${esc(c.title)}</h1>
<button class="icon-btn" type="button" data-rename="card" data-id="${c.id}" data-admin hidden aria-label="Переименовать карточку">${ICON.pencil}</button>
</div>
${note(cardNote(c))}
${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
${c.description ? `<section class="card-desc"><h2 class="section-label">Описание</h2>${richText(c.description)}</section>` : ''}
${files.length ? `<section class="card-files"><div class="bar"><h2 class="bar-label">Файлы</h2><span>${pad2(files.length)}</span></div>${files.join('\n')}</section>` : ''}
<p class="card-path">/c/${pad3(c.id)}</p>
</article>`;
  }

  function cardListHTML(cards, label, chips = '') {
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
${cards.map(tileHTML).join('\n')}
</div></div>
<p class="empty" data-empty${cards.length ? ' hidden' : ''}>${cards.length ? 'Ничего не найдено. Попробуйте другое слово.' : 'Карточек пока нет.'}</p>
</section>`;
  }

  function navRowsHTML(active) {
    return model.ordered.map((c) => {
      const on = c.id === active;
      return `<a class="crow${c.parentCol ? ' crow--sub' : ''}${c.priv ? ' crow--private' : ''}${on ? ' is-active' : ''}" href="${BASE}col/${encodeURIComponent(c.id)}/" data-col="${esc(c.id)}"${c.parentCol ? ` data-parent="${esc(c.parentCol.id)}"` : ''}${c.priv ? ' data-private="1"' : ''}${on ? ' aria-current="page"' : ''}>
<span class="crow-num">${esc(c.num)}</span><span class="crow-name">${esc(c.name)}</span><span class="crow-count">${c.priv ? `<span class="crow-flag" aria-label="скрыта">${ICON.eyeOffSmall}</span>` : ''}${c.cards.length}</span>
</a>`;
    }).join('\n');
  }

  function colPageHTML(c) {
    const parent = c.parentCol;
    const crumbs = parent
      ? `<a href="${BASE}">Коллекции</a> / <a href="${BASE}col/${encodeURIComponent(parent.id)}/">${esc(parent.num)}</a> / ${esc(c.num)}`
      : `<a href="${BASE}">Коллекции</a> / ${esc(c.num)}`;
    const meta = [nCards(c.cards.length), c.children.length ? nSubs(c.children.length) : ''].filter(Boolean).join(' · ');
    const chips = c.children.length && c.cards.length
      ? `<div class="chips" role="group" aria-label="Подколлекции">
<button class="chip" type="button" data-filter="" aria-pressed="true">Все <span class="chip-n">${c.cards.length}</span></button>
${c.children.map((k) => `<button class="chip" type="button" data-filter="${esc(k.id)}" aria-pressed="false"><span class="chip-n">${esc(k.num)}</span> <span class="chip-name">${esc(k.name)}</span> <span class="chip-n">${k.cards.length}</span></button>`).join('\n')}
</div>`
      : '';
    // Подколлекция, скрытая вместе с родителем, своей галочкой не управляется
    const canToggle = !(c.priv && !c.selfHidden && parent);
    return `<section class="hero hero--col">
<p class="crumbs">${crumbs}</p>
<div class="title-row">
<h1 class="hero-title" data-title-text>${esc(c.name)}</h1>
<div class="title-actions">
${canToggle ? visBtn('collection', c.id, c.selfHidden) : ''}
<button class="icon-btn" type="button" data-rename="collection" data-id="${esc(c.id)}" data-admin hidden aria-label="Изменить название и описание коллекции">${ICON.pencil}</button>
<button class="icon-btn" type="button" data-delete-col data-id="${esc(c.id)}" data-admin hidden aria-label="Удалить коллекцию">${ICON.trash}</button>
</div>
</div>
${note(colNote(c))}
<p class="lede" data-col-desc${c.description ? '' : ' hidden'}>${esc(c.description || '')}</p>
<p class="meta">${esc(meta)}</p>
${parent ? '' : `<div class="col-admin col-admin--hero" data-admin hidden><button class="link-btn" type="button" data-new-col data-parent="${esc(c.id)}">+ Подколлекция</button></div>`}
</section>
${cardListHTML(c.cards, 'Карточки', chips)}`;
  }

  function cardPageHTML(c) {
    return `<div class="card-page">
<div class="card-bar">
<span class="card-bar-num">№ ${pad3(c.id)}</span>
<div class="card-bar-actions">
<a class="icon-btn" href="${BASE}admin/?edit=${c.id}" data-edit data-admin hidden aria-label="Редактировать карточку">${ICON.edit}</a>
${visBtn('card', c.id, c.selfHidden)}
<button class="icon-btn" type="button" data-delete data-admin hidden aria-label="Удалить карточку">${ICON.trash}</button>
<button class="icon-btn" type="button" data-copy aria-label="Скопировать ссылку на карточку">${ICON.link}</button>
<a class="icon-btn" href="${BASE}" aria-label="Закрыть">${ICON.close}</a>
</div>
</div>
${articleHTML(c)}
</div>`;
  }

  // ═════════ Отрисовка из свежих данных ═════════

  function setVisButton(btn, c) {
    if (!btn || !c) return;
    btn.innerHTML = c.selfHidden ? ICON.eye : ICON.eyeOff;
    btn.setAttribute('aria-label', visLabel(c.selfHidden));
    btn.title = visLabel(c.selfHidden);
  }

  function renderNavs() {
    const active = ROUTE.type === 'col' ? ROUTE.id : null;
    const side = $('.side nav');
    if (side) {
      $$('[data-col], .crow--pending', side).forEach((r) => r.remove());
      const all = $('a.crow', side);
      if (all) {
        $('.crow-count', all).textContent = model.cards.length;
        all.insertAdjacentHTML('afterend', navRowsHTML(active));
      } else {
        side.insertAdjacentHTML('beforeend', navRowsHTML(active));
      }
    }
    const inline = $('.index-inline nav');
    if (inline) {
      inline.innerHTML = model.ordered.length ? navRowsHTML(active) : '<p class="empty empty--tight">Коллекций пока нет.</p>';
      const count = $('.index-inline .bar > span:last-child');
      if (count) count.textContent = pad2(model.tops.length);
    }
  }

  function renderMain() {
    const main = $('#main');
    if (ROUTE.type === 'home') {
      const list = $('section.list', main);
      const tmp = document.createElement('div');
      tmp.innerHTML = cardListHTML(model.cards, 'Все карточки');
      const fresh = tmp.firstElementChild;
      if (list) list.replaceWith(fresh); else main.append(fresh);
      initList(fresh);
    } else if (ROUTE.type === 'col') {
      const c = model.colById.get(ROUTE.id);
      if (!c) { notFound(main, 'Коллекции больше нет. Возможно, её удалили.'); return; }
      BODY.classList.remove('page-404');
      BODY.classList.add('page-col');
      document.title = `${c.name} — ${SITE_TITLE}`;
      main.innerHTML = colPageHTML(c);
      initList($('[data-list]', main));
    } else if (ROUTE.type === 'card') {
      const c = model.cardById.get(ROUTE.id);
      if (!c) { notFound(main, 'Карточки больше нет. Возможно, её удалили.'); return; }
      BODY.classList.remove('page-404');
      BODY.classList.add('page-card');
      document.title = `${c.title} — ${SITE_TITLE}`;
      main.innerHTML = cardPageHTML(c);
    }
  }

  function notFound(main, text) {
    if (BODY.classList.contains('page-404')) return; // настоящая 404 уже на месте
    main.innerHTML = `<section class="hero"><h1 class="hero-title">Нет такой страницы</h1><p class="lede">${esc(text)}</p><p><a class="link" href="${BASE}">Перейти ко всем карточкам</a></p></section>`;
  }

  function renderSheet() {
    if (!sheetCardId || !BODY.classList.contains('sheet-open')) return;
    const c = model.cardById.get(sheetCardId);
    if (!c) { if (closeSheet) closeSheet(); return; }
    const body = $('[data-sheet-body]');
    const scroll = $('[data-sheet]').scrollTop;
    body.innerHTML = articleHTML(c);
    const h = $('h1', body);
    if (h) h.id = 'sheet-title';
    setVisButton($('[data-sheet] [data-visibility]'), c);
    showAdmin(body);
    $('[data-sheet]').scrollTop = scroll;
  }

  // Пока открыто поле правки, страницу не перерисовываем — иначе пропадёт набранный текст
  let pendingRender = false;
  const editing = () => !!$('.rename-form, .mini-form');
  function flushRender() {
    if (pendingRender && !editing()) { pendingRender = false; renderAll(); }
  }

  function renderAll() {
    if (!model) return;
    if (editing()) { pendingRender = true; return; }
    renderNavs();
    renderMain();
    renderSheet();
    showAdmin();
    applyAll();
  }

  let liveTs = '';
  function useLive(data) {
    // Ответы могут прийти не по порядку: старше показанного — пропускаем
    const ts = (data.public && data.public.generatedAt) || '';
    if (liveTs && ts && ts < liveTs) return;
    if (ts) liveTs = ts;
    const json = JSON.stringify(data);
    store.set(LIVE_STORE, JSON.stringify({ ts: Date.now(), data }));
    if (json === liveJSON) return;
    liveJSON = json;
    model = buildModel(data);
    renderAll();
  }

  async function startLive() {
    if (!adminKey) return;
    try {
      const built = await fetch(`${BASE}data.json`).then((r) => r.json());
      builtCovers = new Set([...(built.cards || []), ...(built.collections || [])].map((x) => x.cover).filter(Boolean));
    } catch {}
    // Сразу — из сохранённого, затем тихо обновляем
    try {
      const cached = JSON.parse(store.get(LIVE_STORE) || 'null');
      if (cached && cached.data && Date.now() - cached.ts < 7 * 24 * 3600 * 1000) useLive(cached.data);
    } catch {}
    try {
      const r = await api('listAll');
      useLive({ public: r.public, hidden: r.hidden });
    } catch (err) {
      say(err.message);
    }
  }

  // Все правки: запрос с withLive — скрипт сразу возвращает свежие данные
  async function write(action, payload) {
    const r = await api(action, Object.assign({ withLive: true }, payload));
    if (r.live) useLive(r.live);
    return r;
  }

  // ═════════ Видимость ═════════

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-visibility]');
    if (!btn || !adminKey || !model) return;
    const kind = btn.dataset.visibility;
    const id = kind === 'card' ? Number(btn.dataset.id || sheetCardId) : btn.dataset.id;
    const item = kind === 'card' ? model.cardById.get(id) : model.colById.get(id);
    if (!item) return;
    const next = !item.selfHidden;
    btn.disabled = true;
    try {
      await write('setHidden', { kind, id, hidden: next });
      const what = kind === 'card' ? 'Карточка' : 'Коллекция';
      say(next ? `${what} скрыта. Теперь её видишь только ты` : `${what} открыта. Посетители увидят её через 1–2 минуты`);
    } catch (err) {
      say(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ═════════ Удаление карточки ═════════

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete]');
    if (!btn || !adminKey) return;
    const article = $('article.card', btn.closest('[data-sheet]') || document);
    if (!article) return;
    const ok = window.confirm(`Удалить карточку № ${article.dataset.num} «${article.dataset.title}»?\n\nЗагруженные файлы уйдут в корзину Google Drive, оттуда их можно восстановить в течение 30 дней. Файлы, добавленные ссылкой, останутся на месте.`);
    if (!ok) return;
    btn.disabled = true;
    try {
      const inSheet = !!btn.closest('[data-sheet]');
      if (inSheet && closeSheet) closeSheet();
      await write('deleteCard', { id: Number(article.dataset.id) });
      if (inSheet) say('Карточка удалена');
      else {
        try { sessionStorage.setItem('library:flash', 'Карточка удалена'); } catch {}
        location.href = BASE;
      }
    } catch (err) {
      say(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ═════════ Удаление коллекции ═════════

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete-col]');
    if (!btn || !adminKey || !model) return;
    const c = model.colById.get(btn.dataset.id);
    if (!c) return;
    const isSub = !!c.parentCol;
    const inner = c.children.length ? ` и ${nSubs(c.children.length).replace('подколлекция', 'подколлекцию')} внутри неё` : '';
    const ok = window.confirm(`Удалить ${isSub ? 'подколлекцию' : 'коллекцию'} «${c.name}»${inner}?\n\nКарточки не удалятся: они останутся во «Всех карточках» и в других своих коллекциях. Карточки, которые были скрыты вместе с этой коллекцией, так и останутся скрытыми.`);
    if (!ok) return;
    btn.disabled = true;
    try {
      await write('deleteCollection', { id: c.id });
      try { sessionStorage.setItem('library:flash', isSub ? 'Подколлекция удалена' : 'Коллекция удалена'); } catch {}
      location.href = isSub ? `${BASE}col/${encodeURIComponent(c.parentCol.id)}/` : BASE;
    } catch (err) {
      btn.disabled = false;
      say(err.message);
    }
  });

  // ═════════ Переименование и описание ═════════

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rename]');
    if (!btn || !adminKey) return;
    const row = btn.closest('.title-row');
    if (!row || $('.rename-form', row)) return;
    const heading = $('[data-title-text]', row);
    const kind = btn.dataset.rename;
    const id = btn.dataset.id;
    const old = heading.textContent;
    const actions = btn.closest('.title-actions') || btn;

    const form = document.createElement('form');
    form.className = 'rename-form';
    const label = document.createElement('label');
    label.className = 'sr-only';
    label.textContent = kind === 'card' ? 'Новое название карточки' : 'Новое название коллекции';
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.type = 'text';
    input.value = old;
    input.maxLength = kind === 'card' ? 200 : 120;
    input.id = 'rename-' + Date.now();
    label.htmlFor = input.id;
    const btns = document.createElement('div');
    btns.className = 'rename-btns';
    btns.innerHTML = '<button class="rename-save" type="submit">Сохранить</button><button class="rename-cancel" type="button">Отмена</button>';

    let textarea = null;
    const lede = kind === 'collection' ? $('[data-col-desc]', row.parentElement) : null;
    if (lede) {
      const dl = document.createElement('label');
      dl.className = 'rename-label';
      dl.textContent = 'Описание';
      textarea = document.createElement('textarea');
      textarea.className = 'rename-text';
      textarea.id = input.id + '-desc';
      textarea.maxLength = 4000;
      textarea.value = lede.textContent.trim();
      dl.htmlFor = textarea.id;
      form.append(label, input, dl, textarea, btns);
      lede.hidden = true;
    } else {
      form.append(label, input, btns);
    }

    heading.hidden = true;
    actions.hidden = true;
    row.prepend(form);
    input.focus();
    input.select();

    const finish = () => {
      form.remove();
      if (lede) lede.hidden = !lede.textContent.trim();
      heading.hidden = false;
      actions.hidden = false;
      flushRender();
    };
    $('.rename-cancel', form).addEventListener('click', finish);
    form.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); finish(); } });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const name = input.value.trim();
      if (!name) { say('Название не может быть пустым'); return; }
      const description = textarea ? textarea.value.trim() : undefined;
      if (name === old && (!textarea || description === lede.textContent.trim())) { finish(); return; }
      const save = $('.rename-save', form);
      save.disabled = true;
      try {
        if (kind === 'card') await write('renameCard', { id: Number(id), title: name });
        else await write('updateCollection', { id, name, description });
        if (form.isConnected) finish();
        say('Сохранено');
      } catch (err) {
        save.disabled = false;
        say(err.message);
      }
    });
  });

  // ═════════ Новые коллекции ═════════

  function field(labelText, control, check = false) {
    const wrap = document.createElement(check ? 'label' : 'div');
    wrap.className = check ? 'check' : 'field';
    if (check) {
      wrap.append(control, document.createTextNode(' ' + labelText));
      return wrap;
    }
    const label = document.createElement('label');
    label.className = 'rename-label';
    label.textContent = labelText;
    control.id = 'nc-' + Math.random().toString(36).slice(2);
    label.htmlFor = control.id;
    wrap.append(label, control);
    return wrap;
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-new-col]');
    if (!btn || !adminKey) return;
    const holder = btn.parentElement;
    if ($('.mini-form', holder)) return;
    const fixedParent = btn.dataset.parent || '';

    const form = document.createElement('form');
    form.className = 'mini-form';
    const name = document.createElement('input');
    name.className = 'mini-input';
    name.type = 'text';
    name.maxLength = 120;
    const desc = document.createElement('textarea');
    desc.className = 'mini-input';
    desc.maxLength = 4000;
    form.append(field(fixedParent ? 'Название подколлекции' : 'Название', name), field('Описание (необязательно)', desc));

    let parentSelect = null;
    if (!fixedParent) {
      parentSelect = document.createElement('select');
      parentSelect.className = 'mini-input';
      parentSelect.add(new Option('Нет, верхний уровень', ''));
      const tops = model ? model.tops.map((c) => ({ id: c.id, label: `${c.num} ${c.name}` }))
        : $$('.side nav [data-col]:not(.crow--sub)').map((r) => ({ id: r.dataset.col, label: `${$('.crow-num', r).textContent} ${$('.crow-name', r).textContent}` }));
      tops.forEach((c) => parentSelect.add(new Option(c.label, c.id)));
      form.append(field('Внутри коллекции', parentSelect));
    }
    const priv = document.createElement('input');
    priv.type = 'checkbox';
    form.append(field('Видна только мне', priv, true));

    const btns = document.createElement('div');
    btns.className = 'rename-btns';
    btns.innerHTML = '<button class="rename-save" type="submit">Создать</button><button class="rename-cancel" type="button">Отмена</button>';
    form.append(btns);

    btn.hidden = true;
    holder.append(form);
    name.focus();

    const finish = () => { form.remove(); btn.hidden = false; flushRender(); };
    $('.rename-cancel', form).addEventListener('click', finish);
    form.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); finish(); } });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const n = name.value.trim();
      if (!n) { say('Добавь название'); name.focus(); return; }
      const parent = fixedParent || (parentSelect ? parentSelect.value : '');
      const save = $('.rename-save', form);
      save.disabled = true;
      try {
        await write('createCollection', { name: n, description: desc.value.trim(), parent, hidden: priv.checked });
        if (form.isConnected) finish();
        say(parent ? 'Подколлекция создана' : 'Коллекция создана');
      } catch (err) {
        save.disabled = false;
        say(err.message);
      }
    });
  });

  // ═════════ Шторка с карточкой ═════════

  const sheet = $('[data-sheet]');
  if (sheet) {
    const body = $('[data-sheet-body]', sheet);
    const num = $('[data-sheet-num]', sheet);
    const copyBtn = $('[data-copy]', sheet);
    const closeBtn = $('[data-sheet-close]', sheet);
    const backdrop = $('[data-backdrop]');
    const listTitle = document.title;
    const cache = new Map();
    let lastTile = null;
    let hideTimer;

    const idFromUrl = (url) => { const m = new URL(url, location.href).pathname.match(/\/c\/(\d+)\/?$/); return m ? Number(m[1]) : null; };

    function load(url) {
      const id = idFromUrl(url);
      const live = model && id && model.cardById.get(id);
      if (live) {
        const tmp = document.createElement('div');
        tmp.innerHTML = articleHTML(live);
        return Promise.resolve({ article: tmp.firstElementChild, title: `${live.title} — ${SITE_TITLE}`, card: live });
      }
      if (!cache.has(url)) {
        cache.set(url, fetch(url)
          .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
          .then((html) => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const article = doc.querySelector('article.card');
            if (!article) throw new Error('no card');
            return { article, title: doc.title };
          })
          .catch((err) => { cache.delete(url); throw err; }));
      }
      return cache.get(url);
    }

    async function open(url, push) {
      let data;
      try { data = await load(url); } catch { location.href = url; return; }
      clearTimeout(hideTimer);
      const article = document.importNode(data.article, true);
      const h = $('h1', article);
      if (h) h.id = 'sheet-title';
      body.replaceChildren(article);
      sheetCardId = Number(article.dataset.id);
      num.textContent = '№ ' + (article.dataset.num || '');
      copyBtn.dataset.copy = url;
      const edit = $('[data-edit]', sheet);
      if (edit) edit.href = `${BASE}admin/?edit=${article.dataset.id}`;
      const vis = $('[data-visibility]', sheet);
      if (vis) {
        vis.dataset.id = article.dataset.id;
        setVisButton(vis, data.card || (model && model.cardById.get(sheetCardId)) || { selfHidden: false });
      }
      showAdmin(sheet);
      document.title = data.title;

      sheet.hidden = false;
      backdrop.hidden = false;
      sheet.scrollTop = 0;
      sheet.style.transform = '';
      requestAnimationFrame(() => requestAnimationFrame(() => BODY.classList.add('sheet-open')));
      if (push) history.pushState({ sheet: url }, '', url);
      closeBtn.focus({ preventScroll: true });
    }

    function hide() {
      BODY.classList.remove('sheet-open');
      document.title = listTitle;
      sheet.style.transform = '';
      sheetCardId = null;
      hideTimer = setTimeout(() => {
        sheet.hidden = true;
        backdrop.hidden = true;
        body.replaceChildren();
      }, 300);
      if (lastTile && lastTile.isConnected) lastTile.focus({ preventScroll: true });
    }

    function close() {
      if (history.state && history.state.sheet) history.back();
      else hide();
    }
    closeSheet = close;

    document.addEventListener('click', (e) => {
      const a = e.target.closest('a.tile');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      lastTile = a;
      const inSheet = history.state && history.state.sheet;
      open(a.href, !inSheet);
      if (inSheet) history.replaceState({ sheet: a.href }, '', a.href);
    });

    const prefetch = (e) => {
      if (model) return;
      const a = e.target.closest && e.target.closest('a.tile');
      if (a) load(a.href).catch(() => {});
    };
    document.addEventListener('pointerover', prefetch, { passive: true });
    document.addEventListener('touchstart', prefetch, { passive: true });

    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.sheet) open(e.state.sheet, false);
      else if (BODY.classList.contains('sheet-open')) hide();
    });

    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && BODY.classList.contains('sheet-open')) close();
    });

    let startY = null;
    let dy = 0;
    $$('[data-drag]', sheet).forEach((el) => {
      el.addEventListener('touchstart', (e) => {
        if (desktop.matches || sheet.scrollTop > 0) return;
        startY = e.touches[0].clientY;
        dy = 0;
        sheet.style.transition = 'none';
      }, { passive: true });
      el.addEventListener('touchmove', (e) => {
        if (startY === null) return;
        dy = Math.max(0, e.touches[0].clientY - startY);
        sheet.style.transform = `translateY(${dy}px)`;
      }, { passive: true });
      el.addEventListener('touchend', () => {
        if (startY === null) return;
        startY = null;
        sheet.style.transition = '';
        if (dy > 120) close();
        else sheet.style.transform = '';
      });
    });
  }

  // ═════════ Старт ═════════

  applyAll();
  startLive();
})();
