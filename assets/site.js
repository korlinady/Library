(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const desktop = window.matchMedia('(min-width: 1024px)');
  const SCRIPT_URL = document.body.dataset.scriptUrl;
  const BASE = document.body.dataset.base || '/';
  const KEY_STORE = 'library:key';
  const DELETED_STORE = 'library:deleted';
  let closeSheet = null;

  // ───────── Режим админа: ключ уже введён в форме на этом устройстве ─────────
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

  // Переименования показываем сразу, пока сайт не пересобрался (15 минут)
  const RENAMES_STORE = 'library:renames';
  function readRenames() {
    try {
      const d = JSON.parse(store.get(RENAMES_STORE) || '{}');
      const now = Date.now();
      for (const k in d) if (now - d[k].ts > 15 * 60 * 1000) delete d[k];
      return d;
    } catch { return {}; }
  }
  const renames = readRenames();
  store.set(RENAMES_STORE, JSON.stringify(renames));

  function applyRename(kind, id, entry, root = document) {
    const name = entry.name;
    if (kind === 'card') {
      $$(`a.tile[data-id="${CSS.escape(String(id))}"] .tile-title`, root).forEach((el) => { el.textContent = name; });
      $$(`article.card[data-id="${CSS.escape(String(id))}"]`, root).forEach((a) => {
        a.dataset.title = name;
        const h = $('[data-title-text]', a);
        if (h) h.textContent = name;
      });
    } else {
      $$(`[data-col="${CSS.escape(id)}"] .crow-name`, root).forEach((el) => { el.textContent = name; });
      $$(`[data-col-name="${CSS.escape(id)}"]`, root).forEach((el) => { el.textContent = name; });
      if (typeof entry.description === 'string') {
        $$(`[data-col-desc="${CSS.escape(id)}"]`, root).forEach((el) => {
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
  applyAllRenames();

  // Удалённые карточки прячем сразу, не дожидаясь пересборки сайта (15 минут)
  function readDeleted() {
    try {
      const d = JSON.parse(store.get(DELETED_STORE) || '{}');
      const now = Date.now();
      for (const id in d) if (now - d[id] > 15 * 60 * 1000) delete d[id];
      return d;
    } catch { return {}; }
  }
  const deleted = readDeleted();
  store.set(DELETED_STORE, JSON.stringify(deleted));

  // ───────── Уведомление ─────────
  const toast = $('[data-toast]');
  let toastTimer;
  function say(text) {
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
  }

  // ───────── Копирование ссылки ─────────
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

  // ───────── Списки: вид, сортировка, фильтр, поиск ─────────
  let query = '';
  const appliers = [];

  // «#тег» ищет точное совпадение тега, всё остальное — по тексту
  function matches(tile) {
    if (!query) return true;
    if (query.startsWith('#')) {
      const tag = query.slice(1).trim();
      return !tag || (tile.dataset.tags || '').split('|').includes(tag);
    }
    return tile.dataset.search.includes(query);
  }

  for (const list of $$('[data-list]')) {
    const grid = $('[data-grid]', list);
    const count = $('[data-count]', list);
    const empty = $('[data-empty]', list);
    const sortBtn = $('[data-sort]', list);
    let filter = '';
    let newest = true;

    const apply = () => {
      let visible = 0;
      for (const t of $$('.tile', grid)) {
        const okFilter = !filter || t.dataset.cols.split(' ').includes(filter);
        const okQuery = matches(t);
        t.hidden = !(okFilter && okQuery) || !!deleted[t.dataset.id];
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

    $$('[data-filter]', list).forEach((chip) => chip.addEventListener('click', () => {
      filter = chip.dataset.filter;
      $$('[data-filter]', list).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      apply();
    }));
  }

  const searchToggle = $('[data-search-toggle]');
  const searchBar = $('#search');
  const searchInput = $('[data-search]');
  searchToggle?.addEventListener('click', () => {
    const open = searchBar.hidden;
    searchBar.hidden = !open;
    searchToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      searchInput.focus();
    } else {
      searchInput.value = '';
      query = '';
      appliers.forEach((f) => f());
    }
  });
  searchInput?.addEventListener('input', () => {
    query = searchInput.value.trim().toLowerCase();
    appliers.forEach((f) => f());
  });

  function setSearch(text) {
    if (!searchInput) return;
    searchBar.hidden = false;
    searchToggle.setAttribute('aria-expanded', 'true');
    searchInput.value = text;
    query = text.trim().toLowerCase();
    appliers.forEach((f) => f());
    const list = $('[data-list]');
    if (list) list.scrollIntoView({ block: 'start' });
  }

  const initialQ = new URLSearchParams(location.search).get('q');
  if (initialQ) setSearch(initialQ);
  else appliers.forEach((f) => f());

  // Клик по тегу на главной фильтрует без перезагрузки
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-tag]');
    if (!a || !searchInput || !document.body.classList.contains('page-home')) return;
    e.preventDefault();
    if (closeSheet) closeSheet();
    setSearch('#' + a.dataset.tag);
    history.replaceState(history.state, '', BASE + '?q=' + encodeURIComponent('#' + a.dataset.tag));
  });

  // ───────── Удаление карточки ─────────
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
      deleted[id] = Date.now();
      store.set(DELETED_STORE, JSON.stringify(deleted));
      if (btn.closest('[data-sheet]')) {
        if (closeSheet) closeSheet();
        appliers.forEach((f) => f());
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

  // ───────── Переименование ─────────
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rename]');
    if (!btn || !adminKey) return;
    const row = btn.closest('.title-row');
    if (!row || $('.rename-form', row)) return;
    const heading = $('[data-title-text]', row);
    const kind = btn.dataset.rename;
    const id = btn.dataset.id;
    const old = heading.textContent;

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
    const lede = kind === 'collection' ? $(`[data-col-desc="${CSS.escape(id)}"]`) : null;
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
      lede.dataset.wasHidden = lede.hidden ? '1' : '';
      lede.hidden = true;
    } else {
      form.append(label, input, btns);
    }

    heading.hidden = true;
    btn.hidden = true;
    row.prepend(form);
    input.focus();
    input.select();

    const finish = () => {
      form.remove();
      if (lede) lede.hidden = !lede.textContent.trim();
      heading.hidden = false;
      btn.hidden = false;
      btn.focus({ preventScroll: true });
    };
    $('.rename-cancel', form).addEventListener('click', finish);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.stopPropagation(); finish(); }
    });
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
        store.set(RENAMES_STORE, JSON.stringify(renames));
        applyRename(kind, id, entry);
        finish();
        say('Сохранено. Сайт обновится через 1–2 минуты');
      } catch (err) {
        save.disabled = false;
        say(err.message);
      }
    });
  });

  // ───────── Новые коллекции ─────────
  const NEWCOLS_STORE = 'library:newcols';
  function readNewCols() {
    try {
      const d = JSON.parse(store.get(NEWCOLS_STORE) || '{}');
      const now = Date.now();
      for (const id in d) {
        const real = document.querySelector(`a.crow[data-col="${CSS.escape(id)}"]`);
        if (real || now - d[id].ts > 15 * 60 * 1000) delete d[id];
      }
      return d;
    } catch { return {}; }
  }
  const newCols = readNewCols();
  store.set(NEWCOLS_STORE, JSON.stringify(newCols));

  function addPendingRow(nav, id, c) {
    if ($(`[data-col="${CSS.escape(id)}"]`, nav)) return;
    const row = document.createElement('div');
    row.className = 'crow crow--pending' + (c.parent ? ' crow--sub' : '');
    row.dataset.col = id;
    if (c.parent) row.dataset.parent = c.parent;
    let num;
    if (c.parent) {
      const parentRow = $(`[data-col="${CSS.escape(c.parent)}"]`, nav);
      if (!parentRow) return;
      const kids = $$(`[data-parent="${CSS.escape(c.parent)}"]`, nav);
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
  function renderNewCols() {
    for (const nav of $$('.side nav, .index-inline nav')) {
      for (const id in newCols) if (!newCols[id].parent) addPendingRow(nav, id, newCols[id]);
      for (const id in newCols) if (newCols[id].parent) addPendingRow(nav, id, newCols[id]);
    }
  }
  renderNewCols();

  function topCollections() {
    return $$('.side nav [data-col]:not(.crow--sub)').map((r) => ({
      id: r.dataset.col,
      label: `${$('.crow-num', r).textContent} ${$('.crow-name', r).textContent}`,
    }));
  }

  function field(labelText, control) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
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
    name.required = true;
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
        const r = await api('createCollection', { name: n, description: desc.value.trim(), parent });
        newCols[r.collection.id] = { name: n, parent, ts: Date.now() };
        store.set(NEWCOLS_STORE, JSON.stringify(newCols));
        renderNewCols();
        finish();
        say(parent ? 'Подколлекция создана. Её страница появится через 1–2 минуты' : 'Коллекция создана. Её страница появится через 1–2 минуты');
      } catch (err) {
        save.disabled = false;
        say(err.message);
      }
    });
  });

  // ───────── Шторка с карточкой ─────────
  const sheet = $('[data-sheet]');
  if (!sheet) return;

  const body = $('[data-sheet-body]', sheet);
  const num = $('[data-sheet-num]', sheet);
  const copyBtn = $('[data-copy]', sheet);
  const closeBtn = $('[data-sheet-close]', sheet);
  const backdrop = $('[data-backdrop]');
  const listTitle = document.title;
  const cache = new Map();
  let lastTile = null;
  let hideTimer;

  function load(url) {
    if (!cache.has(url)) {
      cache.set(url, fetch(url)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then((html) => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          return { article: doc.querySelector('article.card'), title: doc.title };
        })
        .catch((err) => { cache.delete(url); throw err; }));
    }
    return cache.get(url);
  }

  async function open(url, push) {
    let data;
    try { data = await load(url); } catch { location.href = url; return; }
    if (!data.article) { location.href = url; return; }

    clearTimeout(hideTimer);
    const article = document.importNode(data.article, true);
    const h = $('h1', article);
    if (h) h.id = 'sheet-title';
    body.replaceChildren(article);
    showAdmin(article);
    applyAllRenames(article);
    num.textContent = '№ ' + (article.dataset.num || '');
    copyBtn.dataset.copy = url;
    document.title = data.title;

    sheet.hidden = false;
    backdrop.hidden = false;
    sheet.scrollTop = 0;
    sheet.style.transform = '';
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('sheet-open')));

    if (push) history.pushState({ sheet: url }, '', url);
    closeBtn.focus({ preventScroll: true });
  }

  function hide() {
    document.body.classList.remove('sheet-open');
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

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.tile');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    lastTile = a;
    open(a.href, !(history.state && history.state.sheet));
    if (history.state && history.state.sheet) history.replaceState({ sheet: a.href }, '', a.href);
  });

  // Подгружаем карточку заранее, пока палец или курсор над ней
  const prefetch = (e) => {
    const a = e.target.closest && e.target.closest('a.tile');
    if (a) load(a.href).catch(() => {});
  };
  document.addEventListener('pointerover', prefetch, { passive: true });
  document.addEventListener('touchstart', prefetch, { passive: true });

  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.sheet) open(e.state.sheet, false);
    else if (document.body.classList.contains('sheet-open')) hide();
  });

  closeSheet = close;
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('sheet-open')) close();
  });

  // Свайп вниз закрывает шторку на телефоне
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
})();
