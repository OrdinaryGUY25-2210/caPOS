-- 014_capos_phase3_business_omnichannel.sql

SET check_function_bodies = off;

-- =========================================================
-- SELESAI. Ringkasan objek baru Phase 2:
--   Tabel   : kitchen_stations, orders, order_items, transaction_payments, cash_movements
--   Kolom   : products.station_id, transactions.order_id,
--             shifts.branch_id/opening_cash/closing_cash_expected/
--             closing_cash_actual/cash_difference/closing_notes/closed_by
--   Fungsi  : open_shift_v2, record_cash_movement, shift_cash_summary,
--             close_shift, create_kitchen_order, update_order_status,
--             checkout_order_v2
-- =========================================================


-- ============================================================
-- >>> BERASAL DARI: migration_013_phase3_purchasing_crm_promosi_analitik.sql
-- ============================================================
-- =========================================================
-- MIGRASI PHASE 3: Supplier & Purchasing, Customer CRM & Loyalty,
-- Promotion Engine, dan Advanced F&B Analytics.
--
-- Melanjutkan skema Phase 1 + Phase 2 (schema.sql + migration_001..012).
-- Aman dijalankan berkali-kali (idempotent).
-- =========================================================

-- =========================================================
-- 1. SUPPLIERS (PEMASOK) — Manajemen data pemasok & kategori bahan
-- =========================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_code TEXT NOT NULL,
  company_name TEXT NOT NULL,
  contact_person TEXT,
  phone_number TEXT,
  whatsapp_number TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,
  payment_terms TEXT,                   -- "NET 30", "COD", "NET 14", dst
  categories TEXT[] DEFAULT '{}',       -- array: ["Bahan Kering", "Daging", "Sayur", ...]
  bank_account TEXT,
  bank_name TEXT,
  account_holder_name TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, supplier_code)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_active ON suppliers (tenant_id, is_active);

COMMENT ON TABLE suppliers IS 'Master data pemasok (Phase 3). Menyimpan informasi kontak, kategori bahan, dan rekening bank untuk transfer pembayaran.';

-- =========================================================
-- 2. PURCHASE ORDERS (PO) — Dokumen pemesanan bahan ke pemasok
-- =========================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE RESTRICT,
  po_number TEXT NOT NULL,              -- "PO-2026-001"
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SENT', 'CONFIRMED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED')),
  po_date TIMESTAMPTZ DEFAULT now(),
  expected_delivery_date DATE,
  received_date DATE,
  subtotal_amount NUMERIC DEFAULT 0,
  tax_amount NUMERIC DEFAULT 0,
  total_amount NUMERIC DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, po_number)
);

CREATE INDEX IF NOT EXISTS idx_po_tenant_status ON purchase_orders (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders (supplier_id);

COMMENT ON TABLE purchase_orders IS 'Purchase Order (PO) ke pemasok (Phase 3). Dokumen pemesanan bahan baku berdasarkan low stock alert.';

-- =========================================================
-- 3. PURCHASE ORDER ITEMS — Item detail dalam PO
-- =========================================================
CREATE TABLE IF NOT EXISTS po_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL,                   -- "kg", "liter", "pcs", "box", dst
  qty_ordered INT NOT NULL CHECK (qty_ordered > 0),
  qty_received INT DEFAULT 0,
  unit_price NUMERIC NOT NULL CHECK (unit_price > 0),
  subtotal NUMERIC,                     -- qty_ordered * unit_price
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_items_po ON po_items (po_id);

COMMENT ON TABLE po_items IS 'Item detail dalam PO. qty_received diupdate saat Goods Receipt (GRN).';

-- =========================================================
-- 4. GOODS RECEIPT (GRN) — Penerimaan barang fisik di cabang
-- =========================================================
CREATE TABLE IF NOT EXISTS goods_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  po_id UUID REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  grn_number TEXT NOT NULL,             -- "GRN-2026-001"
  receipt_date TIMESTAMPTZ DEFAULT now(),
  supplier_id UUID REFERENCES suppliers(id),
  notes TEXT,
  received_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, grn_number)
);

CREATE INDEX IF NOT EXISTS idx_grn_po ON goods_receipts (po_id);

CREATE INDEX IF NOT EXISTS idx_grn_branch ON goods_receipts (branch_id, created_at DESC);

COMMENT ON TABLE goods_receipts IS 'Goods Receipt Note (GRN) - penerimaan barang fisik (Phase 3).';

-- =========================================================
-- 5. GRN ITEMS — Item detail dalam GRN (qty yang diterima)
-- =========================================================
CREATE TABLE IF NOT EXISTS grn_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id UUID REFERENCES goods_receipts(id) ON DELETE CASCADE,
  po_item_id UUID REFERENCES po_items(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty_received INT NOT NULL CHECK (qty_received > 0),
  unit_price NUMERIC NOT NULL,
  actual_cost NUMERIC,                  -- untuk weighted average cost calculation
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grn_items_grn ON grn_items (grn_id);

COMMENT ON TABLE grn_items IS 'Item yang diterima dalam GRN. Digunakan untuk update stok dan perhitungan HPP weighted average.';

-- =========================================================
-- 6. PURCHASE INVOICE — Invoice dari pemasok (untuk audit trail)
-- =========================================================
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  po_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id),
  invoice_number TEXT NOT NULL,        -- nomor invoice dari pemasok
  invoice_date DATE,
  due_date DATE,
  amount NUMERIC NOT NULL,
  status TEXT DEFAULT 'UNPAID'          -- "UNPAID", "PARTIAL_PAID", "PAID"
    CHECK (status IN ('UNPAID', 'partial_paid', 'PAID')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_inv_supplier ON purchase_invoices (supplier_id);

COMMENT ON TABLE purchase_invoices IS 'Invoice pembelian dari pemasok untuk tracking pembayaran & audit.';

-- =========================================================
-- 8. CUSTOMER TIERS (TINGKATAN MEMBER) — Silver, Gold, Platinum, dst
-- =========================================================
CREATE TABLE IF NOT EXISTS customer_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  tier_name TEXT NOT NULL,              -- "Silver", "Gold", "Platinum"
  min_spend_monthly NUMERIC DEFAULT 0,
  min_spend_yearly NUMERIC DEFAULT 0,
  discount_percentage NUMERIC DEFAULT 0,
  points_multiplier NUMERIC DEFAULT 1,
  benefits TEXT[] DEFAULT '{}',         -- array benefit deskripsi
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, tier_name)
);

CREATE INDEX IF NOT EXISTS idx_tiers_tenant ON customer_tiers (tenant_id);

COMMENT ON TABLE customer_tiers IS 'Definisi tingkatan member dengan benefit berbeda (Phase 3).';

-- =========================================================
-- 7. CUSTOMERS (CRM) — Database pelanggan lintas cabang
-- =========================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL, -- NULL = multi-branch customer
  customer_code TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  phone_number TEXT,
  whatsapp_number TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  province TEXT,
  birthday DATE,
  favorite_menu TEXT[] DEFAULT '{}',    -- array menu favorit
  visit_count INT DEFAULT 0,
  lifetime_spend NUMERIC DEFAULT 0,
  last_visit_date TIMESTAMPTZ,
  tier_id UUID REFERENCES customer_tiers(id),
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, customer_code)
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant_branch ON customers (tenant_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_customers_tier ON customers (tier_id);

COMMENT ON TABLE customers IS 'Master data pelanggan untuk CRM & loyalty program (Phase 3).';

-- =========================================================
-- 9. LOYALTY POINTS CONFIGURATION — Konfigurasi poin per tenant
-- =========================================================
CREATE TABLE IF NOT EXISTS loyalty_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  points_per_rupiah NUMERIC DEFAULT 0.1,         -- contoh: Rp 10.000 = 1 poin (0.1 poin per rupiah)
  points_expiry_days INT DEFAULT 365,            -- poin kadaluarsa dalam N hari
  min_points_for_redemption INT DEFAULT 100,
  min_purchase_for_points NUMERIC DEFAULT 0,     -- minimum pembelian untuk mendapat poin
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_config_tenant ON loyalty_config (tenant_id);

COMMENT ON TABLE loyalty_config IS 'Konfigurasi sistem poin loyalitas per tenant (Phase 3).';

-- =========================================================
-- 10. LOYALTY POINTS LOG — Riwayat transaksi poin (earn & redeem)
-- =========================================================
CREATE TABLE IF NOT EXISTS loyalty_points_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL        -- "EARN" (dari pembelian), "REDEEM" (tukar diskon), "EXPIRE", "ADJUST"
    CHECK (transaction_type IN ('EARN', 'REDEEM', 'EXPIRE', 'ADJUST')),
  points_amount INT NOT NULL,           -- positif untuk earn, negatif untuk redeem
  description TEXT,
  balance_after INT,                    -- saldo poin setelah transaksi
  expiry_date DATE,                     -- tanggal kadaluarsa poin
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_log_customer ON loyalty_points_log (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_loyalty_log_tx ON loyalty_points_log (transaction_id);

COMMENT ON TABLE loyalty_points_log IS 'Audit trail poin loyalitas (earn, redeem, expire) (Phase 3).';

-- =========================================================
-- 11. PROMOTIONS — Master promosi (BOGO, diskon %, diskon Rp, bundle)
-- =========================================================
CREATE TABLE IF NOT EXISTS promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL, -- NULL = semua cabang
  promo_name TEXT NOT NULL,
  promo_code TEXT,                      -- optional, jika perlu kode voucher
  promo_type TEXT NOT NULL              -- "PERCENTAGE", "NOMINAL", "BOGO", "BUNDLE"
    CHECK (promo_type IN ('PERCENTAGE', 'NOMINAL', 'BOGO', 'BUNDLE')),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  start_date TIMESTAMPTZ DEFAULT now(),
  end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, promo_code)
);

CREATE INDEX IF NOT EXISTS idx_promo_tenant_active ON promotions (tenant_id, is_active);

COMMENT ON TABLE promotions IS 'Master promosi dengan berbagai tipe (Phase 3).';

