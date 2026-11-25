# TEST REPORT — caPOS

**Jenis:** audit runtime (black-box) terhadap aplikasi live + analisis bundle JS terdeploy
**Tanggal uji:** 27–28 Oktober 2026 (WIB)
**Aplikasi:** https://capos.alditriantama.com
**Backend:** Supabase `frlbmadjlzdpqnfvdxxw.supabase.co`
**Status:** `[ ]` belum · `[~]` sebagian · `[x]` selesai — setiap baris disertai bukti

> **Tidak ada kode aplikasi yang diubah.** Semua pengujian dilakukan lewat UI aplikasi (input data wajar) + HTTP langsung ke API publik (anon key) untuk uji keamanan.

---

## Ringkasan

| Status | Jumlah |
|---|---|
| `[x]` terbukti berjalan | 5 |
| `[~]` sebagian / ada blocker | 14 |
| `[ ]` belum ada / tidak bisa diuji | 21 |
| **Total item checklist** | **40** |

**Kesimpulan singkat:** fondasi teknis (RLS, harga dihitung server, webhook signature, header keamanan, PWA/offline queue) **jauh lebih baik** dari kesan awal. Tapi ada **2 blocker P0** yang membuat alur bisnis inti gagal di produksi:

1. **Tenant baru tidak bisa melakukan penjualan pertama** — mode demo mengunci kasir (deadlock).
2. **Self-Order QR (pesan dari meja) tidak bisa submit sama sekali** — RPC ambigu di database.

---

## Metodologi & akun uji

| Hal | Keterangan |
|---|---|
| Akun owner awal dari pemilik | `capos6326@gmail.com` → login **gagal** (`400 invalid_credentials`, pesan UI "Email atau password salah"). |
| Solusi | Sesuai instruksi: daftar tenant baru lewat `/register` (data uji, domain Mailinator). |
| Registrasi | `POST /api/register` → `200 {"success":true,"tenant_id":"6bbe1eeb-…","requiresEmailConfirmation":true}`, durasi ±10 detik. |
| Verifikasi email | OTP 6 digit diterima, `POST /auth/v1/verify` → `200`. Alur konfirmasi email **berfungsi**. |
| Owner uji | `audit1793051176923@mailinator.com` / `AuditPass123` (role owner/admin) |
| Kasir uji | dibuat **di dalam aplikasi** (`/dashboard/employees` → "Buat Akun Karyawan"): `karyawan.audit1793051241517@mailinator.com` / `Karyawan123`, role `cashier`, jobTitle Barista, cabang "Cabang Utama". `POST /api/employees` → `200`. |
| Paket | Free Trial: menu maks 10, karyawan maks 2, cabang maks 1, riwayat 7 hari |
| Data uji | Produk "Kopi Uji Audit" Rp 15.000 (HPP 6.000, lacak stok), stok 50 → 48, 4 transaksi + 1 order GoFood |

**Dua simulasi yang dipakai (dan alasannya):**

1. **Netralisasi pemicu mode demo** — hanya untuk melewati blocker P0 agar sisa fitur bisa diuji. Setelah transaksi pertama ada, seluruh pengujian penjualan berikutnya dilakukan **tanpa intervensi apa pun**.
2. **Simulasi offline** dengan menggagalkan `fetch` ke `*.supabase.co` + `/api/*` di level halaman (tidak ada alat network-throttling di harness). Perilaku aplikasi saat offline tetap nyata (baca cache IndexedDB, antre di Dexie, sync ulang).

---

## TEMUAN — diurutkan berdasarkan severity

### 🔴 P0-1 — Tenant baru **tidak pernah bisa** menyelesaikan penjualan pertama (mode demo mengunci kasir)

**Dampak:** setiap kafe yang baru daftar **tidak bisa menjual apa pun**. Ini blocker onboarding total.

