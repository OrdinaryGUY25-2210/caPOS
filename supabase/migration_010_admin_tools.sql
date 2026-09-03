-- =========================================================
-- Migration 010 — Perkakas Super Admin: perbaiki kode referral yang
-- hilang, dan kode khusus Super Admin yang bisa dibuat banyak & punya
-- masa berlaku sendiri (menggantikan SUPER_ADMIN_REFERRAL_CODE yang
-- sebelumnya cuma 1 kode statis dari .env, tanpa kedaluwarsa).
-- Jalankan SETELAH migration_009. Semua ADDITIF.
-- =========================================================

-- 1. Fungsi bantu: Super Admin bisa buat/ganti kode referral tenant yang
--    baris `referrals`-nya hilang (mis. akun dibuat sebelum tabel ini
--    ada, atau dibuat manual). Tidak ada policy INSERT/UPDATE di tabel
--    `referrals` untuk client biasa (memang disengaja, cuma service-role
--    yang boleh nulis lewat /api/register) — makanya butuh fungsi
--    SECURITY DEFINER khusus, dengan pengecekan is_super_admin() sendiri.
CREATE OR REPLACE FUNCTION admin_upsert_referral_code(p_tenant_id UUID, p_code TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Super Admin yang boleh mengatur kode referral tenant lain.';
  END IF;

  INSERT INTO referrals (tenant_id, code)
    VALUES (p_tenant_id, p_code)
  ON CONFLICT (tenant_id) DO UPDATE SET code = EXCLUDED.code;
END;
$$;

-- 2. Kode khusus Super Admin — bisa dibuat banyak, tiap kode punya masa
--    berlaku sendiri (expires_at), lama trial Supreme yang diberikan
--    (trial_days), diskon pendaftar (discount_pct), dan batas pemakaian
--    opsional (max_uses, NULL = tak terbatas).
CREATE TABLE IF NOT EXISTS admin_special_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  trial_days INT NOT NULL DEFAULT 5,
  discount_pct NUMERIC NOT NULL DEFAULT 2,
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INT,
  used_count INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  note TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE admin_special_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Special codes: super admin only" ON admin_special_codes;
CREATE POLICY "Special codes: super admin only" ON admin_special_codes
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- 3. Redeem kode khusus saat registrasi. Dipanggil dari /api/register
--    (service role, jadi RLS di atas tidak menghalangi jalannya proses
--    registrasi orang biasa). Return kosong (0 baris) kalau kode tidak
--    valid/aktif/sudah kedaluwarsa/sudah habis jatah pemakaian.
CREATE OR REPLACE FUNCTION redeem_special_code(p_code TEXT, p_new_tenant_id UUID)
RETURNS TABLE(trial_days INT, discount_pct NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row admin_special_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM admin_special_codes WHERE code = p_code FOR UPDATE;

  IF v_row.id IS NULL
     OR NOT v_row.is_active
     OR v_row.expires_at < now()
     OR (v_row.max_uses IS NOT NULL AND v_row.used_count >= v_row.max_uses) THEN
    RETURN; -- kosong = tidak valid, biar caller lanjut coba kode referral biasa
  END IF;

  UPDATE admin_special_codes SET used_count = used_count + 1 WHERE id = v_row.id;

  trial_days := v_row.trial_days;
  discount_pct := v_row.discount_pct;
  RETURN NEXT;
END;
$$;

-- =========================================================
-- Setelah migrasi ini:
--  - Buat kode khusus baru lewat /admin (section "Kode Khusus Admin").
--  - Env var SUPER_ADMIN_REFERRAL_CODE sudah TIDAK dipakai lagi setelah
--    kode di app/api/register/route.ts diperbarui — boleh dihapus dari
--    .env kapan saja, tidak akan mempengaruhi apa pun.
-- =========================================================
