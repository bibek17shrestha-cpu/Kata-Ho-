let me = null;
let allDrivers = [];
let allRides = [];
let myRequests = [];
let myConvos = [];
let seenRequestStatuses = {};
let seenConvoMessageCounts = {};

(async function init() {
  me = await getMe();
  renderNav(me);
  if (!me) { window.location.href = '/login.html'; return; }
  if (me.role !== 'consumer') { window.location.href = '/rider.html'; return; }
  document.getElementById('pName').value = me.name;
  document.getElementById('pContact').value = me.contact || '';
  document.getElementById('pGender').value = me.gender || 'unspecified';
  await loadDrivers();
  await loadRides();
  await loadMyRequests();
  await loadInbox();
  // seed "seen" state so we only notify on changes *after* first load
  myRequests.forEach(r => { seenRequestStatuses[r.id] = r.status; });
  await primeSeenMessageCounts();
  setInterval(pollForUpdates, 5000);

  const notifBtn = document.getElementById('enableNotifBtn');
  const status = await getPushSubscriptionStatus();
  if (status === 'subscribed') { notifBtn.textContent = '🔔 Notifications on'; notifBtn.disabled = true; }
  else if (status === 'unsupported') { notifBtn.style.display = 'none'; }
  notifBtn.addEventListener('click', async () => {
    const ok = await enablePushNotifications();
    if (ok) { notifBtn.textContent = '🔔 Notifications on'; notifBtn.disabled = true; }
  });
})();

async function primeSeenMessageCounts() {
  for (const c of myConvos) {
    try {
      const res = await fetch(`/api/conversations/${c.id}/messages`);
      const msgs = await res.json();
      seenConvoMessageCounts[c.id] = msgs.length;
    } catch (e) { /* ignore */ }
  }
}

async function pollForUpdates() {
  let notifCount = 0;

  try {
    const res = await fetch('/api/my-ride-requests');
    const fresh = await res.json();
    fresh.forEach(r => {
      const prevStatus = seenRequestStatuses[r.id];
      if (prevStatus && prevStatus !== r.status) {
        if (r.status === 'accepted') showToast(`Your ride request was accepted! ${r.from} → ${r.to}`, 'success');
        else if (r.status === 'declined') showToast(`A driver declined your request: ${r.from} → ${r.to}`);
      }
      seenRequestStatuses[r.id] = r.status;
      if (r.status === 'accepted') notifCount++;
    });
    myRequests = fresh;
    if (document.getElementById('requestsPane').style.display !== 'none') renderMyRequests();
  } catch (e) { /* silent */ }

  try {
    const res = await fetch('/api/conversations');
    const fresh = await res.json();
    for (const c of fresh) {
      try {
        const msgRes = await fetch(`/api/conversations/${c.id}/messages`);
        const msgs = await msgRes.json();
        const prevCount = seenConvoMessageCounts[c.id] ?? msgs.length;
        if (msgs.length > prevCount) {
          const last = msgs[msgs.length - 1];
          if (last.senderId !== me.id) {
            showToast(`New message from ${c.otherName}`);
            notifCount++;
          }
        }
        seenConvoMessageCounts[c.id] = msgs.length;
      } catch (e) { /* ignore this convo */ }
    }
    myConvos = fresh;
    if (document.getElementById('inboxPane').style.display !== 'none') {
      if (!document.getElementById('chatOverlay') || document.getElementById('chatOverlay').style.display !== 'flex') {
        renderInboxList();
      }
    }
  } catch (e) { /* silent */ }

  setNavBellCount(notifCount);
}

document.querySelectorAll('.pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('driversPane').style.display = tab === 'drivers' ? 'block' : 'none';
    document.getElementById('browsePane').style.display = tab === 'browse' ? 'block' : 'none';
    document.getElementById('requestsPane').style.display = tab === 'requests' ? 'block' : 'none';
    document.getElementById('inboxPane').style.display = tab === 'inbox' ? 'block' : 'none';
    document.getElementById('profilePane').style.display = tab === 'profile' ? 'block' : 'none';
  });
});

