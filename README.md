# caPOS — Point of Sale Kafe by Studio D13

Aplikasi Web App SaaS POS Kafe berbasis **Next.js (App Router)**, **Tailwind CSS**,
**Lucide Icons**, **Dexie.js (IndexedDB, offline-first)**, dan **Supabase**
(Auth + Postgres + Storage) — PWA (bisa di-install ke home screen dan tetap
terbuka walau offline), dengan integrasi pembayaran **Midtrans** dan sistem
tier **Free Trial / Pro / Supreme**.

---

## 1. Fitur Utama

- **Registrasi terbuka** (`/register`) — tidak perlu kode akses/referral,
  siapa saja bisa daftar dan langsung dapat 28 hari Free Trial. Verifikasi
  akun pakai **kode OTP** (bukan link email).
- **Kasir (`/pos`)** — cari & pilih menu, keranjang, diskon member via
  kode/QR, cetak struk lewat dialog print browser (perlu printer thermal
  terpasang sebagai printer OS via driver — BELUM ada Web Bluetooth
  langsung, lihat Bagian 8 untuk detail), opsional info WiFi kafe, **shift
  kasir otomatis** (navbar menampilkan nama akun yang login + jam mulai
  shift), checkout yang totalnya dihitung ulang di server, dan tetap bisa
  transaksi saat offline (antrian IndexedDB, sync otomatis saat online).
- **Dashboard Owner (`/dashboard`)** — laporan omzet dari data transaksi
  asli (bukan data contoh), riwayat transaksi, kelola menu (dengan
  kompresi gambar otomatis sebelum upload), manajemen kasir, membership,
  pengaturan kafe, panduan fitur & FAQ, status langganan.
- **Sistem Tier — Free Trial / Pro / Supreme**, ditegakkan lewat trigger
  database (bukan cuma UI):

  | | Free Trial | Pro (Bulanan) | Supreme (Tahunan) |
  |---|---|---|---|
  | Akun kasir tambahan | Maks 2 | Unlimited | Unlimited |
  | Jumlah menu | Maks 10 | Unlimited | Unlimited |
  | Riwayat transaksi | 7 hari terakhir | Lengkap | Lengkap |
  | Kesehatan Penjualan | Tidak | Ya | Ya |
  | Jam Ramai & Menu Terlaris | Tidak | Tidak | Ya |
  | Export Excel multi-sheet + PDF | Tidak | Tidak | Ya |

- **Pembayaran langganan via Midtrans** (Snap) — QRIS, kartu, transfer
  bank, dll. Webhook otomatis memperpanjang & meng-upgrade tier begitu
  pembayaran dikonfirmasi.
- **Super Admin (`/admin`)** — daftar semua tenant, statistik ringkas
  (total/active/trial/expired), perpanjang atau aktifkan langganan tenant
  manapun tanpa lewat pembayaran (untuk demo/dukungan pelanggan).
- **Role-based access control** ditegakkan di server (`middleware.ts`) —
  kasir tidak bisa buka Dashboard/Admin walau URL diketik manual, muncul
  notifikasi "Akses ditolak" saat itu terjadi.
- **PWA**: bisa di-"Add to Home Screen", halaman yang pernah dibuka tetap
  bisa diakses walau HP offline total.
- **Responsif di semua ukuran layar**: sidebar dashboard jadi drawer
  overlay di HP, keranjang kasir jadi bottom sheet di layar sempit.

---

## 2. Struktur Proyek

```
capos/
├── app/
│   ├── page.tsx                     # Login + verifikasi OTP inline + lupa password
│   ├── register/page.tsx            # Registrasi TERBUKA (tanpa kode akses) + OTP + konfirmasi password
│   ├── forgot-password/page.tsx     # Lupa password via OTP
│   ├── api/
│   │   ├── register/route.ts        # Buat tenant+trial+akun owner, kirim OTP verifikasi
│   │   ├── cashiers/route.ts        # Buat/hapus akun kasir (admin API, cek limit tier Free)
│   │   └── midtrans/
│   │       ├── create-transaction/route.ts
│   │       └── notification/route.ts
│   ├── pos/page.tsx                 # Halaman Kasir (shift otomatis, PWA-aware, responsif)
│   ├── dashboard/
│   │   ├── layout.tsx
│   │   ├── page.tsx                 # Laporan & Omzet (data asli + Sales Health)
│   │   ├── transactions/page.tsx    # Riwayat Transaksi (limit 7 hari untuk Free)
│   │   ├── menu/page.tsx            # Kelola Menu (kompresi gambar + limit 10 utk Free)
│   │   ├── cashiers/page.tsx        # Manajemen Kasir (limit 2 utk Free)
│   │   ├── membership/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── faq/page.tsx             # Panduan Fitur + FAQ
│   │   └── subscription/page.tsx    # 3 tier + tabel perbandingan + bayar Midtrans
│   └── admin/page.tsx
├── components/
│   ├── Modal.tsx
│   ├── PasswordInput.tsx
│   ├── DashboardShell.tsx
│   ├── PosNavbar.tsx                # Nama akun, role, jam mulai shift
│   ├── AccessDeniedNotice.tsx
│   └── ServiceWorkerRegister.tsx
├── lib/
│   ├── tier.ts                      # Helper tier Free/Pro/Supreme + batasannya
│   ├── compressImage.ts             # Kompresi gambar browser sebelum upload
│   ├── midtransPlans.ts
│   ├── getCurrentProfile.ts
│   ├── dexie.ts
│   └── utils.ts
├── middleware.ts
├── public/                          # manifest.json, sw.js, ikon PWA
└── supabase/
    ├── schema.sql                   # DDL lengkap (setup dari nol)
    ├── migration_001..006_*.sql
    └── reset_all.sql
```

