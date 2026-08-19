const CACHE_NAME = 'pulsealert-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Cache the basic app shell so the UI still loads offline
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for API calls, cache-first for static app shell
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
    return; // let these hit the network normally
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// This is what makes notifications appear even when the app/tab is closed
self.addEventListener('push', (event) => {
  let data = { title: 'PulseAlert', body: 'You have a new notification' };
  try {
    data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Focus or open the app when the notification is tapped
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
