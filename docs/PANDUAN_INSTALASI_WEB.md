# Panduan Instalasi caPOS — 100% Lewat Web (Tanpa Laptop/Terminal)

Panduan ini mengasumsikan kamu **tidak** mau/perlu install Node.js, Git,
atau buka Terminal di komputer. Semua langkah dilakukan lewat browser:
dashboard Supabase, website GitHub, dan dashboard Vercel.

Waktu yang dibutuhkan: kurang lebih 30-45 menit untuk instalasi pertama.

---

## Langkah 0 — Yang Perlu Disiapkan

- Akun email untuk daftar ke [supabase.com](https://supabase.com),
  [github.com](https://github.com), dan [vercel.com](https://vercel.com)
  (bisa pakai akun GitHub yang sama untuk login ke Vercel & Supabase,
  lebih cepat).
- Akun [Midtrans](https://midtrans.com) (untuk pembayaran langganan &
  QRIS) — boleh disiapkan belakangan, aplikasi tetap jalan tanpa ini
  (fitur pembayaran online-nya saja yang belum aktif).
- File proyek ini (folder `capos/`) dalam bentuk ZIP, sudah di
  komputer/HP kamu.

---

## Langkah 1 — Buat Project Supabase

1. Buka [supabase.com/dashboard](https://supabase.com/dashboard) → **New
   Project**.
2. Isi nama project (mis. `capos-produksi`), buat **Database Password**
   yang kuat — **simpan password ini**, akan dipakai lagi.
3. Pilih region terdekat (mis. Singapore untuk Indonesia).
4. Tunggu 1-2 menit sampai project selesai dibuat.

### 1a. Jalankan skema database

Semua ini dilakukan di menu **SQL Editor** (ikon `</>`) di sidebar kiri
dashboard Supabase — **New query**, tempel isi file, klik **Run**.
Kerjakan **berurutan**, satu file selesai baru lanjut file berikutnya:

| Urutan | File | Catatan |
|---|---|---|
| 1 | `supabase/schema.sql` | Fondasi (Fase 1) |
| 2 | `supabase/migration_001_profiles_email_active.sql` | |
| 3 | `supabase/migration_002_fix_rls_recursion.sql` | Penting — perbaikan keamanan |
| 4 | `supabase/migration_003_midtrans_payments.sql` | |
| 5 | `supabase/migration_004_subscription_plan.sql` | |
| 6 | `supabase/migration_005_tiers_shifts_analytics.sql` | |
| 7 | `supabase/migration_006_remove_invite_codes.sql` | |
| 8 | `supabase/migration_007a_add_manager_role.sql` | **WAJIB dijalankan SENDIRI** — menambah enum, jangan digabung query lain dalam satu klik Run |
| 9 | `supabase/migration_007b_manager_features.sql` | |
| 10 | `supabase/migration_008_referral_system.sql` | |
| 11 | `supabase/migration_009_stock_hpp_target_evaluasi.sql` | |
| 12 | `supabase/migration_010_admin_tools.sql` | |
| 13 | `supabase/migration_011_multi_branch_stock_opname.sql` | |
| 14 | `supabase/migration_012_phase2_kitchen_shift_cash.sql` | Dapur, Shift, Kas |
| 15 | `supabase/migration_013_phase3_purchasing_crm_promosi_analitik.sql` | Purchasing, CRM, Promosi |
| 16 | `supabase/migration_014_phase4_qr_reservasi_multichannel_growth.sql` | QR Meja, Reservasi, Online Order |
| 17 | `supabase/migration_015_phase2_table_foundation.sql` | Status meja CLEANING, audit_log, /pos disambungkan ke meja & dapur |
| 18 | `supabase/migration_016_phase2_void_refund.sql` | Void item/pesanan (pra-bayar), Refund penuh/sebagian/item (pasca-bayar) + persetujuan manager |

Kalau salah satu file menampilkan error, **berhenti** — jangan lanjut ke
file berikutnya. Baca pesan errornya (biasanya "already exists" berarti
file itu sudah pernah dijalankan sebelumnya, aman untuk dilewati), atau
screenshot dan tanyakan ke developer.

### 1b. Aktifkan Realtime untuk tabel yang butuh notifikasi live

Buka **Database → Replication** di sidebar. Pastikan tabel-tabel berikut
tercentang aktif di publication `supabase_realtime`:
`approval_requests`, `orders`, `qr_orders`, `reservations`.
(Migrasi sudah mencoba mengaktifkannya otomatis, tapi Supabase kadang
butuh konfirmasi manual lewat UI ini.)

### 1c. Catat kredensial project

Buka **Project Settings → API**. Kamu akan butuh 3 nilai ini nanti:
- **Project URL** (`https://xxxxx.supabase.co`)
- **anon public key**
- **service_role key** (klik "Reveal" — ini rahasia, jangan disebar)

### 1d. Setup Storage (untuk foto menu)

Buka **Storage** di sidebar → **New bucket** → nama `product-images` →
centang **Public bucket** → Create.

### 1e. Setup Email OTP (opsional tapi disarankan)

Buka **Authentication → Email Templates**, sesuaikan template "Confirm
signup" kalau mau branding sendiri. Untuk produksi, disarankan setup SMTP
sendiri di **Project Settings → Auth → SMTP Settings** (supaya email
verifikasi tidak masuk folder Spam) — Supabase punya kuota gratis
terbatas per hari untuk email bawaan.

---

## Langkah 2 — Upload Proyek ke GitHub (Lewat Web)

1. Buka [github.com/new](https://github.com/new) → beri nama repo (mis.
   `capos-app`) → pilih **Private** (disarankan, karena kode berisi logika
   bisnis) → **Create repository**.
2. Di halaman repo kosong yang muncul, cari link kecil bertuliskan
   **"uploading an existing file"** → klik.
3. **Ekstrak dulu ZIP proyek ini di komputer/HP kamu**, lalu drag & drop
   **seluruh isi folder `capos/`** (bukan folder `capos` itu sendiri,
   tapi isinya: `app/`, `components/`, `package.json`, dst) ke area
   upload GitHub.
4. Tunggu proses upload (bisa beberapa menit karena banyak file), lalu
   scroll ke bawah, klik **Commit changes**.

> **Alternatif kalau GitHub web menolak upload folder bertingkat**
> (kadang terjadi untuk repo besar): pakai [GitHub Desktop](https://desktop.github.com)
> (aplikasi resmi GitHub, bukan terminal — tinggal klik-klik) atau minta
> bantuan developer untuk `git push` sekali saja. Setelah itu, semua
> update selanjutnya tetap bisa lewat web GitHub (edit file langsung di
> browser) atau Vercel akan auto-deploy tiap ada perubahan.

---

## Langkah 3 — Deploy ke Vercel

1. Buka [vercel.com/new](https://vercel.com/new), login pakai akun GitHub
   yang sama.
2. Klik **Import** di sebelah repo `capos-app` yang barusan dibuat.
3. Di halaman **Configure Project**, buka bagian **Environment
   Variables**, isi satu per satu (nilai dari Langkah 1c, dan Midtrans
   kalau sudah punya):

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL dari Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
   | `NEXT_PUBLIC_STUDIO_D13_WHATSAPP` | nomor WA format `628xxxxxxxxxx` |
   | `MIDTRANS_SERVER_KEY` | dari dashboard Midtrans (boleh diisi belakangan) |
   | `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | dari dashboard Midtrans |
   | `MIDTRANS_IS_PRODUCTION` | `false` dulu untuk uji coba (Sandbox) |
   | `NEXT_PUBLIC_MIDTRANS_IS_PRODUCTION` | `false` dulu |

4. Klik **Deploy**. Tunggu 2-4 menit.
5. Setelah selesai, Vercel memberi domain gratis seperti
   `capos-app.vercel.app` — ini sudah bisa langsung dipakai/dites.

### 3a. (Opsional) Domain sendiri

Di project Vercel → **Settings → Domains** → masukkan domain kamu
(mis. `kasir.namakafemu.com`) → ikuti instruksi menambahkan record DNS
di penyedia domain kamu (semua lewat web, tidak perlu terminal).

---

## Langkah 4 — Daftar Akun Owner Pertama

1. Buka domain Vercel-mu → `/register`.
2. Isi data kafe & akun Owner. Kolom Kode Referral dikosongkan saja untuk
   akun pertama.
3. Cek email untuk kode OTP verifikasi.
4. Login → kamu masuk ke `/dashboard`.

---

## Langkah 5 — Setup Midtrans (Kalau Belum)

1. Daftar di [dashboard.midtrans.com](https://dashboard.midtrans.com),
   mode **Sandbox** dulu untuk uji coba.
2. **Settings → Access Keys** → salin **Server Key** & **Client Key** →
   masukkan ke Environment Variables Vercel (Langkah 3), lalu **Redeploy**
   (di Vercel: tab **Deployments** → titik tiga di deployment terakhir →
   **Redeploy**).
3. **Settings → Configuration → Payment Notification URL**, isi:
   ```
   https://domain-kamu.vercel.app/api/midtrans/notification
   ```
   Satu URL ini menangani **baik** notifikasi pembayaran langganan
   **maupun** pembayaran QRIS pesanan QR Meja (Fase 4) — sudah digabung
   otomatis di kode, tidak perlu daftar dua URL.
4. Kalau sudah siap go-live: ganti ke Server Key/Client Key **Production**
   di Vercel, ubah `MIDTRANS_IS_PRODUCTION` & `NEXT_PUBLIC_MIDTRANS_IS_PRODUCTION`
   jadi `true`, Redeploy.

---

## Langkah 6 — Cek Cepat Semua Fase Berfungsi

- [ ] Login Owner → `/dashboard` tampil laporan (kosong, wajar untuk
      instalasi baru).
- [ ] `/dashboard/employees` → buat 1 akun Kasir.
- [ ] Login Kasir → `/pos` → tambah 1 menu (via Owner di
      `/dashboard/menu` dulu kalau menu masih kosong) → checkout.
- [ ] `/kitchen` → pesanan dari kasir tadi muncul di KDS (Fase 2).
- [ ] `/dashboard/qr-tables` → tambah 1 meja, download QR-nya, buka link
      `/order/...` di HP lain → coba pesan (Fase 4).
- [ ] `/dashboard/purchasing/suppliers` → tambah 1 pemasok (Fase 3).

Kalau semua ini jalan, instalasi selesai dan seluruh 4 fase aktif.

---

## Update Aplikasi di Kemudian Hari

Karena semua sudah tersambung lewat GitHub → Vercel, update berikutnya
**tidak perlu ulangi semua langkah di atas**:
- Kalau developer memberi file baru/perbaikan: upload/replace file itu
  lewat web GitHub (buka file di repo → ikon pensil **Edit** → paste isi
  baru → **Commit**) → Vercel otomatis deploy ulang dalam 1-2 menit.
- Kalau ada migration SQL baru (mis. `migration_015...sql` di masa
  depan): jalankan **hanya file baru itu** di Supabase SQL Editor,
  seperti Langkah 1a — jangan ulangi migration lama.
