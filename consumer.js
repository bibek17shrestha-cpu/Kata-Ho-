let me = null;
let allRides = [];
let myConvos = [];

(async function init() {
  me = await getMe();
  renderNav(me);
  if (!me) { window.location.href = '/login.html'; return; }
  if (me.role !== 'consumer') { window.location.href = '/rider.html'; return; }
  await loadRides();
  await loadInbox();
})();

document.querySelectorAll('.pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('browsePane').style.display = tab === 'browse' ? 'block' : 'none';
    document.getElementById('inboxPane').style.display = tab === 'inbox' ? 'block' : 'none';
  });
});

document.getElementById('searchBox').addEventListener('input', renderRides);

async function loadRides() {
  const pane = document.getElementById('browsePane');
  try {
    const res = await fetch('/api/rides');
    allRides = await res.json();
    renderRides();
  } catch (e) {
    pane.innerHTML = `<div class="empty">Couldn't load the riders. Try refreshing.</div>`;
  }
}

function renderRides() {
  const pane = document.getElementById('browsePane');
  const q = document.getElementById('searchBox').value.trim().toLowerCase();
  const filtered = allRides.filter(r =>
    !q || r.from.toLowerCase().includes(q) || r.to.toLowerCase().includes(q)
  );

  if (filtered.length === 0) {
    pane.innerHTML = `<div class="empty">${allRides.length === 0 ? 'No riders have posted availability yet.' : 'No matches for that search.'}</div>`;
    return;
  }

  pane.innerHTML = filtered.map(r => `
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
    openChat(convo.id, me.id, btn.dataset.rider, btn.dataset.from, btn.dataset.to);
    loadInbox();
  } catch (err) {
    alert(err.message);
  }
  btn.disabled = false; btn.textContent = 'Chat';
});

async function loadInbox() {
  const pane = document.getElementById('inboxPane');
  try {
    const res = await fetch('/api/conversations');
    myConvos = await res.json();
    if (myConvos.length === 0) {
      pane.innerHTML = `<div class="empty">No conversations yet. Tap "Chat" on a rider's listing to start one.</div>`;
      return;
    }
    pane.innerHTML = myConvos.map(c => `
      <div class="convo-row" data-id="${c.id}" data-name="${esc(c.otherName)}" data-from="${esc(c.rideFrom)}" data-to="${esc(c.rideTo)}">
        <div>
          <div class="convo-name">${esc(c.otherName)}</div>
          <div class="convo-route">${esc(c.rideFrom)} → ${esc(c.rideTo)}</div>
        </div>
        <span class="btn-secondary">Open chat</span>
      </div>
    `).join('');
    pane.querySelectorAll('.convo-row').forEach(row => {
      row.addEventListener('click', () => {
        openChat(row.dataset.id, me.id, row.dataset.name, row.dataset.from, row.dataset.to);
      });
    });
  } catch (e) {
    pane.innerHTML = `<div class="empty">Couldn't load your chats.</div>`;
  }
}
