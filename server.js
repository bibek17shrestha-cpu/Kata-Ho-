const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const webpush = require('web-push');
const { pool, initSchema } = require('./lib/db');
const { sendEmail } = require('./lib/email');
const { encrypt, decrypt } = require('./lib/crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_NAME = 'saathi_session';

// Web Push (real phone/browser notifications, even when the tab is closed).
// VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are a matched key pair — generate
// once with: node -e "console.log(require('web-push').generateVAPIDKeys())"
// and set both as environment variables in Render. Push simply won't work
// (fails silently, rest of the app is unaffected) until both are set.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:support@kataho.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.error('Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — push notifications are disabled until both are set.');
}

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function newId(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Sends a push notification to every device a user has subscribed on.
// Silently no-ops if VAPID isn't configured or the user has no subscriptions.
// Dead subscriptions (410/404 from the push service, e.g. uninstalled PWA)
// are cleaned up automatically.
async function sendPushToUser(userId, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  try {
    const { rows } = await pool.query('SELECT * FROM push_subscriptions WHERE user_id = $1', [userId]);
    for (const sub of rows) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      };
      try {
        await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        }
      }
    }
  } catch (err) {
    console.error('Push send failed:', err.message);
  }
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, contact: u.contact, gender: u.gender };
}

async function findUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function currentUser(req) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return null;
  const { rows } = await pool.query('SELECT user_id FROM sessions WHERE token = $1', [token]);
  if (!rows[0]) return null;
  return findUserById(rows[0].user_id);
}

async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Please log in first.' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

async function startSession(res, userId) {
  const token = newId(24);
  await pool.query(
    'INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)',
    [token, userId, Date.now()]
  );
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
}