// --- profile (name + contact) ---
document.getElementById('saveProfile').addEventListener('click', async () => {
  const name = document.getElementById('pName').value.trim();
  const contact = document.getElementById('pContact').value.trim();
  const gender = document.getElementById('pGender').value;
  const errEl = document.getElementById('profileErr');
  const okEl = document.getElementById('profileOk');
  errEl.textContent = ''; okEl.style.display = 'none';

  if (!name || !contact) { errEl.textContent = 'Name and contact are required.'; return; }

  const btn = document.getElementById('saveProfile');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch('/api/profile', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, contact, gender })
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
        <div style="display:flex; align-items:center; gap:10px;">
          ${avatarHtml(d.name, 'rider')}
          <span class="rider-name">${esc(d.name)}</span>
        </div>
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
          ${r.status === 'declined' || r.status === 'cancelled' || r.status === 'completed' ? `<button class="btn-secondary" data-action="clear" data-id="${r.id}">Clear</button>` : ''}
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
  } else if (btn.dataset.action === 'clear') {
    try {
      const res = await fetch('/api/ride-requests/' + id, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const data = await res.json();
        throw new Error(data.error || 'Could not clear this request.');
      }
      myRequests = myRequests.filter(r => r.id !== id);
      renderMyRequests();
    } catch (err) {
      alert(err.message);
    }
  } else if (btn.dataset.action === 'chat-request') {
    try {
      const res = await fetch('/api/conversations/from-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: id })
      });
      const convo = await res.json();
      if (!res.ok) throw new Error(convo.error);
      openChat(convo.id, me.id, convo.otherName, convo.rideFrom, convo.rideTo, convo.otherContact, convo.otherRole, convo.otherGender);
      loadInbox();
    } catch (err) {
      alert(err.message || 'Could not open chat.');
    }
  }
});

// --- fixed routes ---
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
    openChat(convo.id, me.id, btn.dataset.rider, btn.dataset.from, btn.dataset.to, convo.otherContact, convo.otherRole, convo.otherGender);
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
    renderInboxList();
  } catch (e) {
    pane.innerHTML = `<div class="empty">Couldn't load your chats.</div>`;
  }
}

function renderInboxList() {
  const pane = document.getElementById('inboxPane');
  if (myConvos.length === 0) {
    pane.innerHTML = `<div class="empty">No conversations yet.</div>`;
    return;
  }
  pane.innerHTML = myConvos.map(c => `
    <div class="convo-row" data-id="${c.id}" data-name="${esc(c.otherName)}" data-from="${esc(c.rideFrom)}" data-to="${esc(c.rideTo)}" data-contact="${esc(c.otherContact || '')}" data-role="${esc(c.otherRole || '')}" data-gender="${esc(c.otherGender || '')}">
      ${avatarHtml(c.otherName, c.otherRole, null, c.otherGender)}
      <div style="flex:1; min-width:0;">
        <div class="convo-route-main">${esc(c.rideFrom)} <span class="route-arrow">→</span> ${esc(c.rideTo)}</div>
        <div class="convo-name">${esc(c.otherName)} <span class="role-tag ${c.otherRole === 'rider' ? 'role-driver' : 'role-passenger'}">${roleLabel(c.otherRole)}</span></div>
      </div>
      ${c.unreadCount > 0 ? `<span class="unread-badge">${c.unreadCount > 9 ? '9+' : c.unreadCount}</span>` : ''}
      <button class="convo-clear-btn" data-clear-id="${c.id}" title="Clear this chat" aria-label="Clear this chat">✕</button>
    </div>
  `).join('');
  pane.querySelectorAll('.convo-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.convo-clear-btn')) return;
      openChat(row.dataset.id, me.id, row.dataset.name, row.dataset.from, row.dataset.to, row.dataset.contact, row.dataset.role, row.dataset.gender);
    });
  });
  pane.querySelectorAll('.convo-clear-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Clear this chat from your inbox?')) return;
      await archiveConversation(btn.dataset.clearId);
      await loadInbox();
    });
  });
}

// Called by the shared chat modal after "Ride done — clear chat" is used.
function onChatArchived() {
  loadInbox();
}
