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
      ? `<span class="nav-bell" id="navBell" style="display:none;">🔔<span class="nav-bell-count" id="navBellCount">0</span></span><span class="user-pill">${esc(user.name)} · ${user.role === 'rider' ? 'driver' : 'passenger'}</span><button id="logoutBtn">Log out</button>`
      : `<a href="/login.html">Log in</a><a href="/signup.html">Sign up</a>`}
  `;
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
}

function setNavBellCount(count) {
  const bell = document.getElementById('navBell');
  const countEl = document.getElementById('navBellCount');
  if (!bell || !countEl) return;
  if (count > 0) {
    countEl.textContent = count > 9 ? '9+' : String(count);
    bell.style.display = 'inline-flex';
  } else {
    bell.style.display = 'none';
  }
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : s;
  return d.innerHTML;
}

// role: 'rider' (driver) or 'consumer' (passenger). Drivers get marigold,
// passengers get sky-blue — a consistent color code used everywhere a
// person's identity appears (directory, inbox, chat).
function avatarHtml(name, role, size) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const cls = role === 'rider' ? 'avatar-driver' : 'avatar-passenger';
  const sizeCls = size === 'sm' ? 'avatar-sm' : '';
  return `<span class="avatar ${cls} ${sizeCls}">${esc(initial)}</span>`;
}

function roleLabel(role) {
  return role === 'rider' ? 'Driver' : 'Passenger';
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

// ---- toast notifications ---------------------------------------------
function ensureToastContainer() {
  if (document.getElementById('toastContainer')) return;
  const div = document.createElement('div');
  div.id = 'toastContainer';
  div.style.cssText = 'position:fixed; top:16px; right:16px; z-index:200; display:flex; flex-direction:column; gap:10px; max-width:320px;';
  document.body.appendChild(div);
}

function showToast(message, kind) {
  ensureToastContainer();
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast-item' + (kind ? ' toast-' + kind : '');
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// ---- shared chat modal ---------------------------------------------------
let chatPollTimer = null;
let chatState = { conversationId: null, myId: null, otherRole: null };

function ensureChatModal() {
  if (document.getElementById('chatOverlay')) return;
  const div = document.createElement('div');
  div.innerHTML = `
  <div id="chatOverlay" class="overlay chat-modal" style="display:none;">
    <div class="modal">
      <div class="chat-header">
        <div style="display:flex; align-items:center; gap:10px;">
          <span id="chatAvatar"></span>
          <div>
            <h2 id="chatWithName" style="margin:0;">Chat</h2>
            <span class="role-tag" id="chatRoleTag"></span>
          </div>
        </div>
        <div class="contact-line" id="chatContact" style="display:none;"></div>
        <div class="sub" id="chatRoute" style="margin:6px 0 0; font-size:13px;"></div>
      </div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-seen" id="chatSeenIndicator" style="display:none;">seen</div>
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

async function openChat(conversationId, myId, withName, rideFrom, rideTo, otherContact, otherRole) {
  ensureChatModal();
  chatState.conversationId = conversationId;
  chatState.myId = myId;
  chatState.otherRole = otherRole || null;
  document.getElementById('chatWithName').textContent = withName;
  document.getElementById('chatAvatar').innerHTML = otherRole ? avatarHtml(withName, otherRole) : '';
  document.getElementById('chatRoleTag').textContent = otherRole ? roleLabel(otherRole) : '';
  document.getElementById('chatRoleTag').className = 'role-tag ' + (otherRole === 'rider' ? 'role-driver' : 'role-passenger');
  const contactEl = document.getElementById('chatContact');
  if (otherContact) {
    contactEl.innerHTML = `<a href="tel:${esc(otherContact)}">${esc(otherContact)}</a>`;
    contactEl.style.display = 'block';
  } else {
    contactEl.style.display = 'none';
  }
  document.getElementById('chatRoute').textContent = rideFrom + ' → ' + rideTo;
  document.getElementById('chatOverlay').style.display = 'flex';
  await loadChatMessages();
  await markConversationRead(conversationId);
  clearInterval(chatPollTimer);
  chatPollTimer = setInterval(async () => {
    await loadChatMessages();
    await markConversationRead(conversationId);
  }, 4000);
}

function closeChat() {
  document.getElementById('chatOverlay').style.display = 'none';
  clearInterval(chatPollTimer);
  chatState = { conversationId: null, myId: null, otherRole: null };
}

async function markConversationRead(conversationId) {
  try {
    await fetch(`/api/conversations/${conversationId}/read`, { method: 'POST' });
  } catch (e) { /* silent */ }
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
      document.getElementById('chatSeenIndicator').style.display = 'none';
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

    // "seen" indicator: only meaningful if the last message was mine
    const lastMsg = msgs[msgs.length - 1];
    const seenEl = document.getElementById('chatSeenIndicator');
    try {
      const convoRes = await fetch('/api/conversations');
      const convos = await convoRes.json();
      const thisConvo = convos.find(c => c.id === chatState.conversationId);
      if (lastMsg.senderId === chatState.myId && thisConvo && thisConvo.seenByOther) {
        seenEl.style.display = 'block';
      } else {
        seenEl.style.display = 'none';
      }
    } catch (e) { seenEl.style.display = 'none'; }
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