**Bukti runtime:**
- Tenant baru (0 transaksi) → buka `/pos` → klik produk asli "Kopi Uji Audit":
  - toast: **"Ini contoh data. Tambahkan menu asli dulu sebelum menjual."**
  - keranjang tetap `Keranjang (0)`, tidak ada item masuk.
- Kondisi saat itu: produk asli sudah ada (stok 50, `is_available: true`), shift sudah dibuka (`rpc/open_shift_v2` 200), jadi bukan masalah data produk.
- Sumber kode (chunk terdeploy `/_next/static/immutable/chunks/023743amkb-8s.js`):
  ```js
  function tk(e){ if(p) return void tv("Ini contoh data. Tambahkan menu asli dulu sebelum menjual."); … }
  ```
  dengan `p` = state mode demo, di-set oleh:
  ```js
  await (0,i.S)() && (h(!0), x(e => 0===e.length ? n.e : e));
  ```
  `i.S` = `tenantHasNoActivity()` (`lib/demoMode.ts`), yang **true selama `count(transactions) = 0`**.
- `DemoBanner` hanya punya tombol "Tutup banner" (`setDismissed`) — **tidak ada jalan keluar dari mode demo**.
- Setelah pemicu demo dinetralkan sementara: klik produk langsung masuk keranjang dan transaksi berhasil (`rpc/checkout_transaction` 200).
- Setelah transaksi pertama benar-benar ada (1 baris di tabel `transactions`): banner contoh hilang otomatis dan **penjualan normal tanpa workaround** (diuji 3× lagi: CASH, QRIS, offline).

**Akar masalah:** logika "contoh hilang setelah transaksi pertama" dipakai juga sebagai **guard penjualan**. Padahal untuk membuat transaksi pertama, kasir harus bisa menjual → siklus tertutup.

**Perbaikan yang disarankan:** guard demo hanya boleh memblokir **produk contoh** (`demoMode` + `is_demo`), bukan produk asli milik tenant. Atau: sediakan tombol "Keluar dari mode contoh / Mulai data asli" yang mematikan demo tanpa syarat transaksi.

---

### 🔴 P0-2 — Self-Order QR (pesan dari meja) gagal submit 100% (fungsi database ambigu)

**Dampak:** pelanggan tidak bisa memesan dari meja sama sekali — fitur unggulan "QR Meja & Self-Order" tidak berfungsi.

**Bukti runtime (2 jalur pembayaran, keduanya gagal identik):**
- `POST /rest/v1/rpc/submit_qr_order` → **HTTP 300**
  ```json
  {"code":"PGRST203","message":"Could not choose the best candidate function between:
   public.submit_qr_order(…, p_items => jsonb),
   public.submit_qr_order(…, p_items => jsonb, p_idempotency_key => text)"}
  ```
- Pesan itu tampil mentah ke pelanggan di halaman order (`/order/cabang-utama-bd3c/1`), bukan pesan ramah.
- Diuji dengan metode **"Bayar di Kasir"** dan **"QRIS / E-Wallet"** → keduanya `300`, tidak ada order yang dibuat.

**Akar masalah:** ada dua versi fungsi `submit_qr_order` (satu dengan `p_idempotency_key`), dan client memanggil tanpa parameter tersebut → PostgreSQL tidak bisa memilih kandidat.

**Perbaikan:** hapus/rename salah satu fungsi, atau beri nilai default pada `p_idempotency_key` sehingga resolusi tidak ambigu. Tambahkan juga penanganan error yang ramah di halaman order.

**Catatan:** halaman QR Meja menampilkan tombol/daftar meja **contoh** ("Meja 01…06", label CONTOH) pada tenant baru. Meja asli yang kami tambah (`branch_tables` → nomor "1") **tidak muncul di daftar** selama mode demo aktif, meski QR-nya berfungsi (`/order/<slug>/1` menampilkan menu asli). Jadi ada dua masalah: data contoh menutupi data asli, dan submit order rusak.

---

### 🟠 P1-1 — POS yang dibuka saat offline menampilkan "Menu tidak ditemukan" (klaim offline di FAQ tidak benar)

