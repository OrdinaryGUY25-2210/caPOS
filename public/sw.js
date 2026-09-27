// caPOS offline service worker.
//
// Tanpa file ini, aplikasi MATI TOTAL begitu koneksi putus: browser butuh
// HTML + chunk JS + CSS dari server Next.js, dan kalau server tidak terjangkau
// halaman langsung "Site can't be reached" - meski data menu/transaksi sudah
// tersimpan di IndexedDB (lib/dexie.ts). Jadi tugas service worker ini hanya
// satu: menahan "app shell" (HTML, JS, CSS, font, ikon, suara) supaya aplikasi
// tetap TERBUKA dan BISA DIPAKAI, sementara data tetap dikelola Dexie.
//
// Data bisnis (produk, member, transaksi tertunda) SENGAJA tidak dicache di
// sini. Request Supabase auth/rest/realtime dibiarkan langsung ke jaringan;
// kalau tidak, session token ikut ter-cache dan berisiko bocor atau basi.

const VERSION = "v1";
const SHELL_CACHE = `capos-shell-${VERSION}`;
const STATIC_CACHE = `capos-static-${VERSION}`;
const IMAGE_CACHE = `capos-image-${VERSION}`;
const RUNTIME_CACHE = `capos-runtime-${VERSION}`;
const ALL_CACHES = [SHELL_CACHE, STATIC_CACHE, IMAGE_CACHE, RUNTIME_CACHE];

const OFFLINE_URL = "/offline.html";

// Dipreload saat install. Dipisah dari cache runtime supaya halaman offline
// selalu ada walau user belum pernah membuka '/' sama sekali.
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.json",
  "/logo.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/assets/sounds/bell_chime.mp3",
  "/assets/sounds/digital_cash.mp3",
  "/assets/sounds/voice_alert.mp3",
];

// Batas jumlah entri cache gambar. Foto menu menumpuk cepat di device kasir
// yang dipakai seharian; tanpa batas ini storage bisa penuh dalam seminggu.
const IMAGE_CACHE_MAX_ENTRIES = 400;

const isCacheable = (response) =>
  response && (response.ok || response.type === "opaque");

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)));
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (isCacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    return Response.error();
  }
}

// Aset Next.js di /_next/static memakai nama ber-hash konten, jadi url yang sama
// dijamin isinya sama -> aman disimpan selamanya dan tidak perlu dicek server.
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) cache.put(request, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll bersifat atomik: satu 404 saja membatalkan seluruh install dan
      // app tidak akan pernah punya service worker. Satu per satu + catch.
      await Promise.all(
        PRECACHE_URLS.map((url) => cache.add(url).catch(() => undefined))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("capos-") && !ALL_CACHES.includes(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;
  if (!request.url.startsWith("http://") && !request.url.startsWith("https://")) return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // --- Domain lain: hanya foto Supabase yang berguna dicache ---------------
  if (!isSameOrigin) {
    const isSupabase = url.hostname === "supabase.co" || url.hostname.endsWith(".supabase.co");
    if (isSupabase && url.pathname.startsWith("/storage/")) {
      event.respondWith(
        staleWhileRevalidate(request, IMAGE_CACHE).then((res) => {
          trimCache(IMAGE_CACHE, IMAGE_CACHE_MAX_ENTRIES);
          return res;
        })
      );
      return;
    }
    // auth / rest / realtime + Midtrans: biarkan ke jaringan apa adanya.
    // Sengaja TIDAK di-respondWith supaya kegagalan network ditangani browser
    // dan aplikasi bisa jatuh ke fallback Dexie-nya masing-masing.
    return;
  }

  // Service worker tidak boleh men-cache dirinya sendiri.
  if (url.pathname === "/sw.js") return;

  // API route internal SELALU ke jaringan, tidak pernah di-cache. Termasuk
  // /api/midtrans/notification (webhook pembayaran dari Midtrans) dan
  // /api/pos/qris-status/* (polling status bayar). Kalau response-nya ikut
  // ter-cache, kasir bisa melihat "lunas" untuk transaksi yang belum dibayar
  // atau sebaliknya - uang pelanggan hilang.
  if (url.pathname.startsWith("/api/")) return;

  // --- Chunk build: content-hashed, aman cache-first ----------------------
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Gambar yang sudah di-optimasi Next.js. Butuh server saat online, jadi
  // memakai stale-while-revalidate supaya yang pernah dilihat tetap tampil.
  if (url.pathname === "/_next/image") {
    event.respondWith(
      staleWhileRevalidate(request, IMAGE_CACHE).then((res) => {
        trimCache(IMAGE_CACHE, IMAGE_CACHE_MAX_ENTRIES);
        return res;
      })
    );
    return;
  }

  // --- Navigasi (Full page load / buka PWA dari layar utama) --------------
  // Network-first: kalau online selalu dapat versi terbaru dari Next.js, dan
  // hasilnya disimpan supaya bisa dipakai lagi saat offline.
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, OFFLINE_URL));
    return;
  }

  // --- Payload RSC (navigasi client-side App Router) ----------------------
  // Tanpa ini, pindah halaman di dalam app saat offline akan menggantung
  // lalu error, karena Next.js selalu minta payload RSC baru dari server.
  if (request.headers.has("rsc") || request.headers.has("next-router-prefetch")) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  // --- Aset statis lain: ikon, suara, logo, css/js milik sendiri ---------
  event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});
