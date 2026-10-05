// SQLite database layer (Node's built-in node:sqlite - no npm install needed)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { hashPassword } = require('./auth');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const FILE = process.env.DB_FILE || path.join(DATA_DIR, 'bookbridge.db');

// If an old (v1: Buy/Exchange/Donate) database is found, keep it as a backup and start fresh.
function archiveLegacyDb(file) {
  if (!fs.existsSync(file)) return;
  const probe = new DatabaseSync(file);
  let legacy = false;
  try {
    const cols = probe.prepare('PRAGMA table_info(users)').all();
    legacy = cols.length > 0 && !cols.some((c) => c.name === 'username');
  } finally { probe.close(); }
  if (!legacy) return;
  const backup = file.replace(/\.db$/, '') + `.legacy-${Date.now()}.db`;
  for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(file + ext)) fs.renameSync(file + ext, backup + ext);
  console.log(`[db] Old v1 database moved to ${path.basename(backup)}`);
}
archiveLegacyDb(FILE);

const db = new DatabaseSync(FILE);

function closeDb() {
  if (db && typeof db.close === 'function') db.close();
}

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS books (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  author         TEXT NOT NULL,
  category       TEXT NOT NULL,
  condition      TEXT NOT NULL DEFAULT 'Good',
  description    TEXT NOT NULL DEFAULT '',
  published_year INTEGER,
  cover_image    TEXT,                          -- file name inside data/uploads (NULL = generated cover)
  cover_color    TEXT NOT NULL DEFAULT '#efe7ff|#4b33b0',
  status         TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available','Donated')),
  owner_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  donated_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_books_owner    ON books(owner_id);
CREATE INDEX IF NOT EXISTS idx_books_category ON books(category);
CREATE INDEX IF NOT EXISTS idx_books_status   ON books(status);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, book_id)
);

CREATE TABLE IF NOT EXISTS requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id      INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','cancelled')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
-- a person can only have one open request per book
CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_open ON requests(book_id, requester_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_requests_requester ON requests(requester_id);

CREATE TABLE IF NOT EXISTS messages (            -- Contact page submissions
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);
`);

// ---- Seed data (only on a fresh database) ----
function seed() {
  if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) return;

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@bookbridge.com';
  const adminPass = process.env.ADMIN_PASSWORD || 'Admin@123';
  const info = db.prepare('INSERT INTO users (name,username,email,password_hash,role,bio) VALUES (?,?,?,?,?,?)')
    .run('BookBridge Team', 'bookbridge', adminEmail, hashPassword(adminPass), 'admin', 'Giving books a second life.');
  const adminId = Number(info.lastInsertRowid);

  // title, author, category, condition, year, cover colours (background|text), description
  const sample = [
    ['Atomic Habits', 'James Clear', 'Self Help', 'Good', 2018, '#f4ead3|#e07a1f',
      'A practical guide to building good habits and breaking bad ones through small, consistent changes.'],
    ['Rich Dad Poor Dad', 'Robert T. Kiyosaki', 'Personal Finance', 'Good', 1997, '#2b1f1a|#f2c14e',
      'A classic look at money, assets and the mindset that separates earning from building wealth.'],
    ['Clean Code', 'Robert C. Martin', 'Programming', 'Good', 2008, '#101b3d|#6fb6ff',
      'A handbook of agile software craftsmanship: how to write code that is readable and easy to change.'],
    ['The Alchemist', 'Paulo Coelho', 'Fiction', 'Good', 1988, '#e8512a|#ffe08a',
      'A shepherd boy travels in search of treasure and learns to listen to his heart.'],
    ['Deep Work', 'Cal Newport', 'Self Help', 'Very Good', 2016, '#1f2a37|#f5c542',
      'Rules for focused success in a distracted world.'],
    ['The Psychology of Money', 'Morgan Housel', 'Personal Finance', 'Excellent', 2020, '#e9f3ee|#1b6b4a',
      'Short stories about how people think about money, risk and happiness.'],
    ['Eloquent JavaScript', 'Marijn Haverbeke', 'Programming', 'Good', 2018, '#fff3b0|#3b2f8f',
      'A modern introduction to programming with JavaScript, with exercises in every chapter.'],
    ['Sapiens', 'Yuval Noah Harari', 'Non-Fiction', 'Fair', 2011, '#f3e0d0|#7a3e1d',
      'A brief history of humankind, from the first humans to the present day.'],
  ];
  const ins = db.prepare(
    `INSERT INTO books (title,author,category,condition,published_year,cover_color,description,owner_id)
     VALUES (?,?,?,?,?,?,?,?)`);
  for (const b of sample) ins.run(b[0], b[1], b[2], b[3], b[4], b[5], b[6], adminId);
  console.log(`[db] Seeded admin (${adminEmail}) and ${sample.length} sample books`);
}
seed();

module.exports = { db, UPLOAD_DIR, closeDb };
