-- =========================================================
-- MIGRATION 018 — sambungkan halaman-halaman /dashboard/settings yang
-- sebelumnya presentation-only (Alert "Belum tersambung ke database") ke
-- data sungguhan.
--
-- Menyentuh:
--   1. app/dashboard/settings/business  -> kolom profil bisnis di tenants
--   2. app/dashboard/settings/receipt   -> kolom teks kwitansi di tenants
--      (tenants.receipt_paper_width sudah ada sejak migration_16, tapi
--      belum pernah ditulis dari mana pun — sekarang settings/receipt
--      yang menulisnya)
--   3. app/dashboard/settings/payment   -> tabel payment_methods_config baru
--   4. app/dashboard/settings/security  -> TIDAK butuh tabel baru: 2FA
--      dipindah ke Supabase Auth MFA bawaan (auth.mfa.*), "Sesi Aktif"
--      memakai session yang sedang berjalan (auth.getSession()). API Keys
--      tetap "Belum tersedia" — butuh infrastruktur otentikasi API
--      terpisah, di luar cakupan migrasi ini.
--
-- Aman dijalankan berkali-kali (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- =========================================================

-- ---------------------------------------------------------
-- 1 & 2. Kolom baru di tenants untuk Business Profile & Receipt text.
--    NPWP/alamat/dsb. sebelumnya tidak ada tempat penyimpanannya sama
--    sekali (lihat komentar lama di business/page.tsx) — kolom di bawah
--    ini yang mengisi kekosongan itu.
-- ---------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS business_email TEXT,
  ADD COLUMN IF NOT EXISTS business_category TEXT,
  ADD COLUMN IF NOT EXISTS tax_id TEXT,
  ADD COLUMN IF NOT EXISTS registration_number TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS province TEXT,
  ADD COLUMN IF NOT EXISTS postal_code TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Indonesia',
  ADD COLUMN IF NOT EXISTS receipt_header_text TEXT,
  ADD COLUMN IF NOT EXISTS receipt_footer_text TEXT;

COMMENT ON COLUMN tenants.business_email IS 'Email kontak bisnis (beda dari email login owner di profiles/auth) — diatur di /dashboard/settings/business.';
COMMENT ON COLUMN tenants.receipt_header_text IS 'Teks custom di atas kwitansi cetak — diatur di /dashboard/settings/receipt, dipakai components/Receipt.tsx & lib/receipt.ts.';
COMMENT ON COLUMN tenants.receipt_footer_text IS 'Teks custom di bawah kwitansi cetak — diatur di /dashboard/settings/receipt, dipakai components/Receipt.tsx & lib/receipt.ts.';

-- ---------------------------------------------------------
-- 3. payment_methods_config — 1 baris per tenant, dibaca/ditulis dari
--    /dashboard/settings/payment. Dipisah dari `tenants` (bukan ditambah
--    sebagai kolom lagi di sana) supaya nanti gampang dibaca juga dari
--    /pos untuk menyembunyikan tombol metode bayar yang dimatikan owner,
--    tanpa perlu SELECT seluruh baris tenants tiap transaksi.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_methods_config (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  cash_enabled BOOLEAN NOT NULL DEFAULT true,
  card_enabled BOOLEAN NOT NULL DEFAULT true,
  ewallet_enabled BOOLEAN NOT NULL DEFAULT true,
  bank_transfer_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE payment_methods_config IS 'Metode pembayaran yang diaktifkan per tenant — diatur di /dashboard/settings/payment. Baris dibuat on-demand (upsert) saat owner pertama kali menyimpan; tidak ada baris = anggap semua default (cash/card/ewallet ON, transfer OFF), sama seperti tampilan awal halaman.';

ALTER TABLE payment_methods_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PaymentMethodsConfig: view own tenant" ON payment_methods_config;
CREATE POLICY "PaymentMethodsConfig: view own tenant" ON payment_methods_config
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "PaymentMethodsConfig: owner/manager write" ON payment_methods_config;
CREATE POLICY "PaymentMethodsConfig: owner/manager write" ON payment_methods_config
  FOR INSERT WITH CHECK (is_super_admin() OR (tenant_id = current_tenant_id() AND is_manager_or_owner()));

DROP POLICY IF EXISTS "PaymentMethodsConfig: owner/manager update" ON payment_methods_config;
CREATE POLICY "PaymentMethodsConfig: owner/manager update" ON payment_methods_config
  FOR UPDATE USING (is_super_admin() OR (tenant_id = current_tenant_id() AND is_manager_or_owner()))
  WITH CHECK (is_super_admin() OR (tenant_id = current_tenant_id() AND is_manager_or_owner()));

-- ---------------------------------------------------------
-- 4. Perketat penulisan tabel `tenants`.
--    Policy lama "Tenants: own tenant or super_admin" adalah FOR ALL
--    tanpa WITH CHECK terpisah, yang berarti SEMUA role di tenant itu
--    (termasuk cashier) sebetulnya sudah bisa UPDATE/DELETE baris
--    tenants-nya sendiri langsung lewat REST API, bukan cuma SELECT.
--    Belum pernah dipakai (tidak ada kode yang menulis ke tenants sejauh
--    ini), tapi sekarang settings/business & settings/receipt MULAI
--    menulis ke tabel ini, jadi celahnya perlu ditutup dulu: pisah jadi
--    SELECT (tetap semua anggota tenant, dipakai /pos baca wifi & lebar
--    kertas) dan UPDATE (owner/manager saja). INSERT/DELETE tenants tetap
--    hanya lewat service-role key di app/api/register & app/api/account
--    (bypass RLS), jadi sengaja tidak dibuka policy-nya di sini.
-- ---------------------------------------------------------
DROP POLICY IF EXISTS "Tenants: own tenant or super_admin" ON tenants;

CREATE POLICY "Tenants: view own tenant or super_admin" ON tenants
  FOR SELECT USING (is_super_admin() OR id = current_tenant_id());

CREATE POLICY "Tenants: owner/manager update own tenant" ON tenants
  FOR UPDATE USING (is_super_admin() OR (id = current_tenant_id() AND is_manager_or_owner()))
  WITH CHECK (is_super_admin() OR (id = current_tenant_id() AND is_manager_or_owner()));
