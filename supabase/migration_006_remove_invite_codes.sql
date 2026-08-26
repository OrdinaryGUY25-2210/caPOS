-- =========================================================
-- MIGRASI OPSIONAL: Hapus sisa sistem Kode Akses/Referral
--
-- Sejak registrasi dibuka bebas (tanpa kode akses), tabel invite_codes
-- dan fungsi redeem_invite_code() sudah TIDAK DIPAKAI SAMA SEKALI oleh
-- kode aplikasi. Membiarkannya tidak berbahaya (tidak ada yang
-- memanggilnya), tapi migrasi ini tersedia kalau kamu mau database-nya
-- bersih dari sisa fitur yang sudah tidak dipakai.
--
-- Aman dijalankan berkali-kali. TIDAK mempengaruhi tenant/user yang
-- sudah terlanjur daftar pakai kode akses dulu — mereka tetap ada,
-- yang dihapus cuma tabel kode aksesnya sendiri.
-- =========================================================

DROP POLICY IF EXISTS "Invite codes: super_admin only" ON invite_codes;
DROP FUNCTION IF EXISTS redeem_invite_code(TEXT) CASCADE;
DROP TABLE IF EXISTS invite_codes CASCADE;
