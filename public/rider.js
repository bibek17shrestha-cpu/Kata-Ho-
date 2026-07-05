let me = null;
let myRides = [];
let myConvos = [];
let incomingRequests = [];

(async function init() {
  me = await getMe();
  renderNav(me);
  if (!me) { window.location.href = '/login.html'; return; }
  if (me.role !== 'rider') { window.location.href = '/consumer.html'; return; }
  document.getElementById('pName').value = me.name;
  document.getElementById('pContact').value = me.contact || '';
  await loadDriverProfile();
  await loadIncomingRequests();
  await loadMyRides();
  await loadInbox();
})();

document.querySelectorAll('.pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('requestsPane').style.display = tab === 'requests' ? 'block' : 'none';
    document.getElementById('listingsPane').style.display = tab === 'listings' ? 'block' : 'none';
    document.getElementById('inboxPane').style.display = tab === 'inbox' ? 'block' : 'none';
    document.getElementById('profilePane').style.display = tab === 'profile' ? 'block' : 'none';
  });
});

// --- profile (name + contact) ---
document.getElementById('saveProfile').addEventListener('click', async () => {
  const name = document.getElementById('pName').value.trim();
  const contact = document.getElementById('pContact').value.trim();
  const errEl = document.getElementById('profileErr');
  const okEl = document.getElementById('profileOk');
  errEl.textContent = ''; okEl.style.display = 'none';

  if (!name || !contact) { errEl.textContent = 'Name and contact are required.'; return; }

  const btn = document.getElementById('saveProfile');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch('/api/profile', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, contact })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    me = data.user;
    renderNav(me);
    okEl.style.display = 'block';
    setTimeout(() => { okEl.style.display = 'none'; }, 2000);
  } catch (e) {
    errEl.textContent = e.message;
  }
  btn.disabled = false; btn.textContent = 'Save profile';
});

// --- availability + vehicle info ---
async function loadDriverProfile() {
  try {
    const res = await fetch('/api/driver-profile');
    const profile = await res.json();
    setAvailToggle(profile.isAvailable);
    document.getElementById('fVehicle').value = profile.vehicleInfo || '';
  } catch (e) { /* leave defaults */ }
}

function setAvailToggle(isAvailable) {
  const toggle = document.getElementById('availToggle');
  toggle.classList.toggle('on', isAvailable);
  toggle.setAttribute('aria-checked', String(isAvailable));
  document.getElementById('availHint').textContent = isAvailable
    ? 'On — passengers can see you and send requests'
    : "Off — passengers won't see you as available";
}

document.getElementById('availToggle').addEventListener('click', async () => {
  const toggle = document.getElementById('availToggle');
  const next = !toggle.classList.contains('on');
  setAvailToggle(next); // optimistic
  try {
    const res = await fetch('/api/driver-profile', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isAvailable: next })
    });
    if (!res.ok) throw new Error('failed');
  } catch (e) {
    setAvailToggle(!next); // revert on failure
    alert('Could not update availability. Please try again.');
  }
});

document.getElementById('saveVehicle').addEventListener('click', async () => {
  const btn = document.getElementById('saveVehicle');
  const savedMsg = document.getElementById('vehicleSavedMsg');
  const vehicleInfo = document.getElementById('fVehicle').value.trim();
  btn.disabled = true; btn.textContent = 'Saving…';
  savedMsg.style.display = 'none';
  try {
    const res = await fetch('/api/driver-profile', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicleInfo })
    });
    if (!res.ok) throw new Error('failed');
    savedMsg.style.display = 'block';
    setTimeout(() => { savedMsg.style.display = 'none'; }, 2000);
  } catch (e) {
    alert('Could not save vehicle info. Please try again.');
  }
  btn.disabled = false; btn.textContent = 'Save vehicle info';
});

// --- incoming ride requests (from passengers, "anywhere" rides) ---
async function loadIncomingRequests() {
  const pane = document.getElementById('requestsPane');
  try {
    const res = await fetch('/api/incoming-ride-requests');
    incomingRequests = await res.json();
    renderIncomingRequests();
  } catch (e) {
    pane.innerHTML = `<div class="empty">Couldn't load ride requests.</div>`;
  }
}

function renderIncomingRequests() {
  const pane = document.getElementById('requestsPane');
  if (incomingRequests.length === 0) {
    pane.innerHTML = `<div class="empty">No pending ride requests right now. Turn on availability so passengers can find you.</div>`;
    return;
  }
  pane.innerHTML = incomingRequests.map(r => `
    <div class="card">
      <div class="card-top">
        <span class="rider-name">${esc(r.consumerName)}</span>
        <span class="status">requested</span>
      </div>
      <div class="route">
        <div class="place">${esc(r.from)}</div>
        <div class="line">${trailSvg()}</div>
        <div class="place">${esc(r.to)}</div>
      </div>
      ${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}
      <div class="card-foot">
        <div class="actions">
          <button class="btn-primary" data-action="accept" data-id="${r.id}">Accept</button>
          <button class="btn-danger" data-action="decline" data-id="${r.id}">Decline</button>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('requestsPane').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  btn.disabled = true;
  try {
    const res = await fetch('/api/ride-requests/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: action === 'accept' ? 'accepted' : 'declined' })
    });
    const updated = await res.json();
    if (!res.ok) throw new Error(updated.error);

    if (action === 'accept') {
      const convoRes = await fetch('/api/conversations/from-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id })
      });
      const convo = await convoRes.json();
      if (convoRes.ok) {
        openChat(convo.id, me.id, convo.otherName, convo.rideFrom, convo.rideTo, convo.otherContact);
      }
    }
    await loadIncomingRequests();
    await loadInbox();
  } catch (err) {
    alert(err.message || 'Something went wrong.');
    btn.disabled = false;
  }
});

// --- fixed route listings ---
async function loadMyRides() {
  const pane = document.getElementById('listingsPane');
  try {
    const res = await fetch('/api/my-rides');
    myRides = await res.json();
    renderMyRides();
  } catch (e) {
    pane.innerHTML = `<div class="empty">Couldn't load your listings.</div>`;
  }
}

