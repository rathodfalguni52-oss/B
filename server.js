// BookBridge backend: REST API + static frontend + cover uploads. Zero external dependencies.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, UPLOAD_DIR } = require('./db');
const { hashPassword, verifyPassword, sign, verify, newToken, hashToken } = require('./auth');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 100 * 1024;            // normal JSON bodies
const MAX_COVER = 2 * 1024 * 1024;      // cover image (decoded)
const MAX_UPLOAD_BODY = 3.5 * 1024 * 1024; // base64 inflates ~37%
const MAX_PENDING_REQUESTS = 5;         // per person, at one time

const CATEGORIES = ['Self Help', 'Personal Finance', 'Programming', 'Fiction', 'Non-Fiction', 'Academic',
  'Biography', 'Business', 'Children', 'History', 'Science', 'Other'];
const CONDITIONS = ['Excellent', 'Very Good', 'Good', 'Fair'];
// background|text colour pairs for books without an uploaded cover
const PALETTES = ['#efe7ff|#4b33b0', '#fff3d6|#c2570c', '#e3f2ee|#1b6b4a', '#ffe4e6|#b4234a',
  '#e0ecff|#1d4ed8', '#2b1f4d|#fbbf24', '#f4ead3|#7a3e1d', '#1f2a37|#a5f3fc'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const clean = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const cleanMultiline = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readJson(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0, tooBig = false; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max * 4) return req.destroy();            // hard stop for abusive uploads
      if (tooBig) return;                                  // keep draining so the client can read our 413
      if (size > max) { tooBig = true; chunks.length = 0; reject(new HttpError(413, 'Request body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' ? v : {});
      } catch { reject(new HttpError(400, 'Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const USER_COLS = 'id,name,username,email,bio,role,created_at';
function currentUser(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const payload = verify(m[1]);
  if (!payload) return null;
  // Re-read from DB so deleted users / role changes take effect immediately
  return db.prepare(`SELECT ${USER_COLS} FROM users WHERE id=?`).get(payload.sub) || null;
}
function requireAuth(req) {
  const u = currentUser(req);
  if (!u) throw new HttpError(401, 'Please log in to continue');
  return u;
}

// In-memory rate limit (per IP, per bucket)
const attempts = new Map();
function rateLimit(req, bucket, limit = 15, windowMs = 60_000) {
  const key = `${bucket}:${req.socket.remoteAddress || 'x'}`;
  const now = Date.now();
  const rec = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  rec.push(now); attempts.set(key, rec);
  if (rec.length > limit) throw new HttpError(429, 'Too many attempts. Please wait a minute and try again.');
}

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

const publicUser = (u) => ({ id: u.id, name: u.name, username: u.username, email: u.email, bio: u.bio, role: u.role, created_at: u.created_at });

// ---------- books ----------
const BOOK_SELECT = `
  SELECT b.*, u.name AS owner_name, u.username AS owner_username, rc.name AS recipient_name,
    (SELECT 1 FROM favorites f WHERE f.book_id=b.id AND f.user_id=@uid) AS fav,
    (SELECT COUNT(*) FROM favorites f WHERE f.book_id=b.id) AS fav_count,
    (SELECT q.id FROM requests q WHERE q.book_id=b.id AND q.requester_id=@uid AND q.status='pending') AS my_request_id,
    (SELECT COUNT(*) FROM requests q WHERE q.book_id=b.id AND q.status='pending') AS pending_count
  FROM books b JOIN users u ON u.id=b.owner_id LEFT JOIN users rc ON rc.id=b.recipient_id`;

function publicBook(b, viewer) {
  const isOwner = !!viewer && viewer.id === b.owner_id;
  const canManage = isOwner || (!!viewer && viewer.role === 'admin');
  const involved = canManage || (!!viewer && viewer.id === b.recipient_id);
  const out = {
    id: b.id, title: b.title, author: b.author, category: b.category, condition: b.condition,
    description: b.description, published_year: b.published_year, status: b.status,
    cover_url: b.cover_image ? `/uploads/${b.cover_image}` : null, cover_color: b.cover_color,
    created_at: b.created_at, donated_at: b.donated_at,
    owner: { id: b.owner_id, name: b.owner_name, username: b.owner_username },
    is_owner: isOwner, can_manage: canManage,
    favorited: !!b.fav, fav_count: b.fav_count, my_request_id: b.my_request_id || null,
  };
  if (canManage) out.pending_count = b.pending_count;
  if (involved && b.recipient_id) out.recipient = { id: b.recipient_id, name: b.recipient_name };
  return out;
}
const loadBook = (id, uid) => db.prepare(`${BOOK_SELECT} WHERE b.id=@id`).get({ id: Number(id), uid: uid || 0 });
const listBooks = (where, params, viewer, order = 'b.id DESC') =>
  db.prepare(`${BOOK_SELECT} ${where} ORDER BY ${order}`).all({ uid: viewer ? viewer.id : 0, ...params }).map((b) => publicBook(b, viewer));

function validateBook(body) {
  const title = clean(body.title, 150), author = clean(body.author, 120);
  const category = clean(body.category), condition = clean(body.condition);
  if (!title) throw new HttpError(400, 'Book title is required');
  if (!author) throw new HttpError(400, 'Author is required');
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Please choose a category');
  if (!CONDITIONS.includes(condition)) throw new HttpError(400, 'Please choose the condition of the book');
  let year = null;
  if (body.published_year !== undefined && body.published_year !== null && String(body.published_year).trim() !== '') {
    year = Number(body.published_year);
    if (!Number.isInteger(year) || year < 1400 || year > new Date().getFullYear() + 1)
      throw new HttpError(400, 'Please enter a valid publication year');
  }
  return { title, author, category, condition, published_year: year, description: cleanMultiline(body.description, 1000) };
}

function paletteFor(title) {
  let h = 0; for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

function saveCover(dataUrl) {
  const m = /^data:image\/(?:png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'Cover image must be a JPG or PNG file');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_COVER) throw new HttpError(400, 'Cover image must be 2 MB or smaller');
  const png = buf.length > 8 && buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const jpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!png && !jpg) throw new HttpError(400, 'That file is not a valid JPG or PNG image'); // checks real bytes, not the name
  const name = crypto.randomBytes(12).toString('hex') + (png ? '.png' : '.jpg');
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return name;
}
const removeCover = (name) => { if (name) fs.rm(path.join(UPLOAD_DIR, path.basename(name)), { force: true }, () => {}); };

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

// --- Auth ---
route('POST', '/api/auth/register', async (req, res) => {
  rateLimit(req, 'auth');
  const b = await readJson(req);
  const name = clean(b.name, 100), email = clean(b.email, 150).toLowerCase(), username = clean(b.username, 30);
  const password = String(b.password ?? '');
  if (name.length < 2) throw new HttpError(400, 'Please enter your full name');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address');
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Username must be 3-30 letters, numbers or underscores');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (password.length > 200) throw new HttpError(400, 'Password is too long');
  if (b.confirm_password !== undefined && b.confirm_password !== password) throw new HttpError(400, 'Passwords do not match');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'An account with this email already exists');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) throw new HttpError(409, 'That username is already taken');
  // Role is always 'user' on public registration; it can never be chosen by the client.
  const info = db.prepare('INSERT INTO users (name,username,email,password_hash,role) VALUES (?,?,?,?,?)')
    .run(name, username, email, hashPassword(password), 'user');
  const user = db.prepare(`SELECT ${USER_COLS} FROM users WHERE id=?`).get(Number(info.lastInsertRowid));
  send(res, 201, { token: sign({ sub: user.id }), user: publicUser(user) });
});

route('POST', '/api/auth/login', async (req, res) => {
  rateLimit(req, 'auth');
  const b = await readJson(req);
  const ident = clean(b.identifier ?? b.email, 150), password = String(b.password ?? '');
  if (!ident || !password) throw new HttpError(400, 'Enter your email or username and your password');
  const row = db.prepare('SELECT * FROM users WHERE email=@i OR username=@i').get({ i: ident });
  // Same message for unknown account / wrong password (avoid user enumeration)
  if (!row || !verifyPassword(password, row.password_hash)) throw new HttpError(401, 'Incorrect email/username or password');
  const ttl = b.remember ? 60 * 60 * 24 * 30 : 60 * 60 * 24;
  send(res, 200, { token: sign({ sub: row.id }, ttl), user: publicUser(row) });
});

route('GET', '/api/auth/me', async (req, res) => send(res, 200, { user: publicUser(requireAuth(req)) }));

route('POST', '/api/auth/forgot', async (req, res) => {
  rateLimit(req, 'forgot', 5);
  const email = clean((await readJson(req)).email, 150).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address');
  const user = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  const out = { ok: true }; // identical response whether or not the account exists
  if (user) {
    const token = newToken();
    db.prepare('INSERT INTO password_resets (token_hash,user_id,expires_at) VALUES (?,?,?)')
      .run(hashToken(token), user.id, Date.now() + 60 * 60 * 1000);
    const link = `http://${req.headers.host || 'localhost:' + PORT}/#/reset?token=${token}`;
    // No email service is bundled: the link is printed to the server console (plug in an email sender here).
    console.log(`[password reset] ${email}: ${link}`);
    if (process.env.BB_DEV_RESET === '1') out.dev_reset_link = link;
  }
  send(res, 200, out);
});

route('POST', '/api/auth/reset', async (req, res) => {
  rateLimit(req, 'auth');
  const b = await readJson(req);
  const password = String(b.password ?? '');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (b.confirm_password !== undefined && b.confirm_password !== password) throw new HttpError(400, 'Passwords do not match');
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash=?').get(hashToken(b.token));
  if (!row || row.used || row.expires_at < Date.now()) throw new HttpError(400, 'This reset link is invalid or has expired');
  tx(() => {
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), row.user_id);
    db.prepare('UPDATE password_resets SET used=1 WHERE user_id=?').run(row.user_id);
  });
  send(res, 200, { ok: true });
});

