require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');
const { Server } = require('socket.io');
const { ensureDataFiles, readData, writeData } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'capstone-demo-secret-change-me';
const PORT = process.env.PORT || 3000;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const pushEnabled = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails('mailto:capstone@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('VAPID keys not set — push notifications disabled. See README to enable them.');
}

ensureDataFiles();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

// Track which userId currently has active socket connections
const onlineUsers = new Map(); // userId -> Set of socketIds

// ---------- Auth helpers ----------
function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

// ---------- Auth routes ----------
app.post('/api/signup', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (username.trim().length < 3 || password.length < 4) {
      return res.status(400).json({ error: 'Username must be 3+ chars, password 4+ chars' });
    }

    const users = readData('users');
    const exists = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
    if (exists) return res.status(409).json({ error: 'Username already taken' });

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = {
      id: crypto.randomUUID(),
      username: username.trim(),
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    writeData('users', users);

    const token = generateToken(newUser);
    res.json({ token, user: { id: newUser.id, username: newUser.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during signup' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const users = readData('users');
    const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid username or password' });

    const token = generateToken(user);
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// ---------- Posts routes ----------
app.get('/api/posts', authenticateToken, (req, res) => {
  const posts = readData('posts').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(posts);
});

app.post('/api/posts', authenticateToken, (req, res) => {
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Post content required' });

  const posts = readData('posts');
  const newPost = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    username: req.user.username,
    content: content.trim(),
    comments: [],
    createdAt: new Date().toISOString(),
  };
  posts.push(newPost);
  writeData('posts', posts);
  res.json(newPost);
});

app.post('/api/posts/:id/comments', authenticateToken, (req, res) => {
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'Comment content required' });

  const posts = readData('posts');
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const comment = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    username: req.user.username,
    content: content.trim(),
    createdAt: new Date().toISOString(),
  };
  post.comments.push(comment);
  writeData('posts', posts);

  // Notify the post owner in real time, unless they're commenting on their own post
  if (post.userId !== req.user.id) {
    const notifications = readData('notifications');
    const notification = {
      id: crypto.randomUUID(),
      userId: post.userId,
      type: 'comment',
      message: `${req.user.username} commented on your post: "${content.trim().slice(0, 60)}"`,
      postId: post.id,
      fromUsername: req.user.username,
      read: false,
      createdAt: new Date().toISOString(),
    };
    notifications.push(notification);
    writeData('notifications', notifications);

    // In-tab instant push if the recipient's app is open
    io.to(`user:${post.userId}`).emit('notification', notification);

    // OS-level push notification, works even if the app/tab is closed
    sendPushToUser(post.userId, {
      title: 'PulseAlert',
      body: notification.message,
      url: '/',
    });
  }

  res.json(post);
});

// ---------- Push notification routes ----------
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: pushEnabled ? VAPID_PUBLIC_KEY : null });
});

app.post('/api/push/subscribe', authenticateToken, (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }

  const subs = readData('pushSubscriptions');
  const filtered = subs.filter(
    s => !(s.userId === req.user.id && s.endpoint === subscription.endpoint)
  );
  filtered.push({ userId: req.user.id, ...subscription });
  writeData('pushSubscriptions', filtered);
  res.json({ success: true });
});

app.post('/api/push/unsubscribe', authenticateToken, (req, res) => {
  const { endpoint } = req.body || {};
  const subs = readData('pushSubscriptions');
  const filtered = subs.filter(s => !(s.userId === req.user.id && s.endpoint === endpoint));
  writeData('pushSubscriptions', filtered);
  res.json({ success: true });
});

function sendPushToUser(userId, payload) {
  if (!pushEnabled) return;
  const subs = readData('pushSubscriptions').filter(s => s.userId === userId);
  if (subs.length === 0) return;

  let dirty = false;
  const remaining = [];
  subs.forEach((sub) => {
    webpush.sendNotification(sub, JSON.stringify(payload)).catch((err) => {
      // 410/404 means the subscription is stale/expired - drop it
      if (err.statusCode === 410 || err.statusCode === 404) {
        dirty = true;
      } else {
        console.error('Push send error:', err.message);
      }
    });
    remaining.push(sub);
  });

  if (dirty) {
    const all = readData('pushSubscriptions').filter(s => s.userId !== userId);
    writeData('pushSubscriptions', [...all, ...remaining]);
  }
}

// ---------- Notifications routes ----------
app.get('/api/notifications', authenticateToken, (req, res) => {
  const notifications = readData('notifications')
    .filter(n => n.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(notifications);
});

app.post('/api/notifications/:id/read', authenticateToken, (req, res) => {
  const notifications = readData('notifications');
  const notif = notifications.find(n => n.id === req.params.id && n.userId === req.user.id);
  if (!notif) return res.status(404).json({ error: 'Notification not found' });
  notif.read = true;
  writeData('notifications', notifications);
  res.json(notif);
});

app.post('/api/notifications/read-all', authenticateToken, (req, res) => {
  const notifications = readData('notifications');
  notifications.forEach(n => {
    if (n.userId === req.user.id) n.read = true;
  });
  writeData('notifications', notifications);
  res.json({ success: true });
});

// ---------- Socket.IO real-time layer ----------
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error('Invalid token'));
    socket.user = user;
    next();
  });
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  console.log(`Socket connected: ${socket.user.username} (${socket.id})`);

  socket.join(`user:${userId}`);

  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socket.id);

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.user.username} (${socket.id})`);
    const sockets = onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) onlineUsers.delete(userId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`PulseAlert server running at http://localhost:${PORT}`);
});
