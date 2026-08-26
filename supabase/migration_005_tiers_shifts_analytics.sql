-- =========================================================
-- MIGRASI: Shift Kasir, Limit Tier Free, Analitik Data Asli
-- Jalankan kalau project Supabase kamu SUDAH ADA sebelum fitur ini
-- ditambahkan. Aman dijalankan berkali-kali (idempotent).
-- =========================================================

-- 1. Tabel shifts (kalau belum ada)
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  cashier_id UUID REFERENCES profiles(id),
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open'
);

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Shifts: own tenant or super_admin" ON shifts;
CREATE POLICY "Shifts: own tenant or super_admin" ON shifts
  FOR ALL USING (is_super_admin() OR tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_shifts_tenant_status ON shifts (tenant_id, cashier_id, status);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES shifts(id);
CREATE INDEX IF NOT EXISTS idx_transactions_shift ON transactions (shift_id);

-- 2. Fungsi tier
CREATE OR REPLACE FUNCTION tenant_tier(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN status = 'active' AND plan = 'yearly' THEN 'supreme'
    WHEN status = 'active' AND plan = 'monthly' THEN 'pro'
    ELSE 'free'
  END
  FROM subscriptions WHERE tenant_id = p_tenant_id;
$$;

-- 3. Fungsi buka shift
CREATE OR REPLACE FUNCTION open_shift(p_tenant_id UUID, p_cashier_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift_id UUID;
BEGIN
  SELECT id INTO v_shift_id FROM shifts
    WHERE tenant_id = p_tenant_id AND cashier_id = p_cashier_id AND status = 'open'
    LIMIT 1;

  IF v_shift_id IS NULL THEN
    INSERT INTO shifts (tenant_id, cashier_id, status)
      VALUES (p_tenant_id, p_cashier_id, 'open')
      RETURNING id INTO v_shift_id;
  END IF;

  RETURN v_shift_id;
END;
$$;

-- 4. checkout_transaction versi baru — sekarang mengaitkan shift_id
CREATE OR REPLACE FUNCTION checkout_transaction(
  p_tenant_id UUID,
  p_cashier_id UUID,
  p_invoice_number TEXT,
  p_payment_method TEXT,
  p_member_code TEXT,
  p_items JSONB
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

-- 5. Trigger limit tier Free (2 kasir, 10 menu)
CREATE OR REPLACE FUNCTION enforce_cashier_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NEW.role <> 'cashier' THEN
    RETURN NEW;
  END IF;

  IF tenant_tier(NEW.tenant_id) = 'free' THEN
    SELECT COUNT(*) INTO v_count FROM profiles
      WHERE tenant_id = NEW.tenant_id AND role = 'cashier';
    IF v_count >= 2 THEN
      RAISE EXCEPTION 'FREE_TIER_CASHIER_LIMIT: Paket Free Trial maksimal 2 akun kasir. Upgrade ke Pro untuk tambah kasir.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_cashier_limit ON profiles;
CREATE TRIGGER trg_enforce_cashier_limit
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_cashier_limit();

CREATE OR REPLACE FUNCTION enforce_menu_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  IF tenant_tier(NEW.tenant_id) = 'free' THEN
    SELECT COUNT(*) INTO v_count FROM products WHERE tenant_id = NEW.tenant_id;
    IF v_count >= 10 THEN
      RAISE EXCEPTION 'FREE_TIER_MENU_LIMIT: Paket Free Trial maksimal 10 menu. Upgrade ke Pro untuk menu unlimited.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_menu_limit ON products;
CREATE TRIGGER trg_enforce_menu_limit
  BEFORE INSERT ON products
  FOR EACH ROW EXECUTE FUNCTION enforce_menu_limit();

-- 6. View analitik data asli
CREATE OR REPLACE VIEW peak_hours_analytics
WITH (security_invoker = true) AS
SELECT tenant_id, EXTRACT(HOUR FROM created_at)::INT AS hour_of_day, COUNT(*) AS total_orders
FROM transactions
GROUP BY tenant_id, EXTRACT(HOUR FROM created_at);

CREATE OR REPLACE VIEW best_seller_analytics
WITH (security_invoker = true) AS
SELECT t.tenant_id, p.name AS product_name, SUM(ti.qty) AS total_qty
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
JOIN products p ON p.id = ti.product_id
GROUP BY t.tenant_id, p.name;
