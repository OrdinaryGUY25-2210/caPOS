-- =========================================================
-- Migration 009 — Stok & HPP, Target Bulanan Owner
-- Jalankan di Supabase SQL Editor SETELAH migration_008.
--
-- Semua perubahan di sini ADDITIF (menambah kolom/tabel/fungsi baru).
-- Tidak ada DROP atau perubahan perilaku pada data yang sudah ada:
--  - Produk lama otomatis dapat cost_price=0, track_stock=false,
--    jadi TIDAK ada yang berubah di alur kasir/menu yang sudah jalan
--    sampai Owner sengaja mengaktifkan pelacakan stok per produk.
--  - checkout_transaction() di-CREATE OR REPLACE hanya untuk MENAMBAH
--    logika pengurangan stok (dieksekusi hanya kalau track_stock=true);
--    validasi & alur lama (member, subtotal, insert transaksi) persis sama.
-- =========================================================

-- 1. Kolom baru di products: HPP (cost_price) & manajemen stok
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS track_stock BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stock_qty NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_threshold NUMERIC NOT NULL DEFAULT 5;

COMMENT ON COLUMN products.cost_price IS 'HPP (Harga Pokok Penjualan) per unit — dipakai untuk hitung estimasi laba kotor di Laporan PDF.';
COMMENT ON COLUMN products.track_stock IS 'Kalau true, stock_qty otomatis berkurang tiap checkout & produk ini muncul di halaman Stok & HPP.';

-- 2. Riwayat pergerakan stok (restock, penyesuaian manual, penjualan, rusak/waste)
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'restock' | 'adjustment' | 'sale' | 'waste'
  qty_change NUMERIC NOT NULL, -- positif = stok bertambah, negatif = stok berkurang
  note TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Stock movements: view own tenant" ON stock_movements;
CREATE POLICY "Stock movements: view own tenant" ON stock_movements
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "Stock movements: manager/owner write" ON stock_movements;
CREATE POLICY "Stock movements: manager/owner write" ON stock_movements
  FOR INSERT WITH CHECK (
    tenant_id = current_tenant_id() AND is_manager_or_owner() AND created_by = auth.uid()
  );

CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_product ON stock_movements (tenant_id, product_id, created_at DESC);

-- 3. Target omzet bulanan (ditentukan Owner/Manager)
CREATE TABLE IF NOT EXISTS monthly_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  target_amount NUMERIC NOT NULL DEFAULT 0,
  created_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, year, month)
);

ALTER TABLE monthly_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Monthly targets: view own tenant" ON monthly_targets;
CREATE POLICY "Monthly targets: view own tenant" ON monthly_targets
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "Monthly targets: manager/owner write" ON monthly_targets;
CREATE POLICY "Monthly targets: manager/owner write" ON monthly_targets
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() AND is_manager_or_owner());

DROP POLICY IF EXISTS "Monthly targets: manager/owner update" ON monthly_targets;
CREATE POLICY "Monthly targets: manager/owner update" ON monthly_targets
  FOR UPDATE USING (tenant_id = current_tenant_id() AND is_manager_or_owner());

CREATE INDEX IF NOT EXISTS idx_monthly_targets_tenant_period ON monthly_targets (tenant_id, year, month);

