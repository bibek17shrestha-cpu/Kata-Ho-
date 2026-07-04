let me = null;
let allDrivers = [];
let allRides = [];
let myRequests = [];
let myConvos = [];

(async function init() {
  me = await getMe();
  renderNav(me);
  if (!me) { window.location.href = '/login.html'; return; }
  if (me.role !== 'consumer') { window.location.href = '/rider.html'; return; }
  await loadDrivers();
  await loadRides();
  await loadMyRequests();
  await loadInbox();
})();

document.querySelectorAll('.pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('driversPane').style.display = tab === 'drivers' ? 'block' : 'none';
    document.getElementById('browsePane').style.display = tab === 'browse' ? 'block' : 'none';
    document.getElementById('requestsPane').style.display = tab === 'requests' ? 'block' : 'none';
    document.getElementById('inboxPane').style.display = tab === 'inbox' ? 'block' : 'none';
  });
});

// --- driver directory: every driver, available or not, passenger picks ---
async function loadDrivers() {
  try {
    const res = await fetch('/api/drivers');
    allDrivers = await res.json();
    renderDrivers();
  } catch (e) {
    document.getElementById('driversList').innerHTML = `<div class="empty">Couldn't load drivers.</div>`;
  }
  document.getElementById('driversLoading').style.display = 'none';
}

function renderDrivers() {
  const list = document.getElementById('driversList');
  if (allDrivers.length === 0) {
    list.innerHTML = `<div class="empty">No drivers have signed up yet.</div>`;
    return;
  }
  list.innerHTML = allDrivers.map(d => `
    <div class="card">
      <div class="card-top">
        <span class="rider-name">${esc(d.name)}</span>
        <span class="status ${d.isAvailable ? 'avail' : 'closed'}">${d.isAvailable ? '● available' : '○ not available'}</span>
      </div>
      ${d.contact ? `<div class="contact-line"><a href="tel:${esc(d.contact)}">${esc(d.contact)}</a></div>` : ''}
      ${d.vehicleInfo ? `<div class="note">${esc(d.vehicleInfo)}</div>` : ''}
      <div class="card-foot">
        <div class="actions">
          <button class="btn-primary" data-action="request-driver" data-id="${d.id}" data-name="${esc(d.name)}">Request this driver</button>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('driversList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action="request-driver"]');
  if (!btn) return;
  const from = document.getElementById('rFrom').value.trim();
  const to = document.getElementById('rTo').value.trim();
  if (!from || !to) {
    document.getElementById('reqErr').textContent = 'Fill in From and To above first, then pick a driver.';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  sendRideRequest({ driverId: btn.dataset.id });
});

document.getElementById('sendOpenRequest').addEventListener('click', () => {
  sendRideRequest({ driverId: null });
});

async function sendRideRequest({ driverId }) {
  const from = document.getElementById('rFrom').value.trim();
  const to = document.getElementById('rTo').value.trim();
  const note = document.getElementById('rNote').value.trim();
  const errEl = document.getElementById('reqErr');
  errEl.textContent = '';

  if (!from || !to) { errEl.textContent = 'From and To are required.'; return; }

  try {
    const res = await fetch('/api/ride-requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, note, driverId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    myRequests.unshift(data);
    document.getElementById('rFrom').value = '';
    document.getElementById('rTo').value = '';
    document.getElementById('rNote').value = '';
    renderMyRequests();
    // switch to "My requests" tab so they can see it went through
    document.querySelector('.pill[data-tab="requests"]').click();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

// --- my ride requests ---
async function loadMyRequests() {
  const pane = document.getElementById('requestsPane');
  try {
    const res = await fetch('/api/my-ride-requests');
    myRequests = await res.json();
    renderMyRequests();
  } catch (e) {
    pane.innerHTML = `<div class="empty">Couldn't load your requests.</div>`;
  }
}

function renderMyRequests() {
  const pane = document.getElementById('requestsPane');
  if (myRequests.length === 0) {
    pane.innerHTML = `<div class="empty">You haven't sent any ride requests yet.</div>`;
    return;
  }
  pane.innerHTML = myRequests.map(r => `
    <div class="card">
      <div class="card-top">
        <span class="rider-name">${r.driverId ? 'Sent to a specific driver' : 'Open to any driver'}</span>
        <span class="status ${r.status === 'accepted' ? 'avail' : r.status === 'declined' || r.status === 'cancelled' ? 'closed' : ''}">${r.status}</span>
      </div>
      <div class="route">
        <div class="place">${esc(r.from)}</div>
        <div class="line">${trailSvg()}</div>
        <div class="place">${esc(r.to)}</div>
      </div>
      ${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}
      <div class="card-foot">
        <div class="actions">
          ${r.status === 'accepted' ? `<button class="btn-primary" data-action="chat-request" data-id="${r.id}">Open chat</button>` : ''}
          ${r.status === 'pending' ? `<button class="btn-danger" data-action="cancel" data-id="${r.id}">Cancel</button>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('requestsPane').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'cancel') {
    await fetch('/api/ride-requests/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    });
    await loadMyRequests();
  } else if (btn.dataset.action === 'chat-request') {
    try {
      const res = await fetch('/api/conversations/from-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id })
      });
      const convo = await res.json();
      if (!res.ok) throw new Error(convo.error);
      openChat(convo.id, me.id, convo.otherName, convo.rideFrom, convo.rideTo, convo.otherContact);
      loadInbox();
    } catch (err) {
      alert(err.message || 'Could not open chat.');
    }
  }
});

// --- fixed routes (unchanged) ---
async function loadRides() {
  const pane = document.getElementById('browsePane');
  try {
    const res = await fetch('/api/rides');
    allRides = await res.json();
    renderRides();
  } catch (e) {
    pane.innerHTML = `<div class="empty">Couldn't load fixed routes.</div>`;
  }
}

function renderRides() {
  const pane = document.getElementById('browsePane');
  if (allRides.length === 0) {
    pane.innerHTML = `<div class="empty">No fixed routes posted yet.</div>`;
    return;
  }
  pane.innerHTML = allRides.map(r => `
    <div class="card">
      <div class="card-top">
        <span class="rider-name">${esc(r.riderName)}</span>
        <span class="status">${r.seats} seat${r.seats == 1 ? '' : 's'} free</span>
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
          <button class="btn-primary" data-action="chat" data-id="${r.id}" data-rider="${esc(r.riderName)}" data-from="${esc(r.from)}" data-to="${esc(r.to)}">Chat</button>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('browsePane').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action="chat"]');
  if (!btn) return;
  btn.disabled = true; btn.textContent = 'Opening…';
  try {
    const res = await fetch('/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rideId: btn.dataset.id })
    });
    const convo = await res.json();
    if (!res.ok) throw new Error(convo.error || 'Could not start chat.');
    openChat(convo.id, me.id, btn.dataset.rider, btn.dataset.from, btn.dataset.to, convo.otherContact);
    loadInbox();
  } catch (err) {
    alert(err.message);
  }
  btn.disabled = false; btn.textContent = 'Chat';
});

// --- inbox ---
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