**Bukti runtime (2× reproduksi):**
- Produk sudah tersimpan di IndexedDB: `caPOS_offline_db` v30, store `products` → `{name:"Kopi Uji Audit", stock:50}`.
- Simulasi offline → navigasi ke `/pos` → chip berubah **"Offline"**, tetapi grid kosong: **"Menu tidak ditemukan."** (produk tidak dirender).
- Sebaliknya, **penjualan offline tetap jalan** jika halaman POS sudah terbuka sebelum jaringan putus (lihat bawah).
- Halaman FAQ aplikasi menjanjikan: "Tetap bisa dipakai walau internet mati — transaksi tersimpan otomatis dan sync begitu online lagi." Untuk **cold start/reload saat offline**, janji ini **tidak terpenuhi**.

**Dugaan penyebab:** efek inisialisasi POS melakukan beberapa `await` ke Supabase (profil → cabang → shift → produk → `branch_stock`) dan berhenti/melewatkan render produk ketika request gagal, padahal cache Dexie sudah berisi. Perlu jalur "offline-first" yang membaca cache lebih dulu dan tidak menunggu jaringan.

---

### 🟠 P1-2 — Pembayaran QRIS tercatat "lunas" tanpa transaksi Midtrans

**Bukti runtime:**
- Transaksi `INV-20261027161617-623` tersimpan `payment_method: "qris"` dan struk tercetak "Bayar: QRIS", tetapi **tidak ada satu pun request** ke `/api/*` atau Midtrans saat checkout (hanya `rpc/checkout_transaction`).
- Konfigurasi cabang: `midtrans_client_key: null`, `midtrans_server_key: null`, `qris_mode: "DYNAMIC"`.
- Halaman `/dashboard/qris-dinamis`: "Belum ada transaksi QRIS Dinamis" setelah penjualan QRIS di atas.

**Risiko:** kasir bisa menandai transaksi QRIS sebagai lunas tanpa verifikasi pembayaran (tidak ada bukti dana masuk). Perlu minimal konfirmasi manual bertanda tangan / status "menunggu pembayaran" selama gateway belum dikonfigurasi.

---

### 🟡 P2 — Temuan lain

| # | Temuan | Bukti |
|---|---|---|
| P2-1 | Order online (GoFood dkk) **tidak menjadi transaksi**, jadi tidak masuk laporan omzet utama | Order `GO-001` selesai (`status: COMPLETED`) tetapi `orders.transaction_id = null`; total omzet dashboard tetap Rp 30.000 (hanya dari 2 transaksi POS). |
| P2-2 | Transaksi hasil sync offline **kehilangan flag** `is_offline_sync` | Antrean IndexedDB `is_offline_sync: true`, tetapi baris di `transactions` tersimpan `is_offline_sync: false` (jejak audit hilang). |
| P2-3 | Tidak ada rate limit yang terlihat pada login | 6 percobaan password salah berturut-turut → semuanya `400 invalid_credentials`, tanpa `429`/`Retry-After`. |
| P2-4 | Halaman hukum & status tidak ada | `/privacy`, `/terms`, `/kebijakan-privasi`, `/syarat-ketentuan`, `/status`, `/docs`, `/faq`, `/help`, `/panduan`, `/changelog`, `/security`, `/refund` → **404 semua**. |
| P2-5 | Tidak ada monitoring error | Tidak ditemukan Sentry/PostHog/GA di 11 chunk client (kata "sentry" hanya muncul di string SDK Supabase soal header `sentry-trace`). |
| P2-6 | Tidak ada kanal dukungan yang bisa dihubungi dari aplikasi | Tidak ada tautan `wa.me`/WhatsApp/email di halaman `/dashboard/faq` maupun bundle client. |
| P2-7 | `/dashboard/reports` 404 | Halaman laporan sebenarnya ada di `/dashboard` ("Laporan & Omzet"). Link lama/bookmark akan 404. |
| P2-8 | Menu asli tidak muncul di daftar QR Meja saat mode demo aktif | Daftar hanya menampilkan "Meja 01–06" contoh walau `branch_tables` sudah berisi meja "1". |

