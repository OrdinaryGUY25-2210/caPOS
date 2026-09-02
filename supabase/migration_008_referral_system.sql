-- =========================================================
-- MIGRASI 008 — Sistem Referral & Diskon
-- Jalankan setelah migration_007a & 007b. Aman dijalankan berkali-kali.
-- =========================================================

-- Kolom tambahan di subscriptions untuk tracking diskon per tenant
ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_pct NUMERIC DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS referred_by_code TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pending_signup_discount_pct NUMERIC DEFAULT 0;
-- ^ diisi 2 kalau daftar pakai kode referral (siapapun, termasuk kode
--   Super Admin), dikonsumsi (kembali ke 0) begitu pembayaran PERTAMA
--   berhasil — sesuai spesifikasi "khusus transaksi pembayaran pertama".
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS super_trial_ends_at TIMESTAMPTZ;
-- ^ HANYA diisi kalau daftar pakai kode khusus Super Admin: now()+5 hari.
--   Selama masih di bawah tanggal ini, tenant dianggap tier 'supreme'
--   penuh TANPA bayar. Setelah lewat, otomatis jatuh balik ke tier
--   'free' standar — sisa masa trial_ends_at (28 hari sejak awal) TETAP
--   jalan seperti biasa, jadi totalnya: 5 hari akses penuh + 23 hari
--   sisa trial standar = 28 hari total, bukan 28+5.

-- 1 tenant = 1 kode referral permanen (dibuat otomatis saat registrasi).
CREATE TABLE IF NOT EXISTS referrals (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  accumulated_uses INT NOT NULL DEFAULT 0, -- 0-5, tiap +1 = +3% (maks 15%)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Log siapa memakai kode siapa — dipakai untuk (a) mencegah 1 tenant
-- dihitung reward-nya dua kali kalau dia bayar berkali-kali, dan (b)
-- tampilkan riwayat "5 orang terakhir pakai kode saya" di halaman
-- Program Referral.
CREATE TABLE IF NOT EXISTS referral_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  referrer_tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  referred_tenant_id UUID UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  reward_granted BOOLEAN NOT NULL DEFAULT false, -- true setelah referred_tenant top-up pertama & referrer dapat +3%
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Referrals: own tenant or super_admin" ON referrals;
CREATE POLICY "Referrals: own tenant or super_admin" ON referrals
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "Referral redemptions: view own" ON referral_redemptions;
CREATE POLICY "Referral redemptions: view own" ON referral_redemptions
  FOR SELECT USING (
    is_super_admin()
    OR referrer_tenant_id = current_tenant_id()
    OR referred_tenant_id = current_tenant_id()
  );

-- Semua PENULISAN ke referrals/referral_redemptions HANYA lewat service
-- role (server) di /api/register dan webhook Midtrans — tidak ada policy
-- INSERT/UPDATE untuk client biasa, supaya angka akumulasi diskon tidak
-- bisa dimanipulasi langsung dari browser.

CREATE INDEX IF NOT EXISTS idx_referral_redemptions_referrer ON referral_redemptions (referrer_tenant_id, reward_granted);

-- =========================================================
-- Perbarui tenant_tier(): kalau masih dalam window super_trial_ends_at,
-- tenant dianggap 'supreme' penuh walau belum bayar.
-- =========================================================
CREATE OR REPLACE FUNCTION tenant_tier(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN super_trial_ends_at IS NOT NULL AND super_trial_ends_at > now() THEN 'supreme'
    WHEN status = 'active' AND plan = 'yearly' THEN 'supreme'
    WHEN status = 'active' AND plan = 'monthly' THEN 'pro'
    ELSE 'free'
  END
  FROM subscriptions WHERE tenant_id = p_tenant_id;
$$;

-- =========================================================
-- FUNGSI: Redeem kode referral saat registrasi (atomic, cegah race
-- condition kalau kode sama dipakai bersamaan). Dipanggil dari
-- /api/register lewat service role.
-- Return: 'super_admin' | 'referrer' | 'invalid'
-- =========================================================
CREATE OR REPLACE FUNCTION redeem_referral_code(p_code TEXT, p_new_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_referrer_tenant_id UUID;
BEGIN
  -- Kode khusus Super Admin dicek di kode aplikasi (dibandingkan dengan
  -- env var), BUKAN di sini — fungsi ini hanya menangani kode referral
  -- biasa milik tenant lain.
  SELECT tenant_id INTO v_referrer_tenant_id FROM referrals WHERE code = p_code FOR UPDATE;

  IF v_referrer_tenant_id IS NULL THEN
    RETURN 'invalid';
  END IF;

  IF v_referrer_tenant_id = p_new_tenant_id THEN
    RETURN 'invalid'; -- tidak boleh pakai kode sendiri
  END IF;

  INSERT INTO referral_redemptions (code, referrer_tenant_id, referred_tenant_id)
    VALUES (p_code, v_referrer_tenant_id, p_new_tenant_id);

  RETURN 'referrer';
END;
$$;

-- =========================================================
-- FUNGSI: Proses reward referral setelah pembayaran PERTAMA seorang
-- tenant berhasil. Dipanggil dari webhook Midtrans.
--
-- 1. Kalau tenant ini sebelumnya direferral orang lain & reward belum
--    diberikan -> referrer dapat +3% (maks 5x/15%).
-- 2. Kalau tenant ini SENDIRI sedang punya akumulasi diskon (dari orang
--    yang dia referral) -> diskon itu dianggap "terpakai" untuk
--    pembayaran ini, dan LANGSUNG DI-RESET ke 0 saat itu juga — TIDAK
--    perlu menunggu akumulasi penuh 5/5 dulu. Ini sesuai permintaan:
--    kalau baru kepakai 2x (6%) terus dia top up, ya 6% itu yang
--    kepakai, dan counter langsung balik ke 0/5 dari titik itu.
-- =========================================================
CREATE OR REPLACE FUNCTION process_referral_on_payment(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- (1) Beri reward ke referrer tenant ini, kalau ada & belum pernah.
  UPDATE referrals r
  SET accumulated_uses = LEAST(r.accumulated_uses + 1, 5)
  FROM referral_redemptions rr
  WHERE rr.referred_tenant_id = p_tenant_id
    AND rr.reward_granted = false
    AND r.tenant_id = rr.referrer_tenant_id;

  UPDATE referral_redemptions
  SET reward_granted = true
  WHERE referred_tenant_id = p_tenant_id AND reward_granted = false;

  -- (2) Reset akumulasi diskon tenant ini sendiri (dia baru saja "belanja"
  -- diskonnya, apa pun jumlahnya, tidak harus penuh 5/5).
  UPDATE referrals SET accumulated_uses = 0 WHERE tenant_id = p_tenant_id;

  -- (3) Konsumsi diskon 2% pendaftar baru (kalau masih ada & ini
  -- pembayaran pertamanya).
  UPDATE subscriptions SET pending_signup_discount_pct = 0 WHERE tenant_id = p_tenant_id;
END;
$$;