-- =========================================================
-- 12. PROMOTION RULES — Aturan & kondisi untuk setiap promosi
-- =========================================================
CREATE TABLE IF NOT EXISTS promotion_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id UUID REFERENCES promotions(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL               -- "MIN_PURCHASE", "MAX_DISCOUNT", "CATEGORY", "MEMBER_ONLY", "HAPPY_HOUR"
    CHECK (rule_type IN ('MIN_PURCHASE', 'MAX_DISCOUNT', 'CATEGORY', 'MEMBER_ONLY', 'HAPPY_HOUR', 'SPECIFIC_PRODUCT')),
  rule_value TEXT,                      -- nilai dinamis sesuai rule_type
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promo_rules_promo ON promotion_rules (promotion_id);

COMMENT ON TABLE promotion_rules IS 'Aturan detail untuk setiap promosi (minimum pembelian, max diskon, jam berlaku, dst).';

-- =========================================================
-- 13. VOUCHERS / KUPON — Voucher/kupon dengan redemption tracking
-- =========================================================
CREATE TABLE IF NOT EXISTS vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  promotion_id UUID REFERENCES promotions(id) ON DELETE CASCADE,
  voucher_code TEXT NOT NULL,
  voucher_name TEXT,
  discount_type TEXT NOT NULL           -- "PERCENTAGE", "NOMINAL"
    CHECK (discount_type IN ('PERCENTAGE', 'NOMINAL')),
  discount_value NUMERIC NOT NULL,
  max_discount_amount NUMERIC,          -- untuk persentase, maksimal diskon nominal
  min_purchase_amount NUMERIC DEFAULT 0,
  usage_limit INT,                      -- NULL = unlimited
  usage_count INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  start_date TIMESTAMPTZ DEFAULT now(),
  expiry_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, voucher_code)
);

CREATE INDEX IF NOT EXISTS idx_vouchers_tenant ON vouchers (tenant_id, is_active);

COMMENT ON TABLE vouchers IS 'Voucher/kupon dengan tracking penggunaan (Phase 3).';