function renderMyRides() {
  const pane = document.getElementById('listingsPane');
  if (myRides.length === 0) {
    pane.innerHTML = `<div class="empty">You haven't posted a fixed route yet.</div>`;
    return;
  }
  pane.innerHTML = myRides.map(r => `
    <div class="card">
      <div class="card-top">
        <span class="rider-name">${r.seats} seat${r.seats == 1 ? '' : 's'} free</span>
        <span class="status ${r.status === 'closed' ? 'closed' : ''}">${r.status === 'closed' ? '● closed' : '○ open'}</span>
      </div>
      <div class="route">
        <div class="place">${esc(r.from)}</div>
        <div class="line">${trailSvg()}</div>
        <div class="place">${esc(r.to)}</div>
      </div>
      <div class="meta"><span>${fmtDate(r.date, r.time)}</span></div>
      ${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}
      <div class="card-foot">
        <div class="actions">
          <button class="btn-secondary" data-action="toggle" data-id="${r.id}">${r.status === 'closed' ? 'Reopen' : 'Mark closed'}</button>
          <button class="btn-danger" data-action="delete" data-id="${r.id}">Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('listingsPane').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const ride = myRides.find(r => r.id === id);
  if (btn.dataset.action === 'toggle') {
    const newStatus = ride.status === 'closed' ? 'open' : 'closed';
    await fetch('/api/rides/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    ride.status = newStatus;
    renderMyRides();
  } else if (btn.dataset.action === 'delete') {
    if (!confirm('Remove this listing?')) return;
    await fetch('/api/rides/' + id, { method: 'DELETE' });
    myRides = myRides.filter(r => r.id !== id);
    renderMyRides();
  }
});

async function loadInbox() {
  const pane = document.getElementById('inboxPane');
  try {
    const res = await fetch('/api/conversations');
    myConvos = await res.json();
    if (myConvos.length === 0) {
      pane.innerHTML = `<div class="empty">No conversations yet.</div>`;
      return;
    }
    pane.innerHTML = myConvos.map(c => `
      <div class="convo-row" data-id="${c.id}" data-name="${esc(c.otherName)}" data-from="${esc(c.rideFrom)}" data-to="${esc(c.rideTo)}" data-contact="${esc(c.otherContact || '')}">
        <div>
          <div class="convo-name">${esc(c.otherName)}</div>
          <div class="convo-route">${esc(c.rideFrom)} → ${esc(c.rideTo)}</div>
        </div>
        <span class="btn-secondary">Open chat</span>
      </div>
    `).join('');
    pane.querySelectorAll('.convo-row').forEach(row => {
      row.addEventListener('click', () => {
        openChat(row.dataset.id, me.id, row.dataset.name, row.dataset.from, row.dataset.to, row.dataset.contact);
      });
    });
  } catch (e) {
    pane.innerHTML = `<div class="empty">Couldn't load your chats.</div>`;
  }
}

// --- post a fixed route modal ---
document.getElementById('openPost').addEventListener('click', () => {
  document.getElementById('postOverlay').style.display = 'flex';
});
document.getElementById('cancelPost').addEventListener('click', () => {
  document.getElementById('postOverlay').style.display = 'none';
});
document.getElementById('postOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'postOverlay') document.getElementById('postOverlay').style.display = 'none';
});

document.getElementById('submitPost').addEventListener('click', async () => {
  const from = document.getElementById('fFrom').value.trim();
  const to = document.getElementById('fTo').value.trim();
  const date = document.getElementById('fDate').value;
  const time = document.getElementById('fTime').value;
  const seats = document.getElementById('fSeats').value;
  const note = document.getElementById('fNote').value.trim();
  const errEl = document.getElementById('formErr');
  errEl.textContent = '';

  if (!from || !to) { errEl.textContent = 'From and To are required.'; return; }

  const btn = document.getElementById('submitPost');
  btn.disabled = true; btn.textContent = 'Posting…';
  try {
    const res = await fetch('/api/rides', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, date, time, seats, note })
    });
    const ride = await res.json();
    if (!res.ok) throw new Error(ride.error || 'Something went wrong.');
    myRides.unshift(ride);
    renderMyRides();
    document.getElementById('postOverlay').style.display = 'none';
    ['fFrom','fTo','fDate','fTime','fNote'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('fSeats').value = 1;
  } catch (e) {
    errEl.textContent = e.message;
  }
  btn.disabled = false; btn.textContent = 'Post';
});