---

## 1. Fungsi inti

| Item | Status | Bukti / Temuan |
|---|---|---|
| Kasir / POS online | `[~]` | **Berfungsi normal SETELAH tenant punya ≥1 transaksi.** Transaksi `INV-20261027161534-142` (CASH Rp 15.000, kembalian Rp 5.000), `INV-20261027161617-623` (QRIS), `INV-20261027162310-567`. `rpc/checkout_transaction` 200, `transaction_items` 1 baris, struk modal lengkap ("Cetak Struk" memanggil `window.print()` 1×). **Blocker: tenant baru tidak bisa transaksi pertama → P0-1.** |
| Kasir offline dan sinkronisasi | `[~]` | Offline saat halaman sudah terbuka: chip "Offline", struk `INV-20261027161942-750` tercetak, antrean `pendingTransactions` (is_offline_sync true, synced 0). Online lagi → chip "Online", antrean `synced: 1`, transaksi masuk DB, stok turun 50→48. **Tapi buka/reload POS saat offline → "Menu tidak ditemukan" (P1-1).** |
| Kelola menu (online) | `[x]` | Buat menu "Kopi Uji Audit" (Rp 15.000, kategori Kopi) → 1/10 kuota. Edit harga 15.000→16.000 → `PATCH products` 204 → DB `price: 16000`. Tambah/edit/HPP/stok semua tersimpan. |
| Kelola menu offline dengan resep (skenario B) | `[~]` | Modal edit menu menampilkan: *"Sedang offline — menu ini akan tersimpan di device dulu, terkirim otomatis begitu online lagi."* Edit harga 16.000 → antrean `pendingProductOps` (`synced: 0`) → online → `PATCH products` 204 → antrean `synced: 1`, DB `price: 16000`. **Sisi resep/BOM offline belum diuji** (belum ada bahan baku/resep di tenant uji). |
| Penolakan izin untuk kasir (skenario C) | `[x]` | Login kasir → redirect `/pos` (sesuai `ROLE_HOME`). Akses `/dashboard/employees`, `/dashboard/menu`, `/dashboard/settings` → **"Akses ditolak"** + redirect `/pos?access_denied=%2Fdashboard…`. Tidak ada kebocoran UI manajemen. |
| Mode "Semua Cabang" diblokir dengan benar (skenario D) | `[ ]` | **Tidak bisa diuji:** paket Free Trial membatasi 1 cabang (`/dashboard/branches` → "1 / 1", "sudah mencapai batas maksimal"). Tidak ada pemilih cabang/"Semua Cabang" di navbar pada tenant 1 cabang. Perlu tenant multi-cabang (Pro/Supreme). |
| Edit dan toggle menu lama tidak rusak (skenario E) | `[x]` | Toggle ketersediaan "Tersedia" ⇄ "Habis / Nonaktif" → `PATCH products?id=eq.9e0e3be7…` 204, kembali normal. Setelah edit harga + toggle + restock, produk tetap tampil benar di POS (nama, kategori, harga, stok). |
| HPP menu dihitung dari resep dan harga bahan cabang | `[~]` | HPP manual + margin terbukti: set `cost_price 6000`, harga jual 15.000 → UI menampilkan **margin 60%**, "Nilai Inventori = stok × HPP". **HPP berbasis resep multi-bahan belum diuji** (tidak ada bahan baku). |
| Stok bahan dan opname | `[~]` | Restock `rpc/adjust_stock` 200 → stok 50; penjualan menurunkan `branch_stock` (50→48); `stock_movements` mencatat `sale -1` dengan catatan nomor invoice. Halaman Stok Opname punya tab "Input Opname"/"Riwayat", **belum dieksekusi** karena belum ada bahan baku. |
| Laporan dan omzet | `[x]` | `/dashboard`: "Total Omzet (7 hari) Rp 30.000 · Total Transaksi 2 · Rata-rata Rp 15.000" + daftar aktivitas nyata (bukan contoh). `/dashboard/transactions` menampilkan 2 invoice, penanda "Sudah di-refund (Rp 15.000)". `/dashboard/laporan-pdf` menghasilkan **`laporan-capos-2026-10-21-sd-2026-10-28.pdf` (12.966 byte)**. |
| Pembayaran QRIS (Midtrans) | `[~]` | Webhook menolak signature palsu (`POST /api/midtrans/notification` kosong & `signature_key: "deadbeef"` → **403 `{"message":"Invalid signature."}`**). **Tapi QRIS di POS tidak memanggil Midtrans sama sekali** (kunci Midtrans cabang `null`) → lihat P1-2. |

