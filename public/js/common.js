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
    ${user ? `<button class="hamburger-btn" id="hamburgerBtn" aria-label="Menu"><span></span><span></span><span></span></button>` : `<div style="width:36px;"></div>`}
    <a class="brand brand-center" href="${brandHref}">कता हो?</a>
    ${user
      ? `<span class="nav-bell" id="navBell" style="display:none;">🔔<span class="nav-bell-count" id="navBellCount">0</span>
           <div class="notif-dropdown" id="notifDropdown"></div>
         </span>`
      : `<div class="nav-guest-links"><a href="/login.html">Log in</a><a href="/signup.html">Sign up</a></div>`}
  `;

  if (user) {
    buildSideMenu(user);
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    hamburgerBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSideMenu(); });

    const bell = document.getElementById('navBell');
    bell.addEventListener('click', (e) => { e.stopPropagation(); toggleNotifDropdown(); });
    document.addEventListener('click', () => { closeNotifDropdown(); });

    if (user.emailVerified === false) showVerifyBanner();
  } else {
    removeVerifyBanner();
  }
}

function showVerifyBanner() {
  if (document.getElementById('verifyBanner')) return;
  const nav = document.getElementById('nav');
  if (!nav || !nav.parentNode) return;
  const banner = document.createElement('div');
  banner.id = 'verifyBanner';
  banner.className = 'verify-banner';
  banner.innerHTML = `
    <span>Please verify your email to secure your account.</span>
    <button id="resendVerifyBtn">Resend email</button>
  `;
  nav.insertAdjacentElement('afterend', banner);
  document.getElementById('resendVerifyBtn').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await fetch('/api/resend-verification', { method: 'POST' });
      btn.textContent = 'Sent!';
    } catch (err) {
      btn.textContent = 'Failed — try again';
      btn.disabled = false;
    }
  });
}

function removeVerifyBanner() {
  const banner = document.getElementById('verifyBanner');
  if (banner) banner.remove();
}

// ---- hamburger side menu ---------------------------------------------
function buildSideMenu(user) {
  if (document.getElementById('sideMenuOverlay')) document.getElementById('sideMenuOverlay').remove();

  const isDriver = user.role === 'rider';
  const menuItems = isDriver
    ? [
        { label: 'Chats', tab: 'inbox', icon: '💬' },
        { label: 'Profile', tab: 'profile', icon: '👤' }
      ]
    : [
        { label: 'Fixed routes', tab: 'browse', icon: '🛣️' },
        { label: 'My requests', tab: 'requests', icon: '📋' },
        { label: 'Chats', tab: 'inbox', icon: '💬' },
        { label: 'Profile', tab: 'profile', icon: '👤' }
      ];

  const div = document.createElement('div');
  div.innerHTML = `
    <div id="sideMenuOverlay" class="side-menu-overlay">
      <div class="side-menu" id="sideMenu">
        <div class="side-menu-header">
          <div class="side-menu-user">
            ${avatarHtml(user.name, user.role, null, user.gender)}
            <div>
              <div class="side-menu-name">${esc(user.name)}</div>
              <div class="side-menu-role">${roleLabel(user.role)}</div>
            </div>
          </div>
          <button class="side-menu-close" id="sideMenuClose" aria-label="Close menu">✕</button>
        </div>
        <div class="side-menu-items">
          ${menuItems.map(item => `
            <button class="side-menu-item" data-tab="${item.tab}">
              <span class="side-menu-icon">${item.icon}</span> ${esc(item.label)}
            </button>
          `).join('')}
        </div>
        <div class="side-menu-footer">
          <button class="side-menu-item side-menu-logout" id="sideMenuLogout">
            <span class="side-menu-icon">🚪</span> Log out
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(div.firstElementChild);

  document.getElementById('sideMenuClose').addEventListener('click', closeSideMenu);
  document.getElementById('sideMenuOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'sideMenuOverlay') closeSideMenu();
  });
  document.getElementById('sideMenuLogout').addEventListener('click', logout);
  document.querySelectorAll('.side-menu-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabBtn = document.querySelector(`.pill[data-tab="${btn.dataset.tab}"]`);
      if (tabBtn) tabBtn.click();
      closeSideMenu();
    });
  });
}