// --- Profile ---
route('GET', '/api/profile', async (req, res) => {
  const u = requireAuth(req);
  const n = (sql) => db.prepare(sql).get(u.id).c;
  send(res, 200, {
    user: publicUser(u),
    stats: {
      donated: n('SELECT COUNT(*) AS c FROM books WHERE owner_id=?'),
      requested: n("SELECT COUNT(*) AS c FROM requests WHERE requester_id=? AND status!='cancelled'"),
      favorites: n('SELECT COUNT(*) AS c FROM favorites WHERE user_id=?'),
      received: n('SELECT COUNT(*) AS c FROM books WHERE recipient_id=?'),
      incoming: n("SELECT COUNT(*) AS c FROM requests q JOIN books b ON b.id=q.book_id WHERE b.owner_id=? AND q.status='pending'"),
    },
  });
});

route('PUT', '/api/profile', async (req, res) => {
  const u = requireAuth(req);
  const b = await readJson(req);
  const name = clean(b.name ?? u.name, 100), email = clean(b.email ?? u.email, 150).toLowerCase();
  const username = clean(b.username ?? u.username, 30), bio = cleanMultiline(b.bio ?? u.bio, 300);
  if (name.length < 2) throw new HttpError(400, 'Please enter your full name');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address');
  if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Username must be 3-30 letters, numbers or underscores');
  if (db.prepare('SELECT 1 FROM users WHERE email=? AND id!=?').get(email, u.id)) throw new HttpError(409, 'That email is already used by another account');
  if (db.prepare('SELECT 1 FROM users WHERE username=? AND id!=?').get(username, u.id)) throw new HttpError(409, 'That username is already taken');
  db.prepare('UPDATE users SET name=?,email=?,username=?,bio=? WHERE id=?').run(name, email, username, bio, u.id);
  send(res, 200, { user: publicUser(db.prepare(`SELECT ${USER_COLS} FROM users WHERE id=?`).get(u.id)) });
});

