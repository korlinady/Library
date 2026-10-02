(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const desktop = window.matchMedia('(min-width: 1024px)');

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
        const okQuery = !query || t.dataset.search.includes(query);
        t.hidden = !(okFilter && okQuery);
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
