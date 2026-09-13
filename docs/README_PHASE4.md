# caPOS — Phase 4: QR Self-Order, Reservasi, Online Order Hub & Growth Analytics

Paket ini melengkapi ekosistem caPOS (Next.js App Router + Supabase) di atas
Phase 1 (POS inti), Phase 2 (KDS, Shift Cash), dan Phase 3 (yang sudah
berjalan), TANPA mengubah perilaku fitur-fitur lama.

## Isi Paket

```
supabase/
  phase4_schema.sql            ← jalankan di Supabase SQL Editor SETELAH migration_012

lib/
  types-phase4.ts              ← tempel ke akhir lib/types.ts

app/
  order/[branch]/[table]/page.tsx        ← halaman publik pelanggan (QR Self-Order)
  reserve/[branch]/page.tsx              ← form reservasi publik
  dashboard/qr-tables/page.tsx           ← generator QR meja (Owner/Manager)
  dashboard/reservations/page.tsx        ← kalender & manajemen reservasi
  dashboard/online-orders/page.tsx       ← Online Order Hub (input manual + status)
  dashboard/channel-pricing/page.tsx     ← markup harga & komisi per kanal
  dashboard/analytics/growth/page.tsx    ← Repeat Visit Rate, LTV, pelanggan tidak aktif
  dashboard/analytics/menu-engineering/page.tsx  ← Matriks Stars/Plowhorses/Puzzles/Dogs
  api/orders/qris-charge/route.ts        ← generate QRIS dinamis (Midtrans)
  api/midtrans/order-notification/route.ts  ← webhook konfirmasi bayar QRIS pesanan

components/
  order/SelfOrderClient.tsx      ← menu, keranjang, checkout, pelacakan status (mobile-first)
  tables/QrTableCard.tsx         ← 1 kartu QR + unduh PNG
  tables/qrPdfExport.ts          ← unduh semua QR sebagai 1 PDF siap cetak
  tables/TableStatusBoard.tsx    ← peta status meja live (AVAILABLE/RESERVED/OCCUPIED)
  reservations/ReservationFormModal.tsx  ← form reservasi sisi staff
  online-orders/ (di dalam page.tsx)     ← form input pesanan agregator
  pos/QrOrderAlert.tsx           ← popup + bunyi notifikasi pesanan baru di POS/KDS

PATCH_INSTRUCTIONS.md            ← edit kecil yang perlu ditempel ke file lama
```

## Langkah Instalasi

1. **Jalankan SQL** — buka Supabase SQL Editor, jalankan `supabase/phase4_schema.sql`
   secara utuh (idempotent, aman dijalankan ulang). Pastikan `migration_012`
   sudah pernah dijalankan sebelumnya.
2. **Salin file** — copy folder `app/`, `components/`, `lib/types-phase4.ts`
   ke proyek Next.js kamu, sesuai struktur di atas.
3. **Ikuti `PATCH_INSTRUCTIONS.md`** — 8 edit kecil di file yang sudah ada
   (`middleware.ts`, `lib/types.ts`, `DashboardSidebar.tsx`, `PosNavbar.tsx`,
   `package.json`, `globals.css`).
4. **Install dependency baru**: `npm install qrcode && npm install -D @types/qrcode`.
5. Deploy, lalu tes alur end-to-end (lihat "Cara Uji Coba" di bawah).

## Bagaimana Tiap Fitur Bekerja

### 1. QR Self-Order
- Owner/Manager menambah meja di `/dashboard/qr-tables`, lalu unduh QR
  (PNG per meja atau PDF gabungan siap cetak).
- QR mengarah ke `capos.id/order/<slug-cabang>/<no-meja>` — halaman publik,
  **tanpa login**, memuat menu lewat SATU panggilan RPC (`get_qr_order_page`)
  supaya tetap ringan di jaringan seluler pelanggan.