route('PUT', '/api/profile/password', async (req, res) => {
  rateLimit(req, 'auth');
  const u = requireAuth(req);
  const b = await readJson(req);
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(u.id);
  if (!verifyPassword(String(b.current_password ?? ''), row.password_hash)) throw new HttpError(403, 'Your current password is incorrect');
  const pw = String(b.new_password ?? '');
  if (pw.length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
  if (pw.length > 200) throw new HttpError(400, 'Password is too long');
  if (b.confirm_password !== undefined && b.confirm_password !== pw) throw new HttpError(400, 'Passwords do not match');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(pw), u.id);
  send(res, 200, { ok: true });
});

route('DELETE', '/api/profile', async (req, res) => {
  rateLimit(req, 'auth');
  const u = requireAuth(req);
  const b = await readJson(req);
  if (u.role === 'admin') throw new HttpError(400, 'The admin account cannot be deleted');
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(u.id);
  if (!verifyPassword(String(b.password ?? ''), row.password_hash)) throw new HttpError(403, 'Your password is incorrect');
  const covers = db.prepare('SELECT cover_image FROM books WHERE owner_id=? AND cover_image IS NOT NULL').all(u.id);
  db.prepare('DELETE FROM users WHERE id=?').run(u.id); // cascades to books, favorites, requests
  covers.forEach((c) => removeCover(c.cover_image));
  send(res, 200, { ok: true });
});

