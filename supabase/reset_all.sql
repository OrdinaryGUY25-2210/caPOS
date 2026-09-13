-- =========================================================
-- RESET TOTAL — kembalikan database Supabase ke kondisi KOSONG
-- (setara project baru), supaya bisa mulai lagi dari schema.sql +
-- migration_001 s/d migration_016 tanpa bentrok "already exists".
--
-- PERBAIKAN (merge notes): versi lama file ini cuma men-DROP tabel dari
-- Phase 1 (tenants/profiles/products/dst) secara manual satu-satu — jadi
-- kalau project sudah pernah menjalankan migration_002 s/d migration_016
-- (Phase 2/3/4: kitchen_stations, orders, branch_tables, reservations,
-- qr_orders, promotions, suppliers, dst — total puluhan tabel/fungsi/
-- tipe baru), banyak yang KETINGGALAN tidak ter-hapus, dan schema.sql
-- akan gagal lagi dengan error "already exists".
--
-- Solusinya sekarang jauh lebih sederhana & tidak akan pernah ketinggalan
-- lagi walau ke depan ditambah migration_015, 016, dst: hapus SELURUH
-- schema "public" (tempat semua tabel/fungsi/tipe kita hidup) lalu buat
-- ulang kosong, plus kembalikan izin akses standar Supabase.
--
-- ⚠️ INI MENGHAPUS SEMUA DATA DI SCHEMA PUBLIC TANPA TERKECUALI —
-- termasuk data transaksi, pelanggan, dan pengaturan tenant. Tidak bisa
-- dibatalkan. Jangan jalankan di project yang sedang dipakai orang lain /
-- ada data asli yang masih dibutuhkan. Lihat docs/PANDUAN_RESET_SUPABASE.md
-- untuk kapan & bagaimana file ini sebaiknya dipakai (termasuk cara
-- membuat backup terlebih dahulu lewat Supabase Dashboard).
-- =========================================================

-- 1. Hapus schema public beserta SELURUH isinya (tabel, view, function,
--    type, sequence, trigger, policy, index — semua ikut CASCADE).
DROP SCHEMA IF EXISTS public CASCADE;

-- 2. Buat ulang schema public yang kosong.
CREATE SCHEMA public;

-- 3. Kembalikan kepemilikan & izin dasar seperti bawaan project Supabase
--    baru — tanpa ini, langkah schema.sql sesudahnya bisa gagal karena
--    role `anon`/`authenticated`/`service_role` tidak punya akses apa pun
--    ke schema public yang baru dibuat.
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;

-- 4. Ekstensi yang dipakai schema.sql (UUID) — Supabase biasanya sudah
--    mengaktifkannya secara default, baris ini cuma jaga-jaga.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================================
-- SELESAI. Langkah selanjutnya (lihat docs/PANDUAN_RESET_SUPABASE.md):
--   1. Jalankan supabase/schema.sql
--   2. Jalankan migration_001 s/d migration_016 SATU PER SATU, berurutan
--   3. Daftar ulang akun Owner pertama lewat halaman /register aplikasi
-- =========================================================