---

## 2. Keamanan

| Item | Status | Bukti / Temuan |
|---|---|---|
| Semua celah di `capos_security_audit.md` diverifikasi ulang dengan tes nyata | `[ ]` | File `capos_security_audit.md` **tidak ada** di workspace ini (repo hanya berisi slice: `app/`, `components/`, `lib/demoMode.ts`, `lib/demoData.ts`, `TEST_REPORT.md`). Daftar temuannya tidak bisa dibandingkan. |
| RLS aktif di semua tabel data tenant, dibuktikan dengan akun berbeda | `[~]` | Tanpa token (anon key saja): `GET /rest/v1/products` → `200 []`, `GET /rest/v1/profiles` → `200 []`. Dengan JWT kasir: hanya 1 produk tenant sendiri; filter `tenant_id=neq.<tenant>` → `[]`; `profiles` hanya 2 baris tenant sendiri. **Catatan:** hanya tersedia 1 tenant, jadi isolasi antar-tenant nyata belum bisa dibuktikan (butuh tenant kedua). |
| Total transaksi dihitung di server, bukan dari browser | `[x]` | `rpc/checkout_transaction` hanya menerima `p_items: [{product_id, qty}]` — **tidak ada** total/harga dari client. Uji tamper: kirim `{product_id, qty:1, price:1, unit_price:1, subtotal:1}` → transaksi tersimpan **`total_amount: 16000`** (harga dari DB), bukan 1. Client tidak bisa mengakali harga. |
| Webhook Midtrans idempoten dan memverifikasi signature | `[~]` | Signature **terverifikasi**: body kosong & signature palsu → 403 "Invalid signature." **Idempotensi belum teruji** (butuh signature valid/kunci Midtrans asli). Catatan: route hanya ada di deployment, bukan di workspace. |
| Rate limit memakai penyimpanan bersama (Redis/Upstash), bukan memori | `[ ]` | 6 login salah berturut-turut → 6× `400 invalid_credentials`, tanpa `429`/`Retry-After` → **tidak ada rate limit aplikasi yang terlihat**. Belum bisa dipastikan apakah Supabase Auth punya limit internal. |
| Tidak ada kode akses default atau kredensial di repo | `[~]` | Anon/publishable key memang publik (wajar). Tidak ditemukan `service_role`/`sb_secret_…` nyata di 11 chunk client — string `sb_secret_` hanya muncul pada pengecekan prefix SDK Supabase. Audit penuh tidak mungkin karena repo slice. |
| Service role key hanya di server, tidak pernah `NEXT_PUBLIC_` | `[~]` | Tidak ada service role di bundle browser (bukti negatif kuat). Kode server tidak ada di workspace sehingga penggunaan `SERVICE_ROLE` tidak bisa diaudit. |
| Key yang pernah terekspos sudah dirotasi | `[ ]` | Proses operasional. Butuh konfirmasi pemilik. |
| Penetration test oleh pihak independen | `[ ]` | Belum ada bukti. |

