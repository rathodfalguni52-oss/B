// End-to-end API test: node test.js  (temporary database + uploads, no dependencies)
const os = require('os'), path = require('path'), fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';
process.env.BB_DEV_RESET = '1';
const server = require('./server');
const { db, UPLOAD_DIR, closeDb } = require('./db');
const assert = require('assert');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let base, pass = 0;
const call = async (method, url, body, token) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers };
};
const t = async (name, fn) => { await fn(); pass++; console.log('  ✔', name); };
const reg = (name, username, email, password = 'secret123') => call('POST', '/api/auth/register', { name, username, email, password, confirm_password: password });
const bookBody = (o = {}) => ({ title: 'Operating Systems', author: 'Galvin', category: 'Programming', condition: 'Good', description: '<b>x</b>', ...o });
const decode = (tok) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());

server.listen(0, async () => {
  base = 'http://localhost:' + server.address().port;
  try {
    console.log('BookBridge API tests');
    let alice, bob, admin, book;

    await t('frontend served with CSP; uploads dir + traversal safe', async () => {
      const r = await fetch(base + '/'); assert.equal(r.status, 200);
      assert((await r.text()).includes('BookBridge')); assert(r.headers.get('content-security-policy').includes("script-src 'self'"));
      assert.notEqual((await fetch(base + '/..%2f..%2fserver.js')).status, 200);
      assert.notEqual((await fetch(base + '/uploads/..%2fbookbridge.db')).status, 200);
    });
    await t('meta + seeded books + featured sorting + pagination', async () => {
      const m = await call('GET', '/api/meta'); assert(m.data.categories.includes('Self Help')); assert(m.data.conditions.includes('Good'));
      const l = await call('GET', '/api/books'); assert.equal(l.data.total, 8); assert.equal(l.data.books.length, 8);
      const p = await call('GET', '/api/books?limit=3&offset=6'); assert.equal(p.data.books.length, 2); assert.equal(p.data.total, 8);
      assert.equal((await call('GET', '/api/books?sort=popular&limit=4')).data.books.length, 4);
    });

    server.resetRateLimits();
    await t('register validates input (name, email, username, password, confirm)', async () => {
      const bad = (o) => call('POST', '/api/auth/register', { name: 'Alice Test', username: 'alice_t', email: 'alice@x.com', password: 'secret123', confirm_password: 'secret123', ...o });
      for (const o of [{ name: 'A' }, { email: 'bad' }, { username: 'a b' }, { username: 'ab' }, { password: '123', confirm_password: '123' }, { confirm_password: 'different1' }])
        assert.equal((await bad(o)).status, 400, JSON.stringify(o));
    });
    await t('register works + returns token; cannot self-register as admin', async () => {
      const r = await reg('Alice Test', 'alice_t', 'alice@x.com'); assert.equal(r.status, 201); assert(r.data.token); alice = r.data;
      const b = await call('POST', '/api/auth/register', { name: 'Bob Test', username: 'bob_t', email: 'bob@x.com', password: 'secret456', role: 'admin' });
      assert.equal(b.data.user.role, 'user'); bob = b.data;
      assert(!('password_hash' in alice.user));
    });
    await t('duplicate email / username rejected (case-insensitive)', async () => {
      assert.equal((await reg('Alice 2', 'other_one', 'ALICE@x.com')).status, 409);
      assert.equal((await reg('Alice 2', 'ALICE_T', 'new@x.com')).status, 409);
    });
    await t('password is hashed in DB', async () => {
      const row = db.prepare('SELECT password_hash FROM users WHERE email=?').get('alice@x.com');
      assert(row.password_hash.startsWith('scrypt$') && !row.password_hash.includes('secret123'));
    });
    await t('login by email or username; wrong password -> 401; remember extends token', async () => {
      assert.equal((await call('POST', '/api/auth/login', { identifier: 'alice@x.com', password: 'nope' })).status, 401);
      assert.equal((await call('POST', '/api/auth/login', { identifier: 'ghost', password: 'nope' })).status, 401);
      const a = await call('POST', '/api/auth/login', { identifier: 'alice@x.com', password: 'secret123' }); assert.equal(a.status, 200);
      const u = await call('POST', '/api/auth/login', { identifier: 'ALICE_T', password: 'secret123', remember: true }); assert.equal(u.status, 200);
      const day = decode(a.data.token).exp - decode(a.data.token).iat, month = decode(u.data.token).exp - decode(u.data.token).iat;
      assert.equal(day, 86400); assert.equal(month, 30 * 86400); alice = a.data;
    });
    await t('admin seed login works', async () => {
      admin = (await call('POST', '/api/auth/login', { identifier: 'admin@bookbridge.com', password: 'Admin@123' })).data; assert.equal(admin.user.role, 'admin');
    });
    await t('/me needs a valid token; tampered token rejected', async () => {
      assert.equal((await call('GET', '/api/auth/me')).status, 401);
      assert.equal((await call('GET', '/api/auth/me', null, 'garbage.token.here')).status, 401);
      assert.equal((await call('GET', '/api/auth/me', null, alice.token)).data.user.username, 'alice_t');
      const [h, , s] = alice.token.split('.');
      const forged = Buffer.from(JSON.stringify({ sub: 1, exp: 9999999999 })).toString('base64url');
      assert.equal((await call('GET', '/api/auth/me', null, `${h}.${forged}.${s}`)).status, 401);
    });

    server.resetRateLimits();
    await t('forgot + reset password flow (single use, generic response)', async () => {
      const none = await call('POST', '/api/auth/forgot', { email: 'nobody@x.com' }); assert.equal(none.status, 200); assert(!none.data.dev_reset_link);
      const f = await call('POST', '/api/auth/forgot', { email: 'bob@x.com' }); assert.equal(f.status, 200);
      const tok = new URL(f.data.dev_reset_link.replace('/#/', '/')).searchParams.get('token');
      assert.equal((await call('POST', '/api/auth/reset', { token: 'wrong', password: 'newpass123' })).status, 400);
      assert.equal((await call('POST', '/api/auth/reset', { token: tok, password: 'short' })).status, 400);
      assert.equal((await call('POST', '/api/auth/reset', { token: tok, password: 'newpass123', confirm_password: 'newpass123' })).status, 200);
      assert.equal((await call('POST', '/api/auth/reset', { token: tok, password: 'again12345' })).status, 400);
      const l = await call('POST', '/api/auth/login', { identifier: 'bob_t', password: 'newpass123' }); assert.equal(l.status, 200); bob = l.data;
      assert(!db.prepare('SELECT 1 FROM password_resets WHERE token_hash=?').get(tok)); // only the hash is stored
    });

    server.resetRateLimits();
    await t('profile: stats, update, conflicts, change password, validation', async () => {
      const p = await call('GET', '/api/profile', null, alice.token); assert.equal(p.data.stats.donated, 0); assert.equal(p.data.stats.requested, 0);
      assert.equal((await call('GET', '/api/profile')).status, 401);
      const u = await call('PUT', '/api/profile', { name: 'Alice Updated', bio: 'Loves books' }, alice.token);
      assert.equal(u.data.user.name, 'Alice Updated'); assert.equal(u.data.user.username, 'alice_t');
      assert.equal((await call('PUT', '/api/profile', { username: 'bob_t' }, alice.token)).status, 409);
      assert.equal((await call('PUT', '/api/profile', { email: 'bob@x.com' }, alice.token)).status, 409);
      assert.equal((await call('PUT', '/api/profile/password', { current_password: 'wrong', new_password: 'whatever123' }, alice.token)).status, 403);
      assert.equal((await call('PUT', '/api/profile/password', { current_password: 'secret123', new_password: 'x' }, alice.token)).status, 400);
      assert.equal((await call('PUT', '/api/profile/password', { current_password: 'secret123', new_password: 'secret789', confirm_password: 'secret789' }, alice.token)).status, 200);
      assert.equal((await call('POST', '/api/auth/login', { identifier: 'alice_t', password: 'secret789' })).status, 200);
    });

    await t('adding a book requires login; validation (category, condition, year, cover)', async () => {
      assert.equal((await call('POST', '/api/books', bookBody())).status, 401);
      for (const o of [{ title: '' }, { author: '' }, { category: 'Nope' }, { condition: 'Mint' }, { published_year: 1066 }, { published_year: 'abc' }, { cover_data: 'data:image/gif;base64,AAAA' },
        { cover_data: 'data:image/png;base64,' + Buffer.from('this is not an image at all').toString('base64') }])
        assert.equal((await call('POST', '/api/books', bookBody(o), alice.token)).status, 400, JSON.stringify(o).slice(0, 60));
    });
    await t('book with cover image: stored, served, then removed on delete', async () => {
      const r = await call('POST', '/api/books', bookBody({ cover_data: PNG, published_year: 2012 }), alice.token);
      assert.equal(r.status, 201); book = r.data.book; assert(book.is_owner); assert.equal(book.owner.username, 'alice_t'); assert.equal(book.status, 'Available'); assert(book.cover_url.startsWith('/uploads/'));
      const img = await fetch(base + book.cover_url); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
      const noCover = await call('POST', '/api/books', bookBody({ title: 'Temp' }), alice.token);
      assert.equal(noCover.data.book.cover_url, null); assert(noCover.data.book.cover_color.includes('|'));
      assert.equal((await call('DELETE', '/api/books/' + noCover.data.book.id, null, alice.token)).status, 200);
    });
    await t('search (incl. wildcard safety), filters, status', async () => {
      assert.equal((await call('GET', '/api/books?q=galvin')).data.total, 1);
      assert.equal((await call('GET', '/api/books?q=%25')).data.total, 0);           // a literal % must not match everything
      assert.equal((await call('GET', '/api/books?category=Self Help')).data.total, 2);
      assert.equal((await call('GET', '/api/books?condition=Fair')).data.total, 1);
      assert.equal((await call('GET', '/api/books?status=Donated')).data.total, 0);
      assert.equal((await call('GET', "/api/books?q=' OR 1=1 --")).data.total, 0);
    });
    await t('authorization: other user cannot edit/delete; owner can edit', async () => {
      assert.equal((await call('PUT', '/api/books/' + book.id, bookBody(), bob.token)).status, 403);
      assert.equal((await call('DELETE', '/api/books/' + book.id, null, bob.token)).status, 403);
      assert.equal((await call('DELETE', '/api/books/' + book.id)).status, 401);
      const r = await call('PUT', '/api/books/' + book.id, bookBody({ title: 'OS Concepts', condition: 'Fair' }), alice.token);
      assert.equal(r.data.book.title, 'OS Concepts'); assert(r.data.book.cover_url);       // cover kept when not touched
    });
    await t('favorites toggle + counts + list', async () => {
      assert.equal((await call('POST', `/api/books/${book.id}/favorite`)).status, 401);
      assert.equal((await call('POST', `/api/books/${book.id}/favorite`, null, bob.token)).data.favorited, true);
      const b = (await call('GET', '/api/books/' + book.id, null, bob.token)).data.book; assert.equal(b.favorited, true); assert.equal(b.fav_count, 1);
      assert.equal((await call('GET', '/api/me/favorites', null, bob.token)).data.books.length, 1);
      assert.equal((await call('GET', '/api/profile', null, bob.token)).data.stats.favorites, 1);
      assert.equal((await call('POST', `/api/books/${book.id}/favorite`, null, bob.token)).data.favorited, false);
      assert.equal((await call('GET', '/api/books/' + book.id)).data.book.favorited, false);
    });

    let rq1, rq2, carol;
    await t('requests: rules (own book, duplicate, login) and listing', async () => {
      assert.equal((await call('POST', `/api/books/${book.id}/request`, {})).status, 401);
      assert.equal((await call('POST', `/api/books/${book.id}/request`, {}, alice.token)).status, 400);
      assert.equal((await call('POST', '/api/books/9999/request', {}, bob.token)).status, 404);
      const r = await call('POST', `/api/books/${book.id}/request`, { message: 'Need it for exams' }, bob.token); assert.equal(r.status, 201); rq1 = r.data.request;
      assert.equal((await call('POST', `/api/books/${book.id}/request`, {}, bob.token)).status, 409);
      carol = (await reg('Carol Test', 'carol_t', 'carol@x.com')).data;
      rq2 = (await call('POST', `/api/books/${book.id}/request`, {}, carol.token)).data.request;
      assert.equal((await call('GET', '/api/books/' + book.id, null, bob.token)).data.book.my_request_id, rq1.id);
      assert.equal((await call('GET', '/api/books/' + book.id, null, alice.token)).data.book.pending_count, 2);
      assert.equal((await call('GET', '/api/books/' + book.id, null, bob.token)).data.book.pending_count, undefined); // hidden from non-owners
      assert.equal((await call('GET', `/api/books/${book.id}/requests`, null, bob.token)).status, 403);
      assert.equal((await call('GET', `/api/books/${book.id}/requests`, null, alice.token)).data.requests.length, 2);
      assert.equal((await call('GET', '/api/me/books', null, alice.token)).data.books.find((b) => b.id === book.id).requests.length, 2);
      assert.equal((await call('GET', '/api/me/requests', null, bob.token)).data.requests[0].book.id, book.id);
      assert.equal((await call('GET', '/api/profile', null, alice.token)).data.stats.incoming, 2);
    });
    await t('requests: only donor approves; approval marks Donated and declines the rest', async () => {
      assert.equal((await call('POST', `/api/requests/${rq1.id}/approve`, null, carol.token)).status, 403);
      assert.equal((await call('POST', `/api/requests/${rq1.id}/cancel`, null, carol.token)).status, 403);
      assert.equal((await call('POST', `/api/requests/${rq1.id}/approve`, null, alice.token)).status, 200);
      assert.equal((await call('POST', `/api/requests/${rq1.id}/approve`, null, alice.token)).status, 409);
      const b = (await call('GET', '/api/books/' + book.id, null, alice.token)).data.book;
      assert.equal(b.status, 'Donated'); assert.equal(b.recipient.name, 'Bob Test'); assert(b.donated_at);
      const mine = (await call('GET', '/api/me/requests', null, carol.token)).data.requests[0]; assert.equal(mine.status, 'declined');
      assert.equal((await call('POST', `/api/books/${book.id}/request`, {}, admin.token)).status, 409);
      assert.equal((await call('GET', '/api/me/donations', null, alice.token)).data.given.length, 1);
      assert.equal((await call('GET', '/api/me/donations', null, bob.token)).data.received[0].id, book.id);
      assert.equal((await call('GET', '/api/books?status=Donated')).data.total, 1);
      assert.equal((await call('GET', '/api/profile', null, bob.token)).data.stats.received, 1);
    });
    await t('requests: decline, cancel, and the open-request limit', async () => {
      const seeded = (await call('GET', '/api/books?status=Available&limit=20')).data.books;
      const ids = seeded.slice(0, 6).map((b) => b.id); const made = [];
      for (const id of ids.slice(0, 5)) { const r = await call('POST', `/api/books/${id}/request`, {}, carol.token); assert.equal(r.status, 201); made.push(r.data.request.id); }
      assert.equal((await call('POST', `/api/books/${ids[5]}/request`, {}, carol.token)).status, 429);
      assert.equal((await call('POST', `/api/requests/${made[0]}/cancel`, null, carol.token)).status, 200);
      assert.equal((await call('POST', `/api/books/${ids[5]}/request`, {}, carol.token)).status, 201);   // slot freed
      assert.equal((await call('POST', `/api/requests/${made[1]}/decline`, null, admin.token)).status, 200);
      assert.equal((await call('POST', `/api/requests/${made[1]}/cancel`, null, carol.token)).status, 409);
    });
    await t('cover: replace and remove files on disk', async () => {
      const fresh = (await call('POST', '/api/books', bookBody({ title: 'Cover Test', cover_data: PNG }), bob.token)).data.book;
      const file = fresh.cover_url.split('/').pop(); assert(fs.existsSync(path.join(UPLOAD_DIR, file)));
      const r = await call('PUT', '/api/books/' + fresh.id, bookBody({ title: 'Cover Test', remove_cover: true }), bob.token);
      assert.equal(r.data.book.cover_url, null); await new Promise((ok) => setTimeout(ok, 50)); assert(!fs.existsSync(path.join(UPLOAD_DIR, file)));
    });
    server.resetRateLimits();
    await t('contact form: validation, saved, admin-only inbox', async () => {
      assert.equal((await call('POST', '/api/contact', { name: 'X', email: 'bad', message: 'hi' })).status, 400);
      assert.equal((await call('POST', '/api/contact', { name: 'Dana', email: 'dana@x.com', message: 'Hello, how do I donate?' })).status, 201);
      assert.equal((await call('GET', '/api/admin/messages', null, bob.token)).status, 403);
      assert.equal((await call('GET', '/api/admin/messages', null, admin.token)).data.messages[0].name, 'Dana');
    });
    await t('stats reflect database', async () => { const s = (await call('GET', '/api/stats')).data; assert.equal(s.members, 4); assert(s.donated >= 1); });
    await t('admin can delete any listing', async () => {
      assert.equal((await call('DELETE', '/api/books/' + book.id, null, admin.token)).status, 200);
      assert.equal((await call('GET', '/api/books/' + book.id)).status, 404);
    });
    await t('delete account needs password; removes data; admin protected', async () => {
      assert.equal((await call('DELETE', '/api/profile', { password: 'wrong' }, carol.token)).status, 403);
      assert.equal((await call('DELETE', '/api/profile', { password: 'secret123' }, carol.token)).status, 200);
      assert.equal((await call('GET', '/api/auth/me', null, carol.token)).status, 401);
      assert.equal((await call('DELETE', '/api/profile', { password: 'Admin@123' }, admin.token)).status, 400);
    });
    await t('bad JSON -> 400, oversize -> 413, unknown route -> 404', async () => {
      assert.equal((await fetch(base + '/api/auth/login', { method: 'POST', body: '{bad' })).status, 400);
      assert.equal((await call('POST', '/api/contact', { name: 'x'.repeat(200 * 1024) })).status, 413);
      assert.equal((await call('GET', '/api/nothing')).status, 404);
    });
    await t('rate limiting on login', async () => {
      server.resetRateLimits(); let last;
      for (let i = 0; i < 17; i++) last = await call('POST', '/api/auth/login', { identifier: 'x', password: 'y' });
      assert.equal(last.status, 429);
    });
    console.log(`\nAll ${pass} tests passed ✅`);
  } catch (e) { console.error('\nTEST FAILED ❌', e); process.exitCode = 1; }
  server.close(); closeDb(); fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(process.exitCode || 0), 100);
});