-- =========================================================
-- 14. VOUCHER REDEMPTIONS — Riwayat penggunaan voucher
-- =========================================================
CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID REFERENCES vouchers(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  discount_given NUMERIC NOT NULL,
  redeemed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voucher_redeem_tx ON voucher_redemptions (transaction_id);

COMMENT ON TABLE voucher_redemptions IS 'Audit trail penggunaan voucher (Phase 3).';

-- =========================================================
-- 15. PRODUCT PROFITABILITY VIEW -- laporan profitabilitas produk
-- =========================================================
-- BUG FIX (Phase 2A.1 audit): original view referenced columns that never
-- existed on `products` (product_name, category_id, cost_price join target
-- `product_categories`, which was never created anywhere in this codebase)
-- and never exposed `branch_id`, even though the app's server action
-- (app/actions/purchasing-loyalty-actions.ts) filters on it. Rewritten
-- against the real `products` schema (name, category TEXT, cost_price from
-- migration_009) and joined through `orders` to recover branch_id.
CREATE OR REPLACE VIEW product_profitability
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.tenant_id,
  ord.branch_id,
  p.name AS product_name,
  p.category,
  COUNT(DISTINCT ti.id) as sale_count,
  SUM(ti.qty) as total_qty_sold,
  SUM(ti.subtotal) as total_revenue,
  COALESCE(AVG(p.cost_price), 0) as avg_cost_price,
  SUM(ti.qty) * COALESCE(AVG(p.cost_price), 0) as total_cogs,
  SUM(ti.subtotal) - (SUM(ti.qty) * COALESCE(AVG(p.cost_price), 0)) as gross_profit,
  ROUND(
    ((SUM(ti.subtotal) - (SUM(ti.qty) * COALESCE(AVG(p.cost_price), 0))) / NULLIF(SUM(ti.subtotal), 0) * 100)::NUMERIC,
    2
  ) as profit_margin_pct,
  MAX(tr.created_at) as last_sale_date
FROM products p
LEFT JOIN transaction_items ti ON p.id = ti.product_id
LEFT JOIN transactions tr ON ti.transaction_id = tr.id
LEFT JOIN orders ord ON tr.order_id = ord.id
GROUP BY p.id, p.tenant_id, ord.branch_id, p.name, p.category;

COMMENT ON VIEW product_profitability IS 'View untuk laporan profitabilitas per produk (Phase 3). Fixed in Phase 2A.1 audit: corrected column names to match actual products schema, added branch_id.';

-- =========================================================
-- 16. PEAK HOURS ANALYTICS VIEW -- distribusi transaksi per jam
-- =========================================================
-- BUG FIX (Phase 2A.1 audit): original view referenced `t.branch_id`
-- directly on `transactions`, which has no such column (branch is only
-- reachable via transactions.order_id -> orders.branch_id). It also
-- replaced the simpler base view from migration_005 with an incompatible
-- column type for hour_of_day (numeric vs the original's ::INT) and
-- renamed total_orders to transaction_count, breaking
-- app/dashboard/page.tsx which selects `hour_of_day, total_orders`
-- explicitly. Fixed: join through orders for branch_id, keep hour_of_day
-- as ::INT, keep the column name total_orders for backward compatibility,
-- and DROP the old view first since CREATE OR REPLACE cannot change an
-- existing column's data type.
DROP VIEW IF EXISTS peak_hours_analytics;
CREATE VIEW peak_hours_analytics
WITH (security_invoker = true) AS
SELECT
  t.tenant_id,
  ord.branch_id,
  EXTRACT(HOUR FROM t.created_at)::INT as hour_of_day,
  COUNT(DISTINCT t.id) as total_orders,
  COUNT(DISTINCT ti.id) as item_count,
  SUM(ti.qty) as total_qty,
  SUM(t.total_amount) as total_revenue,
  AVG(t.total_amount) as avg_transaction_value
FROM transactions t
LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
LEFT JOIN orders ord ON t.order_id = ord.id
WHERE t.created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY t.tenant_id, ord.branch_id, EXTRACT(HOUR FROM t.created_at)::INT;

COMMENT ON VIEW peak_hours_analytics IS 'View untuk analisis jam-jam sibuk (Phase 3).';

-- =========================================================
-- 17. WASTE LOSS REPORT VIEW — Laporan kerugian dari waste/kadaluarsa
-- =========================================================
CREATE TABLE IF NOT EXISTS waste_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id),
  product_name TEXT NOT NULL,
  waste_type TEXT NOT NULL              -- "EXPIRED", "DAMAGED", "SPOILED", "LOSS"
    CHECK (waste_type IN ('EXPIRED', 'DAMAGED', 'SPOILED', 'LOSS')),
  qty_wasted INT NOT NULL CHECK (qty_wasted > 0),
  cost_price NUMERIC,
  total_loss_amount NUMERIC,            -- qty_wasted * cost_price
  notes TEXT,
  recorded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waste_logs_branch ON waste_logs (branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_waste_logs_type ON waste_logs (waste_type);

COMMENT ON TABLE waste_logs IS 'Pencatatan waste/kerugian dari barang kadaluarsa/rusak (Phase 3).';

-- =========================================================
-- 20. FUNCTION: calculate_loyalty_points — Hitung poin dari transaksi
-- =========================================================
CREATE OR REPLACE FUNCTION calculate_loyalty_points(
  p_tenant_id UUID,
  p_transaction_amount NUMERIC
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_config loyalty_config%ROWTYPE;
  v_points INT;
BEGIN
  SELECT * INTO v_config FROM loyalty_config WHERE tenant_id = p_tenant_id;
  
  IF v_config.id IS NULL OR NOT v_config.is_enabled THEN
    RETURN 0;
  END IF;

  IF p_transaction_amount < v_config.min_purchase_for_points THEN
    RETURN 0;
  END IF;

  v_points := FLOOR(p_transaction_amount * v_config.points_per_rupiah)::INT;
  RETURN v_points;
END;
$$;

-- =========================================================
-- 21. FUNCTION: earn_loyalty_points — Catat poin yang diperoleh dari pembelian
-- =========================================================
CREATE OR REPLACE FUNCTION earn_loyalty_points(
  p_transaction_id UUID,
  p_customer_id UUID,
  p_points INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer customers%ROWTYPE;
  v_transaction transactions%ROWTYPE;
  v_config loyalty_config%ROWTYPE;
  v_current_balance INT;
  v_expiry_date DATE;
BEGIN
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
  IF v_customer.id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_transaction FROM transactions WHERE id = p_transaction_id;
  IF v_transaction.id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_config FROM loyalty_config WHERE tenant_id = v_customer.tenant_id;
  
  -- Hitung saldo poin sebelumnya
  SELECT COALESCE(SUM(CASE WHEN transaction_type IN ('EARN', 'ADJUST') THEN points_amount ELSE -points_amount END), 0)
  INTO v_current_balance FROM loyalty_points_log WHERE customer_id = p_customer_id;

  v_current_balance := v_current_balance + p_points;
  v_expiry_date := CURRENT_DATE + INTERVAL '1 day' * v_config.points_expiry_days;

  -- Insert loyalty log
  INSERT INTO loyalty_points_log (
    tenant_id, customer_id, transaction_id, transaction_type, points_amount,
    description, balance_after, expiry_date
  ) VALUES (
    v_customer.tenant_id, p_customer_id, p_transaction_id, 'EARN', p_points,
    'Poin dari transaksi #' || v_transaction.invoice_number,
    v_current_balance, v_expiry_date
  );

  RETURN TRUE;
END;
$$;

-- =========================================================
-- 22. FUNCTION: redeem_loyalty_points — Tukar poin menjadi diskon
-- =========================================================
CREATE OR REPLACE FUNCTION redeem_loyalty_points(
  p_customer_id UUID,
  p_points_to_redeem INT,
  p_discount_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer customers%ROWTYPE;
  v_available_points INT;
  v_config loyalty_config%ROWTYPE;
  v_current_balance INT;
BEGIN
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
  IF v_customer.id IS NULL THEN
    RAISE EXCEPTION 'Pelanggan tidak ditemukan';
  END IF;

  SELECT * INTO v_config FROM loyalty_config WHERE tenant_id = v_customer.tenant_id;

  IF NOT v_config.is_enabled THEN
    RAISE EXCEPTION 'Program loyalitas tidak aktif';
  END IF;

  -- Hitung poin tersedia (belum expired)
  SELECT COALESCE(SUM(CASE WHEN transaction_type IN ('EARN', 'ADJUST') THEN points_amount ELSE -points_amount END), 0)
  INTO v_available_points FROM loyalty_points_log 
  WHERE customer_id = p_customer_id AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE);

  IF v_available_points < p_points_to_redeem THEN
    RAISE EXCEPTION 'Poin tidak cukup. Tersedia: %, Diminta: %', v_available_points, p_points_to_redeem;
  END IF;

  -- Hitung saldo setelah redeem
  v_current_balance := v_available_points - p_points_to_redeem;

  -- Insert redeem log
  INSERT INTO loyalty_points_log (
    tenant_id, customer_id, transaction_type, points_amount, 
    description, balance_after
  ) VALUES (
    v_customer.tenant_id, p_customer_id, 'REDEEM', -p_points_to_redeem,
    'Tukar poin menjadi diskon Rp' || p_discount_amount,
    v_current_balance
  );

  RETURN TRUE;
END;
$$;

-- =========================================================
-- 23. FUNCTION: apply_promotion — Validasi & hitung diskon promosi
-- =========================================================
CREATE OR REPLACE FUNCTION apply_promotion(
  p_promotion_id UUID,
  p_transaction_amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_promo promotions%ROWTYPE;
  v_rule promotion_rules%ROWTYPE;
  v_discount NUMERIC := 0;
  v_min_purchase NUMERIC := 0;
  v_max_discount NUMERIC := NULL;
  v_now TIME := CURRENT_TIME;
BEGIN
  SELECT * INTO v_promo FROM promotions WHERE id = p_promotion_id;
  IF v_promo.id IS NULL OR NOT v_promo.is_active THEN
    RETURN 0;
  END IF;

  -- Validasi periode promo
  IF v_promo.start_date > now() OR (v_promo.end_date IS NOT NULL AND v_promo.end_date < now()) THEN
    RETURN 0;
  END IF;

  -- Parse rules
  FOR v_rule IN SELECT * FROM promotion_rules WHERE promotion_id = p_promotion_id LOOP
    CASE v_rule.rule_type
      WHEN 'MIN_PURCHASE' THEN
        v_min_purchase := (v_rule.rule_value)::NUMERIC;
      WHEN 'MAX_DISCOUNT' THEN
        v_max_discount := (v_rule.rule_value)::NUMERIC;
      WHEN 'HAPPY_HOUR' THEN
        -- Format: "08:00-11:00,14:00-17:00"
        -- Untuk simplicity, skip validasi jam di function ini
        NULL;
      ELSE
        NULL;
    END CASE;
  END LOOP;

  -- Validasi minimum pembelian
  IF p_transaction_amount < v_min_purchase THEN
    RETURN 0;
  END IF;

  -- Hitung diskon berdasarkan tipe promo
  CASE v_promo.promo_type
    WHEN 'PERCENTAGE' THEN
      v_discount := ROUND(p_transaction_amount * v_promo.discount_value / 100, 2);
      IF v_max_discount IS NOT NULL AND v_discount > v_max_discount THEN
        v_discount := v_max_discount;
      END IF;
    WHEN 'NOMINAL' THEN
      v_discount := v_promo.discount_value;
      IF v_discount > p_transaction_amount THEN
        v_discount := p_transaction_amount;
      END IF;
    ELSE
      v_discount := 0;
  END CASE;

  RETURN v_discount;
END;
$$;

-- =========================================================
-- 24. RLS POLICIES — Row Level Security untuk semua tabel baru
-- =========================================================

-- Suppliers
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_suppliers" ON suppliers;
CREATE POLICY rls_suppliers ON suppliers
  USING (tenant_id = current_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "rls_suppliers_insert" ON suppliers;
CREATE POLICY rls_suppliers_insert ON suppliers FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "rls_suppliers_update" ON suppliers;
CREATE POLICY rls_suppliers_update ON suppliers FOR UPDATE
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Purchase Orders
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_po" ON purchase_orders;
CREATE POLICY rls_po ON purchase_orders
  USING (tenant_id = current_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "rls_po_insert" ON purchase_orders;
CREATE POLICY rls_po_insert ON purchase_orders FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "rls_po_update" ON purchase_orders;
CREATE POLICY rls_po_update ON purchase_orders FOR UPDATE
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Customers
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_customers" ON customers;
CREATE POLICY rls_customers ON customers
  USING (tenant_id = current_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS "rls_customers_insert" ON customers;
CREATE POLICY rls_customers_insert ON customers FOR INSERT
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "rls_customers_update" ON customers;
CREATE POLICY rls_customers_update ON customers FOR UPDATE
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- Promotions
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_promotions" ON promotions;
CREATE POLICY rls_promotions ON promotions
  USING (tenant_id = current_tenant_id() OR is_super_admin());

-- Vouchers
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_vouchers" ON vouchers;
CREATE POLICY rls_vouchers ON vouchers
  USING (tenant_id = current_tenant_id() OR is_super_admin());

-- Waste Logs
ALTER TABLE waste_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_waste_logs" ON waste_logs;
CREATE POLICY rls_waste_logs ON waste_logs
  USING (tenant_id = current_tenant_id() OR is_super_admin());

-- =========================================================
-- REALTIME SUBSCRIPTIONS
-- =========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'customers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE customers;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'loyalty_points_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE loyalty_points_log;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'purchase_orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE purchase_orders;
  END IF;
END $$;

-- =========================================================
-- SELESAI PHASE 3
-- =========================================================
COMMENT ON SCHEMA public IS 'caPOS Phase 3: Supplier & Purchasing, Customer CRM & Loyalty, Promotion Engine, Advanced Analytics';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'pos';

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check;

ALTER TABLE orders ADD CONSTRAINT orders_channel_check
  CHECK (channel IN ('pos', 'qr_self_order', 'reservation', 'gofood', 'grabfood', 'shopeefood', 'website'));

-- Komisi platform (poin 3) di-snapshot di sini saat order dibuat, supaya
-- laporan historis tidak berubah kalau tarif channel_pricings diubah nanti.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel_commission_amount NUMERIC NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders (tenant_id, branch_id, channel, created_at DESC);

-- 1c. qr_orders — "amplop" info pelanggan & pembayaran mandiri di atas
--     sebuah `orders` (KDS ticket). Item & status dapur TETAP di
--     orders/order_items (Phase 2) supaya QR Self-Order otomatis
--     terintegrasi ke KDS & POS tanpa alur terpisah.
CREATE TABLE IF NOT EXISTS qr_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  table_id UUID REFERENCES branch_tables(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  customer_name TEXT,
  customer_phone TEXT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('qris', 'pay_at_cashier')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'failed')),
  payment_reference TEXT,      -- Midtrans order_id / transaction_id untuk QRIS dinamis
  total_amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qr_orders_tenant_branch ON qr_orders (tenant_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_qr_orders_order ON qr_orders (order_id);

CREATE INDEX IF NOT EXISTS idx_qr_orders_payment_ref ON qr_orders (payment_reference);

ALTER TABLE qr_orders ENABLE ROW LEVEL SECURITY;

-- Staff (dashboard/POS) hanya boleh MELIHAT — penulisan HANYA lewat
-- submit_qr_order()/mark_qr_order_paid() di bawah (SECURITY DEFINER),
-- supaya total_amount & status pembayaran tidak bisa dimanipulasi
-- langsung dari browser oleh siapa pun (staff maupun pelanggan).
DROP POLICY IF EXISTS "QR orders: branch-scoped view" ON qr_orders;

DROP POLICY IF EXISTS "QR orders: branch-scoped view" ON qr_orders;
CREATE POLICY "QR orders: branch-scoped view" ON qr_orders
  FOR SELECT USING (
    is_super_admin() OR (tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id()))
  );

-- 1e. submit_qr_order — inti QR Self-Order. Membuat SATU tiket dapur
--     (`orders`+`order_items`, channel='qr_self_order') yang otomatis
--     realtime ke POS & KDS (tabel `orders`/`order_items` sudah masuk
--     publication `supabase_realtime` sejak migration_012), plus baris
--     `qr_orders` untuk melacak pilihan pembayaran pelanggan.
--     p_items: [{ "product_id": "...", "qty": 2, "variant_notes": "Less Sugar" }, ...]
CREATE OR REPLACE FUNCTION submit_qr_order(
  p_branch_slug TEXT,
  p_table_number TEXT,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_payment_method TEXT,   -- 'qris' | 'pay_at_cashier'
  p_notes TEXT,
  p_items JSONB
)
RETURNS TABLE (order_id UUID, qr_order_id UUID, order_number TEXT, total_amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch branches%ROWTYPE;
  v_table branch_tables%ROWTYPE;
  v_item JSONB;
  v_product products%ROWTYPE;
  v_qty INT;
  v_order_id UUID;
  v_qr_order_id UUID;
  v_order_number TEXT;
  v_seq INT;
  v_total NUMERIC := 0;
BEGIN
  IF p_payment_method NOT IN ('qris', 'pay_at_cashier') THEN
    RAISE EXCEPTION 'Metode pembayaran tidak valid';
  END IF;

  SELECT * INTO v_branch FROM branches WHERE slug = p_branch_slug AND is_active = true;
  IF v_branch.id IS NULL THEN
    RAISE EXCEPTION 'TABLE_OR_BRANCH_NOT_FOUND: Cabang tidak ditemukan atau tidak aktif';
  END IF;

  SELECT * INTO v_table FROM branch_tables
    WHERE branch_id = v_branch.id AND table_number = p_table_number AND is_active = true;
  IF v_table.id IS NULL THEN
    RAISE EXCEPTION 'TABLE_OR_BRANCH_NOT_FOUND: Meja tidak ditemukan atau tidak aktif';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang kosong';
  END IF;
  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'Jumlah jenis item pesanan terlalu banyak';
  END IF;

  -- Nomor pesanan harian per cabang, prefix "QR-" supaya gampang dibedakan
  -- dari tiket POS ("ORD-") di layar KDS.
  SELECT COUNT(*) + 1 INTO v_seq FROM orders
    WHERE branch_id = v_branch.id AND created_at::date = CURRENT_DATE;
  v_order_number := 'QR-' || lpad(v_seq::text, 3, '0');
  v_order_id := gen_random_uuid();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::INT;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 50 THEN
      RAISE EXCEPTION 'Qty item tidak valid';
    END IF;

    SELECT * INTO v_product FROM products
      WHERE id = (v_item->>'product_id')::UUID
        AND tenant_id = v_branch.tenant_id
        AND is_available = true;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Produk tidak ditemukan atau tidak tersedia';
    END IF;

    v_total := v_total + (v_product.price * v_qty);
  END LOOP;

  INSERT INTO orders (
    id, tenant_id, branch_id, table_id, order_number, order_type,
    table_number, customer_name, status, notes, channel
  ) VALUES (
    v_order_id, v_branch.tenant_id, v_branch.id, v_table.id, v_order_number, 'dine_in',
    v_table.table_number, NULLIF(trim(p_customer_name), ''), 'NEW', p_notes, 'qr_self_order'
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::INT;
    SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::UUID AND tenant_id = v_branch.tenant_id;

    INSERT INTO order_items (
      order_id, product_id, station_id, product_name, variant_notes, qty, unit_price, subtotal
    ) VALUES (
      v_order_id, v_product.id, v_product.station_id, v_product.name,
      NULLIF(trim(v_item->>'variant_notes'), ''), v_qty, v_product.price, v_product.price * v_qty
    );
  END LOOP;

  INSERT INTO qr_orders (
    id, tenant_id, branch_id, table_id, order_id, customer_name, customer_phone,
    payment_method, payment_status, total_amount
  ) VALUES (
    gen_random_uuid(), v_branch.tenant_id, v_branch.id, v_table.id, v_order_id,
    NULLIF(trim(p_customer_name), ''), NULLIF(trim(p_customer_phone), ''),
    p_payment_method, CASE WHEN p_payment_method = 'qris' THEN 'pending' ELSE 'unpaid' END, v_total
  ) RETURNING id INTO v_qr_order_id;

  RETURN QUERY SELECT v_order_id, v_qr_order_id, v_order_number, v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_qr_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

-- 1f. get_qr_order_status — dipakai halaman "status pesanan saya" di HP
--     pelanggan (polling/realtime). qr_order_id berfungsi sebagai token
--     akses (UUID acak, tidak bisa ditebak) — TANPA ini tidak ada cara
--     bagi anon untuk membaca isi tabel orders/qr_orders sama sekali.
CREATE OR REPLACE FUNCTION get_qr_order_status(p_qr_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'order_number', o.order_number,
    'table_number', o.table_number,
    'status', o.status,
    'payment_method', q.payment_method,
    'payment_status', q.payment_status,
    'total_amount', q.total_amount,
    'created_at', o.created_at,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_name', oi.product_name, 'qty', oi.qty,
        'variant_notes', oi.variant_notes, 'subtotal', oi.subtotal
      ))
      FROM order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM qr_orders q
  JOIN orders o ON o.id = q.order_id
  WHERE q.id = p_qr_order_id;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_qr_order_status(UUID) TO anon, authenticated;

-- 1g. mark_qr_order_paid — HANYA dipanggil dari webhook Midtrans (server,
--     service role). SENGAJA TIDAK di-GRANT ke anon/authenticated supaya
--     status "paid" tidak bisa dipalsukan dari browser pelanggan.
--     Order otomatis diteruskan ke dapur (status NEW -> ACCEPTED) begitu
--     pembayaran QRIS dinamis terkonfirmasi.
CREATE OR REPLACE FUNCTION mark_qr_order_paid(
  p_qr_order_id UUID,
  p_payment_reference TEXT,
  p_status TEXT -- 'pending' | 'paid' | 'failed'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
BEGIN
  IF p_status NOT IN ('pending', 'paid', 'failed') THEN
    RAISE EXCEPTION 'Status pembayaran tidak valid';
  END IF;

  SELECT order_id INTO v_order_id FROM qr_orders WHERE id = p_qr_order_id;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'qr_order tidak ditemukan';
  END IF;

  UPDATE qr_orders
    SET payment_status = p_status, payment_reference = COALESCE(p_payment_reference, payment_reference)
    WHERE id = p_qr_order_id;

  IF p_status = 'paid' THEN
    UPDATE orders SET status = 'ACCEPTED', accepted_at = now()
      WHERE id = v_order_id AND status = 'NEW';
  END IF;
END;
$$;

-- 2a. get_branch_public_info — dipakai halaman /reserve/[branch] publik.
CREATE OR REPLACE FUNCTION get_branch_public_info(p_branch_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch branches%ROWTYPE;
BEGIN
  SELECT * INTO v_branch FROM branches WHERE slug = p_branch_slug AND is_active = true;
  IF v_branch.id IS NULL THEN
    RETURN jsonb_build_object('error', 'branch_not_found');
  END IF;

  RETURN jsonb_build_object(
    'id', v_branch.id, 'name', v_branch.name, 'address', v_branch.address, 'slug', v_branch.slug
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_branch_public_info(TEXT) TO anon, authenticated;

-- 2b. create_reservation — dipanggil dari form publik pelanggan (anon,
--     status awal 'pending' menunggu konfirmasi Manager/Owner) MAUPUN
--     dari dashboard staff (authenticated owner/manager, langsung
--     'confirmed' — sesuai spesifikasi "Input reservasi ... oleh
--     Manager/Owner ATAU via form publik pelanggan").
CREATE OR REPLACE FUNCTION create_reservation(
  p_branch_id UUID,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_reservation_at TIMESTAMPTZ,
  p_party_size INT,
  p_deposit_amount NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL,
  p_table_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch branches%ROWTYPE;
  v_is_staff BOOLEAN;
  v_reservation_id UUID;
  v_status TEXT := 'pending';
BEGIN
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id AND is_active = true;
  IF v_branch.id IS NULL THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan';
  END IF;

  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Nama pelanggan wajib diisi';
  END IF;
  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'No. WhatsApp wajib diisi';
  END IF;
  IF p_party_size IS NULL OR p_party_size <= 0 THEN
    RAISE EXCEPTION 'Jumlah tamu tidak valid';
  END IF;
  IF p_reservation_at IS NULL OR p_reservation_at < now() - INTERVAL '1 hour' THEN
    RAISE EXCEPTION 'Tanggal & jam reservasi tidak valid';
  END IF;

  v_is_staff := is_super_admin() OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = v_branch.tenant_id AND role IN ('owner', 'manager'))
  );

  -- Staff (Manager/Owner) yang input langsung -> otomatis 'confirmed'.
  -- Pelanggan lewat form publik -> 'pending' menunggu konfirmasi staff.
  IF v_is_staff THEN
    v_status := 'confirmed';
  END IF;

  IF p_table_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM branch_tables WHERE id = p_table_id AND branch_id = p_branch_id) THEN
      RAISE EXCEPTION 'Meja tidak ditemukan di cabang ini';
    END IF;
  END IF;

  INSERT INTO reservations (
    id, tenant_id, branch_id, table_id, customer_name, customer_phone,
    party_size, reservation_at, deposit_amount, status, notes, created_by
  ) VALUES (
    gen_random_uuid(), v_branch.tenant_id, p_branch_id, p_table_id, trim(p_customer_name), trim(p_customer_phone),
    p_party_size, p_reservation_at, COALESCE(p_deposit_amount, 0), v_status, p_notes,
    CASE WHEN v_is_staff THEN auth.uid() ELSE NULL END
  ) RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_reservation(UUID, TEXT, TEXT, TIMESTAMPTZ, INT, NUMERIC, TEXT, UUID) TO anon, authenticated;

-- 2c. get_reservation_status — cek status publik pakai ID reservasi
--     (dikirim ke pelanggan lewat WhatsApp/halaman konfirmasi).
CREATE OR REPLACE FUNCTION get_reservation_status(p_reservation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'customer_name', r.customer_name, 'reservation_at', r.reservation_at,
    'party_size', r.party_size, 'status', r.status, 'deposit_amount', r.deposit_amount,
    'deposit_status', r.deposit_status
  ) INTO v_result
  FROM reservations r WHERE r.id = p_reservation_id;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_reservation_status(UUID) TO anon, authenticated;

-- 2d. update_reservation_status — tombol Konfirmasi/Batalkan/No-Show di
--     dashboard staff. Menegakkan urutan alur seperti update_order_status.
CREATE OR REPLACE FUNCTION update_reservation_status(
  p_reservation_id UUID,
  p_new_status TEXT,
  p_table_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res reservations%ROWTYPE;
  v_allowed BOOLEAN := false;
BEGIN
  IF NOT is_manager_or_owner() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Manager/Owner yang boleh mengubah status reservasi';
  END IF;

  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id;
  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Reservasi tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_res.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan reservasi tenant Anda';
  END IF;

  IF p_new_status IN ('cancelled', 'no_show') THEN
    v_allowed := v_res.status NOT IN ('completed', 'cancelled', 'no_show');
  ELSE
    v_allowed := (v_res.status = 'pending' AND p_new_status = 'confirmed')
      OR (v_res.status = 'confirmed' AND p_new_status = 'seated')
      OR (v_res.status = 'seated' AND p_new_status = 'completed');
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transisi status tidak valid: % -> %', v_res.status, p_new_status;
  END IF;

  UPDATE reservations SET
    status = p_new_status,
    table_id = COALESCE(p_table_id, table_id)
  WHERE id = p_reservation_id;
END;
$$;

-- 2e. seat_reservation — konversi Reservasi -> Pesanan Aktif (Occupied).
--     Membuat tiket `orders` (channel='reservation') persis seperti
--     pesanan dine-in biasa, supaya kasir tinggal input item seperti
--     alur POS normal begitu tamu duduk dan mulai memesan.
CREATE OR REPLACE FUNCTION seat_reservation(p_reservation_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_res reservations%ROWTYPE;
  v_table branch_tables%ROWTYPE;
  v_order_id UUID;
  v_order_number TEXT;
  v_seq INT;
BEGIN
  IF NOT is_manager_or_owner() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Manager/Owner/Kasir yang boleh check-in reservasi';
  END IF;

  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id;
  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Reservasi tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_res.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF v_res.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Reservasi harus berstatus confirmed sebelum check-in';
  END IF;
  IF v_res.table_id IS NULL THEN
    RAISE EXCEPTION 'Alokasikan meja terlebih dahulu sebelum check-in';
  END IF;

  SELECT * INTO v_table FROM branch_tables WHERE id = v_res.table_id;

  SELECT COUNT(*) + 1 INTO v_seq FROM orders
    WHERE branch_id = v_res.branch_id AND created_at::date = CURRENT_DATE;
  v_order_number := 'RSV-' || lpad(v_seq::text, 3, '0');
  v_order_id := gen_random_uuid();

  INSERT INTO orders (
    id, tenant_id, branch_id, table_id, order_number, order_type,
    table_number, customer_name, status, channel
  ) VALUES (
    v_order_id, v_res.tenant_id, v_res.branch_id, v_res.table_id, v_order_number, 'dine_in',
    v_table.table_number, v_res.customer_name, 'NEW', 'reservation'
  );

  UPDATE reservations SET status = 'seated', order_id = v_order_id WHERE id = p_reservation_id;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_reservation_status(UUID, TEXT, UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION seat_reservation(UUID) TO authenticated;

-- 2g. reservation_calendar — daftar reservasi mendatang siap pakai untuk
--     tampilan Calendar/Timeline di dashboard.
CREATE OR REPLACE VIEW reservation_calendar
WITH (security_invoker = true) AS
SELECT
  r.id, r.tenant_id, r.branch_id, r.table_id, bt.table_number,
  r.customer_name, r.customer_phone, r.party_size, r.reservation_at,
  r.duration_minutes, r.deposit_amount, r.deposit_status, r.status, r.notes
FROM reservations r
LEFT JOIN branch_tables bt ON bt.id = r.table_id;

-- =========================================================
-- 3. ONLINE ORDER HUB (Takeaway / Delivery Multisaluran)
-- =========================================================

-- 3a. Penyesuaian harga otomatis per menu x kanal penjualan.
CREATE TABLE IF NOT EXISTS channel_pricings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('gofood', 'grabfood', 'shopeefood', 'website')),
  markup_pct NUMERIC NOT NULL DEFAULT 0,     -- mis. 20 = harga kanal ini +20% dari harga dine-in
  commission_pct NUMERIC NOT NULL DEFAULT 0, -- komisi yang dipotong platform dari nilai transaksi
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (product_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_channel_pricings_tenant ON channel_pricings (tenant_id, channel);

ALTER TABLE channel_pricings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Channel pricings: view own tenant" ON channel_pricings;

DROP POLICY IF EXISTS "Channel pricings: view own tenant" ON channel_pricings;
CREATE POLICY "Channel pricings: view own tenant" ON channel_pricings
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "Channel pricings: manager/owner write" ON channel_pricings;

CREATE POLICY "Channel pricings: manager/owner write" ON channel_pricings
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() AND is_manager_or_owner());

DROP POLICY IF EXISTS "Channel pricings: manager/owner update" ON channel_pricings;

CREATE POLICY "Channel pricings: manager/owner update" ON channel_pricings
  FOR UPDATE USING (tenant_id = current_tenant_id() AND is_manager_or_owner());

DROP POLICY IF EXISTS "Channel pricings: manager/owner delete" ON channel_pricings;

CREATE POLICY "Channel pricings: manager/owner delete" ON channel_pricings
  FOR DELETE USING (tenant_id = current_tenant_id() AND is_manager_or_owner());

-- Harga jual produk di kanal tertentu, dibulatkan ke Rupiah terdekat.
-- Kalau belum ada aturan markup untuk kombinasi produk+kanal ini,
-- fallback ke harga dine-in biasa (markup 0%).
CREATE OR REPLACE FUNCTION get_channel_price(p_product_id UUID, p_channel TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT round(p.price * (1 + COALESCE(cp.markup_pct, 0) / 100))
  FROM products p
  LEFT JOIN channel_pricings cp
    ON cp.product_id = p.id AND cp.channel = p_channel AND cp.is_active = true
  WHERE p.id = p_product_id;
$$;

-- 3b. create_online_order — staff (kasir/manager) input pesanan yang
--     masuk dari GoFood/GrabFood/ShopeeFood/website caPOS. Harga & komisi
--     dihitung dari channel_pricings di server (bukan input bebas kasir),
--     lalu masuk KDS seperti pesanan dine-in biasa (channel != 'pos').
CREATE OR REPLACE FUNCTION create_online_order(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_channel TEXT,          -- 'gofood' | 'grabfood' | 'shopeefood' | 'website'
  p_customer_name TEXT,
  p_notes TEXT,
  p_items JSONB            -- [{ "product_id": "...", "qty": 2 }, ...]
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
  v_unit_price NUMERIC;
  v_commission_pct NUMERIC;
  v_order_id UUID;
  v_order_number TEXT;
  v_seq INT;
  v_commission_total NUMERIC := 0;
BEGIN
  IF NOT is_super_admin() AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: bukan anggota tenant ini';
  END IF;

  IF p_channel NOT IN ('gofood', 'grabfood', 'shopeefood', 'website') THEN
    RAISE EXCEPTION 'Kanal tidak valid';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Pesanan kosong';
  END IF;

  SELECT COUNT(*) + 1 INTO v_seq FROM orders
    WHERE branch_id = p_branch_id AND created_at::date = CURRENT_DATE;
  v_order_number := upper(left(p_channel, 2)) || '-' || lpad(v_seq::text, 3, '0');
  v_order_id := gen_random_uuid();

  INSERT INTO orders (
    id, tenant_id, branch_id, order_number, order_type, customer_name, status, notes, channel
  ) VALUES (
    v_order_id, p_tenant_id, p_branch_id, v_order_number, 'delivery',
    NULLIF(trim(p_customer_name), ''), 'NEW', p_notes, p_channel
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::INT;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 500 THEN
      RAISE EXCEPTION 'Qty item tidak valid';
    END IF;

    SELECT * INTO v_product FROM products
      WHERE id = (v_item->>'product_id')::UUID AND tenant_id = p_tenant_id AND is_available = true;
    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Produk tidak ditemukan atau tidak tersedia';
    END IF;

    v_unit_price := get_channel_price(v_product.id, p_channel);

    SELECT COALESCE(commission_pct, 0) INTO v_commission_pct FROM channel_pricings
      WHERE product_id = v_product.id AND channel = p_channel AND is_active = true;
    v_commission_pct := COALESCE(v_commission_pct, 0);

    INSERT INTO order_items (order_id, product_id, station_id, product_name, qty, unit_price, subtotal)
      VALUES (v_order_id, v_product.id, v_product.station_id, v_product.name, v_qty, v_unit_price, v_unit_price * v_qty);

    v_commission_total := v_commission_total + (v_unit_price * v_qty * v_commission_pct / 100);
  END LOOP;

  UPDATE orders SET channel_commission_amount = round(v_commission_total) WHERE id = v_order_id;

  RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_online_order(UUID, UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- 3c. Izinkan `transaction_payments.method` mencatat pelunasan dari
--     agregator (biasanya sudah ditransfer platform, dicatat di caPOS
--     sebagai metode 'online_platform' supaya tetap tercatat di kas &
--     rekonsiliasi shift tanpa dianggap uang tunai/kartu).
ALTER TABLE transaction_payments DROP CONSTRAINT IF EXISTS transaction_payments_method_check;

ALTER TABLE transaction_payments ADD CONSTRAINT transaction_payments_method_check
  CHECK (method IN ('cash', 'qris', 'debit', 'credit', 'ewallet', 'bank_transfer', 'online_platform'));

-- 3d. channel_commission_report — rekap komisi platform vs pendapatan
--     bersih, dipakai di dashboard Online Order Hub.
CREATE OR REPLACE VIEW channel_commission_report
WITH (security_invoker = true) AS
SELECT
  t.tenant_id, o.branch_id, o.channel,
  DATE(t.created_at) AS sale_date,
  COUNT(DISTINCT t.id) AS total_orders,
  SUM(t.total_amount) AS gross_revenue,
  SUM(o.channel_commission_amount) AS total_commission,
  SUM(t.total_amount - o.channel_commission_amount) AS net_revenue
FROM transactions t
JOIN orders o ON o.id = t.order_id
WHERE o.channel <> 'pos'
GROUP BY t.tenant_id, o.branch_id, o.channel, DATE(t.created_at);

-- =========================================================
-- 4. ANALITIK PERTUMBUHAN & OTOMATISASI BISNIS
-- =========================================================

-- 4a. customer_visit_stats — dasar untuk Repeat Visit Rate, LTV, dan
--     deteksi pelanggan tidak aktif. Berbasis data Membership (satu-
--     satunya identitas pelanggan yang tersambung ke transaksi di caPOS).
CREATE OR REPLACE VIEW customer_visit_stats
WITH (security_invoker = true) AS
SELECT
  m.tenant_id,
  m.id AS member_id,
  m.customer_name,
  m.customer_phone,
  COUNT(t.id) AS visit_count,
  COALESCE(SUM(t.total_amount), 0) AS lifetime_value,
  MIN(t.created_at) AS first_visit_at,
  MAX(t.created_at) AS last_visit_at,
  CASE WHEN MAX(t.created_at) IS NULL THEN NULL
       ELSE EXTRACT(DAY FROM now() - MAX(t.created_at))::INT END AS days_since_last_visit,
  (COUNT(t.id) > 1) AS is_repeat_customer
FROM memberships m
LEFT JOIN transactions t ON t.member_id = m.id
GROUP BY m.tenant_id, m.id, m.customer_name, m.customer_phone;

-- 4b. inactive_customers — pelanggan member yang tidak transaksi >30 hari
--     (kandidat kirim voucher/penawaran otomatis).
CREATE OR REPLACE VIEW inactive_customers
WITH (security_invoker = true) AS
SELECT * FROM customer_visit_stats
WHERE last_visit_at IS NOT NULL AND days_since_last_visit > 30;

-- 4c. growth_summary — ringkasan satu-panggilan untuk kartu statistik di
--     Dashboard Analitik Pertumbuhan (Repeat Visit Rate, LTV rata-rata,
--     jumlah pelanggan tidak aktif). Berjalan sebagai SECURITY INVOKER
--     (default) — RLS memberships/transactions milik pemanggil tetap
--     berlaku, p_tenant_id hanya mempersempit hasil, bukan membuka akses.
CREATE OR REPLACE FUNCTION growth_summary(p_tenant_id UUID)
RETURNS TABLE (
  total_customers BIGINT,
  repeat_customers BIGINT,
  repeat_visit_rate NUMERIC,
  avg_ltv NUMERIC,
  inactive_customers_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE is_repeat_customer)::BIGINT,
    ROUND(COALESCE(COUNT(*) FILTER (WHERE is_repeat_customer)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 0), 1),
    ROUND(COALESCE(AVG(lifetime_value), 0), 0),
    COUNT(*) FILTER (WHERE days_since_last_visit > 30)::BIGINT
  FROM customer_visit_stats
  WHERE tenant_id = p_tenant_id;
$$;

-- 4d. menu_engineering_report — Matriks Boston (Stars / Plowhorses /
--     Puzzles / Dogs): volume penjualan vs profitabilitas (margin HPP),
--     dibandingkan terhadap RATA-RATA seluruh menu tenant yang sama.
--     SECURITY INVOKER (default) — RLS products/transactions pemanggil
--     tetap berlaku sebagai lapis keamanan kedua di luar p_tenant_id.
CREATE OR REPLACE FUNCTION menu_engineering_report(
  p_tenant_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL
)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  category TEXT,
  price NUMERIC,
  cost_price NUMERIC,
  margin_amount NUMERIC,
  margin_pct NUMERIC,
  qty_sold NUMERIC,
  revenue NUMERIC,
  avg_qty_sold NUMERIC,
  avg_margin_amount NUMERIC,
  classification TEXT,
  recommendation TEXT
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH sales AS (
    SELECT
      p.id AS s_product_id, p.name AS s_product_name, p.category AS s_category,
      p.price AS s_price, p.cost_price AS s_cost_price,
      (p.price - p.cost_price) AS s_margin_amount,
      COALESCE(SUM(ti.qty) FILTER (
        WHERE (p_date_from IS NULL OR t.created_at::date >= p_date_from)
          AND (p_date_to IS NULL OR t.created_at::date <= p_date_to)
          AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
      ), 0) AS s_qty_sold,
      COALESCE(SUM(ti.subtotal) FILTER (
        WHERE (p_date_from IS NULL OR t.created_at::date >= p_date_from)
          AND (p_date_to IS NULL OR t.created_at::date <= p_date_to)
          AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
      ), 0) AS s_revenue
    FROM products p
    LEFT JOIN transaction_items ti ON ti.product_id = p.id
    LEFT JOIN transactions t ON t.id = ti.transaction_id AND t.tenant_id = p_tenant_id
    WHERE p.tenant_id = p_tenant_id AND p.is_available = true
    GROUP BY p.id, p.name, p.category, p.price, p.cost_price
  ),
  agg AS (
    SELECT AVG(s_qty_sold) AS avg_qty, AVG(s_margin_amount) AS avg_margin FROM sales
  )
  SELECT
    s.s_product_id, s.s_product_name, s.s_category, s.s_price, s.s_cost_price,
    s.s_margin_amount,
    CASE WHEN s.s_price > 0 THEN ROUND(s.s_margin_amount / s.s_price * 100, 1) ELSE 0 END,
    s.s_qty_sold, s.s_revenue,
    ROUND(a.avg_qty, 2), ROUND(a.avg_margin, 0),
    CASE
      WHEN s.s_qty_sold >= a.avg_qty AND s.s_margin_amount >= a.avg_margin THEN 'STAR'
      WHEN s.s_qty_sold >= a.avg_qty AND s.s_margin_amount < a.avg_margin THEN 'PLOWHORSE'
      WHEN s.s_qty_sold < a.avg_qty AND s.s_margin_amount >= a.avg_margin THEN 'PUZZLE'
      ELSE 'DOG'
    END,
    CASE
      WHEN s.s_qty_sold >= a.avg_qty AND s.s_margin_amount >= a.avg_margin
        THEN 'Andalan — pertahankan kualitas & posisi menonjol di menu.'
      WHEN s.s_qty_sold >= a.avg_qty AND s.s_margin_amount < a.avg_margin
        THEN 'Laris tapi margin tipis — pertimbangkan naikkan harga sedikit atau tekan HPP.'
      WHEN s.s_qty_sold < a.avg_qty AND s.s_margin_amount >= a.avg_margin
        THEN 'Margin bagus tapi kurang laku — promosikan atau reposisi tampilan menu.'
      ELSE 'Penjualan & margin rendah — pertimbangkan hapus dari katalog.'
    END
  FROM sales s CROSS JOIN agg a
  ORDER BY s.s_revenue DESC;
END;
$$;

-- =========================================================
-- 5. REALTIME — daftarkan tabel baru ke publication supaya UI live
--    (bell notifikasi order QR baru di POS, live table status, dst)
--    tidak perlu polling. `orders`/`order_items` sudah terdaftar sejak
--    migration_012, jadi QR Self-Order & Reservasi (yang menulis ke
--    tabel itu juga) OTOMATIS realtime tanpa entri tambahan di sini.
-- =========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'qr_orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE qr_orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'reservations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE reservations;
  END IF;
END $$;

-- =========================================================
-- SELESAI. Ringkasan objek baru Phase 4:
--   Tabel   : branch_tables, qr_orders, reservations, channel_pricings
--   Kolom   : branches.slug, orders.table_id/channel/channel_commission_amount
--   Views   : table_live_status, reservation_calendar, channel_commission_report,
--             customer_visit_stats, inactive_customers
--   Fungsi  : get_qr_order_page, submit_qr_order, get_qr_order_status,
--             mark_qr_order_paid (server-only), get_branch_public_info,
--             create_reservation, get_reservation_status,
--             update_reservation_status, seat_reservation,
--             get_channel_price, create_online_order,
--             growth_summary, menu_engineering_report
--
-- Langkah selanjutnya:
--   1. Owner/Manager tambah meja per cabang di /dashboard/qr-tables lalu
--      cetak QR (mengarah ke capos.id/order/<slug-cabang>/<no-meja>).
--   2. Aktifkan markup harga per kanal di /dashboard/channel-pricing
--      sebelum mulai mencatat pesanan GoFood/GrabFood/ShopeeFood.
--   3. Set env MIDTRANS_SERVER_KEY (sudah ada dari Phase 1) untuk
--      mengaktifkan QRIS Dynamic di /order/[branch]/[table].
-- =========================================================

-- =========================================================
-- MIGRASI 014 (GABUNGAN) — Loyalty/Promo/Voucher + F&B Core Engine (Ingredient/Recipe/Modifier) + Expenses/Budgets + Wiring Deduction ke Checkout
-- File gabungan (concat apa adanya, urutan asli dipertahankan)
-- dari beberapa migration terpisah, supaya jumlah file yang
-- perlu dijalankan lebih sedikit. Tidak ada isi yang diubah,
-- hanya digabung berurutan.
-- =========================================================

-- ============================================================
-- >>> BERASAL DARI: migration_017_checkout_loyalty_promo_voucher.sql
-- ============================================================
-- =========================================================
-- MIGRATION 017 — Hubungkan Loyalitas, Promosi & Voucher ke checkout_transaction()
-- =========================================================
-- MASALAH YANG DIPERBAIKI:
-- checkout_transaction() (didefinisikan ulang terakhir di migration_011)
-- hanya pernah tahu soal diskon member (tabel `memberships`, fase lama).
-- Modul Phase 3 (loyalty_config, earn_loyalty_points, promotions, vouchers)
-- dan seluruh UI CRM/Promosi/Loyalitas yang dibangun di atasnya TIDAK
-- PERNAH benar-benar tersambung ke transaksi kasir sungguhan:
--   - Poin loyalitas tidak pernah ditambahkan (earn_loyalty_points tidak
--     pernah dipanggil dari checkout).
--   - Voucher/promosi yang "divalidasi" di UI tidak pernah benar-benar
--     memotong total di server — server tetap authoritative dan
--     mengabaikan keduanya.
-- Migration ini menambah kolom yang diperlukan lalu menulis ulang
-- checkout_transaction() supaya benar-benar menerapkan & mencatat
-- ketiganya, tetap dengan server sebagai satu-satunya sumber kebenaran
-- finansial (Rule #65 pada master prompt Phase 3).
-- =========================================================

-- 1. Kolom baru di transactions — supaya breakdown subtotal/diskon/poin
--    per transaksi bisa dilihat di riwayat & laporan (bukan cuma total_amount
--    gabungan seperti sebelumnya).
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS voucher_id UUID REFERENCES vouchers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promotion_id UUID REFERENCES promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loyalty_points_earned INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions (tenant_id, customer_id);

COMMENT ON COLUMN transactions.discount_amount IS 'Total diskon (member + promosi/voucher, TIDAK termasuk penukaran poin loyalitas) yang benar-benar diterapkan server saat checkout.';

COMMENT ON COLUMN transactions.subtotal_amount IS 'Subtotal sebelum diskon apa pun — dipakai untuk analitik "discount rate" (rule #43 master prompt).';

-- 2. checkout_transaction() — signature lama (7 parameter, dari migration_011)
--    HARUS di-drop eksplisit dulu, atau CREATE OR REPLACE dengan parameter
--    tambahan akan membuat overload baru alih-alih menimpa (pelajaran yang
--    sama seperti dicatat di migration_011).
DROP FUNCTION IF EXISTS checkout_transaction(UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID);

-- ============================================================
-- >>> BERASAL DARI: migration_015_phase1_fnb_core.sql
-- ============================================================
-- =========================================================
-- MIGRASI 015 — PHASE 1: F&B CORE ENGINE
-- Product/Variant -> Modifier -> Recipe -> Ingredient ->
-- Branch Ingredient Stock -> Stock Movement -> COGS, terhubung
-- dengan Purchase -> Inventory -> Recipe Consumption -> Sales.
--
-- Melanjutkan schema.sql + migration_001..014. ADDITIF & idempotent:
--  - Tidak ada DROP tabel/kolom lama. products.stock_qty/cost_price,
--    order_items.variant_notes, transaction_items lama TETAP ada dan
--    tetap berfungsi persis seperti sebelumnya.
--  - checkout_transaction() / checkout_order_v2() / create_kitchen_order()
--    TIDAK diubah di migrasi ini — kolom snapshot baru (variant_id,
--    modifier_selections, recipe_id, recipe_version) nullable & default
--    aman, jadi alur checkout existing jalan tanpa modifikasi. Mengaitkan
--    consume_recipe() ke dalam alur checkout adalah langkah lanjutan
--    (terpisah) setelah Phase 1 ini di-review.
--
-- BUG FIX PENTING: migration_013 (calculate_weighted_average_cost,
-- process_goods_receipt) sudah mereferensikan tabel `branch_ingredients_stock`
-- yang TERNYATA belum pernah dibuat di migration manapun (hanya `branch_stock`
-- yang ada, dibuat migration_011, dan itu untuk PRODUCT bukan ingredient).
-- Akibatnya process_goods_receipt() akan gagal total dengan error
-- "relation branch_ingredients_stock does not exist" kalau dipanggil.
-- Migrasi ini membuat tabel tersebut dengan benar (section 4) dan
-- me-replace ulang kedua fungsi itu (section 14) supaya sesuai skema baru.
-- =========================================================

-- =========================================================
-- 0. TENANT SETTING — izinkan stok ingredient negatif (opsional, default OFF)
-- =========================================================
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS allow_negative_ingredient_stock BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.allow_negative_ingredient_stock IS 'Kalau true, consume_recipe()/deduct tetap lanjut walau stok ingredient tidak cukup (stok boleh minus). Default false (blokir transaksi kalau stok kurang).';

-- =========================================================
-- 13. PURCHASE INTEGRATION — po_items/grn_items harus bisa menunjuk
--     ingredient_id (bukan cuma product_id), dan qty harus mendukung
--     desimal (18.5 gram, dst). ALTER TYPE INT -> NUMERIC aman (tidak
--     ada kehilangan data untuk baris existing).
-- =========================================================
ALTER TABLE po_items
  ADD COLUMN IF NOT EXISTS ingredient_id UUID REFERENCES ingredients(id),
  ADD COLUMN IF NOT EXISTS purchase_unit TEXT REFERENCES units(code),
  ALTER COLUMN qty_ordered TYPE NUMERIC USING qty_ordered::NUMERIC,
  ALTER COLUMN qty_received TYPE NUMERIC USING qty_received::NUMERIC;

ALTER TABLE grn_items
  ADD COLUMN IF NOT EXISTS ingredient_id UUID REFERENCES ingredients(id),
  ADD COLUMN IF NOT EXISTS purchase_unit TEXT REFERENCES units(code),
  ALTER COLUMN qty_received TYPE NUMERIC USING qty_received::NUMERIC;

CREATE INDEX IF NOT EXISTS idx_po_items_ingredient ON po_items (ingredient_id);

CREATE INDEX IF NOT EXISTS idx_grn_items_ingredient ON grn_items (ingredient_id);

COMMENT ON COLUMN po_items.ingredient_id IS 'Isi ini untuk pembelian bahan baku/material (ingredient). product_id lama tetap dipakai untuk pembelian produk jadi (kalau ada). Salah satu harus terisi.';

-- =========================================================
-- 14. FIX + PERLUAS: calculate_weighted_average_cost & process_goods_receipt
--     supaya benar-benar bekerja di branch_ingredients_stock (bukan tabel
--     yang tidak pernah ada), dan mendukung baris berbasis ingredient_id.
--     Signature calculate_weighted_average_cost() DIPERTAHANKAN sama
--     (p_product_id sekarang dipakai sebagai p_ingredient_id) supaya
--     pemanggil lama tidak perlu diubah.
-- =========================================================
CREATE OR REPLACE FUNCTION calculate_weighted_average_cost(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_product_id UUID, -- diperlakukan sebagai ingredient_id
  p_new_qty NUMERIC,
  p_new_unit_price NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_qty NUMERIC;
  v_current_cost NUMERIC;
  v_weighted_avg NUMERIC;
BEGIN
  SELECT stock_qty, cost_price INTO v_current_qty, v_current_cost
  FROM branch_ingredients_stock
  WHERE branch_id = p_branch_id AND ingredient_id = p_product_id;

  IF v_current_qty IS NULL OR v_current_qty = 0 THEN
    RETURN p_new_unit_price;
  END IF;

  v_weighted_avg := (v_current_qty * COALESCE(v_current_cost, 0) + p_new_qty * p_new_unit_price)
                    / (v_current_qty + p_new_qty);

  RETURN ROUND(v_weighted_avg, 2);
END;
$$;

CREATE OR REPLACE FUNCTION process_goods_receipt(
  p_grn_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grn goods_receipts%ROWTYPE;
  v_po purchase_orders%ROWTYPE;
  v_item RECORD;
  v_wac NUMERIC;
  v_branch_id UUID;
  v_base_qty NUMERIC;
BEGIN
  SELECT * INTO v_grn FROM goods_receipts WHERE id = p_grn_id;
  IF v_grn.id IS NULL THEN
    RAISE EXCEPTION 'GRN tidak ditemukan';
  END IF;

  SELECT * INTO v_po FROM purchase_orders WHERE id = v_grn.po_id;
  IF v_po.id IS NULL THEN
    RAISE EXCEPTION 'PO tidak ditemukan';
  END IF;

  v_branch_id := COALESCE(v_grn.branch_id, main_branch_id(v_grn.tenant_id));

  FOR v_item IN SELECT gi.* FROM grn_items gi WHERE gi.grn_id = p_grn_id
  LOOP
    IF v_item.ingredient_id IS NULL THEN
      -- Baris lama tanpa ingredient_id (pembelian produk jadi) — biarkan
      -- seperti perilaku lama, cukup catat stock_movements produk seperti sebelumnya.
      INSERT INTO stock_movements (tenant_id, branch_id, product_id, type, qty_change, note, created_by)
      VALUES (v_grn.tenant_id, v_branch_id, v_item.product_id, 'purchase', v_item.qty_received,
              'GRN ' || v_grn.grn_number || ' dari PO ' || v_po.po_number, v_grn.received_by);
      CONTINUE;
    END IF;

    -- Konversi ke inventory_unit ingredient kalau purchase_unit beda.
    SELECT convert_unit(
      v_grn.tenant_id, v_item.qty_received,
      COALESCE(v_item.purchase_unit, (SELECT purchase_unit FROM ingredients WHERE id = v_item.ingredient_id)),
      (SELECT inventory_unit FROM ingredients WHERE id = v_item.ingredient_id)
    ) INTO v_base_qty;

    v_wac := calculate_weighted_average_cost(
      v_grn.tenant_id, v_branch_id, v_item.ingredient_id, v_base_qty,
      v_item.unit_price / NULLIF(v_base_qty / NULLIF(v_item.qty_received, 0), 0)
    );

    INSERT INTO branch_ingredients_stock (tenant_id, branch_id, ingredient_id, stock_qty, cost_price, updated_at)
    VALUES (v_grn.tenant_id, v_branch_id, v_item.ingredient_id, v_base_qty, v_wac, now())
    ON CONFLICT (branch_id, ingredient_id) DO UPDATE SET
      stock_qty = branch_ingredients_stock.stock_qty + EXCLUDED.stock_qty,
      cost_price = v_wac,
      updated_at = now();

    INSERT INTO ingredient_stock_movements (tenant_id, branch_id, ingredient_id, type, qty_change, unit, note, created_by)
    SELECT v_grn.tenant_id, v_branch_id, v_item.ingredient_id, 'PURCHASE', v_base_qty, inventory_unit,
           'GRN ' || v_grn.grn_number || ' dari PO ' || v_po.po_number, v_grn.received_by
    FROM ingredients WHERE id = v_item.ingredient_id;

    UPDATE po_items SET qty_received = qty_received + v_item.qty_received
    WHERE po_id = v_po.id AND ingredient_id = v_item.ingredient_id;
  END LOOP;

  UPDATE purchase_orders SET
    status = CASE
      WHEN (SELECT COUNT(*) FROM po_items WHERE po_id = v_po.id AND qty_received < qty_ordered) = 0
      THEN 'RECEIVED' ELSE 'PARTIAL_RECEIVED'
    END,
    received_date = CASE WHEN status <> 'RECEIVED' THEN CURRENT_DATE ELSE received_date END,
    updated_at = now()
  WHERE id = v_po.id;

  RETURN TRUE;
END;
$$;

-- =========================================================
-- 6. checkout_transaction — CREATE OR REPLACE penuh (signature 10
--    parameter dari migration_017, tidak berubah). Satu-satunya tambahan:
--    PERFORM deduct_recipe_stock_for_transaction(v_tx_id) sebelum RETURN.
-- =========================================================
CREATE OR REPLACE FUNCTION checkout_transaction(
  p_tenant_id UUID,
  p_cashier_id UUID,
  p_invoice_number TEXT,
  p_payment_method TEXT,
  p_member_code TEXT,
  p_items JSONB,
  p_branch_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_voucher_code TEXT DEFAULT NULL,
  p_promotion_id UUID DEFAULT NULL
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
  v_member_discount NUMERIC := 0;
  v_promo_voucher_discount NUMERIC := 0;
  v_total NUMERIC;
  v_tx_id UUID;
  v_shift_id UUID;
  v_branch_id UUID;
  v_stock_qty NUMERIC;
  v_pending_product_ids UUID[] := '{}';
  v_pending_qtys INT[] := '{}';
  v_pending_subtotals NUMERIC[] := '{}';
  v_i INT;
  v_voucher vouchers%ROWTYPE;
  v_customer customers%ROWTYPE;
  v_loyalty_points INT := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: bukan anggota tenant ini';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang kosong';
  END IF;

  v_branch_id := COALESCE(
    p_branch_id,
    (SELECT branch_id FROM profiles WHERE id = p_cashier_id),
    main_branch_id(p_tenant_id)
  );

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

  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers
      WHERE id = p_customer_id AND tenant_id = p_tenant_id AND is_active = true;
    IF v_customer.id IS NULL THEN
      RAISE EXCEPTION 'Pelanggan tidak ditemukan atau tidak aktif';
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

    IF v_product.track_stock THEN
      SELECT stock_qty INTO v_stock_qty FROM branch_stock
        WHERE branch_id = v_branch_id AND product_id = v_product.id
        FOR UPDATE;

      IF v_stock_qty IS NULL THEN
        v_stock_qty := 0;
        INSERT INTO branch_stock (tenant_id, branch_id, product_id, stock_qty)
          VALUES (p_tenant_id, v_branch_id, v_product.id, 0)
          ON CONFLICT (branch_id, product_id) DO NOTHING;
      END IF;

      IF v_stock_qty < v_qty THEN
        RAISE EXCEPTION 'STOCK_INSUFFICIENT: Stok "%" tidak cukup di cabang ini (tersisa %, diminta %).',
          v_product.name, v_stock_qty, v_qty;
      END IF;

      UPDATE branch_stock SET stock_qty = stock_qty - v_qty, updated_at = now()
        WHERE branch_id = v_branch_id AND product_id = v_product.id;

      INSERT INTO stock_movements (tenant_id, branch_id, product_id, type, qty_change, note, created_by)
        VALUES (p_tenant_id, v_branch_id, v_product.id, 'sale', -v_qty, 'Otomatis dari transaksi ' || p_invoice_number, p_cashier_id);
    END IF;

    v_subtotal := v_subtotal + (v_product.price * v_qty);

    v_pending_product_ids := array_append(v_pending_product_ids, v_product.id);
    v_pending_qtys := array_append(v_pending_qtys, v_qty);
    v_pending_subtotals := array_append(v_pending_subtotals, v_product.price * v_qty);
  END LOOP;

  v_member_discount := round(v_subtotal * v_discount_pct / 100);

  IF p_voucher_code IS NOT NULL AND p_voucher_code <> '' THEN
    SELECT * INTO v_voucher FROM vouchers
      WHERE tenant_id = p_tenant_id
        AND voucher_code = p_voucher_code
        AND is_active = true
      FOR UPDATE;

    IF v_voucher.id IS NULL THEN
      RAISE EXCEPTION 'Voucher tidak ditemukan atau tidak aktif';
    END IF;
    IF v_voucher.branch_id IS NOT NULL AND v_voucher.branch_id <> v_branch_id THEN
      RAISE EXCEPTION 'Voucher tidak berlaku untuk cabang ini';
    END IF;
    IF v_voucher.start_date > now() OR (v_voucher.expiry_date IS NOT NULL AND v_voucher.expiry_date < now()) THEN
      RAISE EXCEPTION 'Voucher sudah tidak berlaku (kedaluwarsa atau belum mulai)';
    END IF;
    IF v_voucher.usage_limit IS NOT NULL AND v_voucher.usage_count >= v_voucher.usage_limit THEN
      RAISE EXCEPTION 'Voucher sudah mencapai batas penggunaan';
    END IF;
    IF v_subtotal < v_voucher.min_purchase_amount THEN
      RAISE EXCEPTION 'Belanja belum mencapai minimum Rp% untuk voucher ini', v_voucher.min_purchase_amount;
    END IF;

    IF v_voucher.discount_type = 'PERCENTAGE' THEN
      v_promo_voucher_discount := round(v_subtotal * v_voucher.discount_value / 100);
      IF v_voucher.max_discount_amount IS NOT NULL AND v_promo_voucher_discount > v_voucher.max_discount_amount THEN
        v_promo_voucher_discount := v_voucher.max_discount_amount;
      END IF;
    ELSE
      v_promo_voucher_discount := LEAST(v_voucher.discount_value, v_subtotal);
    END IF;

    UPDATE vouchers SET usage_count = usage_count + 1, updated_at = now() WHERE id = v_voucher.id;

  ELSIF p_promotion_id IS NOT NULL THEN
    v_promo_voucher_discount := apply_promotion(p_promotion_id, v_subtotal);
  END IF;

  v_total := round(v_subtotal - v_member_discount - v_promo_voucher_discount);
  IF v_total < 0 THEN
    v_total := 0;
  END IF;

  INSERT INTO transactions (
    id, tenant_id, cashier_id, invoice_number, total_amount,
    payment_method, member_id, is_offline_sync, shift_id, branch_id,
    customer_id, voucher_id, promotion_id, subtotal_amount, discount_amount
  ) VALUES (
    v_tx_id, p_tenant_id, p_cashier_id, p_invoice_number, v_total,
    p_payment_method, v_member_id, false, v_shift_id, v_branch_id,
    p_customer_id,
    CASE WHEN v_voucher.id IS NOT NULL THEN v_voucher.id ELSE NULL END,
    CASE WHEN v_voucher.id IS NULL AND p_promotion_id IS NOT NULL THEN p_promotion_id ELSE NULL END,
    v_subtotal, v_member_discount + v_promo_voucher_discount
  );

  FOR v_i IN 1..array_length(v_pending_product_ids, 1) LOOP
    INSERT INTO transaction_items (transaction_id, product_id, qty, subtotal)
      VALUES (v_tx_id, v_pending_product_ids[v_i], v_pending_qtys[v_i], v_pending_subtotals[v_i]);
  END LOOP;

  IF v_voucher.id IS NOT NULL THEN
    INSERT INTO voucher_redemptions (voucher_id, transaction_id, customer_id, discount_given)
      VALUES (v_voucher.id, v_tx_id, p_customer_id, v_promo_voucher_discount);
  END IF;

  IF p_customer_id IS NOT NULL THEN
    v_loyalty_points := calculate_loyalty_points(p_tenant_id, v_total);
    IF v_loyalty_points > 0 THEN
      PERFORM earn_loyalty_points(v_tx_id, p_customer_id, v_loyalty_points);
      UPDATE transactions SET loyalty_points_earned = v_loyalty_points WHERE id = v_tx_id;
    END IF;

    UPDATE customers
      SET visit_count = visit_count + 1,
          lifetime_spend = lifetime_spend + v_total,
          last_visit_date = now(),
          updated_at = now()
      WHERE id = p_customer_id;
  END IF;

  -- BARU (Migrasi 019): potong branch_ingredients_stock berdasar resep
  -- DEFAULT tiap produk (jalur ini tidak punya konsep varian/modifier).
  -- Kalau consume_recipe() gagal (stok bahan baku kurang & tidak boleh
  -- negatif), seluruh transaksi ini ikut rollback (all-or-nothing).
  PERFORM deduct_recipe_stock_for_transaction(v_tx_id);

  RETURN v_tx_id;
END;
$$;

COMMENT ON FUNCTION checkout_transaction IS 'Checkout otoritatif (Migrasi 017 + Migrasi 019) — server menghitung subtotal, diskon member, diskon voucher/promosi, total akhir, poin loyalitas, DAN memotong stok bahan baku berbasis resep default produk lewat deduct_recipe_stock_for_transaction(). Client TIDAK PERNAH mengirim harga/total/diskon, hanya product_id+qty.';

-- 2. get_qr_order_page — tambahkan `tenant_id` di objek `branch` supaya
--    SelfOrderClient bisa subscribe ke topik broadcast
--    `products-<tenant_id>` yang sama dipakai POS/KDS. Field lain & isi
--    query TIDAK berubah dari migration_014 — tetap satu fungsi publik,
--    tetap tidak membuka tabel `products` langsung ke anon.
CREATE OR REPLACE FUNCTION get_qr_order_page(p_branch_slug TEXT, p_table_number TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch branches%ROWTYPE;
  v_table branch_tables%ROWTYPE;
  v_result JSONB;
BEGIN
  SELECT * INTO v_branch FROM branches WHERE slug = p_branch_slug AND is_active = true;
  IF v_branch.id IS NULL THEN
    RETURN jsonb_build_object('error', 'branch_not_found');
  END IF;

  SELECT * INTO v_table FROM branch_tables
    WHERE branch_id = v_branch.id AND table_number = p_table_number AND is_active = true;
  IF v_table.id IS NULL THEN
    RETURN jsonb_build_object('error', 'table_not_found');
  END IF;

  SELECT jsonb_build_object(
    'branch', jsonb_build_object(
      'name', v_branch.name, 'slug', v_branch.slug, 'address', v_branch.address,
      -- BARU (Migrasi 020) — hanya dipakai sebagai nama topik broadcast
      -- realtime ketersediaan menu, bukan untuk query apa pun di klien.
      'tenant_id', v_branch.tenant_id
    ),
    'table', jsonb_build_object('id', v_table.id, 'table_number', v_table.table_number, 'capacity', v_table.capacity),
    'products', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id, 'name', p.name, 'price', p.price,
          'category', COALESCE(p.category, 'Lainnya'), 'image_url', p.image_url
        )
        ORDER BY p.category NULLS LAST, p.name
      )
      FROM products p WHERE p.tenant_id = v_branch.tenant_id AND p.is_available = true
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_qr_order_page(TEXT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION get_qr_order_page IS
  'Migrasi 020: sama seperti sebelumnya (migration_014) + field branch.tenant_id, dipakai SelfOrderClient.tsx sebagai nama topik broadcast realtime.products-<tenant_id> untuk menerima notifikasi Sold Out/Menu 86 secara instan.';


SET check_function_bodies = on;
