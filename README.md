# BookBridge: Donate books, share knowledge

Full-stack project: **Node.js REST API + SQLite + a single-page frontend** built from your UI design
(indigo navigation, yellow actions, lavender surfaces, Poppins). No `npm install` needed: the backend
uses only Node's built-in modules.

## Requirements
Node.js **22.13+** (uses built-in `node:sqlite`). Check with `node -v`.

## Run
```bash
cd bookbridge
npm start            # http://localhost:3000
npm test             # 26 end-to-end API checks
```
The backend serves the frontend and API from the same address (no CORS setup).
Default admin (created on first run): `admin@bookbridge.com` / `Admin@123` (username `bookbridge`).
Change with `ADMIN_EMAIL` / `ADMIN_PASSWORD` before first run.

## Free hosting (Render)
Chrome is only the browser used to view the website. The project must be hosted on a Node-capable service.

The easiest free option is Render:

1. Push this project to GitHub.
2. Go to <https://dashboard.render.com> and click New + → Web Service.
3. Connect the GitHub repo and choose this project.
4. Use these settings:
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment variables:
     - `PORT=10000`
     - `JWT_SECRET=<random long value>`
     - `ADMIN_EMAIL=admin@bookbridge.com`
     - `ADMIN_PASSWORD=Admin@123`
5. Deploy and open the generated public URL in Chrome.

A ready-to-use config file is included at `render.yaml` for this project.

> Note: free hosting is fine for demo/student projects, but SQLite and uploaded image files are best treated as temporary because free instances can reset data.

> Upgrading from the previous version? An old `data/bookbridge.db` is automatically moved to
> `bookbridge.legacy-<time>.db` and a fresh database is created.

## Pages (all 9 from the design, plus the ones they imply)
| Design screen | Route |
|---|---|
| Home (hero + Featured Books) | `#/` |
| Navigation bar (search, avatar menu, mobile menu) | every page |
| Login / Registration | `#/login`, `#/register` (+ `#/forgot`, `#/reset`) |
| Profile (stats, My Activity tabs, Edit Profile) | `#/profile` (+ `/profile/books`, `/favorites`, `/donations`, `/settings`) |
| Help & Support (accordion) | `#/help` |
| Contact | `#/contact` |
| Upload a Book (cover upload) | `#/donate` (edit: `#/edit/:id`) |
| Book view | `#/book/:id` |
| Browse Books, Favorites | `#/browse`, `#/favorites` |

## How donating works
1. A member uploads a book (cover optional; a styled cover is generated if none).
2. Anyone logged in can **Request Book** (optional note; max 5 open requests at once).
3. The donor sees requests in **My Books** and approves or declines. Approving marks the book
   *Donated* to that person and declines the other requests.

## Project structure
```
server.js   REST API, static files, cover uploads, security headers
db.js       SQLite schema + seed data     auth.js  scrypt hashing + HS256 JWT
test.js     API tests                     data/    database + uploads (auto-created)
public/     index.html, css/style.css, js/core.js (router, nav, API), js/pages.js (screens)
```

## Database
`users` (name, username, email, bio, role) · `books` (title, author, category, condition, description,
published_year, cover_image, status, owner, recipient) · `favorites` · `requests` (pending / approved /
declined / cancelled) · `messages` (contact form) · `password_resets` (hashed one-time tokens)

## API
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | /api/auth/register | | name, email, username, password, confirm_password |
| POST | /api/auth/login | | `identifier` (email or username), password, remember |
| GET | /api/auth/me | ✔ | |
| POST | /api/auth/forgot, /api/auth/reset | | reset link is printed in the server console |
| GET/PUT/DELETE | /api/profile | ✔ | stats; edit; delete account (password required) |
| PUT | /api/profile/password | ✔ | |
| GET | /api/books?q&category&condition&status&sort&limit&offset | optional | |
| GET | /api/books/:id | optional | |
| POST | /api/books | ✔ | JSON; `cover_data` = base64 data URL (JPG/PNG, max 2 MB) |
| PUT/DELETE | /api/books/:id | owner/admin | |
| POST | /api/books/:id/favorite | ✔ | toggle |
| POST | /api/books/:id/request | ✔ | |
| GET | /api/books/:id/requests | owner/admin | |
| POST | /api/requests/:id/approve, /decline, /cancel | ✔ | donor approves/declines; requester cancels |
| GET | /api/me/books, /requests, /favorites, /donations | ✔ | profile tabs |
| POST | /api/contact | optional | |
| GET | /api/admin/messages | admin | contact inbox |
| GET | /api/meta, /api/stats, /api/health | | |

## Security notes
scrypt password hashing; JWT (1 day, or 30 days with "Remember me"); role can't be chosen at signup;
owner/admin checks on every change; login errors don't reveal if an account exists; rate limiting on
auth/contact; uploads validated by real file bytes and stored under random names; CSP blocks inline scripts;
all user text is HTML-escaped.

## Config (env vars)
`PORT` (3000), `JWT_SECRET` (auto-generated in `data/.jwt_secret`), `DB_FILE`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
