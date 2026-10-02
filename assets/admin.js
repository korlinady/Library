(() => {
  const SCRIPT_URL = document.body.dataset.scriptUrl;
  const BASE = document.body.dataset.base || '/';
  const MAX_BYTES = 30 * 1024 * 1024;
  const KEY_STORE = 'library:key';
  const DRAFT_STORE = 'library:draft';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pad3 = (n) => { const s = String(n); return s.length >= 3 ? s : s.padStart(3, '0'); };
  let uid = 0;
  const nid = () => 'f' + Date.now().toString(36) + (uid++);

  let key = store.get(KEY_STORE);
  const EDIT_ID = Number(new URLSearchParams(location.search).get('edit')) || 0;
  let original = null; // карточка до правок, в режиме редактирования
  let collections = [];
  let state = emptyState();

  function emptyState() {
    return { title: '', description: '', link: '', tags: '', star: false, hidden: false, keepOriginal: false, cols: [], cover: null, files: [] };
  }

  // ───────── Сообщения ─────────

  const toast = $('[data-toast]');
  let toastTimer;
  function say(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }
  function setError(el, text) {
    el.textContent = text || '';
    el.hidden = !text;
  }

  // ───────── API ─────────

  class AuthError extends Error {}

  // Чтение и повторяемые правки можно безопасно повторить; создание — нет, иначе будет дубль
  const READS = new Set(['listCollections', 'getCard', 'editData', 'listAll', 'ping']);
  const RETRYABLE = new Set([...READS, 'updateCard', 'uploadFile', 'publish']);

  function timeoutText(action) {
    if (action === 'createCard') return 'Скрипт не ответил за минуту. Карточка могла сохраниться — открой сайт и проверь, прежде чем публиковать ещё раз.';
    if (action === 'createCollection') return 'Скрипт не ответил за минуту. Коллекция могла создаться — обнови страницу и проверь.';
    if (READS.has(action)) return 'Скрипт не отвечает. Проверь интернет и попробуй ещё раз.';
    return 'Скрипт не ответил вовремя. Попробуй ещё раз.';
  }

  async function apiOnce(action, payload, timeout) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      let res;
      try {
        res = await fetch(SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ key, action }, payload)),
          signal: ctrl.signal,
        });
      } catch {
        const err = new Error(ctrl.signal.aborted ? timeoutText(action) : 'Нет связи со скриптом. Проверь интернет и попробуй ещё раз.');
        err.retryable = true;
        throw err;
      }
      let data;
      try {
        data = await res.json();
      } catch {
        const err = new Error(ctrl.signal.aborted ? timeoutText(action) : 'Скрипт ответил не так, как ожидалось. Проверь, что веб-приложение развёрнуто с доступом «Все».');
        err.retryable = ctrl.signal.aborted;
        throw err;
      }
      if (!data.ok) {
        if (data.error === 'unauthorized') throw new AuthError('Ключ не подходит.');
        const err = new Error(data.error || 'Неизвестная ошибка.');
        err.code = data.error;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function api(action, payload = {}, opts = {}) {
    let timeout = opts.timeout || (READS.has(action) ? 20000 : 60000);
    if (action === 'uploadFile' && payload.data) {
      // ~50 КБ/с на плохой мобильной связи, но не больше 15 минут
      timeout = Math.min(15 * 60 * 1000, 30000 + (payload.data.length * 0.75) / 50);
    }
    const tries = RETRYABLE.has(action) ? 2 : 1;
    let last;
    for (let i = 0; i < tries; i++) {
      if (i > 0) {
        if (opts.onRetry) opts.onRetry();
        else say('Скрипт отвечает медленно, пробую ещё раз…');
      }
      try {
        return await apiOnce(action, payload, timeout);
      } catch (err) {
        last = err;
        if (err instanceof AuthError || !err.retryable) throw err;
      }
    }
    throw last;
  }

  function handleAuth(err) {
    if (err instanceof AuthError) {
      key = null;
      store.del(KEY_STORE);
      show('key');
      setError($('[data-key-error]'), 'Ключ больше не подходит. Возможно, его поменяли через rotateKey — введи новый.');
      return true;
    }
    return false;
  }

  // ───────── Экраны ─────────

  function show(name) {
    $$('[data-screen]').forEach((s) => { s.hidden = s.dataset.screen !== name; });
    $('[data-rebuild]').hidden = name === 'key' || name === 'loading';
    window.scrollTo(0, 0);
  }

  async function fetchFresh() {
    try {
      return await api('editData', { id: EDIT_ID || 0 });
    } catch (err) {
      if (err.code !== 'unknown_action') throw err;
      // Старая версия скрипта: два запроса вместо одного
      const cols = await api('listCollections');
      const card = EDIT_ID ? (await api('getCard', { id: EDIT_ID })).card : null;
      return { collections: cols.collections, card };
    }
  }

  async function start() {
    if (!SCRIPT_URL) {
      show('key');
      setError($('[data-key-error]'), 'В site.config.json не указан адрес скрипта.');
      return;
    }
    if (!key) { show('key'); return; }

    // 1. Сразу — из копии на устройстве
    let shown = false;
    const live = readLive();
    if (live) {
      setCollections(colsFromLive(live));
      const c = EDIT_ID ? cardFromLive(live, EDIT_ID) : null;
      if (c) fillCard(c);
      else if (!EDIT_ID) restoreDraft();
      if (c || !EDIT_ID) { renderAll(); show('form'); shown = true; }
    }
    if (!shown) {
      show('loading');
      setLoading('Загружаем…');
    }

    // 2. Тихо сверяемся со свежими данными
    try {
      const r = await fetchFresh();
      setCollections(r.collections || []);
      if (EDIT_ID) {
        if (!r.card) throw new Error('Карточка не найдена — возможно, её удалили.');
        if (!shown || !touched) fillCard(r.card);
      } else if (!shown) {
        restoreDraft();
      }
      renderAll();
      if (!shown) show('form');
    } catch (err) {
      if (handleAuth(err)) return;
      if (shown) say('Не удалось сверить с таблицей: ' + err.message);
      else setLoading(err.message, true);
    }
  }

  function setLoading(text, canRetry = false) {
    $('[data-loading-text]').textContent = text;
    $('[data-loading-retry]').hidden = !canRetry;
  }
  $('[data-loading-retry]').addEventListener('click', () => start());

  $('[data-key-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#key');
    const err = $('[data-key-error]');
    setError(err, '');
    key = input.value.trim();
    if (!key) { setError(err, 'Вставь ключ.'); return; }
    const btn = $('[type="submit"]', e.target);
    btn.disabled = true;
    try {
      await api('ping');
      store.set(KEY_STORE, key);
      input.value = '';
      start();
    } catch (ex) {
      key = null;
      setError(err, ex.message);
    } finally {
      btn.disabled = false;
    }
  });

  $('[data-logout]').addEventListener('click', () => {
    key = null;
    store.del(KEY_STORE);
    show('key');
  });

  $('[data-rebuild]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await api('publish');
      say(r.triggered ? 'Сайт обновится через 1–2 минуты' : 'Автообновление ещё не настроено');
    } catch (err) {
      if (!handleAuth(err)) say(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ───────── Черновик ─────────

  let draftTimer;
  function saveDraft() {
    if (EDIT_ID) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const keep = (f) => f && (f.kind === 'drive' || f.status === 'done');
      const clean = (f) => {
        const o = {};
        for (const k in f) if (!k.startsWith('_')) o[k] = f[k];
        return o;
      };
      const cover = keep(state.cover) ? clean(state.cover) : null;
      if (cover && String(cover.thumb || '').startsWith('blob:')) cover.thumb = '';
      const draft = Object.assign({}, state, {
        cover,
        files: state.files.filter(keep).map(clean),
      });
      store.set(DRAFT_STORE, JSON.stringify(draft));
    }, 300);
  }

  function restoreDraft() {
    try {
      const d = JSON.parse(store.get(DRAFT_STORE) || 'null');
      if (d && typeof d === 'object') state = Object.assign(emptyState(), d);
    } catch {}
    const known = new Set(collections.map((c) => c.id));
    state.cols = state.cols.filter((id) => known.has(id));
    $$('[data-field]').forEach((el) => {
      const k = el.dataset.field;
      if (el.type === 'checkbox') el.checked = !!state[k];
      else el.value = state[k] || '';
    });
  }

  $$('[data-field]').forEach((el) => {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      const k = el.dataset.field;
      state[k] = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'keepOriginal') syncOriginal();
      saveDraft();
    });
  });

  // ───────── Редактирование ─────────

  const driveImg = (id, w) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w}`;

  // Копия данных, которую сайт держит на этом устройстве
  function readLive() {
    try {
      const c = JSON.parse(store.get('library:live') || 'null');
      return c && c.data && c.data.public ? c.data : null;
    } catch { return null; }
  }
  const colsFromLive = (d) => d.public.collections.map((c) => Object.assign({}, c, { hidden: false }))
    .concat(d.hidden.collections.map((c) => Object.assign({}, c, { hidden: true })));
  function cardFromLive(d, id) {
    const mem = d.hidden.memberships || {};
    let c = d.public.cards.find((x) => Number(x.id) === id);
    if (c) return Object.assign({}, c, { hidden: false, collections: (c.collections || []).concat(mem[c.id] || []) });
    c = d.hidden.cards.find((x) => Number(x.id) === id);
    return c ? Object.assign({}, c, { hidden: !!c.selfHidden }) : null;
  }

  // Пользователь уже что-то менял — свежие данные поверх не кладём
  let touched = false;
  ['input', 'change'].forEach((ev) => $('[data-card-form]').addEventListener(ev, () => { touched = true; }));
  $('[data-card-form]').addEventListener('click', (e) => { if (e.target.closest('button, label')) touched = true; });

  function fillCard(c) {
    original = c;
    state = Object.assign(emptyState(), {
      title: c.title,
      description: c.description,
      link: c.link,
      tags: (c.tags || []).join(', '),
      star: !!c.star,
      hidden: !!c.hidden,
      cols: (c.collections || []).filter((id) => collections.some((x) => x.id === id)),
      cover: c.cover ? { id: nid(), kind: 'existing', fileId: c.cover, status: 'done', name: 'Обложка', thumb: `${BASE}img/${c.cover}-800.webp`, fallback: driveImg(c.cover, 480) } : null,
      files: (c.files || []).map((f) => ({
        id: nid(), kind: 'existing', fileId: f.driveId, name: f.title, title: f.title,
        size: f.size, type: f.type, status: 'done', drive: f.kind === 'drive',
      })),
    });
    $$('[data-field]').forEach((el) => {
      const k = el.dataset.field;
      if (el.type === 'checkbox') el.checked = !!state[k];
      else el.value = state[k] || '';
    });
    const label = `Карточка № ${pad3(c.id)}`;
    $('[data-admin-title]').textContent = label;
    document.title = `${label} — правка`;
    $('[data-publish-hint]').textContent = state.hidden ? 'Карточка скрыта — изменения видны сразу' : 'Изменения появятся на сайте через 1–2 минуты';
  }

  // ───────── Коллекции ─────────

  async function loadCollections() {
    const r = await api('listCollections');
    setCollections(r.collections || []);
  }

  // Нумерация как на сайте: сначала открытые, затем скрытые
  function setCollections(raw) {
    raw = raw.map((c) => Object.assign({}, c));
    const byOrder = (a, b) => (!!a.hidden - !!b.hidden) || ((Number(a.order) || 0) - (Number(b.order) || 0)) || a.name.localeCompare(b.name, 'ru');
    const tops = raw.filter((c) => !c.parent || !raw.some((p) => p.id === c.parent)).sort(byOrder);
    collections = [];
    tops.forEach((c, i) => {
      c.num = String(i + 1).padStart(2, '0');
      c.label = c.name;
      collections.push(c);
      raw.filter((k) => k.parent === c.id).sort(byOrder).forEach((k, j) => {
        k.num = `${c.num}.${j + 1}`;
        k.label = `${c.name} / ${k.name}`;
        k.isSub = true;
        collections.push(k);
      });
    });
  }

  function renderCols() {
    const picked = $('[data-picked]');
    picked.innerHTML = state.cols.map((id) => {
      const c = collections.find((x) => x.id === id);
      if (!c) return '';
      return `<div class="box-row"><span><span class="mono">${esc(c.num)}</span>${esc(c.label)}</span>