**Bonus — header keamanan live (kuat):** `content-security-policy` (termasuk `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`), `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, `strict-transport-security: max-age=63072000`, `permissions-policy: camera=(), microphone=(), geolocation=()`, `cross-origin-opener-policy: same-origin`.

---

## 3. Data dan hukum

| Item | Status | Bukti / Temuan |
|---|---|---|
| Kebijakan privasi (sesuai UU PDP) | `[ ]` | `/privacy` → 404, `/kebijakan-privasi` → 404. Tidak ada tautan hukum di halaman login/register. |
| Syarat dan ketentuan layanan | `[ ]` | `/terms` → 404, `/syarat-ketentuan` → 404. |
| Persetujuan pemrosesan data saat daftar | `[ ]` | HTML `/register` (11.994 byte) **tidak memuat** checkbox maupun teks "setuju/persetujuan/privasi/syarat" — tidak ada consent sama sekali. |
| Prosedur hapus akun dan data pelanggan | `[~]` | Ada self-service: **Pengaturan → Profil & Akun → "Hapus Akun"**, dengan konfirmasi ketik nama bisnis ("Ketik nama bisnis Anda: Kafe Uji Audit") dan peringatan bahwa menu/transaksi/karyawan/cabang/stok dihapus permanen. **Tidak dieksekusi** (destruktif). Prosedur penghapusan "data pelanggan" secara terpisah belum terlihat. |
| Konsultasi dengan ahli hukum sudah dilakukan | `[ ]` | Proses eksternal. |

---

## 4. Backup dan pemulihan

| Item | Status | Bukti / Temuan |
|---|---|---|
| Backup otomatis aktif (Supabase PITR atau backup terjadwal) | `[ ]` | Konfigurasi project, tidak dapat dilihat dari luar. |
| Uji restore sungguhan, hasilnya dicatat | `[ ]` | Belum ada bukti. |
| Target waktu pemulihan (RTO) dan kehilangan data maksimal (RPO) ditulis | `[ ]` | Tidak ada dokumen. |

**Catatan tambahan:** di dalam aplikasi **tidak ada fitur backup/restore** — `/dashboard/settings` hanya berisi Business Profile, Cabang, Metode Pembayaran, Printer, Desain Struk, Keamanan & PIN, Profil & Akun, Langganan. Yang tersedia hanya **Import** (`/dashboard/settings/import`: Products, Customers, Suppliers, Recipes) — satu arah, tanpa ekspor penuh.

---

## 5. Operasi

| Item | Status | Bukti / Temuan |
|---|---|---|
| Kanal dukungan (email/WhatsApp) dan jam layanan | `[ ]` | Halaman `/dashboard/faq` ("Panduan & Bantuan") ada, tetapi **tidak ada** nomor WhatsApp/email/jam layanan; tidak ada tautan `wa.me` di semua halaman & bundle client. |
| Status page atau pengumuman gangguan | `[ ]` | `/status` → 404. Tidak ada banner status. |
| Akses cadangan ke Supabase dan Vercel (tidak hanya satu akun) | `[ ]` | Operasional, butuh konfirmasi pemilik. |
| Monitoring error (mis. Sentry) dan alert | `[ ]` | Tidak ada Sentry/PostHog/GA di bundle (`sentry` hanya string header di SDK Supabase). Tidak ada endpoint health (`/api/health` → 404). |
| Proses branch protection di `main` dan PR wajib | `[ ]` | Bukan repo git di workspace ini; tidak bisa diperiksa. |

---

## 6. Produk dan harga

| Item | Status | Bukti / Temuan |
|---|---|---|
| Paket dan harga final | `[~]` | Halaman `/dashboard/subscription` menampilkan: **Free Trial Rp0 / 28 hari** · **Pro Rp100.000/bulan** (kasir unlimited, riwayat 30 hari) · **Supreme Rp900.000/tahun**. Kuota ditegakkan nyata: menu 1/10, staf 1/2, cabang 1/1, riwayat 7 hari. Harga masih perlu konfirmasi final dari pemilik. |
| Kebijakan refund | `[ ]` | `/refund` → 404, tidak ada dokumen. (Fitur refund *transaksi* di dalam aplikasi berfungsi baik — lihat bawah.) |
| Apa yang terjadi saat langganan berakhir (data bisa diekspor) | `[~]` | Pembatasan paket ditegakkan (riwayat 7 hari untuk Trial, "Upgrade untuk riwayat lengkap"), ekspor tersedia: CSV di laporan + PDF otomatis. **Kebijakan grace period / read-only setelah trial habis belum dijelaskan** di UI. |
| Onboarding pengguna baru (panduan singkat, tanpa data contoh yang membingungkan) | `[~]` | Tur onboarding ada dan berjalan: `profiles.onboarding_tour_completed_at` terisi `2026-10-26T21:47:00Z` (tepat setelah login pertama), 30+ langkah mengenalkan tiap menu. **Tapi** "data contoh" justru **memblokir penjualan pertama** (P0-1) → bertentangan dengan tujuannya. |

**Refund (fitur, terbukti berfungsi):**
- "Refund Penuh" pada `INV-…-142` → `rpc/request_refund` 200 + `rpc/revert_recipe_stock` 200.
- DB: `refunds {refund_type:"FULL", amount:15000, status:"COMPLETED", stock_restored:true}`; `stock_movements {type:"refund_restock", qty_change:+1}`; `branch_stock` kembali 49.
- Refund kedua ditolak dengan benar: UI menampilkan *"Transaksi ini sudah direfund penuh · Sisa dapat direfund Rp 0"* (tidak ada tombol submit). **Tidak ada risiko double refund.**
- `/dashboard/transactions` menandai invoice "Sudah di-refund (Rp 15.000)" setelah refresh; `/dashboard/cancellations` ("Log Pembatalan") kosong karena pembatalan berbeda dari refund.

---

## 7. Pilot

| Item | Status | Bukti / Temuan |
|---|---|---|
| 3 sampai 5 UMKM pilot dengan kesepakatan tertulis | `[ ]` | Proses eksternal. |
| Minimal 4 minggu pilot tanpa insiden data | `[ ]` | Belum dilakukan. |
| Umpan balik pilot didokumentasikan dan ditindaklanjuti | `[ ]` | Belum ada. |

---

## Cakupan halaman (semua route sidebar diuji)

37 route sidebar dashboard → **semua `200`**:
`/dashboard`, `/laporan-pdf`, `/target`, `/transactions`, `/cancellations`, `/menu`, `/variants`, `/modifiers`, `/recipes`, `/ingredients`, `/stock`, `/stock-opname`, `/purchasing/suppliers`, `/purchasing/purchase-orders`, `/qr-tables`, `/qris-dinamis`, `/reservations`, `/online-orders`, `/channel-pricing`, `/crm/customers`, `/promotions`, `/membership`, `/referral`, `/analytics/growth`, `/analytics/menu-engineering`, `/analytics/profitability`, `/analytics/peak-hours`, `/analytics/waste-loss`, `/branches`, `/employees`, `/cashiers`, `/cashier-evaluation`, `/attendance`, `/settings`, `/settings/import`, `/subscription`, `/faq` (semua berprefiks `/dashboard`).

Di luar sidebar: `/pos` 200, `/order/<slug>/<meja>` 200, `/dashboard/reports` **404**, `/dashboard/admin` **404**.

**Alur yang terbukti jalan end-to-end:**
1. Registrasi → OTP email → login owner → dashboard.
2. Buat karyawan (batas paket dihitung) → login kasir → redirect POS → blokir akses manajemen.
3. Buat menu → HPP + margin → lacak stok → restock → penjualan → stok turun → struk → refund → stok balik.
4. Mode offline: jual → antre → sync → transaksi masuk.
5. Mode offline: edit harga menu → antre → sync → DB berubah.
6. Laporan omzet + PDF otomatis.
7. Online Order Hub: input pesanan GoFood → proses → selesai (tapi tidak jadi transaksi, P2-1).

---

## Rekomendasi prioritas

| # | Prioritas | Tindakan |
|---|---|---|
| 1 | 🔴 **P0** | Lepaskan guard mode demo dari produk asli (atau sediakan tombol keluar mode contoh). Tanpa ini, **tidak ada kafe baru yang bisa bertransaksi.** |
| 2 | 🔴 **P0** | Perbaiki fungsi `submit_qr_order` yang ambigu (drop/rename salah satu overload atau beri `DEFAULT` pada `p_idempotency_key`), lalu uji ulang kedua metode bayar. |
| 3 | 🟠 P1 | Buat POS benar-benar offline-first: render dari Dexie **sebelum** menunggu jaringan; jangan hentikan inisialisasi saat profil/cabang gagal diambil. |
| 4 | 🟠 P1 | Jangan tandai QRIS "lunas" tanpa verifikasi Midtrans; sediakan status "menunggu konfirmasi" selama gateway belum aktif. |
| 5 | 🟡 P2 | Order online sebaiknya membuat/menautkan `transaction_id` agar omzet marketplace masuk laporan utama; pertahankan flag `is_offline_sync` saat sync. |
| 6 | 🟡 P2 | Tambah rate limit login (shared store) + monitoring error (Sentry) + status page. |
| 7 | 🟡 P2 | Lengkapi dokumen wajib: Kebijakan Privasi (UU PDP), S&K, consent checkbox di form daftar, kebijakan refund, kanal dukungan resmi. |
| 8 | ⚪ P3 | Sembunyikan data contoh di daftar QR Meja bila tenant sudah punya meja asli; perbaiki link `/dashboard/reports` → `/dashboard`. |

---

## Lampiran — bukti teknis ringkas

**Transaksi tersimpan (tabel `transactions`):**

| Invoice | Total | Metode | `is_offline_sync` | Catatan |
|---|---|---|---|---|
| INV-20261027161534-142 | 15.000 | cash | false | di-refund penuh (`refunds` COMPLETED, stok +1) |
| INV-20261027161617-623 | 15.000 | qris | false | tanpa pemanggilan Midtrans |
| INV-20261027161942-750 | 15.000 | cash | false | dibuat saat offline, sync sukses (flag hilang — P2-2) |
| INV-20261027162310-567 | 16.000 | cash | false | setelah harga diubah ke 16.000 |
| AUDIT-TAMPER-001 | 16.000 | cash | false | **sengaja dibuat** untuk uji "harga dihitung server" (client kirim `price:1`, server tetap 16.000). Bisa dihapus/di-refund kapan saja. |

**Pergerakan stok `branch_stock`:** 50 (restock) → 49 → 48; `stock_movements`: `sale -1` (INV-…-142), `sale -1` (INV-…-623), `refund_restock +1`.

**IndexedDB `caPOS_offline_db` v30:** stores `authCache`, `memberships`, `pendingProductOps`, `pendingTransactions`, `products` — service worker aktif (`scope: https://capos.alditriantama.com/`, `controller: true`), `manifest.json` tersedia.

**Uji HTTP keamanan:** anon `products`/`profiles` → `[]`; JWT kasir lintas tenant → `[]`; `POST /api/employees` tanpa auth → `401 {"message":"Hanya Owner yang boleh menambah karyawan."}`; `POST /api/midtrans/notification` signature salah → `403`; `POST /api/checkout` & `/api/health` → `404`.

**Catatan data uji:** tenant `Kafe Uji Audit` (`6bbe1eeb-69e0-4a0c-9716-31f16b92c548`) berisi 5 transaksi, 1 order online, 1 meja, 1 produk, 1 karyawan. Silakan hapus setelah audit selesai (Pengaturan → Profil & Akun → Hapus Akun), atau minta saya bersihkan.