function toggleSideMenu() {
  const overlay = document.getElementById('sideMenuOverlay');
  if (!overlay) return;
  if (overlay.classList.contains('open')) closeSideMenu();
  else openSideMenu();
}

function openSideMenu() {
  const overlay = document.getElementById('sideMenuOverlay');
  if (!overlay) return;
  overlay.classList.add('open');
  document.getElementById('hamburgerBtn').classList.add('active');
}

function closeSideMenu() {
  const overlay = document.getElementById('sideMenuOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  const btn = document.getElementById('hamburgerBtn');
  if (btn) btn.classList.remove('active');
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

// ---- notification store: each item is {id, text, tab, read} -------------
let notifications = [];

function addNotification(text, tab) {
  notifications.unshift({ id: 'n' + Date.now() + Math.random().toString(36).slice(2, 6), text, tab, read: false, at: Date.now() });
  if (notifications.length > 20) notifications = notifications.slice(0, 20);
  renderNotifBadgeAndList();
}

function renderNotifBadgeAndList() {
  const unreadCount = notifications.filter(n => !n.read).length;
  setNavBellCount(unreadCount);

  const dropdown = document.getElementById('notifDropdown');
  if (!dropdown) return;
  if (notifications.length === 0) {
    dropdown.innerHTML = `<div class="notif-empty">No notifications yet.</div>`;
    return;
  }
  dropdown.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}" data-tab="${esc(n.tab || '')}">
      ${esc(n.text)}
    </div>
  `).join('');
  dropdown.querySelectorAll('.notif-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const notif = notifications.find(x => x.id === el.dataset.id);
      if (notif) notif.read = true;
      if (el.dataset.tab) {
        const tabBtn = document.querySelector(`.pill[data-tab="${el.dataset.tab}"]`);
        if (tabBtn) tabBtn.click();
      }
      closeNotifDropdown();
      renderNotifBadgeAndList();
    });
  });
}

function toggleNotifDropdown() {
  const dropdown = document.getElementById('notifDropdown');
  if (!dropdown) return;
  const isOpen = dropdown.classList.contains('show');
  if (isOpen) {
    closeNotifDropdown();
  } else {
    renderNotifBadgeAndList();
    dropdown.classList.add('show');
  }
}

function closeNotifDropdown() {
  const dropdown = document.getElementById('notifDropdown');
  if (dropdown) dropdown.classList.remove('show');
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : s;
  return d.innerHTML;
}

// role: 'rider' (driver) or 'consumer' (passenger). Drivers always show a
// car icon (marigold background). Passengers show a gendered emoji based on
// their profile gender — falls back to a neutral person icon if unspecified.
function avatarHtml(name, role, size, gender) {
  let icon;
  if (role === 'rider') {
    icon = '🚗';
  } else if (gender === 'male') {
    icon = '👱\u200d♂️';
  } else if (gender === 'female') {
    icon = '💁\u200d♀️';
  } else {
    icon = '👤';
  }
  const cls = role === 'rider' ? 'avatar-driver' : 'avatar-passenger';
  const sizeCls = size === 'sm' ? 'avatar-sm' : '';
  return `<span class="avatar ${cls} ${sizeCls}">${icon}</span>`;
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
        <div class="chat-header-top">
          <span id="chatAvatar"></span>
          <div style="flex:1; min-width:0;">
            <h2 id="chatWithName" style="margin:0;">Chat</h2>
            <span class="role-tag" id="chatRoleTag"></span>
          </div>
          <button class="chat-more-btn" id="chatMoreBtn" aria-label="More options">⋯</button>
          <div class="chat-more-menu" id="chatMoreMenu">
            <button id="chatCompleteBtn">✓ Ride done — delete chat</button>
          </div>
        </div>
        <div class="chat-route-badge" id="chatRouteBadge"></div>
        <div class="contact-line" id="chatContact" style="display:none;"></div>
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
  document.getElementById('chatMoreBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('chatMoreMenu').classList.toggle('show');
  });
  document.addEventListener('click', () => {
    const menu = document.getElementById('chatMoreMenu');
    if (menu) menu.classList.remove('show');
  });
  document.getElementById('chatCompleteBtn').addEventListener('click', async () => {
    if (!confirm('Delete this chat for both of you? This cannot be undone.')) return;
    await archiveConversation(chatState.conversationId);
    closeChat();
    if (typeof onChatArchived === 'function') onChatArchived();
  });
}

async function archiveConversation(conversationId) {
  try {
    await fetch(`/api/conversations/${conversationId}/archive`, { method: 'POST' });
  } catch (e) { /* silent */ }
}

async function openChat(conversationId, myId, withName, rideFrom, rideTo, otherContact, otherRole, otherGender) {
  ensureChatModal();
  chatState.conversationId = conversationId;
  chatState.myId = myId;
  chatState.otherRole = otherRole || null;
  document.getElementById('chatWithName').textContent = withName;
  document.getElementById('chatAvatar').innerHTML = otherRole ? avatarHtml(withName, otherRole, null, otherGender) : '';
  document.getElementById('chatRoleTag').textContent = otherRole ? roleLabel(otherRole) : '';
  document.getElementById('chatRoleTag').className = 'role-tag ' + (otherRole === 'rider' ? 'role-driver' : 'role-passenger');
  const contactEl = document.getElementById('chatContact');
  if (otherContact) {
    contactEl.innerHTML = `<a href="tel:${esc(otherContact)}">${esc(otherContact)}</a>`;
    contactEl.style.display = 'block';
  } else {
    contactEl.style.display = 'none';
  }
  document.getElementById('chatRouteBadge').innerHTML = `<span class="route-pt from">${esc(rideFrom)}</span><span class="route-arrow">→</span><span class="route-pt to">${esc(rideTo)}</span>`;
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

    let lastDateLabel = null;
    el.innerHTML = msgs.map(m => {
      const d = new Date(m.createdAt);
      const dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      const timeLabel = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      let separator = '';
      if (dateLabel !== lastDateLabel) {
        separator = `<div class="chat-date-sep"><span>${esc(dateLabel)}</span></div>`;
        lastDateLabel = dateLabel;
      }
      return separator + `
        <div class="msg ${m.senderId === chatState.myId ? 'mine' : 'theirs'}">
          <div class="msg-body">${esc(m.body)}</div>
          <div class="msg-time">${timeLabel}</div>
        </div>
      `;
    }).join('');
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

// ---- push notifications ---------------------------------------------
// Real phone/OS-level notifications with sound, delivered even when the
// tab or browser is closed. Requires the person to tap "Enable
// notifications" once (browsers require a user gesture + explicit
// permission — this can't be turned on silently). The service worker
// itself, though, registers automatically on every page load (harmless,
// and keeps it ready/updated so already-subscribed users keep getting
// push reliably in the background without needing to click anything again).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* silent */ });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

async function getPushSubscriptionStatus() {
  if (!(await pushSupported())) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return 'not-subscribed';
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'not-subscribed';
  } catch (e) {
    return 'not-subscribed';
  }
}

async function enablePushNotifications() {
  if (!(await pushSupported())) {
    showToast("Push notifications aren't supported on this browser.");
    return false;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Notifications were not enabled.');
      return false;
    }
    const keyRes = await fetch('/api/push/vapid-public-key');
    const { key } = await keyRes.json();
    if (!key) {
      showToast('Push notifications are not configured yet.');
      return false;
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key)
    });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub)
    });
    showToast('Notifications enabled!', 'success');
    return true;
  } catch (e) {
    showToast('Could not enable notifications.');
    return false;
  }
}
