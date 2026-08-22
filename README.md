# caPOS — Point of Sale Kafe by Studio D13

Aplikasi Web App SaaS POS Kafe berbasis **Next.js (App Router)**, **Tailwind CSS**,
**Lucide Icons**, **Dexie.js (IndexedDB, offline-first)**, dan **Supabase**
(Auth + Postgres + Storage) — sekarang juga **PWA** (bisa di-install ke home
screen dan tetap terbuka walau offline).

---

## 1. Fitur Utama

- **Kasir (`/pos`)** — pencarian & filter kategori menu, keranjang, diskon
  member via kode/QR, cetak struk thermal 58mm/80mm (dengan opsi WiFi kafe di
  struk), checkout yang **totalnya dihitung ulang di server** (RPC
  `checkout_transaction`, bukan dipercaya dari browser), dan tetap bisa
  transaksi saat internet mati (antrian tersimpan di IndexedDB, sync otomatis
  saat online lagi).
- **Dashboard Owner (`/dashboard`)** — laporan omzet (bar/line/donut chart),
  kelola menu & stok (dengan upload foto ke Supabase Storage), manajemen akun
  kasir, membership, pengaturan kafe, FAQ & helpdesk, status
  langganan/trial — **semuanya sudah tersambung ke database asli**, bukan
  data contoh.
- **Super Admin (`/admin`)** — daftar tenant asli, generator kode akses
  registrasi dengan kuota, akses tanpa batas ke seluruh halaman.
- **Registrasi terkunci kode akses** dengan kuota maksimal 100 pendaftaran
  per kode promo, plus **verifikasi email asli** (bukan langsung aktif).
- **Role-based access control** yang ditegakkan di server (`middleware.ts`)
  — kasir tidak bisa buka Dashboard/Admin walau URL diketik manual, dan akan
  muncul notifikasi "Akses ditolak" saat itu terjadi.
- **PWA**: bisa di-"Add to Home Screen" di Android/iOS/Desktop, dan halaman
  yang pernah dibuka tetap bisa diakses walau HP dalam kondisi offline total.
- **Responsif di semua ukuran layar**: sidebar dashboard jadi drawer overlay
  di HP, keranjang kasir jadi bottom sheet di layar sempit, ada saran rotasi
  layar untuk halaman laporan yang berat chart.

---

## 2. Struktur Proyek

```
capos/
├── app/
│   ├── page.tsx                     # Login (root, tanpa landing page)
│   ├── login/page.tsx               # Alias dari root login
│   ├── register/page.tsx            # Registrasi + validasi kode akses + verifikasi OTP inline
│   ├── forgot-password/page.tsx     # Lupa password: kirim OTP → verifikasi → set password baru
│   ├── api/
│   │   ├── register/route.ts        # Redeem kode akses (atomic) + signUp + kirim email verifikasi
│   │   └── cashiers/route.ts        # Buat/hapus akun kasir (admin API, hanya owner/super_admin)
│   ├── pos/page.tsx                 # Halaman Kasir (responsif + PWA-aware)
│   ├── dashboard/
│   │   ├── layout.tsx               # Ambil data trial dari Supabase, bungkus DashboardShell
│   │   ├── page.tsx                 # Laporan & Omzet
│   │   ├── menu/page.tsx            # Kelola Menu & Stok (Supabase + Storage)
│   │   ├── cashiers/page.tsx        # Manajemen Kasir (Supabase + /api/cashiers)
│   │   ├── membership/page.tsx      # Membership (Skenario A/B, Supabase)
│   │   ├── settings/page.tsx        # Pengaturan Kafe (WiFi struk, dll)
│   │   ├── faq/page.tsx             # FAQ & Helpdesk
│   │   └── subscription/page.tsx    # Status Langganan
│   └── admin/page.tsx               # Super Admin Control Panel (Supabase)
├── components/
│   ├── Modal.tsx                    # Modal standar (header/footer sticky, aman di HP)
│   ├── DashboardShell.tsx           # Shell dashboard responsif (drawer di mobile)
│   ├── DashboardSidebar.tsx         # Isi navigasi sidebar (termasuk link ke /pos)
│   ├── LandscapeNotice.tsx          # Saran rotasi layar untuk halaman berat chart
│   ├── AccessDeniedNotice.tsx       # Toast saat user dibelokkan middleware
│   ├── ServiceWorkerRegister.tsx    # Daftarkan service worker (PWA)
│   ├── PosNavbar.tsx / Receipt.tsx  # Komponen khusus halaman kasir
│   └── TrialBanner.tsx
├── lib/
│   ├── supabase/client.ts           # Supabase browser client
│   ├── supabase/server.ts           # Supabase server client (Server Components)
│   ├── getCurrentProfile.ts         # Helper ambil profil user yang login
│   ├── dexie.ts                     # IndexedDB offline cache + sync queue
│   ├── types.ts                     # Tipe TypeScript sesuai skema database
│   └── utils.ts                     # Format Rupiah, invoice number, dsb.
├── middleware.ts                    # Proteksi rute + Direct Role Routing + notif akses ditolak
├── public/
│   ├── manifest.json                # Web App Manifest (PWA)
│   ├── sw.js                        # Service worker (cache offline)
│   ├── offline.html                 # Fallback saat halaman belum pernah dibuka + offline
│   └── icons/                       # Ikon PWA (192px, 512px, apple-touch-icon)
├── supabase/
│   ├── schema.sql                   # DDL lengkap: tabel, RLS, RPC checkout_transaction, dll
│   └── migration_001_profiles_email_active.sql  # Migrasi kalau sudah pernah setup sebelumnya
└── .env.local.example
```