// --- Books ---
route('GET', '/api/meta', async (req, res) => send(res, 200, { categories: CATEGORIES, conditions: CONDITIONS }));

route('GET', '/api/books', async (req, res, { query }) => {
  const u = currentUser(req);
  const where = []; const params = {};
  const q = clean(query.get('q'), 100);
  if (q) {
    where.push(`(b.title LIKE @q ESCAPE '\\' OR b.author LIKE @q ESCAPE '\\' OR b.category LIKE @q ESCAPE '\\' OR b.description LIKE @q ESCAPE '\\')`);
    params.q = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  }
  if (CATEGORIES.includes(query.get('category'))) { where.push('b.category=@category'); params.category = query.get('category'); }
  if (CONDITIONS.includes(query.get('condition'))) { where.push('b.condition=@condition'); params.condition = query.get('condition'); }
  if (['Available', 'Donated'].includes(query.get('status'))) { where.push('b.status=@status'); params.status = query.get('status'); }
  const sorts = { newest: 'b.id DESC', popular: 'fav_count DESC, b.id ASC', title: 'b.title COLLATE NOCASE ASC' };
  const order = sorts[query.get('sort')] || sorts.newest;
  const limit = Math.min(Math.max(parseInt(query.get('limit'), 10) || 12, 1), 50);
  const offset = Math.max(parseInt(query.get('offset'), 10) || 0, 0);
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM books b ${w}`).get(params).c;
  const books = listBooks(`${w} `, params, u, `${order} LIMIT ${limit} OFFSET ${offset}`);
  send(res, 200, { books, total, limit, offset });
});

route('GET', '/api/books/:id', async (req, res, { params }) => {
  const u = currentUser(req);
  const row = loadBook(params.id, u && u.id);
  if (!row) throw new HttpError(404, 'Book not found');
  send(res, 200, { book: publicBook(row, u) });
});

route('POST', '/api/books', async (req, res) => {
  const u = requireAuth(req);
  const body = await readJson(req, MAX_UPLOAD_BODY);
  const d = validateBook(body);
  const cover = body.cover_data ? saveCover(body.cover_data) : null;
  const info = db.prepare(
    `INSERT INTO books (title,author,category,condition,description,published_year,cover_image,cover_color,owner_id)
     VALUES (@title,@author,@category,@condition,@description,@published_year,@cover,@color,@owner)`
  ).run({ ...d, cover, color: paletteFor(d.title), owner: u.id });
  send(res, 201, { book: publicBook(loadBook(info.lastInsertRowid, u.id), u) });
});

// Authorization: only the owner (or an admin) may change a listing
function loadManageable(u, id) {
  const book = db.prepare('SELECT * FROM books WHERE id=?').get(Number(id));
  if (!book) throw new HttpError(404, 'Book not found');
  if (book.owner_id !== u.id && u.role !== 'admin') throw new HttpError(403, 'You can only change your own books');
  return book;
}

route('PUT', '/api/books/:id', async (req, res, { params }) => {
  const u = requireAuth(req);
  const old = loadManageable(u, params.id);
  const body = await readJson(req, MAX_UPLOAD_BODY);
  const d = validateBook(body);
  let cover = old.cover_image;
  if (body.cover_data) cover = saveCover(body.cover_data);
  else if (body.remove_cover) cover = null;
  db.prepare(
    `UPDATE books SET title=@title,author=@author,category=@category,condition=@condition,description=@description,
     published_year=@published_year,cover_image=@cover WHERE id=@id`
  ).run({ ...d, cover, id: old.id });
  if (old.cover_image && old.cover_image !== cover) removeCover(old.cover_image);
  send(res, 200, { book: publicBook(loadBook(old.id, u.id), u) });
});

route('DELETE', '/api/books/:id', async (req, res, { params }) => {
  const u = requireAuth(req);
  const book = loadManageable(u, params.id);
  db.prepare('DELETE FROM books WHERE id=?').run(book.id);
  removeCover(book.cover_image);
  send(res, 200, { ok: true });
});

route('POST', '/api/books/:id/favorite', async (req, res, { params }) => {
  const u = requireAuth(req);
  const id = Number(params.id);
  if (!db.prepare('SELECT 1 FROM books WHERE id=?').get(id)) throw new HttpError(404, 'Book not found');
  const has = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND book_id=?').get(u.id, id);
  if (has) db.prepare('DELETE FROM favorites WHERE user_id=? AND book_id=?').run(u.id, id);
  else db.prepare('INSERT INTO favorites (user_id,book_id) VALUES (?,?)').run(u.id, id);
  send(res, 200, { favorited: !has });
});

// --- Requests (ask for a donated book) ---
route('POST', '/api/books/:id/request', async (req, res, { params }) => {
  const u = requireAuth(req);
  const book = db.prepare('SELECT * FROM books WHERE id=?').get(Number(params.id));
  if (!book) throw new HttpError(404, 'Book not found');
  if (book.owner_id === u.id) throw new HttpError(400, 'You cannot request your own book');
  if (book.status !== 'Available') throw new HttpError(409, 'This book has already been donated');
  if (db.prepare("SELECT 1 FROM requests WHERE book_id=? AND requester_id=? AND status='pending'").get(book.id, u.id))
    throw new HttpError(409, 'You have already requested this book');
  const open = db.prepare("SELECT COUNT(*) AS c FROM requests WHERE requester_id=? AND status='pending'").get(u.id).c;
  if (open >= MAX_PENDING_REQUESTS)
    throw new HttpError(429, `You can have up to ${MAX_PENDING_REQUESTS} open requests at a time. Cancel one or wait for a reply.`);
  const message = cleanMultiline((await readJson(req)).message, 500);
  const info = db.prepare('INSERT INTO requests (book_id,requester_id,message) VALUES (?,?,?)').run(book.id, u.id, message);
  send(res, 201, { request: { id: Number(info.lastInsertRowid), status: 'pending' } });
});

route('GET', '/api/books/:id/requests', async (req, res, { params }) => {
  const u = requireAuth(req);
  const book = loadManageable(u, params.id);
  const rows = db.prepare(
    `SELECT q.id,q.message,q.status,q.created_at, r.id AS rid, r.name, r.username
     FROM requests q JOIN users r ON r.id=q.requester_id WHERE q.book_id=? ORDER BY q.id DESC`).all(book.id);
  send(res, 200, { requests: rows.map((r) => ({ id: r.id, message: r.message, status: r.status, created_at: r.created_at, requester: { id: r.rid, name: r.name, username: r.username } })) });
});

function loadRequest(id) {
  const r = db.prepare('SELECT q.*, b.owner_id, b.status AS book_status FROM requests q JOIN books b ON b.id=q.book_id WHERE q.id=?').get(Number(id));
  if (!r) throw new HttpError(404, 'Request not found');
  return r;
}
const settle = (r, status) => db.prepare("UPDATE requests SET status=?, updated_at=datetime('now') WHERE id=?").run(status, r.id);

route('POST', '/api/requests/:id/approve', async (req, res, { params }) => {
  const u = requireAuth(req);
  const r = loadRequest(params.id);
  if (r.owner_id !== u.id && u.role !== 'admin') throw new HttpError(403, 'Only the donor can answer this request');
  if (r.status !== 'pending') throw new HttpError(409, 'This request has already been answered');
  if (r.book_status !== 'Available') throw new HttpError(409, 'This book has already been donated');
  tx(() => {
    settle(r, 'approved');
    db.prepare("UPDATE requests SET status='declined', updated_at=datetime('now') WHERE book_id=? AND id!=? AND status='pending'").run(r.book_id, r.id);
    db.prepare("UPDATE books SET status='Donated', recipient_id=?, donated_at=datetime('now') WHERE id=?").run(r.requester_id, r.book_id);
  });
  send(res, 200, { ok: true, status: 'approved' });
});

route('POST', '/api/requests/:id/decline', async (req, res, { params }) => {
  const u = requireAuth(req);
  const r = loadRequest(params.id);
  if (r.owner_id !== u.id && u.role !== 'admin') throw new HttpError(403, 'Only the donor can answer this request');
  if (r.status !== 'pending') throw new HttpError(409, 'This request has already been answered');
  settle(r, 'declined');
  send(res, 200, { ok: true, status: 'declined' });
});

route('POST', '/api/requests/:id/cancel', async (req, res, { params }) => {
  const u = requireAuth(req);
  const r = loadRequest(params.id);
  if (r.requester_id !== u.id) throw new HttpError(403, 'You can only cancel your own requests');
  if (r.status !== 'pending') throw new HttpError(409, 'Only open requests can be cancelled');
  settle(r, 'cancelled');
  send(res, 200, { ok: true, status: 'cancelled' });
});

// --- "Me" lists (profile tabs) ---
route('GET', '/api/me/books', async (req, res) => {
  const u = requireAuth(req);
  const books = listBooks('WHERE b.owner_id=@owner', { owner: u.id }, u);
  const reqs = db.prepare(
    `SELECT q.id,q.message,q.created_at, r.id AS rid, r.name, r.username
     FROM requests q JOIN users r ON r.id=q.requester_id WHERE q.book_id=? AND q.status='pending' ORDER BY q.id`);
  for (const b of books)
    b.requests = reqs.all(b.id).map((r) => ({ id: r.id, message: r.message, created_at: r.created_at, requester: { id: r.rid, name: r.name, username: r.username } }));
  send(res, 200, { books });
});

route('GET', '/api/me/requests', async (req, res) => {
  const u = requireAuth(req);
  const rows = db.prepare('SELECT id,book_id,message,status,created_at FROM requests WHERE requester_id=? ORDER BY id DESC').all(u.id);
  const requests = rows.map((r) => ({ id: r.id, message: r.message, status: r.status, created_at: r.created_at, book: publicBook(loadBook(r.book_id, u.id), u) }));
  send(res, 200, { requests });
});

route('GET', '/api/me/favorites', async (req, res) => {
  const u = requireAuth(req);
  send(res, 200, { books: listBooks('WHERE b.id IN (SELECT book_id FROM favorites WHERE user_id=@fu)', { fu: u.id }, u) });
});

route('GET', '/api/me/donations', async (req, res) => {
  const u = requireAuth(req);
  send(res, 200, {
    given: listBooks("WHERE b.owner_id=@me AND b.status='Donated'", { me: u.id }, u, 'b.donated_at DESC'),
    received: listBooks('WHERE b.recipient_id=@me', { me: u.id }, u, 'b.donated_at DESC'),
  });
});

// --- Contact & misc ---
route('POST', '/api/contact', async (req, res) => {
  rateLimit(req, 'contact', 5);
  const u = currentUser(req);
  const b = await readJson(req);
  const name = clean(b.name, 100), email = clean(b.email, 150), message = cleanMultiline(b.message, 2000);
  if (name.length < 2) throw new HttpError(400, 'Please enter your name');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address');
  if (message.length < 10) throw new HttpError(400, 'Please write a message of at least 10 characters');
  db.prepare('INSERT INTO messages (user_id,name,email,message) VALUES (?,?,?,?)').run(u ? u.id : null, name, email, message);
  send(res, 201, { ok: true });
});

route('GET', '/api/admin/messages', async (req, res) => {
  const u = requireAuth(req);
  if (u.role !== 'admin') throw new HttpError(403, 'Admins only');
  send(res, 200, { messages: db.prepare('SELECT id,name,email,message,created_at FROM messages ORDER BY id DESC LIMIT 200').all() });
});

route('GET', '/api/stats', async (req, res) => {
  const one = (sql) => db.prepare(sql).get().c;
  send(res, 200, {
    books: one('SELECT COUNT(*) AS c FROM books'),
    available: one("SELECT COUNT(*) AS c FROM books WHERE status='Available'"),
    donated: one("SELECT COUNT(*) AS c FROM books WHERE status='Donated'"),
    members: one('SELECT COUNT(*) AS c FROM users'),
  });
});

route('GET', '/api/health', async (req, res) => send(res, 200, { status: 'ok' }));

// ---------- static files ----------
const HTML_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function serveFile(res, root, rel, extraHeaders = {}) {
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', ...extraHeaders };
    if (ext === '.html') headers['Content-Security-Policy'] = HTML_CSP;
    res.writeHead(200, headers);
    res.end(data);
  });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  // CORS so the frontend also works if opened from another local origin (e.g. VS Code Live Server)
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    try {
      const p = decodeURIComponent(url.pathname);
      if (p.startsWith('/uploads/')) return serveFile(res, UPLOAD_DIR, p.slice('/uploads/'.length), { 'Cache-Control': 'public, max-age=31536000, immutable' });
      return serveFile(res, PUBLIC_DIR, p === '/' ? 'index.html' : p, { 'Cache-Control': 'no-cache' });
    } catch { res.writeHead(400); return res.end('Bad request'); }
  }

  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (m) return await r.handler(req, res, { params: m.groups || {}, query: url.searchParams });
    }
    throw new HttpError(404, 'API route not found');
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error('[error]', err);
    send(res, 500, { error: 'Something went wrong on the server' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`BookBridge running at http://localhost:${PORT}`));
}
server.resetRateLimits = () => attempts.clear(); // used by the test suite
module.exports = server;
