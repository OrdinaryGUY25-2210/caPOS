-- =========================================================
-- MIGRASI: jalankan file ini HANYA JIKA kamu sudah pernah menjalankan
-- schema.sql versi sebelumnya (yang belum punya kolom email/is_active di
-- profiles). Kalau kamu baru pertama kali setup, LANGSUNG pakai schema.sql
-- saja — file ini tidak perlu dijalankan karena kolomnya sudah otomatis ada.
-- =========================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Isi ulang kolom email untuk baris yang sudah ada, dari data auth.users
UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;
