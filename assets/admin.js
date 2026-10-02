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

  async function api(action, payload = {}) {
    let res;
    try {
      res = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ key, action }, payload)),
      });
    } catch {
      throw new Error('Нет связи со скриптом. Проверь интернет и попробуй ещё раз.');
    }
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('Скрипт ответил не так, как ожидалось. Проверь, что веб-приложение развёрнуто с доступом «Все».');
    }
    if (!data.ok) {
      if (data.error === 'unauthorized') throw new AuthError('Ключ не подходит.');
      throw new Error(data.error || 'Неизвестная ошибка.');
    }
    return data;
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

  async function start() {
    if (!SCRIPT_URL) {
      show('key');
      setError($('[data-key-error]'), 'В site.config.json не указан адрес скрипта.');
      return;
    }
    if (!key) { show('key'); return; }
    show('loading');
    try {
      await loadCollections();
      if (EDIT_ID) await loadCard(); else restoreDraft();
      renderAll();
      show('form');
    } catch (err) {
      if (handleAuth(err)) return;
      show('key');
      setError($('[data-key-error]'), err.message);
    }
  }

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
      await loadCollections();
      store.set(KEY_STORE, key);
      input.value = '';
      if (EDIT_ID) await loadCard(); else restoreDraft();
      renderAll();
      show('form');
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
      const draft = Object.assign({}, state, {
        cover: keep(state.cover) ? clean(state.cover) : null,
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

  async function loadCard() {
    const r = await api('getCard', { id: EDIT_ID });
    const c = r.card;
    original = c;
    state = Object.assign(emptyState(), {
      title: c.title,
      description: c.description,
      link: c.link,
      tags: (c.tags || []).join(', '),
      star: !!c.star,
      hidden: !!c.hidden,
      cols: (c.collections || []).filter((id) => collections.some((x) => x.id === id)),
      cover: c.cover ? { id: nid(), kind: 'existing', fileId: c.cover, status: 'done', name: 'Обложка', thumb: driveImg(c.cover, 480) } : null,
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
    const raw = r.collections || [];
    const byOrder = (a, b) => (a.order - b.order) || a.name.localeCompare(b.name, 'ru');
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

  async function compress(file, max, quality) {
    let src, w, h;
    try {
      src = await createImageBitmap(file);
      w = src.width; h = src.height;
    } catch {
      src = await loadImage(file);
      w = src.naturalWidth; h = src.naturalHeight;
    }
    const s = Math.min(1, max / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * s));
    const ch = Math.max(1, Math.round(h * s));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(src, 0, 0, cw, ch);
    if (src.close) src.close();
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality));
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
    let blob, thumb;
    try {
      blob = await compress(file, 1600, 0.85);
      thumb = await toDataURL(await compress(file, 480, 0.7));
    } catch {
      setError(formErr, 'Не получилось открыть это изображение. Попробуй JPG или PNG.');
      return;
    }
    removeOriginal();
    state.cover = { id: nid(), kind: 'upload', name: baseName(file.name) + '.jpg', size: blob.size, thumb, _orig: file };
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
    $('[data-cover-preview]').src = c.thumb || '';
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
      await waitUploads();
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
      }) : await api('createCard', { withLive: true,
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
