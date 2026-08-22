// caPOS Service Worker
//
// Strategi yang dipakai sengaja SEDERHANA dan aman untuk app yang datanya
// selalu berubah (menu, harga, transaksi):
//   - Navigasi halaman (mis. buka /pos): "network-first" — selalu coba
//     internet dulu supaya data selalu terbaru; kalau gagal (offline),
//     baru pakai versi halaman yang sempat ter-cache dari kunjungan
//     sebelumnya, atau fallback ke /offline.html kalau belum pernah dibuka.
//   - Aset statis (JS/CSS/ikon/gambar): "cache-first" — aset ini jarang
//     berubah isinya (nama file sudah ber-hash dari Next.js), jadi aman
//     diambil dari cache duluan supaya app kerasa instan.
//
// PENTING: Ini BUKAN cara membuat transaksi kasir tetap bisa disimpan saat
// offline — itu sudah ditangani terpisah oleh IndexedDB (lib/dexie.ts).
// Service worker ini hanya mengurus supaya HALAMAN/TAMPILANNYA bisa tetap
// terbuka walau tidak ada internet, setelah pernah dibuka minimal sekali.

const CACHE_NAME = "capos-cache-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // jangan cache POST/PUT (mis. checkout)

  const url = new URL(request.url);

  // Jangan pernah cache panggilan ke Supabase — data transaksi/menu harus
  // selalu fresh atau ditangani jalur offline khusus (Dexie), bukan oleh SW.
  if (url.hostname.endsWith("supabase.co")) return;

  const isNavigation = request.mode === "navigate";

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(
          () =>
            caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // Aset statis: cache-first, isi cache di background untuk kunjungan berikutnya.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
