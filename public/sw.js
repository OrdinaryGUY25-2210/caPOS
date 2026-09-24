// Service Worker Fix: Mengabaikan request selain skema http/https (misal chrome-extension://)
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // IGNORE jika bukan skema http / https
  if (!event.request.url.startsWith('http://') && !event.request.url.startsWith('https://')) {
    return;
  }

  // Masukkan logika cache / fetch bawaan di bawah ini jika ada
});
