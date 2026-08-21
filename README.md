# caPOS — Point of Sale Kafe by Studio D13

Aplikasi Web App SaaS POS Kafe berbasis **Next.js (App Router)**, **Tailwind CSS**,
**Lucide Icons**, **Dexie.js (IndexedDB, offline-first)**, dan **Supabase** (Auth + Postgres + Storage).

---

## 1. Fitur Utama

- **Kasir (`/pos`)** — pencarian & filter kategori menu, keranjang, diskon member via kode/QR,
  cetak struk thermal 58mm/80mm (dengan opsi WiFi kafe di struk), dan **mode Offline**
  (transaksi tetap bisa diproses lewat IndexedDB dan disinkron otomatis saat online kembali).
- **Dashboard Owner (`/dashboard`)** — laporan omzet (bar/line/donut chart), kelola menu & stok,
  manajemen akun kasir, membership, pengaturan kafe, FAQ & helpdesk, status langganan/trial.
- **Super Admin (`/admin`)** — daftar tenant, generator kode akses registrasi dengan kuota,
  akses tanpa batas ke seluruh halaman untuk kebutuhan demo/konten.
- **Registrasi terkunci kode akses** dengan kuota maksimal 100 pendaftaran per kode promo
  (anti-abuse trial), divalidasi secara atomik di database agar aman dari race condition.

---

## 2. Struktur Proyek

```
capos/
├── app/
│   ├── page.tsx                 # Login (root, tanpa landing page)
│   ├── login/page.tsx           # Alias dari root login
│   ├── register/page.tsx        # Registrasi + validasi kode akses
│   ├── api/register/route.ts    # API: redeem kode akses (atomic) + buat tenant/user
│   ├── pos/page.tsx              # Halaman Kasir
│   ├── dashboard/
│   │   ├── layout.tsx           # Sidebar + trial banner
│   │   ├── page.tsx             # Laporan & Omzet
│   │   ├── menu/page.tsx        # Kelola Menu & Stok
│   │   ├── cashiers/page.tsx    # Manajemen Kasir
│   │   ├── membership/page.tsx  # Membership (Skenario A/B)
│   │   ├── settings/page.tsx    # Pengaturan Kafe (WiFi struk, dll)
│   │   ├── faq/page.tsx         # FAQ & Helpdesk
│   │   └── subscription/page.tsx# Status Langganan
│   └── admin/page.tsx           # Super Admin Control Panel
├── components/                  # PosNavbar, Receipt, DashboardSidebar, TrialBanner
├── lib/
│   ├── supabase/client.ts       # Supabase browser client
│   ├── supabase/server.ts       # Supabase server client (Server Components)
│   ├── dexie.ts                 # IndexedDB offline cache + sync queue
│   ├── types.ts                 # Tipe TypeScript sesuai skema database
│   └── utils.ts                 # Format Rupiah, invoice number, dsb.
├── middleware.ts                # Proteksi rute + Direct Role Routing
├── supabase/schema.sql          # DDL lengkap: tabel, RLS, fungsi redeem_invite_code()
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

2. **Buat proyek Supabase baru**, lalu buka **SQL Editor** dan jalankan seluruh isi file
   `supabase/schema.sql`. File ini akan membuat:
   - Semua tabel (tenants, subscriptions, profiles, invite_codes, products, memberships,
     transactions, transaction_items)
   - View `daily_sales_analytics` untuk grafik dashboard
   - Fungsi `redeem_invite_code()` yang memvalidasi & menambah `used_count` kode akses
     secara **atomik** (row lock) agar kuota 100 tenant tidak bisa terlewati meski ada
     banyak pendaftaran bersamaan
   - Row Level Security (RLS) di semua tabel, dibatasi per `tenant_id`
   - 2 kode akses contoh: `CAPOSVIRAL` (max 100x) dan `DEMOSTUDIOD13` (1x pakai)

3. **Salin environment variables**
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

4. **Buat akun Super Admin pertama**
   - Daftar seperti biasa lewat `/register` menggunakan kode `DEMOSTUDIOD13`.
   - Di Supabase Dashboard → Table Editor → `profiles`, ubah kolom `role` akun tersebut
     menjadi `super_admin`.

5. **Jalankan development server**
   ```bash
   npm run dev
   ```
   Buka [http://localhost:3000](http://localhost:3000).

---

## 4. Build Production

```bash
npm run build
npm run start
```

Untuk deploy, disarankan **Vercel** (frontend/Next.js) + **Supabase Cloud** (backend),
sesuai arsitektur 100% cloud-hosted yang menjadi basis desain caPOS.

---

## 5. Catatan Implementasi Penting

- **Mode Offline Kasir**: `lib/dexie.ts` menyimpan cache menu/member dan antrian transaksi
  di IndexedDB browser. Saat status berubah ke "Offline", transaksi tetap tersimpan lokal
  lalu disinkronkan otomatis via `syncPendingTransactions()` saat koneksi kembali.
- **Kuota Registrasi**: validasi dilakukan di server (`app/api/register/route.ts`) memakai
  `SUPABASE_SERVICE_ROLE_KEY`, memanggil fungsi Postgres `redeem_invite_code()` yang
  mengunci baris (`FOR UPDATE`) sehingga aman dari race condition saat banyak pendaftar
  bersamaan mendekati batas 100.
- **Super Admin Bypass**: fungsi `is_super_admin()` di RLS dan pengecekan role di
  `middleware.ts` memastikan akun `super_admin` bisa mengakses seluruh halaman tanpa
  terhalang status trial/expired tenant manapun.
- **Membership Skenario A/B**: `app/dashboard/membership/page.tsx` membaca
  `tenants.has_custom_website` untuk menampilkan kartu promosi upgrade (Skenario A)
  atau panel kelola member penuh (Skenario B).
- **Struk Thermal**: `components/Receipt.tsx` dirender dengan lebar `58mm`/`80mm` dan
  memakai CSS `@media print` (lihat `app/globals.css`) agar hanya area struk yang tercetak.
  Untuk printer Bluetooth thermal, tambahkan integrasi Web Bluetooth API sesuai driver
  printer yang digunakan.
- **Data demo**: banyak halaman dashboard (laporan, menu, kasir, member, tenant admin)
  saat ini memakai data contoh (`DEMO_*`) agar tampilan bisa langsung dilihat tanpa
  koneksi Supabase. Ganti dengan query Supabase (`createClient().from(...)`) setelah
  skema database aktif.

---

## 6. Dukungan

Ada pertanyaan seputar instalasi atau kustomisasi caPOS? Hubungi **Studio D13** melalui
tombol WhatsApp yang tersedia di halaman FAQ & Helpdesk dashboard, atau atur nomor kontak
di `NEXT_PUBLIC_STUDIO_D13_WHATSAPP` pada `.env.local`.