---

## 3. Instalasi & Menjalankan Secara Lokal

### Prasyarat
- Node.js 18.18 atau lebih baru
- Akun [Supabase](https://supabase.com) (gratis)

### Langkah-langkah

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Buat proyek Supabase baru**, buka **SQL Editor**, jalankan seluruh isi
   `supabase/schema.sql`. Ini membuat semua tabel, RLS per-tenant, fungsi
   `redeem_invite_code()` (atomic, anti race-condition), fungsi
   `checkout_transaction()` (total dihitung ulang di server), view laporan,
   dan 2 kode akses contoh (`CAPOSVIRAL` 100x, `DEMOSTUDIOD13` 1x).

   > Sudah pernah menjalankan `schema.sql` versi lama? Jalankan
   > `supabase/migration_001_profiles_email_active.sql` saja, tidak perlu
   > mulai dari nol.

3. **Buat bucket Storage** untuk foto menu: **Storage → New bucket** → nama
   **`menu-images`** (harus persis) → aktifkan **Public bucket**.

4. **Cek pengaturan email verifikasi**: **Authentication → Providers →
   Email** → pastikan **Confirm email** aktif (default-nya sudah aktif).

5. **Set template email supaya mengirim KODE OTP, bukan link.** Ini
   **wajib** dilakukan manual di Supabase Dashboard untuk **DUA** template
   sekaligus — satu untuk pendaftaran, satu untuk lupa password. Secara
   default, Supabase mengirim link (`{{ .ConfirmationURL }}`), bukan kode
   6 digit. caPOS memakai `supabase.auth.verifyOtp()` di halaman
   register/login/lupa-password, jadi kedua template harus diubah supaya
   menampilkan **kode**, bukan link:

   **a. Authentication → Email Templates → Confirm signup** (dipakai saat
   daftar akun baru):
   ```html
   <h2>Kode Verifikasi caPOS Anda</h2>
   <p>Masukkan kode berikut di aplikasi untuk mengaktifkan akun:</p>
   <h1 style="letter-spacing: 8px;">{{ .Token }}</h1>
   <p>Kode ini berlaku selama beberapa menit.</p>
   ```

   **b. Authentication → Email Templates → Reset Password** (dipakai saat
   klik "Lupa password?" di halaman login):
   ```html
   <h2>Kode Reset Password caPOS Anda</h2>
   <p>Masukkan kode berikut untuk atur ulang password akun Anda:</p>
   <h1 style="letter-spacing: 8px;">{{ .Token }}</h1>
   <p>Kalau Anda tidak meminta ini, abaikan email ini.</p>
   ```

   - Simpan (**Save**) di masing-masing template.
   - Kode OTP dari Supabase berlaku **60 detik** sebelum bisa di-resend, dan
     kedaluwarsa setelah periode tertentu (bisa diatur di **Authentication →
     Settings → Email OTP Expiry**, default 1 jam).

6. **Salin environment variables**
   ```bash
   cp .env.local.example .env.local
   ```
   Isi dengan kredensial dari **Supabase Dashboard → Project Settings → API**:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxxx
   SUPABASE_SERVICE_ROLE_KEY=xxxxx   # rahasia — jangan pernah dikirim ke browser
   NEXT_PUBLIC_STUDIO_D13_WHATSAPP=6281234567890
   ```

7. **Jalankan development server**
   ```bash
   npm run dev
   ```
   Buka [http://localhost:3000](http://localhost:3000).

---

## 4. Cara Membuat Akun Tiap Role

| Role | Cara buat |
|---|---|
| **Owner** | Daftar normal lewat `/register` pakai kode akses (`CAPOSVIRAL`/`DEMOSTUDIOD13`). Wajib klik link verifikasi di email sebelum bisa login. |
| **Super Admin** | **Tidak ada form publiknya** (sengaja). Daftar dulu sebagai owner biasa, lalu di **Supabase → Table Editor → profiles**, ubah kolom `role` akun tsb jadi `super_admin`. Logout–login ulang. |
| **Cashier** | Login sebagai owner → `/dashboard/cashiers` → **Tambah Kasir**. Akun langsung aktif (tidak perlu verifikasi email, karena yang membuat adalah owner-nya sendiri). |

Role menentukan halaman tujuan otomatis setelah login (`middleware.ts`):
`super_admin → /admin`, `owner → /dashboard`, `cashier → /pos`. Owner tetap
bisa membuka `/pos` kapan saja lewat link **"Buka Halaman Kasir (POS)"** di
sidebar dashboard. Kalau ada yang mencoba buka halaman di luar izin role-nya
(mis. kasir mengetik `/dashboard` manual di address bar), server otomatis
membelokkan balik ke halaman yang sesuai **dan menampilkan notifikasi**
kenapa itu terjadi.

---

## 5. PWA — Install ke Home Screen & Jalankan Offline

Aplikasi ini adalah **PWA (Progressive Web App)**: setelah di-deploy (bukan
`localhost`, harus HTTPS — Vercel otomatis HTTPS), browser akan mendeteksinya
sebagai "installable".

### Install ke Home Screen
- **Android (Chrome)**: buka URL app → banner **"Tambahkan ke layar Utama"**
  muncul otomatis, atau manual lewat menu titik tiga (⋮) → **Install app**.
- **iOS (Safari)**: buka URL app → tombol **Share** (kotak + panah ke atas)
  → **Add to Home Screen**. *(iOS tidak punya prompt otomatis — ini batasan
  dari Apple, harus manual lewat Safari.)*
- **Desktop (Chrome/Edge)**: ikon install muncul di ujung kanan address bar
  → klik → app terbuka sebagai window terpisah tanpa address bar.

### Cara kerja mode offline
Ada **dua lapis** mekanisme offline yang saling melengkapi:

1. **Service worker (`public/sw.js`)** — meng-cache halaman & aset statis
   yang **pernah dibuka**, supaya app tetap bisa terbuka walau HP offline
   total. Halaman yang belum pernah dibuka sama sekali akan menampilkan
   `public/offline.html` sebagai fallback.
2. **IndexedDB (`lib/dexie.ts`)** — khusus di halaman `/pos`, transaksi yang
   dibuat saat koneksi terputus tetap tersimpan di penyimpanan lokal
   perangkat (bukan cuma "halamannya kebuka", tapi **transaksinya beneran
   tersimpan**), lalu otomatis dikirim ke Supabase begitu koneksi kembali —
   lihat badge **Online/Offline** di navbar kasir.

**Cara tes mode offline**: buka `/pos` sekali saat online (supaya ter-cache),
lalu di Chrome DevTools (F12) → tab **Network** → ubah dropdown jadi
**Offline**. Badge navbar berubah merah, tapi kasir tetap bisa checkout —
cek transaksi yang tertunda di DevTools → **Application** → **IndexedDB** →
`caPOS_offline_db` → `pendingTransactions`.

---

## 6. Build Production

```bash
npm run build
npm run start
```

Untuk deploy: **Vercel** (frontend) + **Supabase Cloud** (backend). Setelah
deploy, jalankan checklist Bagian 5 di atas (install ke home screen) untuk
memastikan PWA-nya aktif dengan benar di URL production.

---

## 7. Catatan Implementasi Penting

- **Total transaksi dihitung di server**: `checkout_transaction()` di
  `schema.sql` mengambil ulang harga produk & diskon member dari database —
  klien hanya mengirim `product_id` + `qty`, tidak pernah harga/total
  langsung. Ini mencegah manipulasi total lewat DevTools/proxy.
- **RLS aktif di semua tabel**, termasuk `invite_codes` (hanya bisa
  dibaca/ditulis oleh `super_admin`).
- **Verifikasi email pakai kode OTP 6 digit** (bukan link) — dikirim lewat
  `auth.signUp()`, diverifikasi lewat `auth.verifyOtp({ email, token, type:
  "signup" })`. Kode diketik langsung di halaman register/login, tidak perlu
  keluar dari app untuk klik link. **Wajib** set template email di Supabase
  Dashboard ke `{{ .Token }}` (lihat Bagian 3 langkah 5) — kalau tidak
  diubah, Supabase tetap mengirim link dan `verifyOtp()` akan selalu gagal
  karena tidak ada kode untuk dicocokkan.
- **Lupa password juga pakai OTP** (`/forgot-password`) — sama seperti
  verifikasi signup: `auth.resetPasswordForEmail()` kirim kode 6 digit,
  lalu `auth.verifyOtp({ type: "recovery" })` sekaligus mengaktifkan sesi
  supaya password baru bisa langsung disimpan tanpa perlu login ulang.
  Pesan yang ditampilkan **selalu sama** baik email terdaftar maupun tidak,
  supaya endpoint ini tidak bisa dipakai untuk menebak daftar email
  terdaftar (user enumeration).
- **Modal seragam**: semua form (`Modal.tsx`) punya header & tombol aksi
  yang selalu terlihat di layar HP manapun — tidak ada lagi kasus tombol
  Simpan/Tutup ter-cut di luar layar.
- **Data demo tersisa**: hanya sebagai *fallback* saat tenant benar-benar
  belum punya data (mis. menu kosong di `/pos` untuk tenant baru) — begitu
  ada data asli di database, itu yang dipakai.

---

## 8. Dukungan

Ada pertanyaan seputar instalasi atau kustomisasi caPOS? Hubungi **Studio
D13** melalui tombol WhatsApp di halaman FAQ & Helpdesk dashboard, atau atur
nomor kontak di `NEXT_PUBLIC_STUDIO_D13_WHATSAPP` pada `.env.local`.