---

## 3. Instalasi & Menjalankan Secara Lokal

### Prasyarat
- Node.js 18.18+
- Akun Supabase (gratis)
- Akun Midtrans (untuk fitur pembayaran — opsional saat awal development)

### Langkah-langkah

1. **Install dependencies**: `npm install`

2. **Buat proyek Supabase baru**, jalankan seluruh isi `supabase/schema.sql`
   di SQL Editor. Ini membuat semua tabel (termasuk `shifts`, `payments`),
   RLS per-tenant, trigger limit tier Free, view analitik data asli, dan
   fungsi RPC.

   Sudah pernah setup Supabase sebelumnya? Jalankan migrasi yang belum
   pernah dijalankan secara berurutan: `migration_001` lalu `migration_002`
   (kritis, perbaiki bug login) lalu `migration_003` (Midtrans) lalu
   `migration_004` (kolom plan) lalu `migration_005` (tier, shift,
   analitik data asli). Semua idempotent (aman dijalankan ulang).

   `migration_006_remove_invite_codes.sql` bersifat **opsional** — hapus
   sisa tabel kode akses/referral yang sudah tidak dipakai sejak
   registrasi dibuka bebas. Membiarkannya (tidak menjalankan file ini)
   tidak berbahaya, cuma tabel yang tidak terpakai.

   Mau reset total dari nol? Jalankan `supabase/reset_all.sql` dulu, baru
   `schema.sql`.

3. **Buat bucket Storage**: Storage → New bucket → nama `menu-images`
   (persis) → aktifkan Public bucket.

4. **Cek "Confirm email" aktif**: Authentication → Providers → Email.

5. **Pasang custom SMTP — wajib.** Sejak Juni 2026, Supabase free-tier
   baru tidak bisa edit template email tanpa SMTP sendiri. Paling mudah
   pakai Resend (gratis 3.000 email/bulan): buat API key di resend.com,
   lalu Supabase → Authentication → Emails → Set up SMTP dengan host
   `smtp.resend.com`, port `465`, username `resend`, password = API key
   Resend, sender email `onboarding@resend.dev` untuk testing.

6. **Set template email jadi kode OTP** (bukan link) — isi body dengan
   `{{ .Token }}` di dua template: Authentication → Emails → Confirm
   signup, dan Authentication → Emails → Reset Password.

7. **Salin environment variables**: `cp .env.local.example .env.local`,
   isi kredensial Supabase (Project Settings → API) dan Midtrans.

8. **Jalankan development server**: `npm run dev`

---

## 4. Cara Membuat Akun Tiap Role

**Owner**: daftar bebas lewat `/register` — isi nama kafe, nama pemilik,
email, password. Tidak perlu kode apa pun. Verifikasi lewat kode OTP yang
dikirim ke email.

**Super Admin**: tidak ada form publik (sengaja). Daftar dulu sebagai
owner, lalu di Supabase Table Editor tabel `profiles`, ubah `role` jadi
`super_admin`. Logout lalu login ulang.

**Cashier**: login sebagai owner, buka `/dashboard/cashiers`, klik Tambah
Kasir. Free Trial dibatasi maksimal 2 akun kasir (Pro/Supreme unlimited).

---

## 5. Midtrans — Pembayaran Langganan

1. Daftar di midtrans.com, ambil Client Key & Server Key dari mode
   Sandbox dulu (Settings → Access Keys).
2. Isi ke environment variables.
3. Wajib daftarkan webhook: Settings → Configuration → Payment
   Notification URL, isi dengan `https://URL-KAMU.vercel.app/api/midtrans/notification`.
