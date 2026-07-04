const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const { load, save } = require('./lib/store');

const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_NAME = 'saathi_session';

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

function findUserById(id) {
  return load('users.json').find(u => u.id === id);
}

function currentUser(req) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return null;
  const session = load('sessions.json').find(s => s.token === token);
  if (!session) return null;
  return findUserById(session.userId) || null;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in first.' });
  req.user = user;
  next();
}

// ---------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------
app.post('/api/signup', (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (role !== 'rider' && role !== 'consumer') {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const users = load('users.json');
  const emailNorm = String(email).trim().toLowerCase();
  if (users.find(u => u.email === emailNorm)) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const user = {
    id: crypto.randomBytes(8).toString('hex'),
    name: String(name).trim().slice(0, 80),
    email: emailNorm,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    createdAt: Date.now()
  };
  users.push(user);
  save('users.json', users);

  startSession(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const emailNorm = String(email || '').trim().toLowerCase();
  const users = load('users.json');
  const user = users.find(u => u.email === emailNorm);
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    const sessions = load('sessions.json').filter(s => s.token !== token);
    save('sessions.json', sessions);
  }
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  res.json({ user: user ? publicUser(user) : null });
});

function startSession(res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const sessions = load('sessions.json');
  sessions.push({ token, userId, createdAt: Date.now() });
  save('sessions.json', sessions);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
}

// ---------------------------------------------------------------------
// rides (posted by riders, browsed by consumers)
// ---------------------------------------------------------------------
app.get('/api/rides', (req, res) => {
  // public browse feed for consumers: only open rides, with rider name attached
  const rides = load('rides.json')
    .filter(r => r.status === 'open')
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(rides);
});

app.get('/api/my-rides', requireAuth, (req, res) => {
  if (req.user.role !== 'rider') return res.status(403).json({ error: 'Riders only.' });
  const rides = load('rides.json')
    .filter(r => r.riderId === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(rides);
});

app.post('/api/rides', requireAuth, (req, res) => {
  if (req.user.role !== 'rider') return res.status(403).json({ error: 'Only riders can post availability.' });
  const { from, to, date, time, seats, note } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'From and To are required.' });

  const ride = {
    id: crypto.randomBytes(6).toString('hex'),
    riderId: req.user.id,
    riderName: req.user.name,
    from: String(from).slice(0, 100),
    to: String(to).slice(0, 100),
    date: date || null,
    time: time || null,
    seats: Math.max(1, Math.min(8, parseInt(seats) || 1)),
    note: note ? String(note).slice(0, 300) : '',
    status: 'open',
    createdAt: Date.now()
  };
  const rides = load('rides.json');
  rides.push(ride);
  save('rides.json', rides);
  res.status(201).json(ride);
});

app.patch('/api/rides/:id', requireAuth, (req, res) => {
  const rides = load('rides.json');
  const ride = rides.find(r => r.id === req.params.id);
  if (!ride) return res.status(404).json({ error: 'Ride not found.' });
  if (ride.riderId !== req.user.id) return res.status(403).json({ error: 'Not your listing.' });

  if (req.body.status === 'open' || req.body.status === 'closed') ride.status = req.body.status;
  if (req.body.seats) ride.seats = Math.max(1, Math.min(8, parseInt(req.body.seats) || ride.seats));
  save('rides.json', rides);
  res.json(ride);
});

app.delete('/api/rides/:id', requireAuth, (req, res) => {
  const rides = load('rides.json');
  const ride = rides.find(r => r.id === req.params.id);
  if (!ride) return res.status(404).json({ error: 'Ride not found.' });
  if (ride.riderId !== req.user.id) return res.status(403).json({ error: 'Not your listing.' });
  save('rides.json', rides.filter(r => r.id !== req.params.id));
  res.status(204).end();
});

// ---------------------------------------------------------------------
// conversations + messages (in-app chat, tied to a ride listing)
// ---------------------------------------------------------------------
app.get('/api/conversations', requireAuth, (req, res) => {
  const all = load('conversations.json');
  const mine = all.filter(c => c.riderId === req.user.id || c.consumerId === req.user.id);
  const users = load('users.json');
  const rides = load('rides.json');
  const enriched = mine.map(c => {
    const otherId = c.riderId === req.user.id ? c.consumerId : c.riderId;
    const other = users.find(u => u.id === otherId);
    const ride = rides.find(r => r.id === c.rideId);
    return {
      ...c,
      otherName: other ? other.name : 'Unknown',
      rideFrom: ride ? ride.from : '?',
      rideTo: ride ? ride.to : '?'
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
  res.json(enriched);
});

app.post('/api/conversations', requireAuth, (req, res) => {
  if (req.user.role !== 'consumer') {
    return res.status(403).json({ error: 'Only consumers can start a chat from a listing.' });
  }
  const { rideId } = req.body;
  const rides = load('rides.json');
  const ride = rides.find(r => r.id === rideId);
  if (!ride) return res.status(404).json({ error: 'Ride not found.' });

  const conversations = load('conversations.json');
  let convo = conversations.find(c => c.rideId === rideId && c.consumerId === req.user.id);
  if (!convo) {
    convo = {
      id: crypto.randomBytes(6).toString('hex'),
      rideId,
      riderId: ride.riderId,
      consumerId: req.user.id,
      createdAt: Date.now()
    };
    conversations.push(convo);
    save('conversations.json', conversations);
  }
  res.status(201).json(convo);
});

function requireConversationAccess(req, res, next) {
  const convo = load('conversations.json').find(c => c.id === req.params.id);
  if (!convo) return res.status(404).json({ error: 'Conversation not found.' });
  if (convo.riderId !== req.user.id && convo.consumerId !== req.user.id) {
    return res.status(403).json({ error: 'Not your conversation.' });
  }
  req.convo = convo;
  next();
}

app.get('/api/conversations/:id/messages', requireAuth, requireConversationAccess, (req, res) => {
  const msgs = load('messages.json')
    .filter(m => m.conversationId === req.params.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  res.json(msgs);
});

app.post('/api/conversations/:id/messages', requireAuth, requireConversationAccess, (req, res) => {
  const body = String(req.body.body || '').trim().slice(0, 1000);
  if (!body) return res.status(400).json({ error: 'Message cannot be empty.' });

  const msg = {
    id: crypto.randomBytes(6).toString('hex'),
    conversationId: req.params.id,
    senderId: req.user.id,
    body,
    createdAt: Date.now()
  };
  const messages = load('messages.json');
  messages.push(msg);
  save('messages.json', messages);
  res.status(201).json(msg);
});

app.listen(PORT, () => {
  console.log(`Saathi Sawaari running at http://localhost:${PORT}`);
});
