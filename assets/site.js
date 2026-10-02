(() => {
  // ═════════ Помощники ═════════

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const readJSON = (k, fallback) => { try { return JSON.parse(store.get(k) || 'null') ?? fallback; } catch { return fallback; } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pad3 = (n) => { const s = String(n); return s.length >= 3 ? s : s.padStart(3, '0'); };
  const sel = (v) => CSS.escape(String(v));

  const BODY = document.body;
  const SCRIPT_URL = BODY.dataset.scriptUrl;
  const BASE = BODY.dataset.base || '/';
  const TZ = BODY.dataset.tz || 'Europe/Riga';
  const SITE_TITLE = BODY.dataset.siteTitle || document.title;
  const desktop = window.matchMedia('(min-width: 1024px)');
  const FRESH = 15 * 60 * 1000;

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  const nCards = (n) => `${n} ${plural(n, 'карточка', 'карточки', 'карточек')}`;
  const nFiles = (n) => `${n} ${plural(n, 'файл', 'файла', 'файлов')}`;
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
  const driveImg = (id, w) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w}`;

  const svg = (d, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${d}</svg>`;
  const ICON = {
    eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: svg('<path d="M3 3l18 18M10.6 5.1A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.4 6.4C3.7 8.2 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.5 4.9-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
    eyeOffSmall: svg('<path d="M3 3l18 18M10.6 5.1A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.4 6.4C3.7 8.2 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.5 4.9-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 14),
    pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>'),
    edit: svg('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'),
    trash: svg('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10.5 11v5M13.5 11v5"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    down: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', 18),
    ext: svg('<path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/>', 18),
  };

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

  // ═════════ Админ ═════════

  const KEY_STORE = 'library:key';
  let adminKey = store.get(KEY_STORE);
  const showAdmin = (root = document) => {
    if (adminKey) $$('[data-admin]', root).forEach((el) => { el.hidden = false; });
  };
  showAdmin();

  async function api(action, payload) {
    let res;
    try {
      res = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ key: adminKey, action }, payload)),
      });
    } catch {
      throw new Error('Нет связи со скриптом. Проверь интернет.');
    }
    let data;
    try { data = await res.json(); } catch { throw new Error('Скрипт ответил не так, как ожидалось.'); }
    if (!data.ok) {
      if (data.error === 'unauthorized') {
        adminKey = null;
        store.del(KEY_STORE);
        $$('[data-admin]').forEach((el) => { el.hidden = true; });
        throw new Error('Ключ не подходит. Войди заново в форме /admin.');
      }
      throw new Error(data.error || 'Неизвестная ошибка.');
    }
    return data;
  }

  // Временные отметки до пересборки сайта
  function freshStore(k, isDone = () => false) {
    const d = readJSON(k, {});
    const now = Date.now();
    for (const id in d) {
      if (!d[id] || typeof d[id] !== 'object') d[id] = { ts: Number(d[id]) || 0 };
      if (now - d[id].ts > FRESH || isDone(id, d[id])) delete d[id];
    }
    store.set(k, JSON.stringify(d));
    return d;
  }
  const saveStore = (k, d) => store.set(k, JSON.stringify(d));

  const deleted = freshStore('library:deleted');
  const renames = freshStore('library:renames');
  const newCols = freshStore('library:newcols', (id) => !!$(`a.crow[data-col="${sel(id)}"]`));
  const deletedCols = freshStore('library:deletedcols', (id) => !$(`a.crow[data-col="${sel(id)}"]:not([data-client])`));
  function hideDeletedCols() {
    for (const id in deletedCols) {
      $$(`[data-col="${sel(id)}"]`).forEach((r) => r.remove());
      $$(`[data-filter="${sel(id)}"]`).forEach((c) => c.remove());
    }
  }

  // Сообщение, переданное через переход на другую страницу
  try {
    const flash = sessionStorage.getItem('library:flash');
    if (flash) { sessionStorage.removeItem('library:flash'); setTimeout(() => say(flash), 300); }
  } catch {}

  // Только что открытые для всех: видны админу, пока сайт не пересоберётся
  const transit = freshStore('library:transit', (key) => {
    const [kind, id] = key.split(':');
    return kind === 'card' ? !!$(`a.tile[data-id="${sel(id)}"]:not([data-client])`)
      : !!$(`a.crow[data-col="${sel(id)}"]:not([data-client])`);
  });

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
  const appliers = [];
  const applyAll = () => appliers.forEach((f) => f());

  function matches(tile) {
    if (!query) return true;
    if (query.startsWith('#')) {
      const tag = query.slice(1).trim();
      return !tag || (tile.dataset.tags || '').split('|').includes(tag);
    }
    return (tile.dataset.search || '').includes(query);
  }

  function initList(list) {
    const grid = $('[data-grid]', list);
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
        t.hidden = !(okFilter && matches(t)) || !!deleted[t.dataset.id];
        if (!t.hidden) visible++;
      }
      if (count) count.textContent = visible;
      if (empty) empty.hidden = visible > 0;
    };
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

  // ═════════ Поиск ═════════

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

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-tag]');
    if (!a || !searchInput || !BODY.classList.contains('page-home')) return;
    e.preventDefault();
    if (closeSheet) closeSheet();
    setSearch('#' + a.dataset.tag);
    history.replaceState(history.state, '', BASE + '?q=' + encodeURIComponent('#' + a.dataset.tag));
  });

  // ═════════ Правки: применение к странице ═════════

  function applyRename(kind, id, entry, root = document) {
    if (kind === 'card') {
      $$(`a.tile[data-id="${sel(id)}"] .tile-title`, root).forEach((el) => { el.textContent = entry.name; });
      $$(`article.card[data-id="${sel(id)}"]`, root).forEach((a) => {
        a.dataset.title = entry.name;
        const h = $('[data-title-text]', a);
        if (h) h.textContent = entry.name;
      });
    } else {
      $$(`[data-col="${sel(id)}"] .crow-name`, root).forEach((el) => { el.textContent = entry.name; });
      $$(`[data-col-name="${sel(id)}"]`, root).forEach((el) => { el.textContent = entry.name; });
      if (typeof entry.description === 'string') {
        $$(`[data-col-desc="${sel(id)}"]`, root).forEach((el) => {
          el.textContent = entry.description;
          el.hidden = !entry.description;
        });
      }
    }
  }
  function applyAllRenames(root = document) {
    for (const k in renames) {
      const i = k.indexOf(':');
      applyRename(k.slice(0, i), k.slice(i + 1), renames[k], root);
    }
  }

  // ═════════ Шаблоны (повторяют сборку) ═════════

  // Сведения о коллекциях берём из левой колонки: она есть на каждой странице
  function colInfo(id) {
    const row = $(`.side nav [data-col="${sel(id)}"]`);
    if (!row) return null;
    return {
      id,
      num: $('.crow-num', row).textContent,
      name: $('.crow-name', row).textContent,
      parent: row.dataset.parent || '',
    };
  }
  const childIds = (id) => $$(`.side nav [data-parent="${sel(id)}"]`).map((r) => r.dataset.col);

  function tileHTML(card, priv) {
    const n = (card.files || []).length;
    const tags = (card.tags || []).map((t) => t.toLowerCase()).join('|');
    const search = [card.title, card.description, (card.tags || []).join(' ')].join(' ').toLowerCase();
    const img = card.cover ? `<img src="${driveImg(card.cover, 800)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
    return `<a class="tile${priv ? ' tile--private' : ''}" href="${BASE}c/${pad3(card.id)}/" data-id="${card.id}" data-cols="${esc((card.collections || []).join(' '))}" data-tags="${esc(tags)}" data-search="${esc(search)}" data-client="1"${priv ? ' data-private="1"' : ''}>
<div class="tile-img">${img}</div>
<div class="tile-body">
<div class="tile-meta"><span>№ ${pad3(card.id)}</span><span class="tile-files">${n ? nFiles(n) : '—'}</span></div>
<span class="tile-title">${esc(card.title)}</span>
</div>
</a>`;
  }

  function articleHTML(card) {
    const cols = (card.collections || []).map(colInfo).filter(Boolean).map((c) => {
      const p = c.parent ? colInfo(c.parent) : null;
      return `<a href="${BASE}col/${encodeURIComponent(c.id)}/"><span class="mono">${esc(c.num)}</span> ${esc(p ? `${p.name} / ${c.name}` : c.name)}</a>`;
    });
    const facts = [
      cols.length && ['Коллекции', `<span class="fact-list">${cols.join('')}</span>`],
      card.created && ['Добавлено', `<span class="mono">${fmtDate(card.created)}</span>`],
      (card.tags || []).length && ['Теги', `<span class="tags">${card.tags.map((t) =>
        `<a class="tag tag--${tagTone(t)}" href="${BASE}?q=${encodeURIComponent('#' + t)}" data-tag="${esc(t)}">${esc(t)}</a>`).join('')}</span>`],
      card.link && ['Источник', `<a href="${esc(card.link)}" rel="noopener">${esc(hostOf(card.link))} ↗</a>`],
    ].filter(Boolean);
    const files = (card.files || []).map((f) => {
      const up = f.kind === 'upload';
      const url = up && f.driveId ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(f.driveId)}` : f.url;
      return `<a class="file" href="${esc(url)}" rel="noopener"${up ? '' : ' target="_blank"'}>
<span class="file-type">${esc(f.type || 'FILE')}</span>
<span class="file-name">${esc(f.title)}</span>
<span class="file-size">${esc(fmtSize(f.size))}</span>
<span class="file-icon" aria-label="${up ? 'Скачать' : 'Открыть на Drive'}">${up ? ICON.down : ICON.ext}</span>
</a>`;
    });
    const cover = card.cover ? `<img src="${driveImg(card.cover, 1600)}" alt="${esc(card.title)}" referrerpolicy="no-referrer">` : '';
    return `<article class="card" data-num="${pad3(card.id)}" data-id="${card.id}" data-title="${esc(card.title)}">
<figure class="card-cover${cover ? '' : ' card-cover--empty'}">${cover}</figure>
<div class="title-row card-title-row">
<h1 class="card-title" data-title-text>${esc(card.title)}</h1>
<button class="icon-btn" type="button" data-rename="card" data-id="${card.id}" data-admin hidden aria-label="Переименовать карточку">${ICON.pencil}</button>
</div>
${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
${card.description ? `<section class="card-desc"><h2 class="section-label">Описание</h2>${richText(card.description)}</section>` : ''}
${files.length ? `<section class="card-files"><div class="bar"><h2 class="bar-label">Файлы</h2><span>${String(files.length).padStart(2, '0')}</span></div>${files.join('\n')}</section>` : ''}
<p class="card-path">/c/${pad3(card.id)}</p>
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
${cards.map((c) => tileHTML(c, c._priv)).join('\n')}
</div></div>
<p class="empty" data-empty${cards.length ? ' hidden' : ''}>${cards.length ? 'Ничего не найдено. Попробуйте другое слово.' : 'Карточек пока нет.'}</p>
</section>`;
  }

  // ═════════ Скрытые карточки и коллекции ═════════

  const HIDDEN_CACHE = 'library:hidden-cache';
  let hidden = { collections: [], cards: [], memberships: {} };
  const hiddenCardById = () => new Map(hidden.cards.map((c) => [String(c.id), c]));
  const hiddenColById = () => new Map(hidden.collections.map((c) => [c.id, c]));
  let privateReady = Promise.resolve();

  // Карточки, которые админ видит, но которых нет в сборке: скрытые + только что открытые
  function clientCards() {
    const list = hidden.cards.map((c) => Object.assign({}, c, { _priv: true }));
    for (const k in transit) {
      if (k.startsWith('card:') && !list.some((c) => String(c.id) === k.slice(5))) {
        list.push(Object.assign({}, transit[k].data, { _priv: false }));
      }
    }
    return list;
  }
  function clientCols() {
    const list = hidden.collections.filter((c) => !deletedCols[c.id]).map((c) => Object.assign({}, c, { _priv: true }));
    for (const k in transit) {
      if (k.startsWith('col:') && !list.some((c) => c.id === k.slice(4))) {
        list.push(Object.assign({}, transit[k].data, { _priv: false }));
      }
    }
    return list;
  }

  function markTile(tile, priv) {
    tile.classList.toggle('tile--private', priv);
    if (priv) tile.dataset.private = '1';
    else delete tile.dataset.private;
  }

  function markRow(row, priv) {
    row.classList.toggle('crow--private', priv);
    if (priv) row.dataset.private = '1';
    else delete row.dataset.private;
    let flag = $('.crow-flag', row);
    if (priv && !flag) {
      flag = document.createElement('span');
      flag.className = 'crow-flag';
      flag.innerHTML = ICON.eyeOffSmall;
      flag.setAttribute('aria-label', 'скрыта');
      $('.crow-count', row).prepend(flag);
    } else if (!priv && flag) {
      flag.remove();
    }
  }

  function placeRow(nav, c) {
    let row = $(`[data-col="${sel(c.id)}"]`, nav);
    if (row && row.tagName === 'DIV') { row.remove(); row = null; } // «скоро» — заменяем ссылкой
    if (!row) {
      row = document.createElement('a');
      row.className = 'crow' + (c.parent ? ' crow--sub' : '');
      row.href = `${BASE}col/${encodeURIComponent(c.id)}/`;
      row.dataset.col = c.id;
      row.dataset.client = '1';
      if (c.parent) row.dataset.parent = c.parent;
      let num;
      if (c.parent) {
        const parentRow = $(`[data-col="${sel(c.parent)}"]`, nav);
        if (!parentRow) return;
        const kids = $$(`[data-parent="${sel(c.parent)}"]`, nav);
        num = $('.crow-num', parentRow).textContent + '.' + (kids.length + 1);
        (kids[kids.length - 1] || parentRow).after(row);
      } else {
        num = String($$('[data-col]:not(.crow--sub)', nav).length + 1).padStart(2, '0');
        nav.append(row);
      }
      row.innerHTML = '<span class="crow-num"></span><span class="crow-name"></span><span class="crow-count"></span>';
      $('.crow-num', row).textContent = num;
      $('.crow-name', row).textContent = c.name;
      const empty = $('.empty', nav);
      if (empty) empty.remove();
      if (location.pathname === row.pathname) {
        row.classList.add('is-active');
        row.setAttribute('aria-current', 'page');
      }
    }
    markRow(row, !!c._priv);
  }

  function renderNavs() {
    const cols = clientCols();
    for (const nav of $$('.side nav, .index-inline nav')) {
      // Скрытые, которые уже есть в сборке (скрыли только что), — просто помечаем
      $$('a.crow[data-col]', nav).forEach((row) => {
        const h = cols.find((c) => c.id === row.dataset.col);
        if (h) markRow(row, !!h._priv);
      });
      cols.filter((c) => !c.parent).forEach((c) => placeRow(nav, c));
      cols.filter((c) => c.parent).forEach((c) => placeRow(nav, c));
      // «скоро» для новых публичных коллекций
      for (const id in newCols) {
        if ($(`[data-col="${sel(id)}"]`, nav)) continue;
        const c = newCols[id];
        if (c.parent && !$(`[data-col="${sel(c.parent)}"]`, nav)) continue;
        const row = document.createElement('div');
        row.className = 'crow crow--pending' + (c.parent ? ' crow--sub' : '');
        row.dataset.col = id;
        if (c.parent) row.dataset.parent = c.parent;
        let num;
        if (c.parent) {
          const parentRow = $(`[data-col="${sel(c.parent)}"]`, nav);
          const kids = $$(`[data-parent="${sel(c.parent)}"]`, nav);
          num = $('.crow-num', parentRow).textContent + '.' + (kids.length + 1);
          (kids[kids.length - 1] || parentRow).after(row);
        } else {
          num = String($$('[data-col]:not(.crow--sub)', nav).length + 1).padStart(2, '0');
          nav.append(row);
        }
        row.innerHTML = '<span class="crow-num"></span><span class="crow-name"></span><span class="crow-count">скоро</span>';
        $('.crow-num', row).textContent = num;
        $('.crow-name', row).textContent = c.name;
        row.title = 'Страница коллекции появится после обновления сайта';
        const empty = $('.empty', nav);
        if (empty) empty.remove();
      }
    }
  }

  // Какие из скрытых карточек относятся к текущему списку
  function listScope() {
    if (BODY.classList.contains('page-home')) return { all: true };
    const id = BODY.dataset.colId;
    if (!id) return null;
    return { ids: new Set([id, ...childIds(id)]) };
  }

  function renderTiles() {
    const scope = listScope();
    if (!scope) return;
    const cards = clientCards().filter((c) => {
      if (scope.all) return true;
      const cols = (c.collections || []).concat(hidden.memberships[c.id] || []);
      return cols.some((x) => scope.ids.has(x));
    });
    if (!cards.length) return;

    let list = $('section.list');
    if (list && !$('[data-grid]', list)) {
      const label = $('.bar-label', list).textContent;
      const tmp = document.createElement('div');
      tmp.innerHTML = cardListHTML([], label);
      const fresh = tmp.firstElementChild;
      list.replaceWith(fresh);
      list = fresh;
      initList(list);
    }
    if (!list) return;
    const grid = $('[data-grid]', list);
    for (const c of cards) {
      const existing = $(`a.tile[data-id="${sel(c.id)}"]`, grid);
      if (existing) { markTile(existing, c._priv); continue; }
      const tmp = document.createElement('div');
      tmp.innerHTML = tileHTML(c, c._priv);
      const tile = tmp.firstElementChild;
      const after = $$('a.tile', grid).find((t) => Number(t.dataset.id) < Number(c.id));
      if (after) grid.insertBefore(tile, after);
      else grid.append(tile);
    }
    // Публичные плитки, скрытые только что, помечаем
    $$('a.tile:not([data-client])', grid).forEach((t) => {
      if (!cards.some((c) => String(c.id) === t.dataset.id)) {
        const h = hiddenCardById().get(t.dataset.id);
        if (h) markTile(t, true);
      }
    });
    applyAllRenames(grid);
    applyAll();
  }

  function renderPrivate() {
    renderNavs();
    hideDeletedCols();
    applyAllRenames();
    renderTiles();
    updateVisibilityUI();
  }

  async function fetchHidden() {
    const data = await api('listHidden');
    hidden = { collections: data.collections || [], cards: data.cards || [], memberships: data.memberships || {} };
    saveHiddenCache();
  }
  function saveHiddenCache() {
    try { sessionStorage.setItem(HIDDEN_CACHE, JSON.stringify({ ts: Date.now(), hidden })); } catch {}
  }

  function loadPrivate() {
    if (!adminKey) return Promise.resolve();
    try {
      const c = JSON.parse(sessionStorage.getItem(HIDDEN_CACHE) || 'null');
      if (c && Date.now() - c.ts < 5 * 60 * 1000) {
        hidden = c.hidden;
        renderPrivate();
        fetchHidden().then(renderPrivate).catch(() => {});
        return Promise.resolve();
      }
    } catch {}
    return fetchHidden().then(renderPrivate).catch((err) => say(err.message));
  }

  // ═════════ Видимость ═════════

  function cardVisibility(id) {
    const h = hiddenCardById().get(String(id));
    if (!h) return { priv: false, self: false };
    return { priv: true, self: !!h.selfHidden };
  }
  function colVisibility(id) {
    const h = hiddenColById().get(id);
    if (!h) return { priv: false, self: false };
    return { priv: true, self: !!h.selfHidden };
  }

  function setVisButton(btn, v) {
    btn.innerHTML = v.self ? ICON.eye : ICON.eyeOff;
    const label = v.self ? 'Показать всем' : 'Скрыть от всех';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  function setNote(after, text) {
    let note = after.parentElement.querySelector(':scope > .private-note');
    if (!text) { if (note) note.remove(); return; }
    if (!note) {
      note = document.createElement('p');
      note.className = 'private-note';
      after.after(note);
    }
    note.innerHTML = ICON.eyeOffSmall + ' ';
    note.append(text);
  }

  function updateVisibilityUI() {
    if (!adminKey) return;
    $$('article.card').forEach((a) => {
      const v = cardVisibility(a.dataset.id);
      const row = $('.title-row', a);
      setNote(row, v.priv ? (v.self ? 'Видна только тебе.' : 'Видна только тебе: все её коллекции скрыты.') : '');
      const bar = a.closest('[data-sheet]') || a.closest('.card-page');
      const btn = bar && $('[data-visibility="card"]', bar);
      if (btn) setVisButton(btn, v);
    });
    $$('[data-visibility="collection"]').forEach((btn) => {
      const id = btn.dataset.id;
      const v = colVisibility(id);
      setVisButton(btn, v);
      const row = btn.closest('.title-row');
      const parent = colInfo(id)?.parent;
      setNote(row, v.priv ? (v.self ? 'Видна только тебе.' : 'Видна только тебе: скрыта коллекция, в которой она лежит.') : '');
      if (parent && !v.self && v.priv) btn.hidden = true;
    });
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-visibility]');
    if (!btn || !adminKey) return;
    const kind = btn.dataset.visibility;
    let id;
    let v;
    if (kind === 'card') {
      const a = $('article.card', btn.closest('[data-sheet]') || document);
      if (!a) return;
      id = a.dataset.id;
      v = cardVisibility(id);
    } else {
      id = btn.dataset.id;
      v = colVisibility(id);
    }
    const nextHidden = !v.self;
    btn.disabled = true;
    const before = { cards: hiddenCardById(), cols: hiddenColById() };
    try {
      await api('setHidden', { kind, id, hidden: nextHidden });
      await fetchHidden();
      // Что стало публичным, но ещё не собрано, держим видимым для админа
      const nowCards = hiddenCardById();
      const nowCols = hiddenColById();
      for (const [cid, c] of before.cards) {
        if (!nowCards.has(cid) && !$(`a.tile[data-id="${sel(cid)}"]:not([data-client])`)) transit['card:' + cid] = { ts: Date.now(), data: c };
        if (!nowCards.has(cid)) $$(`a.tile[data-id="${sel(cid)}"]`).forEach((t) => markTile(t, false));
      }
      for (const [cid, c] of before.cols) {
        if (!nowCols.has(cid) && !$(`a.crow[data-col="${sel(cid)}"]:not([data-client])`)) transit['col:' + cid] = { ts: Date.now(), data: c };
        if (!nowCols.has(cid)) $$(`a.crow[data-col="${sel(cid)}"]`).forEach((r) => markRow(r, false));
      }
      saveStore('library:transit', transit);
      renderPrivate();
      const what = kind === 'card' ? 'Карточка' : 'Коллекция';
      say(nextHidden ? `${what} скрыта. Теперь её видишь только ты` : `${what} снова видна всем после обновления сайта`);
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
    const id = article.dataset.id;
    const ok = window.confirm(`Удалить карточку № ${article.dataset.num} «${article.dataset.title}»?\n\nЗагруженные файлы уйдут в корзину Google Drive, оттуда их можно восстановить в течение 30 дней. Файлы, добавленные ссылкой, останутся на месте.`);
    if (!ok) return;
    btn.disabled = true;
    try {
      await api('deleteCard', { id: Number(id) });
      deleted[id] = { ts: Date.now() };
      saveStore('library:deleted', deleted);
      hidden.cards = hidden.cards.filter((c) => String(c.id) !== id);
      delete transit['card:' + id];
      saveStore('library:transit', transit);
      if (btn.closest('[data-sheet]')) {
        if (closeSheet) closeSheet();
        applyAll();
        say('Карточка удалена. Сайт обновится через 1–2 минуты');
      } else {
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
    if (!btn || !adminKey) return;
    const id = btn.dataset.id;
    const info = colInfo(id);
    const kids = childIds(id);
    const isSub = !!(info && info.parent);
    const name = info ? info.name : id;
    const inner = kids.length ? ` и ${kids.length} ${plural(kids.length, 'подколлекцию', 'подколлекции', 'подколлекций')} внутри неё` : '';
    const ok = window.confirm(`Удалить ${isSub ? 'подколлекцию' : 'коллекцию'} «${name}»${inner}?\n\nКарточки не удалятся: они останутся во «Всех карточках» и в других своих коллекциях. Карточки, которые были скрыты вместе с этой коллекцией, так и останутся скрытыми.`);
    if (!ok) return;
    btn.disabled = true;
    try {
      const r = await api('deleteCollection', { id });
      (r.deleted || [id]).forEach((x) => { deletedCols[x] = { ts: Date.now() }; });
      saveStore('library:deletedcols', deletedCols);
      hidden.collections = hidden.collections.filter((c) => !(r.deleted || [id]).includes(c.id));
      saveHiddenCache();
      try { sessionStorage.setItem('library:flash', `${isSub ? 'Подколлекция удалена' : 'Коллекция удалена'}. Сайт обновится через 1–2 минуты`); } catch {}
      location.href = isSub ? `${BASE}col/${encodeURIComponent(info.parent)}/` : BASE;
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
    const lede = kind === 'collection' ? $(`[data-col-desc="${sel(id)}"]`) : null;
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
      btn.focus({ preventScroll: true });
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
        if (kind === 'card') await api('renameCard', { id: Number(id), title: name });
        else await api('updateCollection', { id, name, description });
        const entry = { name, ts: Date.now() };
        if (textarea) entry.description = description;
        renames[`${kind}:${id}`] = entry;
        saveStore('library:renames', renames);
        applyRename(kind, id, entry);
        // Скрытые хранятся в кэше — обновим и там
        const hc = kind === 'card' ? hidden.cards.find((c) => String(c.id) === id) : hidden.collections.find((c) => c.id === id);
        if (hc) { if (kind === 'card') hc.title = name; else { hc.name = name; hc.description = description; } }
        finish();
        say('Сохранено. Сайт обновится через 1–2 минуты');
      } catch (err) {
        save.disabled = false;
        say(err.message);
      }
    });
  });

  // ═════════ Новые коллекции ═════════

  function topCollections() {
    return $$('.side nav [data-col]:not(.crow--sub):not(.crow--pending)').map((r) => ({
      id: r.dataset.col,
      label: `${$('.crow-num', r).textContent} ${$('.crow-name', r).textContent}`,
    }));
  }

  function field(labelText, control, cls = 'field') {
    const wrap = document.createElement(cls === 'check' ? 'label' : 'div');
    wrap.className = cls;
    if (cls === 'check') {
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
      topCollections().forEach((c) => parentSelect.add(new Option(c.label, c.id)));
      form.append(field('Внутри коллекции', parentSelect));
    }
    const priv = document.createElement('input');
    priv.type = 'checkbox';
    form.append(field('Видна только мне', priv, 'check'));

    const btns = document.createElement('div');
    btns.className = 'rename-btns';
    btns.innerHTML = '<button class="rename-save" type="submit">Создать</button><button class="rename-cancel" type="button">Отмена</button>';
    form.append(btns);

    btn.hidden = true;
    holder.append(form);
    name.focus();

    const finish = () => { form.remove(); btn.hidden = false; };
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
        const r = await api('createCollection', { name: n, description: desc.value.trim(), parent, hidden: priv.checked });
        if (priv.checked || colVisibility(parent).priv) {
          await fetchHidden(); // скрытая видна админу сразу, без пересборки
        } else {
          newCols[r.collection.id] = { name: n, parent, ts: Date.now() };
          saveStore('library:newcols', newCols);
        }
        renderPrivate();
        finish();
        say(priv.checked ? 'Скрытая коллекция создана' : 'Коллекция создана. Её страница появится через 1–2 минуты');
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

    const idFromUrl = (url) => { const m = new URL(url, location.href).pathname.match(/\/c\/(\d+)\/?$/); return m ? String(Number(m[1])) : null; };

    function clientArticle(url) {
      const id = idFromUrl(url);
      const c = id && clientCards().find((x) => String(x.id) === id);
      if (!c) return null;
      const tmp = document.createElement('div');
      tmp.innerHTML = articleHTML(c);
      return { article: tmp.firstElementChild, title: `${c.title} — ${SITE_TITLE}` };
    }

    function load(url) {
      const local = clientArticle(url);
      if (local) return Promise.resolve(local);
      if (!cache.has(url)) {
        cache.set(url, fetch(url)
          .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
          .then((html) => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const article = doc.querySelector('article.card');
            if (!article) throw new Error('no card');
            return { article, title: doc.title };
          })
          .catch(async (err) => {
            cache.delete(url);
            await privateReady;
            const again = clientArticle(url);
            if (again) return again;
            throw err;
          }));
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
      showAdmin(sheet);
      applyAllRenames(article);
      num.textContent = '№ ' + (article.dataset.num || '');
      copyBtn.dataset.copy = url;
      const editLink = $('[data-edit]', sheet);
      if (editLink) editLink.href = `${BASE}admin/?edit=${article.dataset.id}`;
      document.title = data.title;
      updateVisibilityUI();

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
      hideTimer = setTimeout(() => {
        sheet.hidden = true;
        backdrop.hidden = true;
        body.replaceChildren();
      }, 300);
      lastTile?.focus({ preventScroll: true });
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
      const a = e.target.closest && e.target.closest('a.tile:not([data-client])');
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

  // ═════════ Страницы скрытых: рисуем на месте «нет такой страницы» ═════════

  async function renderNotFound() {
    const holder = $('[data-not-found]');
    if (!holder || !adminKey) return;
    const rest = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : '';
    const mCard = rest.match(/^c\/(\d+)\/?$/);
    const mCol = rest.match(/^col\/([^/]+)\/?$/);
    if (!mCard && !mCol) return;
    const original = holder.innerHTML;
    holder.innerHTML = '<p class="empty">Загружаем…</p>';
    await privateReady;

    if (mCard) {
      const c = clientCards().find((x) => String(x.id) === String(Number(mCard[1])));
      if (!c) { holder.innerHTML = original; return; }
      BODY.classList.remove('page-404');
      BODY.classList.add('page-card');
      document.title = `${c.title} — ${SITE_TITLE}`;
      holder.innerHTML = `<div class="card-page">
<div class="card-bar">
<span class="card-bar-num">№ ${pad3(c.id)}</span>
<div class="card-bar-actions">
<a class="icon-btn" href="${BASE}admin/?edit=${c.id}" data-edit data-admin hidden aria-label="Редактировать карточку">${ICON.edit}</a>
<button class="icon-btn" type="button" data-visibility="card" data-admin hidden aria-label="Скрыть от всех">${ICON.eyeOff}</button>
<button class="icon-btn" type="button" data-delete data-admin hidden aria-label="Удалить карточку">${ICON.trash}</button>
<button class="icon-btn" type="button" data-copy aria-label="Скопировать ссылку на карточку">${ICON.link}</button>
<a class="icon-btn" href="${BASE}" aria-label="Закрыть">${ICON.close}</a>
</div>
</div>
${articleHTML(c)}
</div>`;
      showAdmin(holder);
      applyAllRenames(holder);
      updateVisibilityUI();
      return;
    }

    const id = decodeURIComponent(mCol[1]);
    const col = clientCols().find((x) => x.id === id);
    if (!col) { holder.innerHTML = original; return; }
    const info = colInfo(id) || { num: '', parent: col.parent };
    const parent = col.parent ? colInfo(col.parent) : null;
    const ids = new Set([id, ...childIds(id)]);

    let pub = [];
    try {
      const data = await fetch(`${BASE}data.json`).then((r) => r.json());
      pub = (data.cards || []).filter((c) => (hidden.memberships[c.id] || []).some((x) => ids.has(x)) || (c.collections || []).some((x) => ids.has(x)));
    } catch {}
    const priv = clientCards().filter((c) => (c.collections || []).some((x) => ids.has(x)));
    const cards = [...priv, ...pub.filter((p) => !priv.some((c) => c.id === p.id))]
      .map((c) => Object.assign({}, c, { _priv: c._priv ?? false, collections: (c.collections || []).concat(hidden.memberships[c.id] || []) }))
      .sort((a, b) => b.id - a.id);

    BODY.classList.remove('page-404');
    BODY.classList.add('page-col');
    BODY.dataset.colId = id;
    document.title = `${col.name} — ${SITE_TITLE}`;
    const crumbs = parent
      ? `<a href="${BASE}">Коллекции</a> / <a href="${BASE}col/${encodeURIComponent(parent.id)}/">${esc(parent.num)}</a> / ${esc(info.num)}`
      : `<a href="${BASE}">Коллекции</a> / ${esc(info.num)}`;
    holder.innerHTML = `<section class="hero hero--col">
<p class="crumbs">${crumbs}</p>
<div class="title-row">
<h1 class="hero-title" data-title-text data-col-name="${esc(id)}">${esc(col.name)}</h1>
<div class="title-actions">
<button class="icon-btn" type="button" data-visibility="collection" data-id="${esc(id)}" data-admin hidden aria-label="Показать всем">${ICON.eye}</button>
<button class="icon-btn" type="button" data-rename="collection" data-id="${esc(id)}" data-admin hidden aria-label="Изменить название и описание коллекции">${ICON.pencil}</button>
<button class="icon-btn" type="button" data-delete-col data-id="${esc(id)}" data-admin hidden aria-label="Удалить коллекцию">${ICON.trash}</button>
</div>
</div>
<p class="lede" data-col-desc="${esc(id)}"${col.description ? '' : ' hidden'}>${esc(col.description || '')}</p>
<p class="meta">${esc(nCards(cards.length))}</p>
${col.parent ? '' : `<div class="col-admin col-admin--hero" data-admin hidden><button class="link-btn" type="button" data-new-col data-parent="${esc(id)}">+ Подколлекция</button></div>`}
</section>
${cardListHTML(cards, 'Карточки')}`;
    showAdmin(holder);
    initList($('[data-list]', holder));
    applyAllRenames();
    updateVisibilityUI();
    $$('.side nav a.crow').forEach((r) => {
      const on = r.dataset.col === id;
      r.classList.toggle('is-active', on);
      if (on) r.setAttribute('aria-current', 'page'); else r.removeAttribute('aria-current');
    });
  }

  // ═════════ Старт ═════════

  applyAllRenames();
  renderNavs();
  hideDeletedCols();
  applyAll();
  privateReady = loadPrivate();
  renderNotFound();
})();