<button class="icon-btn" type="button" data-unpick="${esc(id)}" aria-label="Убрать из коллекции «${esc(c.label)}»"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
    }).join('');
    $('[data-picker-label]').textContent = state.cols.length ? 'Выбрать ещё' : 'Выбрать';

    const picker = $('[data-picker]');
    picker.innerHTML = collections.length
      ? collections.map((c) => `<label class="pick-row${c.isSub ? ' pick-row--sub' : ''}">
<input type="checkbox" value="${esc(c.id)}"${state.cols.includes(c.id) ? ' checked' : ''}>
<span><span class="mono">${esc(c.num)}</span>${esc(c.name)}${c.hidden ? ' (скрыта)' : ''}</span></label>`).join('')
      : '<p class="pick-empty">Коллекций пока нет. Создай первую кнопкой ниже.</p>';

    const parentSelect = $('#nc-parent');
    parentSelect.innerHTML = '<option value="">Нет, верхний уровень</option>' +
      collections.filter((c) => !c.isSub).map((c) => `<option value="${esc(c.id)}">${esc(c.num)} ${esc(c.name)}</option>`).join('');
  }

  $('[data-picked]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unpick]');
    if (!b) return;
    state.cols = state.cols.filter((id) => id !== b.dataset.unpick);
    renderCols();
    saveDraft();
  });

  $('[data-picker]').addEventListener('change', (e) => {
    const id = e.target.value;
    if (e.target.checked) { if (!state.cols.includes(id)) state.cols.push(id); }
    else state.cols = state.cols.filter((x) => x !== id);
    const picker = $('[data-picker]');
    const open = !picker.hidden;
    const top = picker.scrollTop;
    renderCols();
    picker.hidden = !open;
    picker.scrollTop = top;
    saveDraft();
  });

  $('[data-picker-toggle]').addEventListener('click', (e) => {
    const p = $('[data-picker]');
    p.hidden = !p.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!p.hidden));
  });

  function toggleSub(btnSel, boxSel, open) {
    const box = $(boxSel);
    box.hidden = !open;
    $(btnSel).setAttribute('aria-expanded', String(open));
  }

  $('[data-newcol-toggle]').addEventListener('click', () => {
    const open = $('[data-newcol]').hidden;
    toggleSub('[data-newcol-toggle]', '[data-newcol]', open);
    if (open) $('#nc-name').focus();
  });
  $('[data-newcol-cancel]').addEventListener('click', () => {
    toggleSub('[data-newcol-toggle]', '[data-newcol]', false);
    $('#nc-name').value = '';
    setError($('[data-newcol-error]'), '');
  });
  $('[data-newcol-create]').addEventListener('click', async (e) => {
    const name = $('#nc-name').value.trim();
    const parent = $('#nc-parent').value;
    const err = $('[data-newcol-error]');
    if (!name) { setError(err, 'Добавь название коллекции.'); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    setError(err, '');
    try {
      const r = await api('createCollection', { withLive: true, name, parent, hidden: $('#nc-hidden').checked });
      $('#nc-hidden').checked = false;
      if (r.live) store.set('library:live', JSON.stringify({ ts: Date.now(), data: r.live }));
      await loadCollections();
      if (!state.cols.includes(r.collection.id)) state.cols.push(r.collection.id);
      renderCols();
      saveDraft();
      $('#nc-name').value = '';
      toggleSub('[data-newcol-toggle]', '[data-newcol]', false);
      say(`Коллекция «${name}» создана`);
    } catch (ex) {
      if (!handleAuth(ex)) setError(err, ex.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ───────── Картинки ─────────

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  // Холст освобождаем сразу: на iPhone память под холсты общая и маленькая,
  // и после нескольких картинок Safari молча отдаёт пустой холст
  const freeCanvas = (c) => { c.width = 0; c.height = 0; };

  // Сплошь белый (или пустой) холст — признак того, что картинка не нарисовалась.
  // Проверяем 256 точек по сетке прямо на холсте.
  function looksBlank(canvas) {
    const ctx = canvas.getContext('2d');
    const n = 16;
    try {
      for (let iy = 0; iy < n; iy++) {
        for (let ix = 0; ix < n; ix++) {
          const x = Math.min(canvas.width - 1, Math.floor(((ix + 0.5) / n) * canvas.width));
          const y = Math.min(canvas.height - 1, Math.floor(((iy + 0.5) / n) * canvas.height));
          const d = ctx.getImageData(x, y, 1, 1).data;
          if (d[3] > 0 && (d[0] < 248 || d[1] < 248 || d[2] < 248)) return false;
        }
      }
    } catch {
      return false; // не смогли проверить — считаем, что всё нормально
    }
    return true;
  }

  async function drawTo(src, w, h, max, quality) {
    const s = Math.min(1, max / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * s));
    const ch = Math.max(1, Math.round(h * s));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no context');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(src, 0, 0, cw, ch);
      if (looksBlank(canvas)) throw new Error('blank');
      return await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality));
    } finally {
      freeCanvas(canvas);
    }
  }

  // Два способа открыть картинку: если первый дал пустоту, пробуем второй
  async function compress(file, max, quality) {
    try {
      const bmp = await createImageBitmap(file);
      try { return await drawTo(bmp, bmp.width, bmp.height, max, quality); }
      finally { if (bmp.close) bmp.close(); }
    } catch {
      const img = await loadImage(file);
      return drawTo(img, img.naturalWidth, img.naturalHeight, max, quality);
    }
  }

  function toDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  const baseName = (n) => String(n).replace(/\.[^.]+$/, '') || 'cover';
  const extOf = (n) => { const m = String(n).match(/\.([a-z0-9]{1,6})$/i); return m ? m[1].toUpperCase() : 'FILE'; };
  function fmtSize(b) {
    if (!b) return '';
    const units = [['ГБ', 1024 ** 3], ['МБ', 1024 ** 2], ['КБ', 1024]];
    for (const [u, v] of units) if (b >= v) { const x = b / v; return `${(x >= 10 ? Math.round(x) : Math.round(x * 10) / 10).toString().replace('.', ',')} ${u}`; }
    return `${b} Б`;
  }

  // ───────── Загрузка ─────────

  const queue = [];
  let active = 0;

  function enqueue(item, blob) {
    item.status = 'uploading';
    item._blob = blob;
    queue.push(item);
    pump();
  }

  function pump() {
    while (active < 2 && queue.length) {
      const item = queue.shift();
      active++;
      upload(item).finally(() => { active--; pump(); renderAll(); saveDraft(); });
    }
  }

  async function upload(item) {
    try {
      const data = await toDataURL(item._blob);
      const r = await api('uploadFile', { name: item.name, mimeType: item._blob.type || 'application/octet-stream', data });
      if (item.status !== 'uploading') return; // успели удалить
      item.fileId = r.fileId;
      item.status = 'done';
    } catch (err) {
      if (handleAuth(err)) return;
      item.status = 'error';
      item.error = err.message;
    }
  }

  const pending = () => [state.cover, ...state.files].some((f) => f && f.status === 'uploading');

  function waitUploads() {
    return new Promise((resolve) => {
      const tick = () => (pending() ? setTimeout(tick, 300) : resolve());
      tick();
    });
  }

  // ───────── Обложка ─────────

  async function setCover(file) {
    if (!file) return;
    const formErr = $('[data-form-error]');
    setError(formErr, '');
    let blob, thumb, name;
    try {
      blob = await compress(file, 1600, 0.85);
      name = baseName(file.name) + '.jpg';
      // Превью — из уже сжатой версии: меньше памяти и одно декодирование вместо двух
      thumb = await toDataURL(await compress(blob, 480, 0.7)).catch(() => '');
    } catch {
      // Запасной путь: загружаем оригинал как есть, сайт уменьшит его при сборке
      if (file.size > MAX_BYTES) {
        setError(formErr, 'Не получилось открыть это изображение, а без сжатия оно больше 30 МБ. Попробуй другое фото или сделай скриншот поменьше.');
        return;
      }
      blob = file;
      name = file.name || 'cover';
      thumb = '';
      say('Не получилось сжать картинку на телефоне — загружаю оригинал');
    }
    removeOriginal();
    state.cover = { id: nid(), kind: 'upload', name, size: blob.size, thumb: thumb || URL.createObjectURL(blob), _orig: file };
    enqueue(state.cover, blob);
    syncOriginal();
    renderAll();
  }

  function removeOriginal() {
    if (!state.cover) return;
    state.files = state.files.filter((f) => f.origOf !== state.cover.id);
  }

  function syncOriginal() {
    const c = state.cover;
    if (!c) return;
    const has = state.files.some((f) => f.origOf === c.id);
    if (state.keepOriginal && !has && c._orig) {
      if (c._orig.size > MAX_BYTES) {
        say('Оригинал больше 30 МБ — его можно добавить ссылкой на Drive');
      } else {
        const item = { id: nid(), kind: 'upload', name: c._orig.name, size: c._orig.size, type: extOf(c._orig.name), origOf: c.id };
        state.files.push(item);
        enqueue(item, c._orig);
      }
    }
    if (!state.keepOriginal && has) removeOriginal();
    renderAll();
  }

  $$('[data-cover-input]').forEach((input) => input.addEventListener('change', () => {
    setCover(input.files[0]);
    input.value = '';
  }));

  $('[data-cover-remove]').addEventListener('click', () => {
    if (state.cover) state.cover.status = 'removed';
    removeOriginal();
    state.cover = null;
    renderAll();
    saveDraft();
  });

  function renderCover() {
    const c = state.cover;
    $('[data-cover-empty]').hidden = !!c;
    $('[data-cover-filled]').hidden = !c;
    if (!c) return;
    const preview = $('[data-cover-preview]');
    preview.onerror = c.fallback ? () => { preview.onerror = null; preview.src = c.fallback; } : null;
    if (preview.getAttribute('src') !== (c.thumb || '')) preview.src = c.thumb || '';
    const status = c.status === 'uploading' ? 'Загружается…'
      : c.status === 'error' ? 'Не загрузилась'
      : c.kind === 'existing' ? 'Текущая обложка'
      : `Готово · ${fmtSize(c.size)}`;
    $('[data-cover-status]').textContent = status;
  }

  // ───────── Файлы ─────────

  $('[data-files-input]').addEventListener('change', (e) => {
    const tooBig = [];
    for (const f of e.target.files) {
      if (f.size > MAX_BYTES) { tooBig.push(f.name); continue; }
      const item = { id: nid(), kind: 'upload', name: f.name, size: f.size, type: extOf(f.name), isImage: f.type.startsWith('image/'), _file: f };
      state.files.push(item);
      enqueue(item, f);
    }
    e.target.value = '';
    setError($('[data-form-error]'), tooBig.length
      ? `${tooBig.map((n) => `«${n}»`).join(', ')} — больше 30 МБ. Загрузи на Drive и добавь ссылкой.`
      : '');
    renderAll();
  });

  $('[data-drive-toggle]').addEventListener('click', () => {
    const open = $('[data-drive]').hidden;
    toggleSub('[data-drive-toggle]', '[data-drive]', open);
    if (open) $('#d-url').focus();
  });
  $('[data-drive-cancel]').addEventListener('click', () => {
    toggleSub('[data-drive-toggle]', '[data-drive]', false);
    $('#d-url').value = '';
    $('#d-title').value = '';
    setError($('[data-drive-error]'), '');
  });
  $('[data-drive-add]').addEventListener('click', () => {
    const url = $('#d-url').value.trim();
    const title = $('#d-title').value.trim();
    const err = $('[data-drive-error]');
    if (!/^https:\/\/(drive|docs)\.google\.com\//.test(url)) {
      setError(err, 'Нужна ссылка на файл или папку в Google Drive.');
      return;
    }
    state.files.push({ id: nid(), kind: 'drive', url, title, name: title || 'Файл на Drive', type: 'DRIVE', status: 'done' });
    $('#d-url').value = '';
    $('#d-title').value = '';
    setError(err, '');
    toggleSub('[data-drive-toggle]', '[data-drive]', false);
    renderAll();
    saveDraft();
  });

  $('[data-files]').addEventListener('click', (e) => {
    const row = e.target.closest('[data-file]');
    if (!row) return;
    const item = state.files.find((f) => f.id === row.dataset.file);
    if (!item) return;
    if (e.target.closest('[data-remove]')) {
      item.status = 'removed';
      state.files = state.files.filter((f) => f !== item);
      if (state.cover && item.origOf === state.cover.id) {
        state.keepOriginal = false;
        $('[data-field="keepOriginal"]').checked = false;
      }
    } else if (e.target.closest('[data-file-rename]')) {
      const next = window.prompt('Название файла', item.title || item.name);
      if (next === null) return;
      const t = next.trim();
      if (!t) return;
      item.title = t;
      item.name = t;
    } else if (e.target.closest('[data-retry]') && item._blob) {
      enqueue(item, item._blob);
    } else if (e.target.closest('[data-as-cover]') && item._file) {
      setCover(item._file);
      return;
    } else {
      return;
    }
    renderAll();
    saveDraft();
  });

  function renderFiles() {
    $('[data-files]').innerHTML = state.files.map((f) => {
      const stateText = f.status === 'uploading' ? 'Загрузка…'
        : f.status === 'error' ? 'Ошибка'
        : f.kind === 'drive' || f.drive ? 'Drive ↗'
        : fmtSize(f.size);
      const actions = [
        f.status !== 'uploading' ? '<button class="link-btn" type="button" data-file-rename>Переименовать</button>' : '',
        f.status === 'error' && f._blob ? '<button class="link-btn" type="button" data-retry>Повторить</button>' : '',
        f.isImage && f._file && f.status !== 'error' ? '<button class="link-btn" type="button" data-as-cover>Сделать обложкой</button>' : '',
      ].filter(Boolean).join('');
      return `<div class="file-row${f.status === 'error' ? ' is-error' : ''}" data-file="${esc(f.id)}">
<span class="file-type">${esc(f.type)}</span>
<span class="file-sub"><span class="file-name">${esc(f.name)}</span>${actions ? `<span class="file-actions">${actions}</span>` : ''}</span>
<span class="file-state">${esc(stateText)}</span>
<button class="icon-btn" type="button" data-remove aria-label="Убрать «${esc(f.name)}»"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
${f.status === 'uploading' ? '<span class="progress" aria-hidden="true"></span>' : ''}
</div>`;
    }).join('');
  }

  // ───────── Публикация ─────────

  function renderPublish() {
    const btn = $('[data-publish]');
    if (btn.dataset.busy) return;
    const wait = pending();
    btn.disabled = wait;
    btn.textContent = wait ? 'Загружаем файлы…' : (EDIT_ID ? 'Сохранить' : 'Опубликовать');
  }

  function renderAll() {
    renderCover();
    renderCols();
    renderFiles();
    renderPublish();
  }

  $('[data-card-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-form-error]');
    const btn = $('[data-publish]');
    setError(err, '');

    if (!state.title.trim()) {
      setError(err, 'Добавь название карточки.');
      $('#f-title').focus();
      return;
    }
    const failed = [state.cover, ...state.files].filter((f) => f && f.status === 'error');
    if (failed.length) {
      setError(err, 'Не все файлы загрузились. Нажми «Повторить» или убери их.');
      return;
    }

    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.textContent = EDIT_ID ? 'Сохраняем…' : 'Публикуем…';
    try {
      if (!state.cover) {
        const img = state.files.find((f) => f.isImage && f._file);
        if (img) await setCover(img._file);
      }
      if (pending()) btn.textContent = 'Загружаем файлы…';
      await waitUploads();
      btn.textContent = EDIT_ID ? 'Сохраняем…' : 'Публикуем…';
      if (state.cover && state.cover.status !== 'done') throw new Error('Обложка не загрузилась. Убери её или выбери заново.');

      const filesPayload = state.files.map((f) => f.kind === 'existing'
        ? { kind: 'existing', driveId: f.fileId, title: f.title || '' }
        : f.kind === 'drive'
          ? { kind: 'drive', url: f.url, title: f.title || '' }
          : { kind: 'upload', fileId: f.fileId, title: f.title || '' });
      const r = EDIT_ID ? await api('updateCard', { withLive: true,
        id: EDIT_ID,
        title: state.title.trim(),
        description: state.description,
        link: state.link.trim(),
        tags: state.tags,
        star: state.star,
        hidden: state.hidden,
        collections: state.cols,
        coverFileId: state.cover && state.cover.kind === 'upload' ? state.cover.fileId : '',
        removeCover: !state.cover && !!(original && original.cover),
        files: filesPayload,
      }, { onRetry: () => { btn.textContent = 'Скрипт отвечает медленно, пробую ещё раз…'; } }) : await api('createCard', { withLive: true,
        title: state.title.trim(),
        description: state.description,
        link: state.link.trim(),
        tags: state.tags,
        star: state.star,
        hidden: state.hidden,
        collections: state.cols,
        coverFileId: state.cover ? state.cover.fileId : '',
        files: filesPayload,
      });

      if (r.live) store.set('library:live', JSON.stringify({ ts: Date.now(), data: r.live }));
      const num = pad3(r.card.id);
      const link = `${BASE}c/${num}/`;
      if (EDIT_ID) {
        // Сбрасываем быстрые переименования на сайте и кэш скрытых: они устарели
        try {
          const ren = JSON.parse(store.get('library:renames') || '{}');
          delete ren['card:' + r.card.id];
          store.set('library:renames', JSON.stringify(ren));
          sessionStorage.removeItem('library:hidden-cache');
        } catch {}
        $('[data-done-title]').textContent = 'Сохранено';
      }
      $('[data-done-text]').textContent = EDIT_ID
        ? (state.hidden ? `Карточка № ${num} скрыта, изменения уже видны тебе.` : `Изменения в карточке № ${num} появятся на сайте через 1–2 минуты.`) +
          (r.warnings && r.warnings.length ? ` Обрати внимание: ${r.warnings.join('; ')}.` : '')
        : (state.hidden
        ? `Карточка № ${num} сохранена как скрытая: её видишь только ты, на устройствах, где введён ключ.`
        : `Карточка № ${num} появится на сайте через 1–2 минуты.`) +
        (r.warnings && r.warnings.length ? ` Обрати внимание: ${r.warnings.join('; ')}.` : '');
      $('[data-done-link]').href = link;
      state = emptyState();
      store.del(DRAFT_STORE);
      $$('[data-field]').forEach((el) => { if (el.type === 'checkbox') el.checked = false; else el.value = ''; });
      renderAll();
      show('done');
    } catch (ex) {
      if (!handleAuth(ex)) setError(err, ex.message);
    } finally {
      delete btn.dataset.busy;
      renderPublish();
    }
  });

  $('[data-done-again]').addEventListener('click', () => {
    if (EDIT_ID) location.href = `${BASE}admin/`;
    else show('form');
  });

  window.addEventListener('beforeunload', (e) => {
    if (pending()) { e.preventDefault(); e.returnValue = ''; }
  });

  start();
})();
