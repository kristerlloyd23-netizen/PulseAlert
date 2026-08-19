let token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let socket = null;
let notifications = [];

const API = '/api';

// ---------- Init ----------
if (token && currentUser) {
  showApp();
} else {
  showAuth();
}

function showAuth() {
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('appScreen').classList.add('hidden');
}

function showApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  document.getElementById('currentUsername').textContent = currentUser.username;
  connectSocket();
  loadPosts();
  loadNotifications();
  setupPush();
}

function showSignup() {
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('signupForm').classList.remove('hidden');
  hideAuthError();
}
function showLogin() {
  document.getElementById('signupForm').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
  hideAuthError();
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideAuthError() {
  document.getElementById('authError').classList.add('hidden');
}

// ---------- Auth ----------
async function handleSignup() {
  const username = document.getElementById('signupUsername').value.trim();
  const password = document.getElementById('signupPassword').value;
  try {
    const res = await fetch(`${API}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error);
    loginSuccess(data);
  } catch (err) {
    showAuthError('Could not reach server');
  }
}

async function handleLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error);
    loginSuccess(data);
  } catch (err) {
    showAuthError('Could not reach server');
  }
}

function loginSuccess(data) {
  hideAuthError();
  token = data.token;
  currentUser = data.user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(currentUser));
  showApp();
}

function handleLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  if (socket) socket.disconnect();
  token = null;
  currentUser = null;
  notifications = [];
  showAuth();
}

// ---------- Socket.IO ----------
function connectSocket() {
  socket = io({ auth: { token } });

  socket.on('connect', () => console.log('Connected to real-time server'));

  socket.on('notification', (notif) => {
    notifications.unshift(notif);
    renderNotifications();
    showToast(notif.message);
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error:', err.message);
  });
}

// ---------- API helper ----------
async function apiCall(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    handleLogout();
    throw new Error('Session expired');
  }
  return res.json();
}

// ---------- Posts ----------
async function loadPosts() {
  const posts = await apiCall('/posts');
  renderPosts(posts);
}

async function handleCreatePost() {
  const contentEl = document.getElementById('postContent');
  const content = contentEl.value.trim();
  if (!content) return;
  await apiCall('/posts', { method: 'POST', body: JSON.stringify({ content }) });
  contentEl.value = '';
  loadPosts();
}

async function handleComment(postId) {
  const input = document.getElementById(`comment-input-${postId}`);
  const content = input.value.trim();
  if (!content) return;
  await apiCall(`/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ content }) });
  input.value = '';
  loadPosts();
}

function renderPosts(posts) {
  const el = document.getElementById('postsList');
  el.innerHTML = posts.map(post => `
    <div class="post">
      <div class="post-header"><strong>${escapeHtml(post.username)}</strong> <span class="time">${timeAgo(post.createdAt)}</span></div>
      <div class="post-content">${escapeHtml(post.content)}</div>
      <div class="comments">
        ${post.comments.map(c => `
          <div class="comment"><strong>${escapeHtml(c.username)}:</strong> ${escapeHtml(c.content)}</div>
        `).join('')}
      </div>
      <div class="comment-form">
        <input id="comment-input-${post.id}" placeholder="Write a comment..." onkeydown="if(event.key==='Enter') handleComment('${post.id}')">
        <button onclick="handleComment('${post.id}')">Reply</button>
      </div>
    </div>
  `).join('') || '<p class="empty">No posts yet. Be the first!</p>';
}

// ---------- Notifications ----------
async function loadNotifications() {
  notifications = await apiCall('/notifications');
  renderNotifications();
}

function renderNotifications() {
  const unread = notifications.filter(n => !n.read).length;
  const badge = document.getElementById('badge');
  if (unread > 0) {
    badge.textContent = unread;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  const list = document.getElementById('notifList');
  list.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markRead('${n.id}')">
      <div>${escapeHtml(n.message)}</div>
      <div class="time">${timeAgo(n.createdAt)}</div>
    </div>
  `).join('') || '<p class="empty">No notifications yet</p>';
}

function toggleNotifications() {
  document.getElementById('notifDropdown').classList.toggle('hidden');
}

async function markRead(id) {
  await apiCall(`/notifications/${id}/read`, { method: 'POST' });
  const notif = notifications.find(n => n.id === id);
  if (notif) notif.read = true;
  renderNotifications();
}

async function markAllRead() {
  await apiCall('/notifications/read-all', { method: 'POST' });
  notifications.forEach(n => (n.read = true));
  renderNotifications();
}

// ---------- Toast ----------
function showToast(message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = `🔔 ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ---------- Helpers ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------- PWA: service worker + push notifications ----------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function setupPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Push notifications not supported in this browser');
    return;
  }

  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.error('Service worker registration failed:', err);
    return;
  }

  // Show the "Enable push" button unless the user already granted/denied permission
  const btn = document.getElementById('enablePushBtn');
  if (Notification.permission === 'default') {
    btn.classList.remove('hidden');
  } else if (Notification.permission === 'granted') {
    subscribeToPush();
  }
}

async function enablePush() {
  const permission = await Notification.requestPermission();
  document.getElementById('enablePushBtn').classList.add('hidden');
  if (permission === 'granted') {
    subscribeToPush();
  }
}

async function subscribeToPush() {
  try {
    const { publicKey } = await apiCall('/push/vapid-public-key');
    if (!publicKey) {
      console.log('Server has no VAPID keys configured yet — push disabled (see README).');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await apiCall('/push/subscribe', { method: 'POST', body: JSON.stringify(subscription) });
    console.log('Subscribed to push notifications');
  } catch (err) {
    console.error('Push subscription failed:', err);
  }
}

// Close notification dropdown when clicking outside of it
document.addEventListener('click', (e) => {
  const wrapper = document.querySelector('.bell-wrapper');
  const dropdown = document.getElementById('notifDropdown');
  if (wrapper && dropdown && !wrapper.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});