// ---------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------
app.post('/api/signup', async (req, res, next) => {
  try {
    const { name, email, password, role, contact, gender } = req.body;
    if (!name || !email || !password || !role || !contact) {
      return res.status(400).json({ error: 'All fields are required, including a contact method.' });
    }
    if (role !== 'rider' && role !== 'consumer') {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    const genderNorm = (gender === 'male' || gender === 'female') ? gender : 'unspecified';

    const emailNorm = String(email).trim().toLowerCase();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [emailNorm]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const id = newId();
    const passwordHash = bcrypt.hashSync(password, 10);
    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role, contact, gender, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, String(name).trim().slice(0, 80), emailNorm, passwordHash, role, String(contact).trim().slice(0, 120), genderNorm, Date.now()]
    );

    if (role === 'rider') {
      await pool.query(
        `INSERT INTO driver_profiles (user_id, vehicle_info, is_available, updated_at)
         VALUES ($1, '', false, $2)`,
        [id, Date.now()]
      );
    }

    await startSession(res, id);
    const user = await findUserById(id);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

app.post('/api/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const emailNorm = String(email || '').trim().toLowerCase();
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [emailNorm]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      return res.status(401).json({ error: 'Wrong email or password.' });
    }
    await startSession(res, user.id);
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

// Request a password reset email. Always returns success (even if the
// email doesn't exist) so this endpoint can't be used to check which
// emails have accounts.
app.post('/api/forgot-password', async (req, res, next) => {
  try {
    const emailNorm = String(req.body.email || '').trim().toLowerCase();
    if (!emailNorm) return res.status(400).json({ error: 'Enter your email.' });

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [emailNorm]);
    const user = rows[0];

    if (user) {
      const token = newId(24);
      const expiresAt = Date.now() + 1000 * 60 * 60; // 1 hour
      await pool.query(
        'INSERT INTO password_reset_tokens (token, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)',
        [token, user.id, expiresAt, Date.now()]
      );
      const resetUrl = `${req.protocol}://${req.get('host')}/reset-password.html?token=${token}`;
      await sendEmail({
        to: user.email,
        subject: 'Reset your कता हो? password',
        html: `
          <p>Hi ${user.name},</p>
          <p>Someone requested a password reset for your कता हो? account. If this was you, click below — this link expires in 1 hour:</p>
          <p><a href="${resetUrl}">${resetUrl}</a></p>
          <p>If you didn't request this, you can safely ignore this email.</p>
        `
      });
    }

    // Same response whether or not the account exists.
    res.json({ ok: true, message: 'If that email has an account, a reset link has been sent.' });
  } catch (err) { next(err); }
});

app.post('/api/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Missing token or password.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const { rows } = await pool.query('SELECT * FROM password_reset_tokens WHERE token = $1', [token]);
    const resetToken = rows[0];
    if (!resetToken || resetToken.used || Number(resetToken.expires_at) < Date.now()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, resetToken.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used = true WHERE token = $1', [token]);
    // Invalidate all existing sessions for this user as a safety measure.
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [resetToken.user_id]);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post('/api/logout', async (req, res, next) => {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.get('/api/me', async (req, res, next) => {
  try {
    const user = await currentUser(req);
    res.json({ user: user ? publicUser(user) : null });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// profile (name + contact) — shared by both roles
// ---------------------------------------------------------------------
app.patch('/api/profile', requireAuth, async (req, res, next) => {
  try {
    const { name, contact, gender } = req.body;
    if (!name || !contact) {
      return res.status(400).json({ error: 'Name and contact are required.' });
    }
    const genderNorm = (gender === 'male' || gender === 'female' || gender === 'unspecified') ? gender : req.user.gender;
    await pool.query(
      'UPDATE users SET name = $1, contact = $2, gender = $3 WHERE id = $4',
      [String(name).trim().slice(0, 80), String(contact).trim().slice(0, 120), genderNorm, req.user.id]
    );
    const updated = await findUserById(req.user.id);
    res.json({ user: publicUser(updated) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// driver availability + profile
// ---------------------------------------------------------------------
app.get('/api/driver-profile', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'rider') return res.status(403).json({ error: 'Riders only.' });
    const { rows } = await pool.query('SELECT * FROM driver_profiles WHERE user_id = $1', [req.user.id]);
    const profile = rows[0] || { user_id: req.user.id, vehicle_info: '', is_available: false };
    res.json({
      vehicleInfo: profile.vehicle_info,
      isAvailable: profile.is_available
    });
  } catch (err) { next(err); }
});

app.patch('/api/driver-profile', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'rider') return res.status(403).json({ error: 'Riders only.' });
    const { isAvailable, vehicleInfo } = req.body;

    await pool.query(
      `INSERT INTO driver_profiles (user_id, vehicle_info, is_available, updated_at)
       VALUES ($1, COALESCE($2::text, ''), COALESCE($3::boolean, false), $4)
       ON CONFLICT (user_id) DO UPDATE SET
         vehicle_info = COALESCE($2::text, driver_profiles.vehicle_info),
         is_available = COALESCE($3::boolean, driver_profiles.is_available),
         updated_at = $4`,
      [
        req.user.id,
        typeof vehicleInfo === 'string' ? vehicleInfo.slice(0, 200) : null,
        typeof isAvailable === 'boolean' ? isAvailable : null,
        Date.now()
      ]
    );
    const { rows } = await pool.query('SELECT * FROM driver_profiles WHERE user_id = $1', [req.user.id]);
    res.json({ vehicleInfo: rows[0].vehicle_info, isAvailable: rows[0].is_available });
  } catch (err) { next(err); }
});

// Public: browse all drivers (used by consumers to pick anyone, available or not).
app.get('/api/drivers', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.contact, dp.vehicle_info, dp.is_available
      FROM users u
      LEFT JOIN driver_profiles dp ON dp.user_id = u.id
      WHERE u.role = 'rider'
      ORDER BY dp.is_available DESC NULLS LAST, u.name ASC
    `);
    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      contact: r.contact,
      vehicleInfo: r.vehicle_info || '',
      isAvailable: !!r.is_available
    })));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// rides (fixed listings posted by riders, existing behavior)
// ---------------------------------------------------------------------
app.get('/api/rides', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM rides WHERE status = 'open' ORDER BY created_at DESC`
    );
    res.json(rows.map(rideRow));
  } catch (err) { next(err); }
});

app.get('/api/my-rides', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'rider') return res.status(403).json({ error: 'Riders only.' });
    const { rows } = await pool.query(
      `SELECT * FROM rides WHERE rider_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows.map(rideRow));
  } catch (err) { next(err); }
});

app.post('/api/rides', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'rider') return res.status(403).json({ error: 'Only riders can post availability.' });
    const { from, to, date, time, seats, note } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'From and To are required.' });

    const id = newId(6);
    const now = Date.now();
    const seatsNum = Math.max(1, Math.min(8, parseInt(seats) || 1));
    await pool.query(
      `INSERT INTO rides (id, rider_id, rider_name, from_place, to_place, ride_date, ride_time, seats, note, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10)`,
      [id, req.user.id, req.user.name, String(from).slice(0, 100), String(to).slice(0, 100),
       date || null, time || null, seatsNum, note ? String(note).slice(0, 300) : '', now]
    );
    const { rows } = await pool.query('SELECT * FROM rides WHERE id = $1', [id]);
    res.status(201).json(rideRow(rows[0]));
  } catch (err) { next(err); }
});

app.patch('/api/rides/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM rides WHERE id = $1', [req.params.id]);
    const ride = rows[0];
    if (!ride) return res.status(404).json({ error: 'Ride not found.' });
    if (ride.rider_id !== req.user.id) return res.status(403).json({ error: 'Not your listing.' });

    const status = (req.body.status === 'open' || req.body.status === 'closed') ? req.body.status : ride.status;
    const seats = req.body.seats ? Math.max(1, Math.min(8, parseInt(req.body.seats) || ride.seats)) : ride.seats;

    await pool.query('UPDATE rides SET status = $1, seats = $2 WHERE id = $3', [status, seats, ride.id]);
    const updated = await pool.query('SELECT * FROM rides WHERE id = $1', [ride.id]);
    res.json(rideRow(updated.rows[0]));
  } catch (err) { next(err); }
});

app.delete('/api/rides/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM rides WHERE id = $1', [req.params.id]);
    const ride = rows[0];
    if (!ride) return res.status(404).json({ error: 'Ride not found.' });
    if (ride.rider_id !== req.user.id) return res.status(403).json({ error: 'Not your listing.' });
    await pool.query('DELETE FROM rides WHERE id = $1', [ride.id]);
    res.status(204).end();
  } catch (err) { next(err); }
});

function rideRow(r) {
  return {
    id: r.id,
    riderId: r.rider_id,
    riderName: r.rider_name,
    from: r.from_place,
    to: r.to_place,
    date: r.ride_date,
    time: r.ride_time,
    seats: r.seats,
    note: r.note,
    status: r.status,
    createdAt: Number(r.created_at)
  };
}

// ---------------------------------------------------------------------
// ride requests ("anywhere" rides — consumer posts from/to, any driver can accept)
// ---------------------------------------------------------------------
function requestRow(r) {
  return {
    id: r.id,
    consumerId: r.consumer_id,
    consumerName: r.consumer_name,
    driverId: r.driver_id,
    from: r.from_place,
    to: r.to_place,
    note: r.note,
    status: r.status,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
}

// Consumer creates a request, optionally addressed to a specific driver.
app.post('/api/ride-requests', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'consumer') return res.status(403).json({ error: 'Only passengers can request a ride.' });
    const { from, to, note, driverId } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'From and To are required.' });

    if (driverId) {
      const driver = await findUserById(driverId);
      if (!driver || driver.role !== 'rider') return res.status(400).json({ error: 'Invalid driver selected.' });
    }

    const id = newId(6);
    const now = Date.now();
    await pool.query(
      `INSERT INTO ride_requests (id, consumer_id, consumer_name, driver_id, from_place, to_place, note, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$8)`,
      [id, req.user.id, req.user.name, driverId || null, String(from).slice(0, 100), String(to).slice(0, 100),
       note ? String(note).slice(0, 300) : '', now]
    );
    const { rows } = await pool.query('SELECT * FROM ride_requests WHERE id = $1', [id]);
    res.status(201).json(requestRow(rows[0]));

    if (driverId) {
      sendPushToUser(driverId, {
        title: `New ride request from ${req.user.name}`,
        body: `${from} → ${to}`,
        tag: 'request-' + id,
        url: '/rider.html'
      });
    }
  } catch (err) { next(err); }
});

// Consumer sees their own requests.
app.get('/api/my-ride-requests', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'consumer') return res.status(403).json({ error: 'Passengers only.' });
    const { rows } = await pool.query(
      `SELECT * FROM ride_requests WHERE consumer_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows.map(requestRow));
  } catch (err) { next(err); }
});