- Saat checkout, `submit_qr_order()` membuat tiket `orders`+`order_items`
  dengan `channel = 'qr_self_order'` — otomatis muncul di POS & KDS lewat
  Realtime yang SUDAH ada sejak Phase 2 (tidak perlu infrastruktur baru).
- `components/pos/QrOrderAlert.tsx` menampilkan popup + bunyi di POS saat
  tiket baru itu masuk.
- Pembayaran QRIS Dynamic lewat Midtrans Core API (`/api/orders/qris-charge`)
  atau opsi "Bayar di Kasir".

### 2. Reservasi Meja
- Form publik `/reserve/<slug-cabang>` (status awal `pending`) atau input
  langsung oleh staff di `/dashboard/reservations` (langsung `confirmed`).
- Kalender/timeline harian dengan aksi Konfirmasi → Alokasi Meja →
  Check-in (`seat_reservation`, otomatis membuat tiket `orders` seperti
  pesanan dine-in biasa) → Selesai.
- Status meja "RESERVED" muncul otomatis 30-60 menit sebelum jam
  kedatangan lewat view `table_live_status` — dihitung on-the-fly, TANPA
  cron job.

### 3. Online Order Hub
- `/dashboard/channel-pricing`: atur markup harga (%) dan komisi platform
  (%) per menu per kanal (GoFood/GrabFood/ShopeeFood/Website).
- `/dashboard/online-orders`: input manual pesanan yang masuk dari
  tablet/app masing-masing platform (caPOS belum terhubung API resmi
  agregator) — harga & komisi dihitung otomatis dari Channel Pricing,
  lalu masuk KDS seperti pesanan biasa.
- Rekap `channel_commission_report` memisahkan Omzet Kotor, Komisi
  Platform, dan Pendapatan Bersih per kanal per hari.

### 4. Advanced Growth Analytics
- `/dashboard/analytics/growth`: Repeat Visit Rate, rata-rata LTV, dan
  daftar pelanggan Membership yang tidak berkunjung >30 hari (tombol kirim
  voucher via WhatsApp).
- `/dashboard/analytics/menu-engineering`: kuadran Stars/Plowhorses/
  Puzzles/Dogs (volume vs margin, dibanding rata-rata menu tenant),
  lengkap rekomendasi aksi per menu.

## Cara Uji Coba Cepat

1. Tambah 1 meja di `/dashboard/qr-tables`, buka link `orderUrl` yang
   tertera di kartu QR (bukan scan — cukup buka di tab baru).
2. Pesan 1-2 menu, pilih "Bayar di Kasir", kirim pesanan.
3. Buka `/pos` atau `/kitchen` di tab lain (login sebagai kasir/owner
   tenant yang sama) — tiket baru harus langsung muncul + ada popup/bunyi.
4. Buka `/reserve/<slug-cabang>`, isi form reservasi untuk beberapa menit
   ke depan — cek `/dashboard/reservations`, konfirmasi & alokasikan meja,
   lalu lihat `table_live_status` di halaman yang sama berubah ke RESERVED.
5. Coba `/dashboard/channel-pricing`, set markup 20% untuk GoFood, lalu
   buat pesanan lewat `/dashboard/online-orders` — cek harga otomatis
   ter-markup dan komisi tercatat di kartu ringkasan.

## Keamanan (ringkasan)

- Pelanggan (anon) **tidak pernah** diberi akses SELECT/INSERT langsung ke
  tabel manapun — semua interaksi lewat fungsi `SECURITY DEFINER` yang
  memvalidasi harga dari database, konsisten dengan pola `checkout_transaction()`
  di Phase 1.
- `mark_qr_order_paid()` sengaja **tidak** di-`GRANT` ke `anon`/`authenticated`
  — hanya bisa dipanggil lewat `service_role` key (webhook Midtrans server),
  supaya status "sudah dibayar" tidak bisa dipalsukan dari browser.
- Semua tabel baru mengikuti pola branch-scoped RLS yang sama dengan
  Phase 2/Multi-Cabang: Owner melihat semua cabang, Manager/Kasir hanya
  cabang penugasannya.
