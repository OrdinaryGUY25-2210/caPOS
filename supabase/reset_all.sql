-- =========================================================
-- RESET TOTAL — hapus SEMUA objek caPOS dari database
--
-- Jalankan file ini SEBELUM menjalankan schema.sql dari nol, kalau kamu
-- ingin mulai bersih tapi sebelumnya sempat menghapus tabel secara manual
-- (yang biasanya TIDAK ikut menghapus custom type, function, sequence,
-- dan view — makanya schema.sql gagal dengan error seperti
-- `type "sub_status" already exists`).
--
-- Urutan DROP di bawah ini penting: view/tabel dulu (yang bergantung ke
-- tipe/fungsi), baru fungsi, baru sequence, baru tipe paling akhir.
-- CASCADE otomatis ikut menghapus semua policy, index, trigger, dan
-- foreign key yang menempel — jadi aman dijalankan sekali untuk
-- membersihkan semuanya sekaligus.
--
-- ⚠️ INI MENGHAPUS SEMUA DATA. Jangan jalankan di project yang sedang
-- dipakai orang lain / ada data asli yang masih dibutuhkan.
-- =========================================================

DROP VIEW IF EXISTS daily_sales_analytics CASCADE;

DROP TABLE IF EXISTS transaction_items CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS memberships CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS invite_codes CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

DROP FUNCTION IF EXISTS checkout_transaction(UUID, UUID, TEXT, TEXT, TEXT, JSONB) CASCADE;
DROP FUNCTION IF EXISTS redeem_invite_code(TEXT) CASCADE;
DROP FUNCTION IF EXISTS current_tenant_id() CASCADE;
DROP FUNCTION IF EXISTS is_super_admin() CASCADE;

DROP SEQUENCE IF EXISTS member_seq CASCADE;

DROP TYPE IF EXISTS sub_status CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;

-- Selesai. Sekarang jalankan supabase/schema.sql seperti biasa (dari nol,
-- tanpa error "already exists" lagi).
