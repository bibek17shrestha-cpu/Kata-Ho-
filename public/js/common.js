// ---- auth helpers -------------------------------------------------------
async function getMe() {
  const res = await fetch('/api/me');
  const data = await res.json();
  return data.user;
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
}

function renderNav(user, activeBrandHref) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const brandHref = activeBrandHref || (user ? (user.role === 'rider' ? '/rider.html' : '/consumer.html') : '/');
  nav.innerHTML = `
    <a class="brand" href="${brandHref}">कता हो?</a>
    <div class="spacer"></div>
    ${user
      ? `<span class="user-pill">${esc(user.name)} · ${user.role === 'rider' ? 'driver' : 'passenger'}</span><button id="logoutBtn">Log out</button>`
      : `<a href="/login.html">Log in</a><a href="/signup.html">Sign up</a>`}
  `;
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : s;
  return d.innerHTML;
}

function fmtDate(dateStr, timeStr) {
  if (!dateStr) return 'Date TBD';
  const d = new Date(dateStr + 'T' + (timeStr || '00:00'));
  const dateOut = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeOut = timeStr ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  return timeOut ? dateOut + ' · ' + timeOut : dateOut;
}

function trailSvg() {
  return `<svg viewBox="0 0 200 14" preserveAspectRatio="none">
    <circle cx="4" cy="7" r="3" fill="#E8A33D"/>
    <line x1="4" y1="7" x2="196" y2="7" stroke="#E8A33D" stroke-width="1.3" stroke-dasharray="1 7" stroke-linecap="round" opacity="0.75"/>
    <circle cx="196" cy="7" r="3" fill="#3E7CB1"/>
  </svg>`;
}

// ---- shared chat modal ---------------------------------------------------
let chatPollTimer = null;
let chatState = { conversationId: null, myId: null };

function ensureChatModal() {
  if (document.getElementById('chatOverlay')) return;
  const div = document.createElement('div');
  div.innerHTML = `
  <div id="chatOverlay" class="overlay chat-modal" style="display:none;">
    <div class="modal">
      <div class="chat-header">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <h2 id="chatWithName">Chat</h2>
          <a id="chatCallBtn" class="btn-primary" style="display:none; text-decoration:none; white-space:nowrap;" href="#">📞 Call</a>
        </div>
        <div class="sub" id="chatRoute" style="margin:2px 0 0; font-size:13px;"></div>
        <div class="sub" id="chatCallHint" style="display:none; margin:6px 0 0; font-size:12px; color:#9FB0CC;">Waiting for the driver to accept before their number is shared.</div>
      </div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-input-row">
        <input id="chatInput" placeholder="Type a message…">
        <button class="btn-primary" id="chatSend">Send</button>
      </div>
      <button class="btn-secondary" id="chatClose" style="margin-top:12px;">Close</button>
    </div>
  </div>`;
  document.body.appendChild(div.firstElementChild);

  document.getElementById('chatClose').addEventListener('click', closeChat);
  document.getElementById('chatOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'chatOverlay') closeChat();
  });
  document.getElementById('chatSend').addEventListener('click', sendChatMessage);
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });
}

// otherContact: phone number string if available to reveal, or null/empty if not yet shared.
// showWaitingHint: true when this viewer is the driver and the passenger hasn't been accepted yet,
// so we can explain why there's no call button rather than just hiding it silently.
async function openChat(conversationId, myId, withName, rideFrom, rideTo, otherContact, showWaitingHint) {
  ensureChatModal();
  chatState.conversationId = conversationId;
  chatState.myId = myId;
  document.getElementById('chatWithName').textContent = 'Chat with ' + withName;
  document.getElementById('chatRoute').textContent = rideFrom + ' → ' + rideTo;

  const callBtn = document.getElementById('chatCallBtn');
  const hint = document.getElementById('chatCallHint');
  if (otherContact) {
    const digits = String(otherContact).replace(/[^\d+]/g, '');
    callBtn.href = 'tel:' + digits;
    callBtn.textContent = '📞 Call ' + withName;
    callBtn.style.display = 'inline-block';
    hint.style.display = 'none';
  } else {
    callBtn.style.display = 'none';
    hint.style.display = showWaitingHint ? 'block' : 'none';
  }

  document.getElementById('chatOverlay').style.display = 'flex';
  await loadChatMessages();
  clearInterval(chatPollTimer);
  chatPollTimer = setInterval(loadChatMessages, 4000);
}

function closeChat() {
  document.getElementById('chatOverlay').style.display = 'none';
  clearInterval(chatPollTimer);
}

async function loadChatMessages() {
  if (!chatState.conversationId) return;
  try {
    const res = await fetch(`/api/conversations/${chatState.conversationId}/messages`);
    if (!res.ok) return;
    const msgs = await res.json();
    const el = document.getElementById('chatMessages');
    if (msgs.length === 0) {
      el.innerHTML = `<div class="chat-empty">Say hello to start the conversation.</div>`;
      return;
    }
    const wasAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    el.innerHTML = msgs.map(m => `
      <div class="msg ${m.senderId === chatState.myId ? 'mine' : 'theirs'}">${esc(m.body)}</div>
    `).join('');
    if (wasAtBottom || el.dataset.first !== 'done') {
      el.scrollTop = el.scrollHeight;
      el.dataset.first = 'done';
    }
  } catch (e) { /* silent retry on next poll */ }
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const body = input.value.trim();
  if (!body || !chatState.conversationId) return;
  input.value = '';
  try {
    await fetch(`/api/conversations/${chatState.conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    });
    await loadChatMessages();
  } catch (e) {
    input.value = body;
  }
}
