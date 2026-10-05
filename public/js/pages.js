/* BookBridge pages. Each route handler returns { title, html, mount(root) }. */
(function () {
  'use strict';
  const { $, $$, esc, icon, api, cover, toast, bindForm, fmtDate, route } = BB;
  const A = BB.actions;

  /* ---------- shared bits ---------- */
  let metaCache = null;
  const meta = async () => metaCache || (metaCache = await api('/api/meta'));
  const options = (list, selected, placeholder) =>
    (placeholder ? `<option value="">${esc(placeholder)}</option>` : '') +
    list.map((v) => `<option ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');

  const ifield = (o) => `<div class="ig"><label class="sr" for="${o.id}">${o.label}</label>${icon(o.icon, 18)}
    <input id="${o.id}" name="${o.name}" type="${o.type || 'text'}" placeholder="${o.label}" autocomplete="${o.ac || 'off'}" ${o.req === false ? '' : 'required'} ${o.attrs || ''} value="${esc(o.value || '')}">
    ${o.type === 'password' ? `<button type="button" class="eye" data-action="toggle-pw" aria-label="Show password">${icon('eye', 18)}</button>` : ''}</div>`;

  const safeNext = (q) => { const n = q.get('next') || ''; return /^\/[^/]/.test(n) || n === '/' ? n : '/profile'; };

  function bookCard(b) {
    return `<article class="card">
      ${b.status === 'Donated' ? '<span class="chip donated">Donated</span>' : ''}
      <button class="fav ${b.favorited ? 'on' : ''}" data-action="fav" data-id="${b.id}" aria-pressed="${!!b.favorited}" aria-label="${b.favorited ? 'Remove from favorites' : 'Add to favorites'}">${icon('heart', 16)}</button>
      ${cover(b)}
      <h3><a class="stretch" href="#/book/${b.id}">${esc(b.title)}</a></h3>
      <p class="by">${esc(b.author)}</p><p class="cat">${esc(b.category)}</p>
    </article>`;
  }
  const emptyBlock = (title, text, btn) => `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p>${btn || ''}</div>`;

  /* ================= HOME ================= */
  route('/', async () => {
    const { books } = await api('/api/books?sort=popular&status=Available&limit=4');
    return {
      title: 'Give books a second life',
      html: `<section class="hero">
        <div>
          <h1>Give Books <span>A Second Life</span></h1>
          <p>Donate books, share knowledge, make a difference.</p>
          <div class="hero-cta"><a class="btn" href="#/browse">Explore Books ${icon('arrow', 16)}</a><a class="btn outline" href="#/donate">Donate Books</a></div>
        </div>
        <div class="hero-art">${BB.art()}</div>
      </section>
      <div class="home-feature"><section class="panel" aria-labelledby="featured">
        <div class="section-head"><h2 id="featured">Featured Books</h2><a href="#/browse">View All ${icon('arrow', 14)}</a></div>
        ${books.length ? `<div class="grid four">${books.map(bookCard).join('')}</div>`
          : emptyBlock('No books yet', 'Be the first to donate a book to the community.', '<a class="btn" href="#/donate">Donate a book</a>')}
      </section></div>`,
    };
  });

  /* ================= BROWSE ================= */
  route('/browse', async ({ query }) => {
    const m = await meta();
    const st = { q: query.get('q') || '', category: query.get('category') || '', condition: query.get('condition') || '', show: query.get('show') === 'all' ? 'all' : 'available' };
    return {
      title: 'Browse Books',
      html: `<div class="page">
        <div class="page-head"><h1>Browse Books</h1><p>Find a book you need, or one you didn't know you wanted.</p></div>
        <form class="filters" id="bf" role="search">
          <div class="ig">${icon('search', 18)}<label class="sr" for="bq">Search by title, author or category</label><input id="bq" name="q" type="search" placeholder="Search by title, author or category" value="${esc(st.q)}" autocomplete="off"></div>
          <label class="sr" for="bc">Category</label><select id="bc" name="category">${options(m.categories, st.category, 'All categories')}</select>
          <label class="sr" for="bd">Condition</label><select id="bd" name="condition">${options(m.conditions, st.condition, 'Any condition')}</select>
          <label class="sr" for="bs">Availability</label><select id="bs" name="show"><option value="available" ${st.show === 'available' ? 'selected' : ''}>Available now</option><option value="all" ${st.show === 'all' ? 'selected' : ''}>Include donated</option></select>
        </form>
        <p class="count" id="bcount" aria-live="polite"></p>
        <div class="grid" id="bgrid"></div>
        <div class="more"><button class="btn outline" id="bmore" hidden>Show more books</button></div>
      </div>`,
      mount(root) {
        const form = $('#bf', root), grid = $('#bgrid', root), count = $('#bcount', root), more = $('#bmore', root);
        let offset = 0, seq = 0, timer;
        async function load(append) {
          const mine = ++seq; if (!append) offset = 0;
          const d = BB.formData(form), p = new URLSearchParams();
          if (d.q.trim()) p.set('q', d.q.trim()); if (d.category) p.set('category', d.category);
          if (d.condition) p.set('condition', d.condition); if (d.show === 'all') p.set('show', 'all');
          history.replaceState(null, '', '#/browse' + (p.toString() ? '?' + p : ''));
          const a = new URLSearchParams(p); a.delete('show');
          if (d.show !== 'all') a.set('status', 'Available');
          a.set('limit', 12); a.set('offset', offset);
          try {
            const r = await api('/api/books?' + a);
            if (mine !== seq) return;
            const html = r.books.map(bookCard).join('');
            if (append) grid.insertAdjacentHTML('beforeend', html);
            else grid.innerHTML = html || `<div style="grid-column:1/-1">${emptyBlock('No books match your search', 'Try a different word or clear a filter, or donate a book yourself.', '<a class="btn" href="#/donate">Donate a book</a>')}</div>`;
            offset += r.books.length;
            count.textContent = r.total ? `Showing ${offset} of ${r.total} book${r.total === 1 ? '' : 's'}` : '';
            more.hidden = offset >= r.total;
          } catch (e) { if (mine === seq) grid.innerHTML = emptyBlock('Could not load books', e.message); }
        }
        form.addEventListener('submit', (e) => e.preventDefault());
        form.addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => load(false), e.target.name === 'q' ? 250 : 0); });
        more.addEventListener('click', () => load(true));
        load(false);
      },
    };
  });

  /* ================= FAVORITES ================= */
  function favoritesView(books) {
    return books.length
      ? `<div class="grid" id="favGrid">${books.map(bookCard).join('')}</div>`
      : emptyBlock('No favorites yet', 'Tap the heart on any book to keep it here for later.', '<a class="btn" href="#/browse">Browse books</a>');
  }
  function watchFavorites(root) {
    BB.onFavChange = (id, on) => {
      if (on) return;
      const btn = $(`#favGrid [data-action="fav"][data-id="${id}"]`, root);
      if (btn) btn.closest('.card').remove();
      if (!$('#favGrid .card', root)) $('#favHolder', root).innerHTML = favoritesView([]);
    };
  }
  route('/favorites', async () => {
    const { books } = await api('/api/me/favorites');
    return {
      title: 'Favorites',
      html: `<div class="page"><div class="page-head"><h1>Favorites</h1><p>Books you saved for later.</p></div><div id="favHolder">${favoritesView(books)}</div></div>`,
      mount: watchFavorites,
    };
  }, { auth: true });

  /* ================= AUTH ================= */
  const authShell = (art, card) => `<div class="auth"><div class="auth-art">${BB.art()}<h2>${art[0]}</h2><p>${art[1]}</p></div><div class="auth-card">
    <a class="brand" href="#/">${BB.logo(24)}<span>BookBridge</span></a>${card}</div></div>`;

  route('/login', async ({ query }) => {
    if (BB.token) { BB.go('/profile'); return null; }
    return {
      title: 'Login',
      html: authShell(['Welcome Back!', 'Log in to continue your book journey.'], `
        <h1>Login to your account</h1>
        <form id="loginForm">
          ${ifield({ id: 'li', name: 'identifier', label: 'Email or Username', icon: 'user', ac: 'username' })}
          ${ifield({ id: 'lp', name: 'password', label: 'Password', icon: 'lock', type: 'password', ac: 'current-password' })}
          <div class="row-between"><label class="check"><input type="checkbox" name="remember" checked> Remember me</label><a class="link" href="#/forgot" style="font-size:12px">Forgot password?</a></div>
          <p class="form-error" role="alert"></p>
          <button class="btn block" type="submit">Login</button>
        </form>
        <p class="alt">Don't have an account? <a class="link" href="#/register${query.get('next') ? '?next=' + encodeURIComponent(query.get('next')) : ''}">Register</a></p>`),
      mount(root) {
        bindForm($('#loginForm', root), async (d) => {
          const r = await api('/api/auth/login', { method: 'POST', body: d });
          BB.saveSession(r, d.remember); toast(`Welcome back, ${r.user.name.split(' ')[0]}!`);
          BB.renderNav(); BB.go(safeNext(query));
        });
      },
    };
  });

  route('/register', async ({ query }) => {
    if (BB.token) { BB.go('/profile'); return null; }
    return {
      title: 'Create account',
      html: authShell(['Join BookBridge', 'Create your account and be part of a community that shares books.'], `
        <h1>Create your account</h1>
        <form id="regForm">
          ${ifield({ id: 'rn', name: 'name', label: 'Full Name', icon: 'user', ac: 'name', attrs: 'minlength="2" maxlength="100"' })}
          ${ifield({ id: 're', name: 'email', label: 'Email', icon: 'mail', type: 'email', ac: 'email' })}
          ${ifield({ id: 'ru', name: 'username', label: 'Username', icon: 'at', ac: 'username', attrs: 'pattern="[A-Za-z0-9_]{3,30}" minlength="3" maxlength="30" title="3-30 letters, numbers or underscores"' })}
          ${ifield({ id: 'rp', name: 'password', label: 'Password', icon: 'lock', type: 'password', ac: 'new-password', attrs: 'minlength="8"' })}
          ${ifield({ id: 'rc', name: 'confirm_password', label: 'Confirm Password', icon: 'lock', type: 'password', ac: 'new-password', attrs: 'minlength="8"' })}
          <p class="form-error" role="alert"></p>
          <button class="btn block" type="submit">Register</button>
        </form>
        <p class="alt">Already have an account? <a class="link" href="#/login${query.get('next') ? '?next=' + encodeURIComponent(query.get('next')) : ''}">Login</a></p>`),
      mount(root) {
        bindForm($('#regForm', root), async (d) => {
          if (d.password !== d.confirm_password) throw new Error('Passwords do not match');
          const r = await api('/api/auth/register', { method: 'POST', body: d });
          BB.saveSession(r, true); toast('Account created. Welcome to BookBridge!');
          BB.renderNav(); BB.go(safeNext(query));
        });
      },
    };
  });

  route('/forgot', async () => ({
    title: 'Forgot password',
    html: authShell(['Forgot your password?', "We'll help you get back to your books."], `
      <h1>Reset your password</h1>
      <p class="note">Enter your account email and we'll create a reset link.</p>
      <form id="forgotForm">
        ${ifield({ id: 'fe', name: 'email', label: 'Email', icon: 'mail', type: 'email', ac: 'email' })}
        <p class="form-error" role="alert"></p>
        <div id="forgotDone"></div>
        <button class="btn block" type="submit">Send reset link</button>
      </form>
      <p class="alt"><a class="link" href="#/login">Back to login</a></p>`),
    mount(root) {
      bindForm($('#forgotForm', root), async (d) => {
        const r = await api('/api/auth/forgot', { method: 'POST', body: d });
        $('#forgotDone', root).innerHTML = `<div class="notice">If an account exists for that email, a reset link has been created. It is valid for one hour.
          ${r.dev_reset_link ? `<br><a class="link" href="${esc(r.dev_reset_link)}">Open the reset link</a>` : '<br>Running locally? The link is printed in the server console.'}</div>`;
      });
    },
  }));

  route('/reset', async ({ query }) => {
    const token = query.get('token') || '';
    return {
      title: 'Choose a new password',
      html: authShell(['Almost there!', 'Choose a new password for your account.'], `
        <h1>Choose a new password</h1>
        <form id="resetForm">
          ${ifield({ id: 'np', name: 'password', label: 'New password', icon: 'lock', type: 'password', ac: 'new-password', attrs: 'minlength="8"' })}
          ${ifield({ id: 'nc', name: 'confirm_password', label: 'Confirm new password', icon: 'lock', type: 'password', ac: 'new-password', attrs: 'minlength="8"' })}
          <p class="form-error" role="alert"></p>
          <button class="btn block" type="submit">Save password</button>
        </form>`),
      mount(root) {
        bindForm($('#resetForm', root), async (d) => {
          if (d.password !== d.confirm_password) throw new Error('Passwords do not match');
          await api('/api/auth/reset', { method: 'POST', body: { token, ...d } });
          toast('Password updated. Please log in.'); BB.go('/login');
        });
      },
    };
  });

  /* ================= BOOK DETAIL ================= */
  route('/book/:id', async ({ params }) => {
    const { book: b } = await api('/api/books/' + params.id);
    let pending = [];
    if (b.can_manage && b.status === 'Available') pending = (await api(`/api/books/${b.id}/requests`)).requests.filter((r) => r.status === 'pending');
    const gone = b.status === 'Donated';
    const buttons = [];
    if (gone) buttons.push('<button class="btn" disabled>Already donated</button>');
    else if (b.my_request_id) buttons.push(`<button class="btn outline" data-action="cancel-request" data-id="${b.my_request_id}">Cancel request</button>`);
    else if (!b.is_owner) buttons.push(`<button class="btn" data-action="request-book" data-id="${b.id}">Request Book</button>`);
    buttons.push(`<button class="btn outline fav-btn ${b.favorited ? 'on' : ''}" data-action="fav" data-id="${b.id}" aria-pressed="${b.favorited}">${icon('heart', 16)} <span class="lbl">${b.favorited ? 'Saved to Favorites' : 'Add to Favorites'}</span></button>`);
    return {
      title: b.title,
      html: `<div class="page narrow">
        <div class="panel"><div class="book">
          ${cover(b)}
          <div>
            <h1>${esc(b.title)}</h1><p class="by">${esc(b.author)}</p><p class="cat">${esc(b.category)}</p>
            <div class="meta"><span>${icon('info', 15)} ${esc(b.condition)} Condition</span><span><i class="dot ${gone ? 'off' : ''}"></i> ${gone ? 'Donated' : 'Available'}</span></div>
            ${b.description ? `<p class="desc">${esc(b.description)}</p>` : ''}
            ${b.my_request_id ? '<p class="desc" style="margin-top:12px"><b>Request sent.</b> The donor will approve or decline it. Track it in your profile.</p>' : ''}
            ${gone && b.recipient ? `<p class="desc" style="margin-top:12px">This book was given to ${esc(b.recipient.name)}.</p>` : ''}
            <div class="cta">${buttons.join('')}</div>
            ${b.can_manage ? `<div class="cta" style="margin-top:12px"><a class="btn outline sm" href="#/edit/${b.id}">${icon('edit', 14)} Edit book</a><button class="btn danger sm" data-action="delete-book" data-id="${b.id}">${icon('trash', 14)} Delete</button></div>` : ''}
          </div>
        </div>
        <div class="about"><h2>About the Book</h2><dl>
          <div><dt>Author</dt><dd>${esc(b.author)}</dd></div><div><dt>Category</dt><dd>${esc(b.category)}</dd></div>
          <div><dt>Condition</dt><dd>${esc(b.condition)}</dd></div><div><dt>Published</dt><dd>${b.published_year || 'Not listed'}</dd></div>
          <div><dt>Donated by</dt><dd>${esc(b.owner.name)}</dd></div><div><dt>Listed on</dt><dd>${fmtDate(b.created_at)}</dd></div>
        </dl></div></div>
        ${pending.length ? `<div class="about panel-note"><h2>Requests for this book (${pending.length})</h2>${pending.map((r) => requestRow(r)).join('')}</div>` : ''}
      </div>`,
    };
  });

  function requestRow(r) {
    return `<div class="req"><div class="rt"><b>${esc(r.requester.name)}</b><span>@${esc(r.requester.username)}${r.created_at ? ' · ' + fmtDate(r.created_at) : ''}</span>${r.message ? `<p>${esc(r.message)}</p>` : ''}</div>
      <button class="btn sm" data-action="approve" data-id="${r.id}">Approve</button><button class="btn outline sm" data-action="decline" data-id="${r.id}">Decline</button></div>`;
  }

  Object.assign(A, {
    'request-book'(el) {
      if (!BB.requireLogin('Log in to request this book')) return;
      const d = BB.openDialog(`<h2>Request this book</h2><p class="sub">Add a short note for the donor (optional). They can approve or decline your request.</p>
        <form id="reqForm"><label class="field"><span>Message</span><textarea name="message" maxlength="500" placeholder="Hi! I'd love to read this because..."></textarea></label>
        <p class="form-error" role="alert"></p>
        <div class="dlg-actions"><button type="button" class="btn outline sm" data-action="close-dialog">Cancel</button><button class="btn sm" type="submit">Send request</button></div></form>`);
      bindForm($('#reqForm', d), async (data) => {
        await api(`/api/books/${el.dataset.id}/request`, { method: 'POST', body: data });
        BB.closeDialog(); toast('Request sent'); BB.rerender();
      });
    },
    'close-dialog'() { BB.closeDialog(); },
    async 'cancel-request'(el) {
      if (!(await BB.confirm('Cancel this request?', 'The donor will no longer see it.', 'Cancel request', true))) return;
      try { await api(`/api/requests/${el.dataset.id}/cancel`, { method: 'POST' }); toast('Request cancelled'); BB.rerender(); } catch (e) { toast(e.message); }
    },
    async approve(el) {
      if (!(await BB.confirm('Donate this book?', 'The book will be marked as donated and other requests will be declined.', 'Approve'))) return;
      try { await api(`/api/requests/${el.dataset.id}/approve`, { method: 'POST' }); toast('Request approved. Book marked as donated'); BB.rerender(); } catch (e) { toast(e.message); }
    },
    async decline(el) {
      try { await api(`/api/requests/${el.dataset.id}/decline`, { method: 'POST' }); toast('Request declined'); BB.rerender(); } catch (e) { toast(e.message); }
    },
    async 'delete-book'(el) {
      if (!(await BB.confirm('Delete this book?', 'This removes the listing and its requests for good.', 'Delete', true))) return;
      try { await api('/api/books/' + el.dataset.id, { method: 'DELETE' }); toast('Book deleted'); BB.go('/profile/books'); } catch (e) { toast(e.message); }
    },
    acc(el) {
      const item = el.parentElement, open = !item.classList.contains('open');
      item.classList.toggle('open', open); el.setAttribute('aria-expanded', open); $('.a', item).hidden = !open;
    },
  });

  /* ================= UPLOAD / EDIT BOOK ================= */
  async function bookFormPage(existing) {
    const m = await meta(), b = existing || {};
    return {
      title: existing ? 'Edit book' : 'Upload a Book',
      html: `<div class="page"><div class="page-head"><h1>${existing ? 'Edit book' : 'Upload a Book'}</h1><p>${existing ? 'Update the details of your book' : 'Share a book with the community'}</p></div>
        <form class="upload" id="bookForm">
          <div><label class="drop" id="drop"><input type="file" id="coverFile" accept="image/jpeg,image/png" aria-label="Upload cover image"><span id="dropInner"></span></label>
            <div class="drop-actions" id="dropActions" hidden><button type="button" class="btn outline sm" data-action="clear-cover">Remove image</button></div></div>
          <div class="form-card">
            <label class="field"><span>Book Title <em>*</em></span><input name="title" required maxlength="150" placeholder="Enter book title" value="${esc(b.title)}"></label>
            <label class="field"><span>Author <em>*</em></span><input name="author" required maxlength="120" placeholder="Enter author name" value="${esc(b.author)}"></label>
            <div class="two">
              <label class="field"><span>Category <em>*</em></span><select name="category" required>${options(m.categories, b.category, 'Select category')}</select></label>
              <label class="field"><span>Condition <em>*</em></span><select name="condition" required>${options(m.conditions, b.condition, 'Select condition')}</select></label>
            </div>
            <label class="field"><span>Published year</span><input name="published_year" type="number" min="1400" max="${new Date().getFullYear() + 1}" placeholder="e.g. 2018 (optional)" value="${b.published_year || ''}"></label>
            <label class="field"><span>Description</span><textarea name="description" maxlength="1000" placeholder="Tell us about the book (optional)">${esc(b.description)}</textarea></label>
            <p class="form-error" role="alert"></p>
            <button class="btn block" type="submit">${existing ? 'Save changes' : 'Upload Book'}</button>
          </div>
        </form></div>`,
      mount(root) {
        const drop = $('#drop', root), inner = $('#dropInner', root), file = $('#coverFile', root), acts = $('#dropActions', root);
        let coverData = null, removeCover = false;
        const empty = () => { inner.innerHTML = `${icon('camera', 44)}<br><b>Click to upload cover image</b><br>(or drag and drop)<br><small>Supported formats: JPG, PNG, JPEG (max 2 MB)</small>`; acts.hidden = true; };
        const preview = (src) => { inner.innerHTML = `<img src="${src}" alt="Selected cover preview">`; acts.hidden = false; };
        if (b.cover_url) preview(BB.apiBase + b.cover_url); else empty();
        file.addEventListener('change', () => {
          const f = file.files[0]; if (!f) return;
          if (!/^image\/(png|jpe?g)$/.test(f.type)) { toast('Please choose a JPG or PNG image'); file.value = ''; return; }
          if (f.size > 2 * 1024 * 1024) { toast('That image is over 2 MB. Please choose a smaller one'); file.value = ''; return; }
          const rd = new FileReader();
          rd.onload = () => { coverData = rd.result; removeCover = false; preview(coverData); };
          rd.readAsDataURL(f);
        });
        ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.add('over')));
        ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
        A['clear-cover'] = () => { coverData = null; removeCover = !!b.cover_url; file.value = ''; empty(); };
        bindForm($('#bookForm', root), async (d) => {
          const body = { ...d };
          if (coverData) body.cover_data = coverData; else if (removeCover) body.remove_cover = true;
          const r = existing ? await api('/api/books/' + b.id, { method: 'PUT', body }) : await api('/api/books', { method: 'POST', body });
          toast(existing ? 'Changes saved' : 'Thank you! Your book is now listed'); BB.go('/book/' + r.book.id);
        });
      },
    };
  }
  route('/donate', () => bookFormPage(null), { auth: true });
  route('/edit/:id', async ({ params }) => {
    const { book } = await api('/api/books/' + params.id);
    if (!book.can_manage) { toast('You can only edit your own books'); BB.go('/book/' + book.id); return null; }
    return bookFormPage(book);
  }, { auth: true });

  /* ================= PROFILE ================= */
  const SIDE = [['/profile', 'Profile', 'user'], ['/profile/books', 'My Books', 'book'], ['/profile/favorites', 'Favorites', 'heart'], ['/profile/donations', 'Donations', 'gift'], ['/profile/settings', 'Settings', 'settings']];
  const shell = (active, inner, stats) => `<div class="page"><div class="shell">
    <nav class="side" aria-label="Account">${SIDE.map(([p, t, ic]) => `<a href="#${p}" ${p === active ? 'class="on" aria-current="page"' : ''}>${icon(ic, 18)} ${t}${p === '/profile/books' && stats.incoming ? `<span class="dot" title="${stats.incoming} open request(s)">${stats.incoming}</span>` : ''}</a>`).join('')}
      <button class="out" data-action="logout">${icon('logout', 18)} Logout</button></nav>
    <section class="main">${inner}</section></div></div>`;
  const miniRow = (b, metaHtml) => `<li><a class="stretch" href="#/book/${b.id}" aria-label="${esc(b.title)}"></a>${cover(b, 'mini')}<div class="rt"><b>${esc(b.title)}</b><span>${esc(b.author)}</span></div><div class="rm">${metaHtml}</div>${icon('right', 16)}</li>`;
  const statusChip = (s) => `<span class="chip ${s.toLowerCase()}">${esc(s[0].toUpperCase() + s.slice(1))}</span>`;
  const profileLoad = async () => { const p = await api('/api/profile'); BB.updateUser(p.user); BB.renderNav(); return p; };

  route('/profile', async ({ query }) => {
    const { user: u, stats } = await profileLoad();
    const tab = ['donated', 'requested', 'favorites'].includes(query.get('tab')) ? query.get('tab') : 'donated';
    return {
      title: 'Profile',
      html: shell('/profile', `
        <div class="me-card"><div class="me-top"><span class="avatar lg">${BB.initial(u)}</span>
          <div class="who"><b>${esc(u.name)}</b><span>${esc(u.email)} · @${esc(u.username)}</span>${u.bio ? `<p>${esc(u.bio)}</p>` : ''}</div>
          <button class="btn outline sm" data-action="edit-profile">${icon('edit', 14)} Edit Profile</button></div>
          <div class="stats"><div><b>${stats.donated}</b><span>Books Donated</span></div><div><b>${stats.requested}</b><span>Books Requested</span></div><div><b>${stats.favorites}</b><span>Favorites</span></div></div></div>
        <h2>My Activity</h2>
        <div class="tabs" role="tablist" aria-label="My activity">${[['donated', 'Donated Books'], ['requested', 'Requested Books'], ['favorites', 'Favorites']].map(([k, t]) => `<button role="tab" id="tab-${k}" data-tab="${k}" aria-selected="${k === tab}">${t}</button>`).join('')}</div>
        <div id="tabBody" role="tabpanel" aria-live="polite"></div>`, stats),
      mount(root) {
        const body = $('#tabBody', root);
        async function show(k) {
          $$('.tabs button', root).forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === k));
          body.setAttribute('aria-labelledby', 'tab-' + k);
          history.replaceState(null, '', '#/profile?tab=' + k);
          body.innerHTML = '<p class="empty-list">Loading...</p>';
          try {
            let rows = '', emptyMsg = '';
            if (k === 'donated') {
              const { books } = await api('/api/me/books');
              rows = books.map((b) => miniRow(b, `${statusChip(b.status)}${b.pending_count ? `<span>${b.pending_count} open request${b.pending_count > 1 ? 's' : ''}</span>` : ''}<span>Donated on: ${fmtDate(b.created_at)}</span>`)).join('');
              emptyMsg = 'You have not donated any books yet. <a class="link" href="#/donate">Donate your first book</a>';
            } else if (k === 'requested') {
              const { requests } = await api('/api/me/requests');
              rows = requests.map((r) => miniRow(r.book, `${statusChip(r.status)}<span>Requested on: ${fmtDate(r.created_at)}</span>`)
                .replace('<div class="rm">', `<div class="rm">${r.status === 'pending' ? `<button class="btn outline sm above" data-action="cancel-request" data-id="${r.id}">Cancel</button>` : ''}`)).join('');
              emptyMsg = 'You have not requested any books yet. <a class="link" href="#/browse">Browse books</a>';
            } else {
              const { books } = await api('/api/me/favorites');
              rows = books.map((b) => miniRow(b, `<span>${esc(b.category)}</span>`)).join('');
              emptyMsg = 'Nothing saved yet. Tap the heart on a book to add it.';
            }
            body.innerHTML = rows ? `<ul class="list">${rows}</ul>` : `<div class="list"><p class="empty-list">${emptyMsg}</p></div>`;
          } catch (e) { body.innerHTML = `<p class="empty-list">${esc(e.message)}</p>`; }
        }
        $('.tabs', root).addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
        show(tab);
      },
    };
  }, { auth: true });

  A['edit-profile'] = () => {
    const u = BB.user;
    const d = BB.openDialog(`<h2>Edit profile</h2><p class="sub">Update how you appear to other members.</p>
      <form id="epForm"><label class="field"><span>Full name</span><input name="name" required minlength="2" maxlength="100" value="${esc(u.name)}"></label>
      <label class="field"><span>Username</span><input name="username" required pattern="[A-Za-z0-9_]{3,30}" title="3-30 letters, numbers or underscores" value="${esc(u.username)}"></label>
      <label class="field"><span>Email</span><input name="email" type="email" required value="${esc(u.email)}"></label>
      <label class="field"><span>About you</span><textarea name="bio" maxlength="300" placeholder="A line about the books you love (optional)">${esc(u.bio)}</textarea></label>
      <p class="form-error" role="alert"></p>
      <div class="dlg-actions"><button type="button" class="btn outline sm" data-action="close-dialog">Cancel</button><button class="btn sm" type="submit">Save changes</button></div></form>`);
    bindForm($('#epForm', d), async (data) => {
      BB.updateUser((await api('/api/profile', { method: 'PUT', body: data })).user);
      BB.closeDialog(); toast('Profile updated'); BB.renderNav(); BB.rerender();
    });
  };

  route('/profile/books', async () => {
    const [{ stats }, { books }] = await Promise.all([profileLoad(), api('/api/me/books')]);
    return {
      title: 'My Books',
      html: shell('/profile/books', `<div class="row-between"><h2>My Books</h2><a class="btn sm" href="#/donate">Donate a book</a></div>
        ${books.length ? books.map((b) => `<div class="mybook"><div class="head"><a class="stretch" href="#/book/${b.id}" aria-label="${esc(b.title)}"></a>${cover(b, 'mini')}
          <div class="rt"><b>${esc(b.title)}</b><span>${esc(b.author)} · ${statusChip(b.status)}${b.recipient ? ` given to ${esc(b.recipient.name)}` : ''}</span></div>
          <div class="acts"><a class="btn outline sm" href="#/edit/${b.id}">Edit</a><button class="btn danger sm" data-action="delete-book" data-id="${b.id}" aria-label="Delete ${esc(b.title)}">${icon('trash', 14)}</button></div></div>
          ${b.requests.length ? `<div class="reqs">${b.requests.map(requestRow).join('')}</div>` : ''}</div>`).join('')
          : '<div class="list"><p class="empty-list">You have not listed any books yet. <a class="link" href="#/donate">Donate your first book</a></p></div>'}`, stats),
    };
  }, { auth: true });

  route('/profile/favorites', async () => {
    const [{ stats }, { books }] = await Promise.all([profileLoad(), api('/api/me/favorites')]);
    return { title: 'Favorites', html: shell('/profile/favorites', `<h2 style="margin-bottom:14px">Favorites</h2><div id="favHolder">${favoritesView(books)}</div>`, stats), mount: watchFavorites };
  }, { auth: true });

  route('/profile/donations', async () => {
    const [{ stats }, d] = await Promise.all([profileLoad(), api('/api/me/donations')]);
    const list = (books, who) => books.length
      ? `<ul class="list">${books.map((b) => miniRow(b, `<span>${who(b)}</span><span>${fmtDate(b.donated_at)}</span>`)).join('')}</ul>`
      : '<div class="list"><p class="empty-list">Nothing here yet.</p></div>';
    return {
      title: 'Donations',
      html: shell('/profile/donations', `<h2>Donations</h2><p style="font-size:13px;color:var(--muted);margin:2px 0 16px">Books that found a new home through you, and books you received.</p>
        <h3 class="group-title">Books you gave (${d.given.length})</h3>${list(d.given, (b) => 'To ' + esc(b.recipient ? b.recipient.name : 'a member'))}
        <h3 class="group-title">Books you received (${d.received.length})</h3>${list(d.received, (b) => 'From ' + esc(b.owner.name))}`, stats),
    };
  }, { auth: true });

  route('/profile/settings', async () => {
    const { stats } = await profileLoad();
    return {
      title: 'Settings',
      html: shell('/profile/settings', `<h2>Settings</h2>
        <form class="settings-form" id="pwForm"><h3 class="group-title">Change password</h3>
          ${ifield({ id: 'cp', name: 'current_password', label: 'Current password', icon: 'lock', type: 'password', ac: 'current-password' })}
          ${ifield({ id: 'sp', name: 'new_password', label: 'New password', icon: 'lock', type: 'password', ac: 'new-password', attrs: 'minlength="8"' })}
          ${ifield({ id: 'sc', name: 'confirm_password', label: 'Confirm new password', icon: 'lock', type: 'password', ac: 'new-password', attrs: 'minlength="8"' })}
          <p class="form-error" role="alert"></p><button class="btn" type="submit">Update password</button></form>
        <div class="danger-zone"><h3>Delete account</h3><p>This permanently removes your profile, your listed books and your requests.</p>
          <button class="btn danger sm" data-action="delete-account">Delete my account</button></div>`, stats),
      mount(root) {
        bindForm($('#pwForm', root), async (d, form) => {
          if (d.new_password !== d.confirm_password) throw new Error('New passwords do not match');
          await api('/api/profile/password', { method: 'PUT', body: d }); form.reset(); toast('Password updated');
        });
      },
    };
  }, { auth: true });

  A['delete-account'] = () => {
    const d = BB.openDialog(`<h2>Delete your account?</h2><p class="sub">This cannot be undone. Enter your password to confirm.</p>
      <form id="delForm">${ifield({ id: 'dp', name: 'password', label: 'Password', icon: 'lock', type: 'password', ac: 'current-password' })}
      <p class="form-error" role="alert"></p>
      <div class="dlg-actions"><button type="button" class="btn outline sm" data-action="close-dialog">Keep account</button><button class="btn danger sm" type="submit">Delete account</button></div></form>`);
    bindForm($('#delForm', d), async (data) => {
      await api('/api/profile', { method: 'DELETE', body: data });
      BB.closeDialog(); BB.clearSession(); BB.renderNav(); toast('Your account has been deleted'); BB.go('/');
    });
  };

  /* ================= HELP ================= */
  const FAQ = [
    ['How does BookBridge work?', 'BookBridge lets members donate books, request books and share knowledge with their community. You can browse available books, request a book you need, or donate books you no longer use.'],
    ['How do I donate a book?', 'Log in, choose Donate in the top menu, add a cover photo if you like, fill in the title, author, category and condition, then press Upload Book. Your book appears in Browse Books straight away.'],
    ['How do I request a book?', 'Open any available book and press Request Book. You can add a short note. The donor will approve or decline, and you can follow the status under Profile, Requested Books.'],
    ['Is there a limit to how many books I can donate/request?', 'You can donate as many books as you like. You can have up to 5 open requests at a time; cancel one or wait for a reply to free up a slot.'],
    ['How can I contact support?', 'Use the Contact page or email support@bookbridge.com. We reply within a couple of working days.'],
  ];
  route('/help', async () => ({
    title: 'Help & Support',
    html: `<div class="page"><div class="page-head"><h1>Help &amp; Support</h1><p>Find answers to common questions or get in touch with us.</p></div>
      <div class="acc">${FAQ.map(([q, a], i) => `<div class="acc-item ${i === 0 ? 'open' : ''}"><button aria-expanded="${i === 0}" aria-controls="faq${i}" data-action="acc">${esc(q)} ${icon('down', 18)}</button><div class="a" id="faq${i}" ${i === 0 ? '' : 'hidden'}>${esc(a)}</div></div>`).join('')}</div>
      <div class="help-more">${icon('help', 30)}<div><b>Still need help?</b>Contact us at <a href="mailto:support@bookbridge.com">support@bookbridge.com</a> or use the <a href="#/contact">contact form</a>.</div></div></div>`,
  }));

  /* ================= CONTACT ================= */
  route('/contact', async () => {
    const u = BB.user || {};
    return {
      title: 'Contact',
      html: `<div class="page"><div class="contact">
        <div><h1 style="font-size:26px">Get In Touch</h1><p style="color:var(--muted);font-size:14px;margin-top:6px;max-width:380px">We'd love to hear from you! Feel free to reach out for any queries, suggestions or support.</p>
          <div class="details">
            <div class="d"><span class="ic">${icon('mail', 18)}</span><div><b>Email</b><a href="mailto:support@bookbridge.com">support@bookbridge.com</a></div></div>
            <div class="d"><span class="ic">${icon('phone', 18)}</span><div><b>Phone</b><a href="tel:+919876543210">+91 98765 43210</a></div></div>
            <div class="d"><span class="ic">${icon('pin', 18)}</span><div><b>Location</b>Virar, Maharashtra, India</div></div>
          </div><div class="art">${BB.art()}</div></div>
        <form class="form-card" id="contactForm">
          <label class="field"><span>Name</span><input name="name" required minlength="2" maxlength="100" placeholder="Name" autocomplete="name" value="${esc(u.name)}"></label>
          <label class="field"><span>Email</span><input name="email" type="email" required placeholder="Email" autocomplete="email" value="${esc(u.email)}"></label>
          <label class="field"><span>Message</span><textarea name="message" required minlength="10" maxlength="2000" placeholder="How can we help?" style="min-height:130px"></textarea></label>
          <p class="form-error" role="alert"></p><button class="btn block" type="submit">Send Message</button>
        </form></div></div>`,
      mount(root) {
        bindForm($('#contactForm', root), async (d, form) => {
          await api('/api/contact', { method: 'POST', body: d });
          form.elements.message.value = ''; toast("Thanks! Your message has been sent. We'll reply by email.");
        });
      },
    };
  });

  BB.start();
})();