// Driver sees: requests addressed to them directly, plus all open (unaddressed) pending requests.
app.get('/api/incoming-ride-requests', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'rider') return res.status(403).json({ error: 'Riders only.' });
    const { rows } = await pool.query(
      `SELECT * FROM ride_requests
       WHERE status = 'pending' AND (driver_id = $1 OR driver_id IS NULL)
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows.map(requestRow));
  } catch (err) { next(err); }
});

app.patch('/api/ride-requests/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM ride_requests WHERE id = $1', [req.params.id]);
    const request = rows[0];
    if (!request) return res.status(404).json({ error: 'Request not found.' });

    const { status } = req.body;
    const now = Date.now();

    if (status === 'accepted') {
      if (req.user.role !== 'rider') return res.status(403).json({ error: 'Only a driver can accept.' });
      if (request.status !== 'pending') return res.status(409).json({ error: 'This request is no longer pending.' });
      if (request.driver_id && request.driver_id !== req.user.id) {
        return res.status(403).json({ error: 'This request was addressed to a different driver.' });
      }
      await pool.query(
        `UPDATE ride_requests SET status = 'accepted', driver_id = $1, updated_at = $2 WHERE id = $3`,
        [req.user.id, now, request.id]
      );
    } else if (status === 'declined') {
      if (req.user.role !== 'rider') return res.status(403).json({ error: 'Only a driver can decline.' });
      await pool.query(`UPDATE ride_requests SET status = 'declined', updated_at = $1 WHERE id = $2`, [now, request.id]);
    } else if (status === 'cancelled') {
      if (request.consumer_id !== req.user.id) return res.status(403).json({ error: 'Not your request.' });
      await pool.query(`UPDATE ride_requests SET status = 'cancelled', updated_at = $1 WHERE id = $2`, [now, request.id]);
    } else if (status === 'completed') {
      if (request.driver_id !== req.user.id && request.consumer_id !== req.user.id) {
        return res.status(403).json({ error: 'Not part of this request.' });
      }
      await pool.query(`UPDATE ride_requests SET status = 'completed', updated_at = $1 WHERE id = $2`, [now, request.id]);
    } else {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const updated = await pool.query('SELECT * FROM ride_requests WHERE id = $1', [request.id]);
    res.json(requestRow(updated.rows[0]));

    if (status === 'accepted' || status === 'declined') {
      const driver = await findUserById(req.user.id);
      sendPushToUser(request.consumer_id, {
        title: status === 'accepted' ? 'Your ride request was accepted!' : 'A driver declined your request',
        body: `${request.from_place} → ${request.to_place}${driver ? ' — ' + driver.name : ''}`,
        tag: 'request-status-' + request.id,
        url: '/consumer.html'
      });
    }
  } catch (err) { next(err); }
});

// Passenger removes a finished (declined/cancelled/completed) request from
// their own "My requests" list. Doesn't affect the driver's view of it.
app.delete('/api/ride-requests/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM ride_requests WHERE id = $1', [req.params.id]);
    const request = rows[0];
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.consumer_id !== req.user.id) return res.status(403).json({ error: 'Not your request.' });
    if (request.status === 'pending' || request.status === 'accepted') {
      return res.status(400).json({ error: 'Cancel or complete this request before clearing it.' });
    }
    await pool.query('DELETE FROM ride_requests WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// conversations + encrypted messages
// ---------------------------------------------------------------------
async function enrichConversation(c, userId) {
  const otherId = c.rider_id === userId ? c.consumer_id : c.rider_id;
  const other = await findUserById(otherId);
  let routeFrom = '?', routeTo = '?';
  if (c.ride_id) {
    const { rows } = await pool.query('SELECT from_place, to_place FROM rides WHERE id = $1', [c.ride_id]);
    if (rows[0]) { routeFrom = rows[0].from_place; routeTo = rows[0].to_place; }
  } else if (c.ride_request_id) {
    const { rows } = await pool.query('SELECT from_place, to_place FROM ride_requests WHERE id = $1', [c.ride_request_id]);
    if (rows[0]) { routeFrom = rows[0].from_place; routeTo = rows[0].to_place; }
  }

  const { rows: myReadRows } = await pool.query(
    'SELECT last_read_at FROM conversation_reads WHERE conversation_id = $1 AND user_id = $2',
    [c.id, userId]
  );
  const myLastRead = myReadRows[0] ? Number(myReadRows[0].last_read_at) : 0;

  const { rows: theirReadRows } = await pool.query(
    'SELECT last_read_at FROM conversation_reads WHERE conversation_id = $1 AND user_id = $2',
    [c.id, otherId]
  );
  const theirLastRead = theirReadRows[0] ? Number(theirReadRows[0].last_read_at) : 0;

  const { rows: unreadRows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id = $1 AND sender_id != $2 AND created_at > $3',
    [c.id, userId, myLastRead]
  );
  const unreadCount = unreadRows[0] ? unreadRows[0].count : 0;

  const { rows: lastMsgRows } = await pool.query(
    'SELECT sender_id, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
    [c.id]
  );
  const lastMessage = lastMsgRows[0];
  const seenByOther = !!(lastMessage && lastMessage.sender_id === userId && Number(lastMessage.created_at) <= theirLastRead);

  return {
    id: c.id,
    rideId: c.ride_id,
    rideRequestId: c.ride_request_id,
    riderId: c.rider_id,
    consumerId: c.consumer_id,
    otherName: other ? other.name : 'Unknown',
    otherContact: other ? other.contact : '',
    otherRole: c.rider_id === userId ? 'consumer' : 'rider',
    otherGender: other ? other.gender : 'unspecified',
    rideFrom: routeFrom,
    rideTo: routeTo,
    createdAt: Number(c.created_at),
    unreadCount,
    seenByOther
  };
}

app.get('/api/conversations', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM conversations
       WHERE (rider_id = $1 AND archived_by_rider = false)
          OR (consumer_id = $1 AND archived_by_consumer = false)
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    const enriched = await Promise.all(rows.map(c => enrichConversation(c, req.user.id)));
    res.json(enriched);
  } catch (err) { next(err); }
});

// Start (or reuse) a conversation tied to a fixed rider listing.
app.post('/api/conversations', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'consumer') {
      return res.status(403).json({ error: 'Only passengers can start a chat from a listing.' });
    }
    const { rideId } = req.body;
    const { rows: rideRows } = await pool.query('SELECT * FROM rides WHERE id = $1', [rideId]);
    const ride = rideRows[0];
    if (!ride) return res.status(404).json({ error: 'Ride not found.' });

    const existing = await pool.query(
      'SELECT * FROM conversations WHERE ride_id = $1 AND consumer_id = $2',
      [rideId, req.user.id]
    );
    let convo = existing.rows[0];
    if (!convo) {
      const id = newId(6);
      await pool.query(
        `INSERT INTO conversations (id, ride_id, rider_id, consumer_id, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [id, rideId, ride.rider_id, req.user.id, Date.now()]
      );
      const inserted = await pool.query('SELECT * FROM conversations WHERE id = $1', [id]);
      convo = inserted.rows[0];
    }
    res.status(201).json(await enrichConversation(convo, req.user.id));
  } catch (err) { next(err); }
});