4. Harga paket ada di 2 tempat yang wajib sinkron: `lib/midtransPlans.ts`
   (harga sungguhan yang ditagih) dan `app/dashboard/subscription/page.tsx`
   (harga yang ditampilkan).
5. Setelah siap terima uang asli, pindah ke mode Production: ambil key
   baru, update env vars, daftarkan ulang webhook URL di mode Production.

Penting: Midtrans di sini hanya untuk owner bayar langganan caPOS ke
Studio D13. Transaksi jual-beli kafe ke pelanggannya di `/pos` tidak lewat
Midtrans — dropdown metode pembayaran di kasir cuma label pencatatan,
uangnya tetap diterima langsung oleh kafe (cash/QRIS/EDC milik mereka
sendiri).

---

## 6. PWA — Install ke Home Screen & Jalankan Offline

Android (Chrome): banner "Tambahkan ke layar Utama" otomatis muncul, atau
menu titik tiga → Install app. iOS (Safari): tombol Share → Add to Home
Screen (manual, keterbatasan dari Apple). Desktop: ikon install di
address bar Chrome/Edge.

Dua lapis offline: service worker (`public/sw.js`) meng-cache halaman
yang pernah dibuka supaya tetap terbuka walau offline total; IndexedDB
(`lib/dexie.ts`) khusus di `/pos` menyimpan transaksi yang dibuat saat
koneksi terputus, sync otomatis saat online lagi.

---

## 7. Build Production

```bash
npm run build
npm run start
```

Deploy: Vercel (frontend) + Supabase Cloud (backend).

---

## 8. Catatan Implementasi Penting

- **Cetak struk HANYA lewat `window.print()`** (dialog print browser
  bawaan) — **BELUM ADA** integrasi Web Bluetooth langsung ke printer
  thermal, walau versi awal dokumen sempat menyebutkannya. Ini berarti:
  - **Bisa jalan**: printer thermal yang terpasang sebagai printer OS
    lewat driver (USB/kabel, atau printer jaringan yang sudah di-setup
    sebagai printer default sistem).
  - **BELUM bisa jalan**: printer thermal yang cuma bisa connect lewat
    Bluetooth langsung tanpa driver OS (umum di printer thermal portable
    murah) — tombol "Cetak Struk" tidak akan bisa mengirim apa pun ke
    printer jenis ini.
  - Kalau mau tambah dukungan Bluetooth asli, perlu implementasi
    `navigator.bluetooth` (Web Bluetooth API) + protokol ESC/POS sesuai
    merk printer target — ini pekerjaan terpisah yang belum dikerjakan.
  - **Sebelum menjanjikan fitur cetak struk ke kafe manapun, tes dulu
    dengan printer fisik yang benar-benar mereka pakai.**

- Registrasi terbuka tanpa kode akses. Endpoint `/api/register`
  dilindungi rate limiting (5 percobaan/menit/IP) sebagai satu-satunya
  penghalang dari spam akun massal — pertimbangkan tambah CAPTCHA kalau
  spam jadi masalah nyata di production.
- Limit tier Free (2 kasir, 10 menu) ditegakkan lewat trigger database
  (`enforce_cashier_limit()`, `enforce_menu_limit()` di `schema.sql`),
  bukan cuma dicegah di UI — tidak bisa dilewati lewat panggilan API
  langsung sekalipun.
- Total transaksi & shift dihitung/dikaitkan di server —
  `checkout_transaction()` mengambil ulang harga dari database dan
  memanggil `open_shift()` otomatis, klien tidak pernah mengirim harga
  atau shift_id langsung.
- Laporan pakai data transaksi asli (view `daily_sales_analytics`,
  `peak_hours_analytics`, `best_seller_analytics`), bukan lagi angka
  contoh hardcode — tenant baru akan melihat laporan kosong sampai ada
  transaksi sungguhan dari `/pos`.
- Kompresi gambar di browser (`lib/compressImage.ts`, Canvas API, tanpa
  library tambahan) sebelum upload ke Supabase Storage.
- Export laporan 2 tingkat: Free/Pro dapat CSV sederhana, Supreme dapat
  file .xlsx multi-sheet (library xlsx/SheetJS).
- Verifikasi via kode OTP (bukan link) untuk signup maupun reset
  password — wajib dikonfigurasi manual di Supabase Dashboard.
- RLS aktif di semua tabel — kolom `plan`/`status` di `subscriptions`
  adalah sumber kebenaran tunggal untuk fungsi `tenant_tier()` yang
  dipakai trigger maupun frontend (`lib/tier.ts`).

---

## 9. Dukungan

Hubungi Studio D13 lewat tombol WhatsApp di halaman FAQ dashboard, atau
atur nomornya di `NEXT_PUBLIC_STUDIO_D13_WHATSAPP` (`.env.local`).
