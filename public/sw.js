const CACHE_NAME = 'knx-cache-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    let data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data = { title: 'KNX Messenger', body: event.data.text() };
        }
    }
    const title = data.title || 'KNX Messenger';
    const options = {
        body: data.body || 'Новое сообщение',
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: data.tag || 'knx-msg',
        renotify: true,
        data: data.data || {},
        vibrate: [120, 60, 120]
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const chatKId = event.notification.data ? event.notification.data.chatKId : null;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if ('focus' in client) {
                    client.focus();
                    if (chatKId) {
                        client.postMessage({ type: 'OPEN_CHAT', chatKId: chatKId });
                    }
                    return;
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow('/');
            }
        })
    );
});