// Start (or reuse) a conversation tied to an accepted ride request.
app.post('/api/conversations/from-request', requireAuth, async (req, res, next) => {
  try {
    const { requestId } = req.body;
    const { rows } = await pool.query('SELECT * FROM ride_requests WHERE id = $1', [requestId]);
    const request = rows[0];
    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.status !== 'accepted') return res.status(400).json({ error: 'Request must be accepted first.' });
    if (request.driver_id !== req.user.id && request.consumer_id !== req.user.id) {
      return res.status(403).json({ error: 'Not part of this request.' });
    }

    const existing = await pool.query('SELECT * FROM conversations WHERE ride_request_id = $1', [requestId]);
    let convo = existing.rows[0];
    if (!convo) {
      const id = newId(6);
      await pool.query(
        `INSERT INTO conversations (id, ride_request_id, rider_id, consumer_id, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [id, requestId, request.driver_id, request.consumer_id, Date.now()]
      );
      const inserted = await pool.query('SELECT * FROM conversations WHERE id = $1', [id]);
      convo = inserted.rows[0];
    }
    res.status(201).json(await enrichConversation(convo, req.user.id));
  } catch (err) { next(err); }
});

async function requireConversationAccess(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM conversations WHERE id = $1', [req.params.id]);
    const convo = rows[0];
    if (!convo) return res.status(404).json({ error: 'Conversation not found.' });
    if (convo.rider_id !== req.user.id && convo.consumer_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your conversation.' });
    }
    req.convo = convo;
    next();
  } catch (err) { next(err); }
}

app.get('/api/conversations/:id/messages', requireAuth, requireConversationAccess, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    const messages = rows.map(m => {
      let body;
      try {
        body = decrypt(m.body_encrypted, m.iv, m.auth_tag);
      } catch (e) {
        body = '[unable to decrypt message]';
      }
      return { id: m.id, senderId: m.sender_id, body, createdAt: Number(m.created_at) };
    });
    res.json(messages);
  } catch (err) { next(err); }
});

app.post('/api/conversations/:id/messages', requireAuth, requireConversationAccess, async (req, res, next) => {
  try {
    const body = String(req.body.body || '').trim().slice(0, 1000);
    if (!body) return res.status(400).json({ error: 'Message cannot be empty.' });

    const { bodyEncrypted, iv, authTag } = encrypt(body);
    const id = newId(6);
    const now = Date.now();
    await pool.query(
      `INSERT INTO messages (id, conversation_id, sender_id, body_encrypted, iv, auth_tag, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, req.params.id, req.user.id, bodyEncrypted, iv, authTag, now]
    );
    // A new message un-archives the thread for the recipient — otherwise a
    // reply could silently vanish into a hidden conversation.
    const recipientColumn = req.convo.rider_id === req.user.id ? 'archived_by_consumer' : 'archived_by_rider';
    await pool.query(`UPDATE conversations SET ${recipientColumn} = false WHERE id = $1`, [req.params.id]);

    res.status(201).json({ id, senderId: req.user.id, body, createdAt: now });

    const recipientId = req.convo.rider_id === req.user.id ? req.convo.consumer_id : req.convo.rider_id;
    sendPushToUser(recipientId, {
      title: `New message from ${req.user.name}`,
      body: body.slice(0, 100),
      tag: 'chat-' + req.params.id,
      url: '/' + (req.convo.rider_id === recipientId ? 'rider.html' : 'consumer.html')
    });
  } catch (err) { next(err); }
});

