# Panduan Reset Total Supabase (Jaga-Jaga)

Dokumen ini untuk situasi **darurat/terencana** di mana kamu perlu
mengosongkan project Supabase caPOS dan memulai dari nol lagi — misalnya:
data uji coba sudah terlalu berantakan, mau bikin ulang struktur dari
awal, atau project lama mau "di-daur ulang" untuk dipakai bisnis baru.

> ⚠️ **INI MENGHAPUS SEMUA DATA SECARA PERMANEN** — semua tenant, semua
> transaksi, semua akun, tidak bisa dibatalkan. Baca sampai selesai
> sebelum menjalankan apa pun.

---

## Kapan SEBAIKNYA tidak pakai panduan ini

- Kalau cuma mau hapus 1-2 baris data (mis. 1 tenant tes) — hapus manual
  lewat **Table Editor** di Supabase Dashboard, jangan reset semuanya.
- Kalau project sudah dipakai bisnis nyata dengan data asli — reset total
  = kehilangan semua riwayat transaksi & pelanggan selamanya. Pertimbangkan
  bikin **project Supabase baru terpisah** untuk keperluan uji coba,
  biarkan project produksi tidak disentuh.

## Kapan panduan ini COCOK dipakai

- Project ini memang khusus untuk development/testing dan datanya boleh
  hilang.
- Kamu sengaja mau "mulai dari nol" (mis. struktur database berubah besar
  dan lebih gampang reset daripada migrasi data lama).

---

## Langkah 0 — Backup Dulu (Kalau Ragu)

Sebelum reset, ada baiknya backup dulu walau cuma untuk jaga-jaga:

1. Buka project Supabase → **Database → Backups**.
2. Kalau di plan Free, Supabase tetap menyimpan backup harian otomatis
   selama beberapa hari terakhir — cukup untuk kondisi darurat "eh
   ternyata masih butuh data lama".
3. Untuk backup manual sendiri: **Database → Backups → Download** (kalau
   tersedia di plan-mu), atau ekspor tabel penting satu-satu lewat
   **Table Editor → (pilih tabel) → Export → CSV**.

---

## Langkah 1 — Jalankan `reset_all.sql`

1. Buka **SQL Editor** di dashboard Supabase project yang mau di-reset.
2. **New query**, tempel **seluruh isi** file `supabase/reset_all.sql`
   dari paket ini.
3. Baca sekali lagi peringatan di bagian atas file itu.
4. Klik **Run**.

File ini bekerja dengan cara **menghapus seluruh schema `public`**
(tempat semua tabel/fungsi/tipe data caPOS berada) lalu membuat ulang
yang kosong, plus mengembalikan izin akses standar. Ini pendekatan yang
paling aman dipakai jangka panjang — **tidak akan pernah "ketinggalan"**
menghapus sesuatu walau nanti proyek ini ditambah fase 5, 6, dst, karena
tidak bergantung pada daftar tabel yang di-hardcode satu-satu.

Kalau berhasil, hasil query kosong tanpa error — itu normal/wajar untuk
perintah `DROP`/`CREATE SCHEMA`.

---

## Langkah 2 — Bangun Ulang dari Nol

Setelah `reset_all.sql` selesai, project Supabase kamu sekarang **benar-benar
kosong** (setara project baru yang belum pernah dijalankan apa pun). Ikuti
persis **Langkah 1a** di `docs/PANDUAN_INSTALASI_WEB.md` — jalankan
`schema.sql`, lalu `migration_001` sampai `migration_016` berurutan.

Tabel ringkas urutannya (salin dari `PANDUAN_INSTALASI_WEB.md` supaya
tidak perlu bolak-balik):

```
schema.sql
migration_001_profiles_email_active.sql
migration_002_fix_rls_recursion.sql
migration_003_midtrans_payments.sql
migration_004_subscription_plan.sql
migration_005_tiers_shifts_analytics.sql
migration_006_remove_invite_codes.sql
migration_007a_add_manager_role.sql   ← WAJIB dijalankan sendiri (nambah enum)
migration_007b_manager_features.sql
migration_008_referral_system.sql
migration_009_stock_hpp_target_evaluasi.sql
migration_010_admin_tools.sql
migration_011_multi_branch_stock_opname.sql
migration_012_phase2_kitchen_shift_cash.sql
migration_013_phase3_purchasing_crm_promosi_analitik.sql
migration_014_phase4_qr_reservasi_multichannel_growth.sql
migration_015_phase2_table_foundation.sql
migration_016_phase2_void_refund.sql
```

## Langkah 3 — Cek Replication (Realtime)

Buka **Database → Replication**, pastikan `approval_requests`, `orders`,
`qr_orders`, `reservations` aktif di publication `supabase_realtime` —
kadang perlu dicentang manual setelah reset.

## Langkah 4 — Daftar Ulang Akun Pertama

Karena tabel `auth.users` (akun login) **ikut terhapus** oleh
`reset_all.sql`, semua orang perlu daftar ulang dari `/register` —
termasuk akun Owner pertama. Tidak ada cara memulihkan akun lama setelah
reset; ini bagian dari konsekuensi "mulai dari nol".

> Catatan teknis: `DROP SCHEMA public CASCADE` **tidak** menyentuh schema
> `auth` bawaan Supabase (tempat sesungguhnya akun login disimpan), tapi
> tabel `profiles` di schema `public` (yang menyimpan nama, role, dan
> `tenant_id` tiap akun) **ikut terhapus**. Karena aplikasi caPOS selalu
> mengecek tabel `profiles`, secara praktis semua akun lama jadi tidak
> bisa dipakai lagi walau baris di `auth.users` masih ada — jadi
> perlakukan seolah "semua akun hilang" setelah reset.

---

## Kalau Tidak Mau Kehilangan Data Tapi Tetap Perlu "Mulai Bersih"

Alternatif yang lebih aman daripada reset total:
1. **Bikin project Supabase BARU** (project kedua, terpisah) khusus untuk
   keperluan yang butuh "mulai dari nol" itu.
2. Deploy ulang aplikasi Vercel ke project baru itu (ganti Environment
   Variables `NEXT_PUBLIC_SUPABASE_URL` dkk ke project baru, atau buat
   deployment Vercel kedua kalau ingin dua environment berjalan
   bersamaan — mis. `capos-produksi.vercel.app` dan
   `capos-staging.vercel.app`).
3. Project Supabase lama (dengan data asli) dibiarkan utuh, tidak
   disentuh sama sekali.

Ini cocok kalau kamu ingin lingkungan "staging/uji coba" yang terpisah
permanen dari data produksi asli.
