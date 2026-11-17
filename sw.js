// Waymore Jobs service worker — shows push notifications on the phone.
// iOS requires that every push displays a notification, or Apple revokes permission.
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function(e){
  var d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch(_) { try { d = { body: e.data.text() }; } catch(__){} }
  var title = d.title || 'Waymore Jobs';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.tag || ('wm-' + Date.now()),
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(ws){
    for (var i = 0; i < ws.length; i++){ if ('focus' in ws[i]) return ws[i].focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
