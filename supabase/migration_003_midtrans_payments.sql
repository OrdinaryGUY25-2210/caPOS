-- =========================================================
-- MIGRASI: Tabel payments untuk integrasi Midtrans
-- Jalankan SATU KALI di SQL Editor Supabase. Aman dijalankan berkali-kali.
-- =========================================================

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  order_id TEXT UNIQUE NOT NULL,       -- ID transaksi unik yang dikirim ke Midtrans
  plan TEXT NOT NULL,                  -- 'monthly' atau 'yearly'
  amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed
  raw_response JSONB,                  -- payload notifikasi terakhir dari Midtrans (untuk audit/debug)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Owner/super_admin BOLEH BACA riwayat pembayaran tenant sendiri, tapi
-- TIDAK BOLEH insert/update langsung dari client — status pembayaran
-- HANYA boleh berubah lewat webhook /api/midtrans/notification (pakai
-- service role di server, setelah verifikasi signature Midtrans). Kalau
-- user biasa bisa UPDATE status='paid' sendiri lewat client, itu artinya
-- siapa saja bisa "membayar" tanpa benar-benar transfer uang.
CREATE POLICY "Payments: read own tenant" ON payments
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id);
