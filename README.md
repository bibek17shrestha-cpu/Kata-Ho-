# कता हो? — Ride Board (v3)

Accounts for drivers and passengers, a driver directory with live availability,
"anywhere" ride requests, fixed-route listings, and encrypted in-app chat —
all backed by a real Postgres database (Neon) so nothing disappears on redeploy.

## What's new in this version

- **Real persistence**: every route now uses Postgres via `lib/db.js` instead
  of JSON files. Data survives restarts and redeploys.
- **Driver availability**: drivers have an on/off toggle and vehicle info,
  separate from any specific posted route.
- **Driver directory**: passengers can browse *every* driver (not just those
  with an open fixed listing) and send a ride request directly to one, or
  leave it open for any available driver to accept.
- **Ride requests**: passengers submit a custom From → To; a driver (specific
  or any) accepts or declines. Accepting opens a chat automatically.
- **Encrypted chat**: messages are encrypted with AES-256-GCM before being
  stored, using a key that lives only in an environment variable — never in
  the database or the code.

## Project structure

```
kata-ho/
├── server.js              # Express app: auth, drivers, rides, requests, chat
├── lib/
│   ├── db.js               # Postgres connection + schema (auto-creates tables)
│   └── crypto.js           # AES-256-GCM encrypt/decrypt for chat messages
├── package.json
├── .env.example             # template for local DATABASE_URL / encryption key
├── .gitignore
└── public/
    ├── index.html, signup.html, login.html, rider.html, consumer.html
    ├── styles.css
    └── js/ (common.js, rider.js, consumer.js)
```

## One-time setup: Neon database

1. Go to **neon.com**, sign up (GitHub sign-in is easiest)
2. Create a project — it auto-creates a database
3. Copy the **connection string** from the dashboard
4. Treat it like a password — never paste it into a chat, commit, or public file.
   If it's ever exposed, reset it immediately from the Neon dashboard.

## One-time setup: encryption key

Generate a 32-byte hex key for encrypting chat messages:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save the output somewhere safe — you'll set it as `MESSAGE_ENCRYPTION_KEY`.
**If this key is lost, existing messages can never be decrypted again.**

## Run it locally

Requires [Node.js](https://nodejs.org) 18+.

```bash
cd kata-ho
npm install
cp .env.example .env
# edit .env: paste your Neon connection string as DATABASE_URL,
# and your generated key as MESSAGE_ENCRYPTION_KEY
npm start
```

Open **http://localhost:3000**. The first run automatically creates all
database tables in Neon.

## Deploy to Render

1. Push this folder to a GitHub repo (don't commit `.env` — `.gitignore`
   already excludes it)
2. On Render: **New → Web Service** → connect the repo
   - Build Command: `npm install`
   - Start Command: `npm start`
3. Before the first deploy finishes, go to the service's **Environment** tab
   and add two variables:
   - `DATABASE_URL` — your Neon connection string
   - `MESSAGE_ENCRYPTION_KEY` — your generated 32-byte hex key
4. Save — Render redeploys with both connected

## Account roles

- Chosen once at signup: **driver** or **passenger** — not switchable.
  A person who wants both needs two accounts.
- Drivers: toggle availability, list vehicle info, post fixed routes, accept
  or decline incoming ride requests.
- Passengers: browse all drivers, send a ride request (to one driver or left
  open), browse fixed routes, chat once matched.

## Security notes

- Passwords are hashed with bcrypt — never stored in plain text.
- Chat messages are encrypted at rest (AES-256-GCM) using a key that only
  your server process has access to (via environment variable). This is
  encryption in transit (HTTPS on Render) + at rest, not end-to-end — your
  server can still decrypt messages if you ever need to investigate abuse
  reports, which most ride-matching platforms consider a safety requirement.
- Still a lightweight system: no email verification, no password reset flow,
  no rate limiting on login attempts. Fine for a small community; say the
  word if you want any of those added.

## Customizing

- Colors, fonts: `public/styles.css`
- Copy text: each `.html` file
- Database schema: `lib/db.js`