// Mark a conversation as read up to now, for unread counts + seen receipts.
app.post('/api/conversations/:id/read', requireAuth, requireConversationAccess, async (req, res, next) => {
  try {
    const now = Date.now();
    await pool.query(
      `INSERT INTO conversation_reads (conversation_id, user_id, last_read_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = $3`,
      [req.params.id, req.user.id, now]
    );
    res.json({ ok: true, readAt: now });
  } catch (err) { next(err); }
});

// Clears the conversation from just this user's inbox (e.g. once a ride is
// done). The other participant still sees it until they clear it too.
app.post('/api/conversations/:id/archive', requireAuth, requireConversationAccess, async (req, res, next) => {
  try {
    const column = req.convo.rider_id === req.user.id ? 'archived_by_rider' : 'archived_by_consumer';
    await pool.query(`UPDATE conversations SET ${column} = true WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// push notifications
// ---------------------------------------------------------------------
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', requireAuth, async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: 'Invalid push subscription.' });
    }
    await pool.query(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $2, p256dh = $4, auth = $5`,
      [newId(6), req.user.id, endpoint, keys.p256dh, keys.auth, Date.now()]
    );
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

app.post('/api/push/unsubscribe', requireAuth, async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (endpoint) await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// error handling + startup
// ---------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Kata Ho running at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
