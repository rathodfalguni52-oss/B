/* BookBridge frontend core: API client, session, icons, artwork, router, navbar, shared UI helpers */
(function () {
  'use strict';
  const BB = (window.BB = { routes: [], actions: {} });

  /* ---------- API ---------- */
  // Same origin when served by the backend. If the page is opened from another dev server
  // (e.g. VS Code Live Server) this falls back to the backend on localhost:3000.
  BB.apiBase = '';
  BB.initApi = async function () {
    try {
      const r = await fetch('/api/health');
      if (r.ok) return;
    } catch { /* fall through */ }
    BB.apiBase = 'http://localhost:3000';
  };

  /* ---------- session (localStorage when "Remember me", else sessionStorage) ---------- */
  BB.token = null; BB.user = null;
  const stores = () => { try { return [localStorage, sessionStorage]; } catch { return []; } };
  BB.loadSession = function () {
    for (const st of stores()) {
      const t = st.getItem('bb_token');
      if (t) { BB.token = t; try { BB.user = JSON.parse(st.getItem('bb_user')); } catch { BB.user = null; } return; }
    }
  };
  BB.saveSession = function (data, remember) {
    BB.clearSession();
    const st = remember ? localStorage : sessionStorage;
    BB.token = data.token; BB.user = data.user;
    try { st.setItem('bb_token', data.token); st.setItem('bb_user', JSON.stringify(data.user)); } catch { /* private mode */ }
  };
  BB.updateUser = function (user) {
    BB.user = user;
    for (const st of stores()) if (st.getItem('bb_token')) st.setItem('bb_user', JSON.stringify(user));
  };
  BB.clearSession = function () {
    BB.token = null; BB.user = null;
    for (const st of stores()) { st.removeItem('bb_token'); st.removeItem('bb_user'); }
  };

  BB.api = async function (path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (BB.token) headers.Authorization = 'Bearer ' + BB.token;
    let res;
    try {
      res = await fetch(BB.apiBase + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error('Cannot reach the server. Make sure the backend is running (npm start).');
    }
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && BB.token) { // session expired
      BB.clearSession(); renderNav();
      if (!/^\/(login|register|forgot|reset)/.test(BB.path())) { toast('Your session expired. Please log in again.'); BB.go('/login?next=' + encodeURIComponent(BB.path())); }
    }
    if (!res.ok) throw new Error(data.error || 'Something went wrong (' + res.status + ')');
    return data;
  };

  /* ---------- utilities ---------- */
  const esc = (BB.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  BB.$ = (sel, root = document) => root.querySelector(sel);
  BB.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  BB.fmtDate = (s) => {
    if (!s) return '';
    const d = new Date(String(s).replace(' ', 'T') + 'Z');
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  BB.initial = (u) => esc((u && u.name ? u.name.trim()[0] : '?').toUpperCase());

  const toast = (BB.toast = (msg) => {
    const t = BB.$('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3000);
  });

  /* ---------- icons (Feather-style, 24px grid) ---------- */
  const P = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M17.9 17.9A10.9 10.9 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="m1 1 22 22"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    down: '<path d="m6 9 6 6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
    arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    gift: '<path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
    menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  };
  const icon = (BB.icon = (name, size = 18) =>
    `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`);
  BB.logo = (size = 26) =>
    `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><path d="M3 7.5c4-1.5 8.300-1.200 13 1.500v17.500c-4.700-2.700-9-3-13-1.500z" fill="currentColor"/><path d="M29 7.500c-4-1.500-8.300-1.200-13 1.500v17.500c4.700-2.700 9-3 13-1.500z" fill="currentColor" opacity=".7"/></svg>`;

  /* ---------- artwork: stack of books with a sprout ---------- */
  BB.art = () => `
  <svg viewBox="0 0 320 280" role="img" aria-label="A stack of books with a small plant growing from the top">
    <circle cx="160" cy="140" r="124" fill="#e6dcfb"/><circle cx="160" cy="140" r="100" fill="#efe8fd"/>
    <path d="M60 60l3 8 8 3-8 3-3 8-3-8-8-3 8-3z M262 96l2.500 6 6 2.500-6 2.500-2.500 6-2.500-6-6-2.500 6-2.500z M250 200l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff"/>
    <ellipse cx="160" cy="236" rx="104" ry="11" fill="#d4c6f5" opacity=".7"/>
    <g>
      <rect x="62" y="190" width="206" height="42" rx="8" fill="#3f2a99"/>
      <rect x="76" y="201" width="190" height="20" rx="4" fill="#fbf4e4"/>
      <path d="M86 207h160M86 214h130" stroke="#e5d9bd" stroke-width="2"/>
      <rect x="62" y="190" width="18" height="42" rx="8" fill="#2f1f7a"/>
    </g>
    <g>
      <rect x="78" y="148" width="178" height="40" rx="8" fill="#f6b52e"/>
      <rect x="92" y="159" width="162" height="19" rx="4" fill="#fbf4e4"/>
      <path d="M102 165h130M102 172h100" stroke="#e5d9bd" stroke-width="2"/>
      <rect x="78" y="148" width="18" height="40" rx="8" fill="#dc9a14"/>
    </g>
    <g>
      <rect x="70" y="106" width="190" height="40" rx="8" fill="#5a3fd0"/>
      <rect x="84" y="117" width="174" height="19" rx="4" fill="#fbf4e4"/>
      <path d="M94 123h140M94 130h110" stroke="#e5d9bd" stroke-width="2"/>
      <rect x="70" y="106" width="18" height="40" rx="8" fill="#4829b8"/>
    </g>
    <path d="M164 106c0-18 2-34 8-48" stroke="#4829b8" stroke-width="4" stroke-linecap="round" fill="none"/>
    <path d="M170 62c-2-22 12-40 34-44 4 22-8 40-34 44z" fill="#6c4be0"/>
    <path d="M166 82c-18 2-34-8-40-28 20-4 38 6 40 28z" fill="#8a6cf0"/>
    <path d="M188 40c0-5 7-6 8-1 1-5 8-4 8 1 0 5-8 10-8 10s-8-5-8-10z" fill="#211a5b"/>
  </svg>`;

  /* ---------- book covers ---------- */
  const COLOR_RE = /^#[0-9a-f]{3,8}$/i;
  BB.cover = (b, cls = '') => {
    if (b.cover_url) return `<div class="cover ${cls}"><img src="${BB.apiBase}${esc(b.cover_url)}" alt="Cover of ${esc(b.title)}" loading="lazy"></div>`;
    let [bg, fg] = String(b.cover_color || '').split('|');
    if (!COLOR_RE.test(bg || '')) bg = '#efe7ff';
    if (!COLOR_RE.test(fg || '')) fg = '#4b33b0';
    return `<div class="cover gen ${cls}" style="--bg:${bg};--fg:${fg}" role="img" aria-label="${esc(b.title)} by ${esc(b.author)}"><span class="ct">${esc(b.title)}</span><span class="ca">${esc(b.author)}</span></div>`;
  };

  /* ---------- dialogs ---------- */
  BB.openDialog = (html) => {
    const d = BB.$('#dlg'); d.onclick = null; d.onclose = null; d.innerHTML = html;
    if (!d.open) d.showModal();
    return d;
  };
  BB.closeDialog = () => { const d = BB.$('#dlg'); if (d.open) d.close(); };
  BB.confirm = (title, text, okLabel = 'Confirm', danger = false) => new Promise((resolve) => {
    const d = BB.openDialog(`<h2>${esc(title)}</h2><p class="sub">${esc(text)}</p>
      <div class="dlg-actions"><button class="btn outline sm" value="no">Cancel</button><button class="btn sm ${danger ? 'danger' : ''}" value="yes">${esc(okLabel)}</button></div>`);
    const done = (v) => { d.onclose = null; BB.closeDialog(); resolve(v); };
    d.onclick = (e) => { const b = e.target.closest('button[value]'); if (b) done(b.value === 'yes'); else if (e.target === d) done(false); };
    d.onclose = () => resolve(false);
  });

  /* ---------- forms ---------- */
  BB.formData = (form) => {
    const o = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return o;
  };
  // Runs `fn(data)` on submit; shows errors inside the form's .form-error and disables the button while busy.
  BB.bindForm = (form, fn) => {
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = BB.$('.form-error', form), btn = BB.$('button[type=submit]', form);
      err.textContent = ''; const label = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait...';
      try { await fn(BB.formData(form), form); }
      catch (ex) { err.textContent = ex.message; err.scrollIntoView({ block: 'nearest' }); }
      finally { btn.disabled = false; btn.textContent = label; }
    });
  };

  /* ---------- router ---------- */
  BB.route = (pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    BB.routes.push({ re, keys, handler, auth: !!opts.auth });
  };
  const parse = () => {
    const h = location.hash.replace(/^#/, '') || '/';
    const [p, q] = h.split('?');
    return { path: p || '/', query: new URLSearchParams(q || '') };
  };
  BB.path = () => { const { path, query } = parse(); const q = query.toString(); return path + (q ? '?' + q : ''); };
  BB.go = (path) => { location.hash = '#' + path; };
  BB.requireLogin = (msg = 'Please log in to continue') => {
    if (BB.token) return true;
    toast(msg); BB.go('/login?next=' + encodeURIComponent(BB.path())); return false;
  };

  let renderId = 0;
  async function render() {
    const id = ++renderId, { path, query } = parse(), app = BB.$('#app');
    BB.closeDialog(); BB.onFavChange = null;
    let match = null;
    for (const r of BB.routes) { const m = r.re.exec(path); if (m) { match = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; break; } }
    renderNav();
    if (!match) { app.innerHTML = `<div class="page empty"><h3>Page not found</h3><p>That page doesn't exist.</p><a class="btn" href="#/">Go home</a></div>`; document.title = 'Not found | BookBridge'; return; }
    if (match.r.auth && !BB.token) { toast('Please log in to continue'); return BB.go('/login?next=' + encodeURIComponent(BB.path())); }
    app.innerHTML = '<div class="loading">Loading...</div>';
    try {
      const out = await match.r.handler({ params: match.params, query });
      if (id !== renderId || !out) return;
      app.innerHTML = out.html;
      document.title = (out.title ? out.title + ' | ' : '') + 'BookBridge';
      if (out.mount) out.mount(app);
      window.scrollTo(0, 0);
    } catch (e) {
      if (id !== renderId) return;
      app.innerHTML = `<div class="page empty"><h3>Something went wrong</h3><p>${esc(e.message)}</p><a class="btn" href="#/">Go home</a></div>`;
    }
  }
  BB.rerender = render;

  /* ---------- navbar ---------- */
  const LINKS = [['/', 'Home'], ['/browse', 'Browse Books'], ['/donate', 'Donate'], ['/favorites', 'Favorites'], ['/help', 'Help'], ['/contact', 'Contact']];
  function activeLink(path) {
    if (path === '/') return '/';
    if (path.startsWith('/browse') || path.startsWith('/book/')) return '/browse';
    if (path.startsWith('/donate') || path.startsWith('/edit/')) return '/donate';
    return LINKS.map((l) => l[0]).find((l) => l !== '/' && path.startsWith(l)) || '';
  }
  function renderNav() {
    const nav = BB.$('#nav'), act = activeLink(parse().path), u = BB.user;
    const wasOpen = BB.$('.nav-search.open', nav) ? BB.$('.nav-search input', nav).value : null;
    nav.innerHTML = `<div class="nav-in">
      <a class="brand" href="#/" aria-label="BookBridge home">${BB.logo()}<span>BookBridge</span></a>
      <nav class="nav-links" id="navLinks" aria-label="Main">${LINKS.map(([p, t]) => `<a href="#${p}" ${act === p ? 'class="on" aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
      <div class="nav-tools">
        <form class="nav-search ${wasOpen !== null ? 'open' : ''}" role="search" id="navSearch">
          <label class="sr" for="navQ">Search books</label>
          <input id="navQ" type="search" placeholder="Search title or author" value="${esc(wasOpen || '')}" autocomplete="off">
          <button class="icon-btn" type="button" data-action="search" aria-label="Search books">${icon('search', 18)}</button>
        </form>
        <button class="avatar" data-action="user-menu" aria-label="Account menu" aria-haspopup="true" aria-expanded="false">${u ? BB.initial(u) : icon('user', 16)}</button>
        <div class="menu-pop" id="userMenu">${u
          ? `<div class="who"><b>${esc(u.name)}</b>@${esc(u.username)}</div>
             <a href="#/profile">${icon('user', 16)} Profile</a><a href="#/profile/books">${icon('book', 16)} My Books</a>
             <a href="#/favorites">${icon('heart', 16)} Favorites</a><a href="#/profile/settings">${icon('settings', 16)} Settings</a>
             <button class="danger" data-action="logout">${icon('logout', 16)} Logout</button>`
          : `<a href="#/login">${icon('lock', 16)} Login</a><a href="#/register">${icon('user', 16)} Create account</a>`}</div>
        <button class="icon-btn burger" data-action="burger" aria-label="Menu" aria-expanded="false" aria-controls="navLinks">${icon('menu', 22)}</button>
      </div></div>`;
    BB.$('#year').textContent = new Date().getFullYear();
  }
  BB.renderNav = renderNav;

  /* ---------- global actions (event delegation) ---------- */
  Object.assign(BB.actions, {
    search(el) {
      const box = BB.$('#navSearch'), input = BB.$('#navQ');
      if (!box.classList.contains('open')) { box.classList.add('open'); input.focus(); return; }
      if (input.value.trim()) BB.go('/browse?q=' + encodeURIComponent(input.value.trim()));
      else box.classList.remove('open');
    },
    'user-menu'(el) {
      const m = BB.$('#userMenu'), open = m.classList.toggle('open');
      el.setAttribute('aria-expanded', open);
    },
    burger(el) {
      const open = BB.$('#navLinks').classList.toggle('open');
      el.setAttribute('aria-expanded', open);
    },
    async logout() {
      BB.clearSession(); toast('You have been logged out'); BB.go('/'); renderNav();
    },
    'toggle-pw'(el) {
      const input = BB.$('input', el.parentElement), show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      el.innerHTML = icon(show ? 'eye-off' : 'eye', 18);
      el.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    },
    async fav(el) {
      if (!BB.requireLogin('Log in to save books to your favorites')) return;
      const id = el.dataset.id;
      try {
        const { favorited } = await BB.api(`/api/books/${id}/favorite`, { method: 'POST' });
        BB.$$(`[data-action="fav"][data-id="${id}"]`).forEach((b) => {
          b.classList.toggle('on', favorited); b.setAttribute('aria-pressed', favorited);
          const lbl = BB.$('.lbl', b);
          if (lbl) lbl.textContent = favorited ? 'Saved to Favorites' : 'Add to Favorites';
          else b.setAttribute('aria-label', favorited ? 'Remove from favorites' : 'Add to favorites');
        });
        toast(favorited ? 'Added to your favorites' : 'Removed from favorites');
        if (BB.onFavChange) BB.onFavChange(id, favorited);
      } catch (e) { toast(e.message); }
    },
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (el && BB.actions[el.dataset.action]) { if (el.tagName === 'BUTTON' && el.type !== 'submit') e.preventDefault(); BB.actions[el.dataset.action](el, e); }
    // close menus when clicking elsewhere / after navigating
    const pop = BB.$('#userMenu');
    if (pop && pop.classList.contains('open') && (!el || el.dataset.action !== 'user-menu')) { pop.classList.remove('open'); const a = BB.$('[data-action="user-menu"]'); if (a) a.setAttribute('aria-expanded', 'false'); }
    const links = BB.$('#navLinks');
    if (links && links.classList.contains('open') && e.target.closest('#navLinks a')) links.classList.remove('open');
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'navSearch') { e.preventDefault(); BB.actions.search(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const box = BB.$('#navSearch'); if (box) box.classList.remove('open');
      const pop = BB.$('#userMenu'); if (pop) pop.classList.remove('open');
    }
  });
  // clicking the dark backdrop closes simple dialogs
  BB.$('#dlg').addEventListener('click', (e) => { if (e.target === e.currentTarget && !e.currentTarget.dataset.keep) BB.closeDialog(); });

  /* ---------- boot (called by pages.js once routes are registered) ---------- */
  BB.start = async function () {
    BB.loadSession();
    await BB.initApi();
    window.addEventListener('hashchange', render);
    if (BB.token) { // refresh the cached user (also validates the token)
      try { BB.updateUser((await BB.api('/api/auth/me')).user); } catch { /* handled in api() */ }
    }
    render();
  };
})();
