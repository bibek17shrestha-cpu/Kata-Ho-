# Kata Ho? — Community Ride Board (v3, with Neon Postgres)

Accounts, rider/consumer dashboards, in-app chat — now backed by a real,
permanent Postgres database (Neon) instead of files on disk. Data survives
redeploys, restarts, and server sleep.

## What changed in this version

- Replaced the JSON-file storage with **Postgres**, hosted for free on
  **Neon** (neon.com/neon.tech)
- `lib/db.js` opens a connection pool and creates the database tables
  automatically the first time the server starts
- All routes in `server.js` now run real SQL queries instead of reading/
  writing JSON files
- The `data/` folder and `lib/store.js` from the previous version are gone —
  no longer needed

## Project structure

```
ride-board/
├── server.js          # Express app: auth, rides, chat — all routes
├── lib/
│   └── db.js           # Postgres connection + schema setup
├── package.json
├── .env.example        # template for local DATABASE_URL (not committed)
├── .gitignore           # excludes node_modules and your real .env
└── public/
    ├── index.html, signup.html, login.html, rider.html, consumer.html
    ├── styles.css
    └── js/ (common.js, rider.js, consumer.js)
```

## One-time setup: Neon database

1. Go to **neon.com**, sign up (GitHub sign-in is easiest)
2. Create a project (e.g. `ride-board`) — it auto-creates a database
3. Find your **connection string** on the project dashboard — looks like:
   ```
   postgresql://user:password@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require
   ```
4. Keep this private — treat it like a password. If you ever paste it
   somewhere public by accident, reset the password immediately from the
   Neon dashboard (Connection Details → reset password).

## Run it locally

Requires [Node.js](https://nodejs.org) 18+.

```bash
cd ride-board
npm install
cp .env.example .env
# edit .env and paste your real Neon connection string as DATABASE_URL
npm start
```

Open **http://localhost:3000**. The first run automatically creates all
the database tables in Neon.

## Deploy to Render

1. Push this folder to a GitHub repo (do **not** commit a `.env` file —
   `.gitignore` already excludes it)
2. On Render: **New → Web Service** → connect the repo
   - Build Command: `npm install`
   - Start Command: `npm start`
3. Before the first deploy finishes, go to your service's **Environment**
   tab in Render and add a variable:
   - Key: `DATABASE_URL`
   - Value: your Neon connection string
4. Save — Render redeploys automatically with the database connected
5. Once live, add your custom domain under **Settings → Custom Domain**

## Notes on this setup

- **Neon's free tier doesn't expire** (unlike Render's own free database),
  but it does have usage limits (storage and monthly compute hours) —
  more than enough for a friend-group board, but worth knowing about if
  usage grows a lot.
- **Passwords are hashed** with bcrypt before storage — never stored in
  plain text.
- This is still a lightweight auth system: no email verification, no
  password reset flow, no login rate limiting. Fine for a small trusted
  community; say the word if you want any of those added.
- Chat messages are only visible to the two participants in a
  conversation, enforced server-side.

## Customizing

- Colors, fonts, trail illustration: `public/styles.css`
- Copy text: each `.html` file
- Database schema: `lib/db.js`
