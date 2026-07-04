let me = null;
let myRides = [];
let myConvos = [];
let activeTab = 'listings';

(async function init() {
  me = await getMe();
  renderNav(me);
  if (!me) { window.location.href = '/login.html'; return; }
  if (me.role !== 'rider') { window.location.href = '/consumer.html'; return; }
  await loadMyRides();
  await loadInbox();
})();

document.querySelectorAll('.pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    document.getElementById('listingsPane').style.display = activeTab === 'listings' ? 'block' : 'none';
    document.getElementById('inboxPane').style.display = activeTab === 'inbox' ? 'block' : 'none';
  });
});

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
    pane.innerHTML = `<div class="empty">You haven't posted any availability yet.</div>`;
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
      pane.innerHTML = `<div class="empty">No conversations yet. When someone chats about one of your rides, it'll show up here.</div>`;
      return;
    }
    pane.innerHTML = myConvos.map(c => `
      <div class="convo-row" data-id="${c.id}" data-name="${esc(c.otherName)}" data-from="${esc(c.rideFrom)}" data-to="${esc(c.rideTo)}" data-contact="${esc(c.otherContact || '')}">
        <div>
          <div class="convo-name">${esc(c.otherName)} ${c.status === 'pending' ? '<span class="status" style="margin-left:6px;">○ requested</span>' : '<span class="status" style="margin-left:6px; color:var(--marigold);">● accepted</span>'}</div>
          <div class="convo-route">${esc(c.rideFrom)} → ${esc(c.rideTo)}</div>
        </div>
        <div style="display:flex; gap:8px;">
          ${c.status === 'pending' ? `<button class="btn-primary" data-action="accept" data-id="${c.id}">Accept</button>` : ''}
          <span class="btn-secondary" data-action="open">Open chat</span>
        </div>
      </div>
    `).join('');
    pane.querySelectorAll('.convo-row').forEach(row => {
      row.addEventListener('click', async (e) => {
        const acceptBtn = e.target.closest('button[data-action="accept"]');
        if (acceptBtn) {
          acceptBtn.disabled = true; acceptBtn.textContent = 'Accepting…';
          try {
            await fetch(`/api/conversations/${acceptBtn.dataset.id}/accept`, { method: 'PATCH' });
            await loadInbox();
          } catch (err) { acceptBtn.disabled = false; acceptBtn.textContent = 'Accept'; }
          return;
        }
        const convo = myConvos.find(c => c.id === row.dataset.id);
        const showHint = convo && convo.status === 'pending';
        openChat(row.dataset.id, me.id, row.dataset.name, row.dataset.from, row.dataset.to, row.dataset.contact || null, showHint);
      });
    });
  } catch (e) {
    pane.innerHTML = `<div class="empty">Couldn't load your chats.</div>`;
  }
}

// --- post availability modal ---
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
