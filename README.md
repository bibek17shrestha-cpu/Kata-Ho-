# Saathi Sawaari — Community Ride Board (v2)

Now with accounts, separate rider/consumer dashboards, and in-app chat —
no phone numbers shared, no fares, just neighbours closing a gap.

## What's new in this version

- **Accounts**: sign up as a "Rider" (you drive) or someone who "needs rides" (consumer)
- **Rider dashboard** (`/rider.html`): post your availability (from/to/date/time/seats), manage your listings, see an inbox of chats
- **Consumer page** (`/consumer.html`): browse *every* rider's availability in one directory, search by place, tap "Chat" to message a rider directly in the app
- **In-app chat**: messages are stored and polled — no need to share a phone number

## Project structure

```
ride-board/
├── server.js          # Express app: auth, rides, chat — all routes
├── lib/
│   └── store.js       # tiny JSON-file read/write helper
├── package.json
├── data/               # created automatically — plain JSON "database"
│   ├── users.json
│   ├── sessions.json
│   ├── rides.json
│   ├── conversations.json
│   └── messages.json
└── public/
    ├── index.html       # landing page
    ├── signup.html
    ├── login.html
    ├── rider.html        # rider dashboard
    ├── consumer.html      # consumer directory
    ├── styles.css
    └── js/
        ├── common.js     # shared auth/nav/chat-modal helpers
        ├── rider.js
        └── consumer.js
```

## Run it locally

Requires [Node.js](https://nodejs.org) 18+.

```bash
cd ride-board
npm install
npm start
```

Open **http://localhost:3000**.

## Deploy (same as before)

Render.com or Railway.app both work with zero config changes:

1. Push this folder to a GitHub repo (root level — `server.js` and
   `package.json` directly in the repo, `public/`, `lib/`, and `data/` as
   folders alongside them)
2. On Render: **New → Web Service** → connect the repo
   - Build Command: `npm install`
   - Start Command: `npm start`
3. Once live, add your custom domain in Render's dashboard and point a
   CNAME at it from your registrar.

## Important notes on data & security

- **Storage is still plain JSON files** on disk — simple and fine for a
  friend-group tool, but:
  - Some free hosts wipe the disk on redeploy or restart. If your board
    matters long-term, ask to have this swapped for a real database
    (e.g. SQLite with a persistent volume, or Postgres).
  - There's no automatic backup. Consider downloading `data/*.json`
    periodically if the board gets real use.
- **Passwords are hashed** (bcrypt) before being stored — never stored in
  plain text.
- **Sessions** are stored in `data/sessions.json` and referenced by an
  httpOnly cookie — reasonably safe for a small trusted community, but this
  is not a hardened production auth system (no email verification, no
  password reset flow, no rate limiting on login attempts).
- Chat messages are visible only to the two participants of a conversation,
  enforced server-side.

## Customizing

- Colors, fonts, and the trail illustration: `public/styles.css`
- Copy text: each `.html` file
- To add password reset, email verification, or a real database, say the
  word and I can extend this.