-- 4. Perluas checkout_transaction(): kurangi stok otomatis untuk produk
--    yang track_stock = true, dan catat pergerakannya di stock_movements.
--    Logika lama (hitung subtotal, validasi member, insert transaksi &
--    transaction_items) TIDAK diubah sama sekali — hanya disisipi 3 baris
--    baru di dalam loop item (lihat komentar "BARU" di bawah).
CREATE OR REPLACE FUNCTION checkout_transaction(
  p_tenant_id UUID,
  p_cashier_id UUID,
  p_invoice_number TEXT,
  p_payment_method TEXT,
  p_member_code TEXT,
  p_items JSONB -- [{ "product_id": "...", "qty": 2 }, ...]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_product products%ROWTYPE;
  v_qty INT;
  v_subtotal NUMERIC := 0;
  v_discount_pct NUMERIC := 0;
  v_member_id UUID := NULL;
  v_total NUMERIC;
  v_tx_id UUID;
  v_shift_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: bukan anggota tenant ini';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang kosong';
  END IF;

  v_shift_id := open_shift(p_tenant_id, p_cashier_id);

  IF p_member_code IS NOT NULL AND p_member_code <> '' THEN
    SELECT id, discount_percentage INTO v_member_id, v_discount_pct
    FROM memberships
    WHERE tenant_id = p_tenant_id
      AND member_code = p_member_code
      AND is_active = true
      AND valid_until > now();
    IF v_member_id IS NULL THEN
      RAISE EXCEPTION 'Kode member tidak valid atau kedaluwarsa';
    END IF;
  END IF;

  v_tx_id := gen_random_uuid();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::INT;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 500 THEN
      RAISE EXCEPTION 'Qty item tidak valid';
    END IF;

    SELECT * INTO v_product FROM products
      WHERE id = (v_item->>'product_id')::UUID
        AND tenant_id = p_tenant_id
        AND is_available = true;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Produk tidak ditemukan atau tidak tersedia';
    END IF;

    v_subtotal := v_subtotal + (v_product.price * v_qty);

    INSERT INTO transaction_items (transaction_id, product_id, qty, subtotal)
      VALUES (v_tx_id, v_product.id, v_qty, v_product.price * v_qty);

    -- BARU (migration 009): kurangi stok otomatis kalau produk ini
    -- dilacak stoknya, dan catat di stock_movements untuk riwayat.
    IF v_product.track_stock THEN
      UPDATE products SET stock_qty = stock_qty - v_qty WHERE id = v_product.id;
      INSERT INTO stock_movements (tenant_id, product_id, type, qty_change, note, created_by)
        VALUES (p_tenant_id, v_product.id, 'sale', -v_qty, 'Otomatis dari transaksi ' || p_invoice_number, p_cashier_id);
    END IF;
  END LOOP;

  v_total := round(v_subtotal * (1 - v_discount_pct / 100));

  INSERT INTO transactions (
    id, tenant_id, cashier_id, invoice_number, total_amount,
    payment_method, member_id, is_offline_sync, shift_id
  ) VALUES (
    v_tx_id, p_tenant_id, p_cashier_id, p_invoice_number, v_total,
    p_payment_method, v_member_id, false, v_shift_id
  );

  RETURN v_tx_id;
END;
$$;

-- 5. Fungsi bantu: restock / penyesuaian manual dari halaman Stok & HPP —
--    supaya stock_qty dan log stock_movements selalu ditulis bersamaan
--    dari satu tempat (tidak ada risiko keduanya beda gara-gara ditulis
--    terpisah dari client).
CREATE OR REPLACE FUNCTION adjust_stock(
  p_product_id UUID,
  p_qty_change NUMERIC,
  p_type TEXT, -- 'restock' | 'adjustment' | 'waste'
  p_note TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  IF NOT is_manager_or_owner() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Manager/Owner yang boleh mengubah stok.';
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM products WHERE id = p_product_id;
  IF v_tenant_id IS NULL OR v_tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Produk tidak ditemukan di tenant Anda.';
  END IF;

  UPDATE products SET stock_qty = stock_qty + p_qty_change WHERE id = p_product_id;

  INSERT INTO stock_movements (tenant_id, product_id, type, qty_change, note, created_by)
    VALUES (v_tenant_id, p_product_id, p_type, p_qty_change, p_note, auth.uid());
END;
$$;

-- 6. Fungsi bantu: set/update target omzet bulanan (upsert per periode).
CREATE OR REPLACE FUNCTION set_monthly_target(p_year INT, p_month INT, p_target_amount NUMERIC)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT is_manager_or_owner() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Manager/Owner yang boleh mengatur target.';
  END IF;

  INSERT INTO monthly_targets (tenant_id, year, month, target_amount, created_by)
    VALUES (current_tenant_id(), p_year, p_month, p_target_amount, auth.uid())
  ON CONFLICT (tenant_id, year, month)
    DO UPDATE SET target_amount = EXCLUDED.target_amount, updated_at = now(), created_by = auth.uid();
END;
$$;

-- =========================================================
-- Selesai. Setelah migrasi ini jalan tanpa error:
--  1. Buka /dashboard/stock untuk aktifkan pelacakan stok per produk.
--  2. Buka /dashboard/target untuk isi target omzet bulan ini.
--  3. /dashboard/cashier-evaluation & /dashboard/laporan-pdf langsung
--     jalan pakai data transaksi yang sudah ada, tanpa setup tambahan.
-- =========================================================
