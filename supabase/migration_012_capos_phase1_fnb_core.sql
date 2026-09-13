-- 012_capos_phase1_fnb_core.sql

SET check_function_bodies = off;

-- =========================================================
-- 1. UNIT MASTER — daftar unit resmi, TIDAK hardcode di frontend.
-- =========================================================
CREATE TABLE IF NOT EXISTS units (
  code TEXT PRIMARY KEY,      -- 'gram', 'kilogram', 'ml', 'liter', 'pcs', 'bungkus', 'pack', 'bottle', 'box', 'sachet'
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO units (code, name) VALUES
  ('gram', 'Gram'),
  ('kilogram', 'Kilogram'),
  ('ml', 'Mililiter'),
  ('liter', 'Liter'),
  ('pcs', 'Pcs'),
  ('bungkus', 'Bungkus'),
  ('pack', 'Pack'),
  ('bottle', 'Bottle'),
  ('box', 'Box'),
  ('sachet', 'Sachet')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE units IS 'Unit master global (Phase 1). "bungkus" adalah unit resmi dan TIDAK boleh dihapus/diganti jadi "pcs" oleh migrasi manapun.';

-- =========================================================
-- 2. UNIT CONVERSION — konfigurable, dipakai Purchasing/GRN/Recipe/
--    Waste/Stock Opname/COGS. tenant_id NULL = default global (berlaku
--    untuk semua tenant); tenant_id terisi = override khusus tenant itu.
-- =========================================================
CREATE TABLE IF NOT EXISTS unit_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = default global
  from_unit TEXT NOT NULL REFERENCES units(code),
  to_unit TEXT NOT NULL REFERENCES units(code),
  factor NUMERIC NOT NULL CHECK (factor > 0), -- 1 from_unit = factor * to_unit
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_conversions_unique
  ON unit_conversions (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'), from_unit, to_unit);

INSERT INTO unit_conversions (tenant_id, from_unit, to_unit, factor) VALUES
  (NULL, 'kilogram', 'gram', 1000),
  (NULL, 'gram', 'kilogram', 0.001),
  (NULL, 'liter', 'ml', 1000),
  (NULL, 'ml', 'liter', 0.001)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE unit_conversions IS 'Faktor konversi antar unit (Phase 1). Contoh baris pack/box -> pcs bersifat tenant-specific (jumlah isi beda per supplier), jadi TIDAK diisi default global — tenant mengisi sendiri lewat admin.';

-- Fungsi konversi: cari override tenant dulu, baru fallback ke default global.
-- Kalau from_unit = to_unit, selalu 1 tanpa perlu baris di tabel.
CREATE OR REPLACE FUNCTION convert_unit(
  p_tenant_id UUID,
  p_qty NUMERIC,
  p_from_unit TEXT,
  p_to_unit TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_factor NUMERIC;
BEGIN
  IF p_from_unit = p_to_unit THEN
    RETURN p_qty;
  END IF;

  SELECT factor INTO v_factor FROM unit_conversions
  WHERE tenant_id = p_tenant_id AND from_unit = p_from_unit AND to_unit = p_to_unit;

  IF v_factor IS NULL THEN
    SELECT factor INTO v_factor FROM unit_conversions
    WHERE tenant_id IS NULL AND from_unit = p_from_unit AND to_unit = p_to_unit;
  END IF;

  IF v_factor IS NULL THEN
    RAISE EXCEPTION 'Konversi unit % -> % belum dikonfigurasi', p_from_unit, p_to_unit;
  END IF;

  RETURN p_qty * v_factor;
END;
$$;

-- =========================================================
-- 3. INGREDIENT MASTER — bahan baku & material (termasuk packaging:
--    cup, lid, straw, bungkus, dst — TIDAK dibatasi hanya makanan).
-- =========================================================
CREATE TABLE IF NOT EXISTS ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT, -- bebas: 'food', 'beverage', 'packaging', dst — deskriptif saja, tidak membatasi fungsi
  purchase_unit TEXT NOT NULL REFERENCES units(code),   -- unit saat dibeli (mis. KG)
  inventory_unit TEXT NOT NULL REFERENCES units(code),  -- unit dasar/stok (mis. GRAM)
  -- Dipakai HANYA kalau purchase_unit <-> inventory_unit tidak ada di unit_conversions
  -- (mis. "1 box = 24 pcs" khusus supplier tertentu). NULL = pakai convert_unit().
  purchase_to_inventory_ratio NUMERIC CHECK (purchase_to_inventory_ratio IS NULL OR purchase_to_inventory_ratio > 0),
  low_stock_threshold NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  is_86 BOOLEAN NOT NULL DEFAULT false, -- flag manual "habis sementara" (86), terpisah dari stock_qty
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_ingredients_tenant_status ON ingredients (tenant_id, status);

COMMENT ON TABLE ingredients IS 'Ingredient/material master (Phase 1). Termasuk packaging (cup/lid/straw/bungkus). Tidak boleh hard-delete kalau sudah dipakai recipe/histori — lihat trigger prevent_ingredient_hard_delete.';

-- =========================================================
-- 4. BRANCH INGREDIENT STOCK — sumber kebenaran stok ingredient per
--    cabang (BUKAN products.stock_qty). Ini tabel yang selama ini
--    hilang tapi sudah dipakai fungsi migration_013 — lihat catatan bug fix di atas.
-- =========================================================
CREATE TABLE IF NOT EXISTS branch_ingredients_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id) ON DELETE RESTRICT,
  stock_qty NUMERIC NOT NULL DEFAULT 0,          -- dalam inventory_unit ingredient ini
  low_stock_threshold NUMERIC,                    -- override threshold per cabang; NULL = pakai ingredients.low_stock_threshold
  cost_price NUMERIC NOT NULL DEFAULT 0,          -- HPP weighted average per inventory_unit, per cabang
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (branch_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_ing_stock_tenant_branch ON branch_ingredients_stock (tenant_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_branch_ing_stock_ingredient ON branch_ingredients_stock (ingredient_id);

COMMENT ON TABLE branch_ingredients_stock IS 'Stok ingredient per (tenant, branch, ingredient) — sumber kebenaran inventory bahan baku (Phase 1).';

-- =========================================================
-- 5. PRODUCT VARIANT ENGINE — terpisah dari order_items.variant_notes
--    (teks bebas lama tetap kompatibel, tidak dihapus).
-- =========================================================
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,       -- "Regular", "Large"
  sku TEXT,
  price NUMERIC NOT NULL CHECK (price >= 0),
  cost_price NUMERIC,
  is_available BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants (product_id, display_order);

COMMENT ON TABLE product_variants IS 'Varian produk terstruktur (Phase 1). variant_notes bebas-teks lama tetap dipertahankan untuk order lama.';

-- =========================================================
-- 6. MODIFIER ENGINE
-- =========================================================
CREATE TABLE IF NOT EXISTS modifier_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,        -- "Size", "Milk", "Sugar", "Ice", "Add-on"
  is_required BOOLEAN NOT NULL DEFAULT false,
  min_select INT NOT NULL DEFAULT 0,
  max_select INT NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CHECK (min_select <= max_select)
);

CREATE TABLE IF NOT EXISTS modifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_group_id UUID REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,        -- "Oat Milk", "Extra Shot"
  price_adjustment NUMERIC NOT NULL DEFAULT 0,
  is_available BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modifiers_group ON modifiers (modifier_group_id, display_order);

CREATE TABLE IF NOT EXISTS product_modifier_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  modifier_group_id UUID REFERENCES modifier_groups(id) ON DELETE CASCADE,
  display_order INT NOT NULL DEFAULT 0,
  UNIQUE (product_id, modifier_group_id)
);

CREATE INDEX IF NOT EXISTS idx_pmg_product ON product_modifier_groups (product_id);

-- Modifier bisa mengubah pemakaian ingredient (bukan cuma harga).
CREATE TABLE IF NOT EXISTS modifier_ingredient_impacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_id UUID REFERENCES modifiers(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity_delta NUMERIC NOT NULL, -- boleh negatif (mis. "Less Sugar" = -5g)
  unit TEXT NOT NULL REFERENCES units(code) -- harus konsisten dengan ingredients.inventory_unit ingredient terkait
);

CREATE INDEX IF NOT EXISTS idx_mii_modifier ON modifier_ingredient_impacts (modifier_id);

CREATE INDEX IF NOT EXISTS idx_mii_ingredient ON modifier_ingredient_impacts (ingredient_id);

COMMENT ON TABLE modifier_ingredient_impacts IS 'Dampak modifier ke konsumsi ingredient (Phase 1), mis. Extra Shot = +9g Coffee Beans, Oat Milk = +150ml Oat Milk, Less Sugar = -5g Sugar.';

-- =========================================================
-- 7. RECIPE / BOM ENGINE — bisa beda per variant, mendukung versioning.
-- =========================================================
CREATE TABLE IF NOT EXISTS recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE, -- NULL = berlaku untuk semua varian produk ini
  name TEXT,
  version INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  yield_quantity NUMERIC NOT NULL DEFAULT 1,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Hanya boleh ada 1 recipe AKTIF per (product, variant) atau 1 recipe
-- AKTIF "default" (variant_id NULL) per product.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_active_default
  ON recipes (product_id) WHERE is_active AND variant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_active_variant
  ON recipes (product_id, variant_id) WHERE is_active AND variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recipes_product ON recipes (product_id, variant_id);

COMMENT ON TABLE recipes IS 'Recipe/BOM (Phase 1). Mendukung versioning — recipe lama TIDAK diubah/dihapus, cukup is_active=false lalu buat baris versi baru, supaya histori transaksi lama tetap merujuk ke recipe/cost snapshot saat itu.';

CREATE TABLE IF NOT EXISTS recipe_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL REFERENCES units(code), -- harus konsisten dengan ingredients.inventory_unit
  wastage_percentage NUMERIC DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe ON recipe_items (recipe_id);

CREATE INDEX IF NOT EXISTS idx_recipe_items_ingredient ON recipe_items (ingredient_id);

-- Ambil recipe aktif untuk sebuah product/variant — variant-specific
-- diutamakan, fallback ke recipe default produk (variant_id NULL).
CREATE OR REPLACE FUNCTION resolve_active_recipe(p_product_id UUID, p_variant_id UUID)
RETURNS UUID
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM recipes
  WHERE product_id = p_product_id AND is_active = true
    AND (variant_id = p_variant_id OR variant_id IS NULL)
  ORDER BY (variant_id IS NOT NULL) DESC
  LIMIT 1;
$$;

-- =========================================================
-- 9. RECIPE CONSUMPTION LOG — audit trail tiap automatic deduction.
-- =========================================================
CREATE TABLE IF NOT EXISTS recipe_consumption_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('order_item', 'transaction_item')),
  source_id UUID NOT NULL, -- order_items.id atau transaction_items.id
  recipe_id UUID REFERENCES recipes(id),
  recipe_version INT,
  ingredient_id UUID REFERENCES ingredients(id),
  quantity NUMERIC NOT NULL,
  unit TEXT NOT NULL REFERENCES units(code),
  cost_snapshot NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rcl_source ON recipe_consumption_logs (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_rcl_tenant_branch ON recipe_consumption_logs (tenant_id, branch_id, created_at DESC);

COMMENT ON TABLE recipe_consumption_logs IS 'Jejak audit tiap automatic ingredient deduction (Phase 1) — dipakai untuk COGS berbasis recipe & investigasi selisih stok.';

-- =========================================================
-- 10. INGREDIENT STOCK MOVEMENT — mirror stock_movements (yang product-
--     based) tapi untuk ingredient. Dipisah supaya tidak bentrok FK.
-- =========================================================
CREATE TABLE IF NOT EXISTS ingredient_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  ingredient_id UUID REFERENCES ingredients(id),
  type TEXT NOT NULL CHECK (type IN (
    'PURCHASE', 'SALE', 'RECIPE_CONSUMPTION', 'WASTE', 'SPOILAGE', 'DAMAGE',
    'ADJUSTMENT', 'STOCK_OPNAME', 'TRANSFER_IN', 'TRANSFER_OUT', 'REFUND', 'RETURN'
  )),
  qty_change NUMERIC NOT NULL, -- positif = stok bertambah, negatif = stok berkurang (dalam inventory_unit)
  unit TEXT REFERENCES units(code),
  note TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ism_tenant_branch ON ingredient_stock_movements (tenant_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ism_ingredient ON ingredient_stock_movements (ingredient_id, created_at DESC);

-- =========================================================
-- 11. INGREDIENT WASTE LOG
-- =========================================================
CREATE TABLE IF NOT EXISTS ingredient_waste_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  ingredient_id UUID REFERENCES ingredients(id),
  waste_type TEXT NOT NULL CHECK (waste_type IN (
    'EXPIRED', 'DAMAGED', 'SPOILED', 'SPILLAGE', 'WRONG_PREPARATION', 'STAFF_MEAL', 'LOSS', 'OTHER'
  )),
  qty_wasted NUMERIC NOT NULL CHECK (qty_wasted > 0),
  cost_price NUMERIC NOT NULL DEFAULT 0,
  total_loss_amount NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  recorded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iwl_branch ON ingredient_waste_logs (branch_id, created_at DESC);

COMMENT ON TABLE ingredient_waste_logs IS 'Waste ingredient (Phase 1) — terpisah dari waste_logs lama (product-based di migration_013), yang TIDAK dihapus.';

-- =========================================================
-- 12. INGREDIENT STOCK OPNAME LOG
-- =========================================================
CREATE TABLE IF NOT EXISTS ingredient_stock_opname_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  ingredient_id UUID REFERENCES ingredients(id),
  system_qty NUMERIC NOT NULL,
  physical_qty NUMERIC NOT NULL,
  difference_qty NUMERIC NOT NULL,
  cost_price_snapshot NUMERIC NOT NULL DEFAULT 0,
  loss_value NUMERIC NOT NULL DEFAULT 0,
  reason TEXT,
  note TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_isol_tenant_branch ON ingredient_stock_opname_logs (tenant_id, branch_id, created_at DESC);

-- =========================================================
-- 15. RECIPE COST & INGREDIENT REQUIREMENT HELPERS
-- =========================================================
CREATE OR REPLACE FUNCTION recipe_ingredient_requirements(
  p_recipe_id UUID,
  p_modifier_ids UUID[] DEFAULT '{}'
) RETURNS TABLE(ingredient_id UUID, quantity NUMERIC, unit TEXT)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT x.ingredient_id, SUM(x.quantity) AS quantity, MIN(x.unit) AS unit
  FROM (
    SELECT ri.ingredient_id, ri.quantity, ri.unit
    FROM recipe_items ri WHERE ri.recipe_id = p_recipe_id
    UNION ALL
    SELECT mii.ingredient_id, mii.quantity_delta, mii.unit
    FROM modifier_ingredient_impacts mii
    WHERE mii.modifier_id = ANY (COALESCE(p_modifier_ids, '{}'))
  ) x
  GROUP BY x.ingredient_id
  HAVING SUM(x.quantity) <> 0;
$$;

CREATE OR REPLACE FUNCTION calculate_recipe_cost(
  p_recipe_id UUID,
  p_branch_id UUID DEFAULT NULL
) RETURNS NUMERIC
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(
    ri.quantity * COALESCE(
      (SELECT bis.cost_price FROM branch_ingredients_stock bis
       WHERE bis.ingredient_id = ri.ingredient_id
         AND bis.branch_id = COALESCE(p_branch_id, main_branch_id((SELECT tenant_id FROM recipes WHERE id = p_recipe_id)))),
      0)
  ), 0)
  FROM recipe_items ri
  WHERE ri.recipe_id = p_recipe_id;
$$;

CREATE OR REPLACE FUNCTION validate_ingredient_availability(
  p_branch_id UUID,
  p_recipe_id UUID,
  p_modifier_ids UUID[],
  p_qty INT
) RETURNS TABLE(ingredient_id UUID, ingredient_name TEXT, required_qty NUMERIC, available_qty NUMERIC, is_sufficient BOOLEAN)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    r.ingredient_id,
    i.name,
    r.quantity * p_qty,
    COALESCE(bis.stock_qty, 0),
    COALESCE(bis.stock_qty, 0) >= (r.quantity * p_qty)
  FROM recipe_ingredient_requirements(p_recipe_id, p_modifier_ids) r
  JOIN ingredients i ON i.id = r.ingredient_id
  LEFT JOIN branch_ingredients_stock bis
    ON bis.branch_id = p_branch_id AND bis.ingredient_id = r.ingredient_id;
$$;

-- =========================================================
-- 16. AUTOMATIC INGREDIENT DEDUCTION — atomic. Dipanggil per order item
--     SETELAH order/transaksi berhasil di-insert (langkah pengaitan ke
--     checkout_transaction()/checkout_order_v2() adalah migrasi lanjutan).
--     Jika stok tidak cukup: RAISE EXCEPTION -> seluruh efek function ini
--     (semua UPDATE/INSERT di dalamnya) rollback otomatis bersama statement
--     pemanggilnya. Tidak ada kondisi "sebagian sukses, sebagian gagal".
-- =========================================================
CREATE OR REPLACE FUNCTION consume_recipe(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_recipe_id UUID,
  p_modifier_ids UUID[],
  p_qty INT,
  p_source_type TEXT, -- 'order_item' | 'transaction_item'
  p_source_id UUID,
  p_created_by UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req RECORD;
  v_available NUMERIC;
  v_allow_negative BOOLEAN;
  v_recipe_version INT;
  v_ing_name TEXT;
BEGIN
  IF p_tenant_id IS DISTINCT FROM current_tenant_id() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Tenant tidak sesuai';
  END IF;

  SELECT allow_negative_ingredient_stock INTO v_allow_negative FROM tenants WHERE id = p_tenant_id;
  SELECT version INTO v_recipe_version FROM recipes WHERE id = p_recipe_id;

  -- Pass 1: lock + validasi SEMUA ingredient dulu, baru kurangi (all-or-nothing).
  FOR v_req IN
    SELECT r.ingredient_id, r.quantity * p_qty AS required_qty, r.unit
    FROM recipe_ingredient_requirements(p_recipe_id, p_modifier_ids) r
  LOOP
    INSERT INTO branch_ingredients_stock (tenant_id, branch_id, ingredient_id, stock_qty)
    VALUES (p_tenant_id, p_branch_id, v_req.ingredient_id, 0)
    ON CONFLICT (branch_id, ingredient_id) DO NOTHING;

    SELECT stock_qty INTO v_available
    FROM branch_ingredients_stock
    WHERE branch_id = p_branch_id AND ingredient_id = v_req.ingredient_id
    FOR UPDATE;

    IF COALESCE(v_available, 0) < v_req.required_qty AND NOT COALESCE(v_allow_negative, false) THEN
      SELECT name INTO v_ing_name FROM ingredients WHERE id = v_req.ingredient_id;
      RAISE EXCEPTION 'Stok % tidak cukup (tersedia %, butuh %)', v_ing_name, COALESCE(v_available, 0), v_req.required_qty;
    END IF;
  END LOOP;

  -- Pass 2: deduct + log.
  FOR v_req IN
    SELECT r.ingredient_id, r.quantity * p_qty AS required_qty, r.unit
    FROM recipe_ingredient_requirements(p_recipe_id, p_modifier_ids) r
  LOOP
    UPDATE branch_ingredients_stock
    SET stock_qty = stock_qty - v_req.required_qty, updated_at = now()
    WHERE branch_id = p_branch_id AND ingredient_id = v_req.ingredient_id;

    INSERT INTO ingredient_stock_movements (tenant_id, branch_id, ingredient_id, type, qty_change, unit, note, created_by)
    VALUES (p_tenant_id, p_branch_id, v_req.ingredient_id, 'RECIPE_CONSUMPTION', -v_req.required_qty, v_req.unit,
            'Konsumsi resep dari ' || p_source_type || ' ' || p_source_id::TEXT, p_created_by);

    INSERT INTO recipe_consumption_logs (
      tenant_id, branch_id, source_type, source_id, recipe_id, recipe_version,
      ingredient_id, quantity, unit, cost_snapshot
    )
    SELECT p_tenant_id, p_branch_id, p_source_type, p_source_id, p_recipe_id, v_recipe_version,
           v_req.ingredient_id, v_req.required_qty, v_req.unit,
           v_req.required_qty * COALESCE(
             (SELECT cost_price FROM branch_ingredients_stock WHERE branch_id = p_branch_id AND ingredient_id = v_req.ingredient_id), 0);
  END LOOP;

  RETURN TRUE;
END;
$$;

-- =========================================================
-- 17. MANUAL STOCK OPERATIONS (adjustment, waste, opname) — ingredient.
-- =========================================================
CREATE OR REPLACE FUNCTION adjust_ingredient_stock(
  p_ingredient_id UUID,
  p_branch_id UUID,
  p_qty_change NUMERIC,
  p_type TEXT DEFAULT 'ADJUSTMENT',
  p_note TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id UUID := current_tenant_id();
BEGIN
  IF NOT is_manager_or_owner() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Hanya Owner/Manager yang boleh menyesuaikan stok bahan baku';
  END IF;

  INSERT INTO branch_ingredients_stock (tenant_id, branch_id, ingredient_id, stock_qty)
  VALUES (v_tenant_id, p_branch_id, p_ingredient_id, GREATEST(p_qty_change, 0))
  ON CONFLICT (branch_id, ingredient_id) DO UPDATE
    SET stock_qty = branch_ingredients_stock.stock_qty + p_qty_change, updated_at = now();

  INSERT INTO ingredient_stock_movements (tenant_id, branch_id, ingredient_id, type, qty_change, unit, note, created_by)
  SELECT v_tenant_id, p_branch_id, p_ingredient_id, p_type, p_qty_change, inventory_unit, p_note, auth.uid()
  FROM ingredients WHERE id = p_ingredient_id;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION record_ingredient_waste(
  p_ingredient_id UUID,
  p_branch_id UUID,
  p_qty_wasted NUMERIC,
  p_waste_type TEXT,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id UUID := current_tenant_id();
  v_cost NUMERIC;
  v_log_id UUID;
BEGIN
  IF p_qty_wasted <= 0 THEN
    RAISE EXCEPTION 'Jumlah waste harus lebih dari 0';
  END IF;

  SELECT cost_price INTO v_cost FROM branch_ingredients_stock
  WHERE branch_id = p_branch_id AND ingredient_id = p_ingredient_id;

  INSERT INTO ingredient_waste_logs (
    tenant_id, branch_id, ingredient_id, waste_type, qty_wasted, cost_price, total_loss_amount, note, recorded_by
  ) VALUES (
    v_tenant_id, p_branch_id, p_ingredient_id, p_waste_type, p_qty_wasted,
    COALESCE(v_cost, 0), p_qty_wasted * COALESCE(v_cost, 0), p_note, auth.uid()
  ) RETURNING id INTO v_log_id;

  UPDATE branch_ingredients_stock
  SET stock_qty = GREATEST(stock_qty - p_qty_wasted, 0), updated_at = now()
  WHERE branch_id = p_branch_id AND ingredient_id = p_ingredient_id;

  INSERT INTO ingredient_stock_movements (tenant_id, branch_id, ingredient_id, type, qty_change, unit, note, created_by)
  SELECT v_tenant_id, p_branch_id, p_ingredient_id, 'WASTE', -p_qty_wasted, inventory_unit, p_note, auth.uid()
  FROM ingredients WHERE id = p_ingredient_id;

  RETURN v_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION submit_ingredient_stock_opname(
  p_ingredient_id UUID,
  p_branch_id UUID,
  p_physical_qty NUMERIC,
  p_reason TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id UUID := current_tenant_id();
  v_system_qty NUMERIC;
  v_cost NUMERIC;
  v_diff NUMERIC;
  v_log_id UUID;
BEGIN
  IF NOT is_manager_or_owner() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Hanya Owner/Manager yang boleh melakukan stock opname';
  END IF;

  SELECT stock_qty, cost_price INTO v_system_qty, v_cost
  FROM branch_ingredients_stock WHERE branch_id = p_branch_id AND ingredient_id = p_ingredient_id;

  v_system_qty := COALESCE(v_system_qty, 0);
  v_diff := p_physical_qty - v_system_qty;

  INSERT INTO ingredient_stock_opname_logs (
    tenant_id, branch_id, ingredient_id, system_qty, physical_qty, difference_qty,
    cost_price_snapshot, loss_value, reason, note, created_by
  ) VALUES (
    v_tenant_id, p_branch_id, p_ingredient_id, v_system_qty, p_physical_qty, v_diff,
    COALESCE(v_cost, 0),
    CASE WHEN v_diff < 0 THEN abs(v_diff) * COALESCE(v_cost, 0) ELSE 0 END,
    p_reason, p_note, auth.uid()
  ) RETURNING id INTO v_log_id;

  INSERT INTO branch_ingredients_stock (tenant_id, branch_id, ingredient_id, stock_qty, cost_price)
  VALUES (v_tenant_id, p_branch_id, p_ingredient_id, p_physical_qty, COALESCE(v_cost, 0))
  ON CONFLICT (branch_id, ingredient_id) DO UPDATE
    SET stock_qty = p_physical_qty, updated_at = now();

  INSERT INTO ingredient_stock_movements (tenant_id, branch_id, ingredient_id, type, qty_change, unit, note, created_by)
  SELECT v_tenant_id, p_branch_id, p_ingredient_id, 'STOCK_OPNAME', v_diff, inventory_unit,
         COALESCE(p_note, 'Stock opname'), auth.uid()
  FROM ingredients WHERE id = p_ingredient_id;

  RETURN v_log_id;
END;
$$;

-- =========================================================
-- 18. AVAILABILITY — Manual (products.is_available / modifiers.is_available)
--     + Ingredient Availability -> Final Availability. Dihitung on-demand
--     lewat fungsi, TIDAK menulis ulang products.is_available (menghindari
--     side effect ke fitur lama yang sudah bergantung ke kolom itu).
-- =========================================================
CREATE OR REPLACE FUNCTION is_ingredient_available(p_ingredient_id UUID, p_branch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT status = 'active' AND NOT is_86 FROM ingredients WHERE id = p_ingredient_id)
    AND COALESCE(
      (SELECT stock_qty > 0 FROM branch_ingredients_stock WHERE ingredient_id = p_ingredient_id AND branch_id = p_branch_id),
      false
    );
$$;

CREATE OR REPLACE FUNCTION is_modifier_available(p_modifier_id UUID, p_branch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    m.is_available AND NOT EXISTS (
      SELECT 1 FROM modifier_ingredient_impacts mii
      WHERE mii.modifier_id = m.id AND mii.quantity_delta > 0
        AND NOT is_ingredient_available(mii.ingredient_id, p_branch_id)
    )
  FROM modifiers m WHERE m.id = p_modifier_id;
$$;

CREATE OR REPLACE FUNCTION is_product_available_at_branch(p_product_id UUID, p_variant_id UUID, p_branch_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE((SELECT is_available FROM products WHERE id = p_product_id), true)
    AND NOT EXISTS (
      SELECT 1 FROM recipe_items ri
      WHERE ri.recipe_id = resolve_active_recipe(p_product_id, p_variant_id)
        AND NOT is_ingredient_available(ri.ingredient_id, p_branch_id)
    );
$$;

COMMENT ON FUNCTION is_product_available_at_branch IS 'Final Availability = Manual Availability (products.is_available) AND Ingredient Availability (semua ingredient recipe aktif tersedia). Query ini, jangan tulis ulang products.is_available.';

-- =========================================================
-- 19. DELETE PROTECTION — tidak ada hard delete untuk data yang sudah
--     dipakai histori transaksi. Gunakan status inactive/is_available=false.
-- =========================================================
CREATE OR REPLACE FUNCTION prevent_ingredient_hard_delete() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM recipe_items WHERE ingredient_id = OLD.id)
     OR EXISTS (SELECT 1 FROM recipe_consumption_logs WHERE ingredient_id = OLD.id)
     OR EXISTS (SELECT 1 FROM ingredient_stock_movements WHERE ingredient_id = OLD.id) THEN
    RAISE EXCEPTION 'Ingredient "%" tidak bisa dihapus karena sudah dipakai di recipe/histori. Nonaktifkan (status=inactive) saja.', OLD.name;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_ingredient_delete ON ingredients;

CREATE TRIGGER trg_prevent_ingredient_delete BEFORE DELETE ON ingredients
FOR EACH ROW EXECUTE FUNCTION prevent_ingredient_hard_delete();

CREATE OR REPLACE FUNCTION prevent_variant_hard_delete() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM order_items WHERE variant_id = OLD.id)
     OR EXISTS (SELECT 1 FROM transaction_items WHERE variant_id = OLD.id)
     OR EXISTS (SELECT 1 FROM recipes WHERE variant_id = OLD.id) THEN
    RAISE EXCEPTION 'Varian "%" tidak bisa dihapus karena sudah dipakai di order/recipe. Nonaktifkan saja (is_available=false).', OLD.name;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_variant_delete ON product_variants;

CREATE TRIGGER trg_prevent_variant_delete BEFORE DELETE ON product_variants
FOR EACH ROW EXECUTE FUNCTION prevent_variant_hard_delete();

CREATE OR REPLACE FUNCTION prevent_modifier_hard_delete() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM order_items
       WHERE modifier_selections @> jsonb_build_array(jsonb_build_object('modifier_id', OLD.id::text))
     )
     OR EXISTS (
       SELECT 1 FROM transaction_items
       WHERE modifier_selections @> jsonb_build_array(jsonb_build_object('modifier_id', OLD.id::text))
     ) THEN
    RAISE EXCEPTION 'Modifier "%" tidak bisa dihapus karena pernah dipakai di order. Nonaktifkan saja (is_available=false).', OLD.name;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_modifier_delete ON modifiers;

CREATE TRIGGER trg_prevent_modifier_delete BEFORE DELETE ON modifiers
FOR EACH ROW EXECUTE FUNCTION prevent_modifier_hard_delete();

CREATE OR REPLACE FUNCTION prevent_recipe_hard_delete() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM recipe_consumption_logs WHERE recipe_id = OLD.id)
     OR EXISTS (SELECT 1 FROM order_items WHERE recipe_id = OLD.id)
     OR EXISTS (SELECT 1 FROM transaction_items WHERE recipe_id = OLD.id) THEN
    RAISE EXCEPTION 'Recipe "%" (v%) tidak bisa dihapus karena sudah dipakai di transaksi. Nonaktifkan saja (is_active=false) dan buat versi baru.', OLD.name, OLD.version;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_recipe_delete ON recipes;

CREATE TRIGGER trg_prevent_recipe_delete BEFORE DELETE ON recipes
FOR EACH ROW EXECUTE FUNCTION prevent_recipe_hard_delete();

-- =========================================================
-- 20. RLS — semua tabel baru: tenant-scoped, branch-scoped kalau relevan.
--     Master data (ingredients/variants/modifiers/recipes/unit overrides):
--     Owner/Manager tulis, semua role tenant baca. Cashier TIDAK bisa
--     insert/update langsung (harus lewat RPC SECURITY DEFINER di atas).
-- =========================================================
ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ingredients: view own tenant" ON ingredients;

DROP POLICY IF EXISTS "Ingredients: view own tenant" ON ingredients;
CREATE POLICY "Ingredients: view own tenant" ON ingredients
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "Ingredients: manager/owner write" ON ingredients;

CREATE POLICY "Ingredients: manager/owner write" ON ingredients
  FOR ALL USING (tenant_id = current_tenant_id() AND is_manager_or_owner())
  WITH CHECK (tenant_id = current_tenant_id() AND is_manager_or_owner());

ALTER TABLE branch_ingredients_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Branch ingredient stock: scoped view" ON branch_ingredients_stock;

DROP POLICY IF EXISTS "Branch ingredient stock: scoped view" ON branch_ingredients_stock;
CREATE POLICY "Branch ingredient stock: scoped view" ON branch_ingredients_stock
  FOR SELECT USING (
    is_super_admin() OR (tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id()))
  );

DROP POLICY IF EXISTS "Branch ingredient stock: manager/owner scoped write" ON branch_ingredients_stock;

CREATE POLICY "Branch ingredient stock: manager/owner scoped write" ON branch_ingredients_stock
  FOR ALL USING (
    tenant_id = current_tenant_id() AND is_manager_or_owner() AND (is_owner() OR branch_id = current_branch_id())
  );

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Product variants: view own tenant" ON product_variants;

DROP POLICY IF EXISTS "Product variants: view own tenant" ON product_variants;
CREATE POLICY "Product variants: view own tenant" ON product_variants
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "Product variants: manager/owner write" ON product_variants;

CREATE POLICY "Product variants: manager/owner write" ON product_variants
  FOR ALL USING (tenant_id = current_tenant_id() AND is_manager_or_owner())
  WITH CHECK (tenant_id = current_tenant_id() AND is_manager_or_owner());

ALTER TABLE modifier_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Modifier groups: view own tenant" ON modifier_groups;

DROP POLICY IF EXISTS "Modifier groups: view own tenant" ON modifier_groups;
CREATE POLICY "Modifier groups: view own tenant" ON modifier_groups
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "Modifier groups: manager/owner write" ON modifier_groups;

CREATE POLICY "Modifier groups: manager/owner write" ON modifier_groups
  FOR ALL USING (tenant_id = current_tenant_id() AND is_manager_or_owner())
  WITH CHECK (tenant_id = current_tenant_id() AND is_manager_or_owner());

ALTER TABLE modifiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Modifiers: view via group tenant" ON modifiers;

DROP POLICY IF EXISTS "Modifiers: view via group tenant" ON modifiers;
CREATE POLICY "Modifiers: view via group tenant" ON modifiers
  FOR SELECT USING (
    is_super_admin() OR modifier_group_id IN (SELECT id FROM modifier_groups WHERE tenant_id = current_tenant_id())
  );

DROP POLICY IF EXISTS "Modifiers: manager/owner write via group tenant" ON modifiers;

CREATE POLICY "Modifiers: manager/owner write via group tenant" ON modifiers
  FOR ALL USING (
    is_manager_or_owner() AND modifier_group_id IN (SELECT id FROM modifier_groups WHERE tenant_id = current_tenant_id())
  )
  WITH CHECK (
    is_manager_or_owner() AND modifier_group_id IN (SELECT id FROM modifier_groups WHERE tenant_id = current_tenant_id())
  );

ALTER TABLE product_modifier_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Product modifier groups: via product tenant" ON product_modifier_groups;

DROP POLICY IF EXISTS "Product modifier groups: via product tenant" ON product_modifier_groups;
CREATE POLICY "Product modifier groups: via product tenant" ON product_modifier_groups
  FOR SELECT USING (
    is_super_admin() OR product_id IN (SELECT id FROM products WHERE tenant_id = current_tenant_id())
  );

DROP POLICY IF EXISTS "Product modifier groups: manager/owner write" ON product_modifier_groups;

CREATE POLICY "Product modifier groups: manager/owner write" ON product_modifier_groups
  FOR ALL USING (
    is_manager_or_owner() AND product_id IN (SELECT id FROM products WHERE tenant_id = current_tenant_id())
  )
  WITH CHECK (
    is_manager_or_owner() AND product_id IN (SELECT id FROM products WHERE tenant_id = current_tenant_id())
  );

ALTER TABLE modifier_ingredient_impacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Modifier ingredient impacts: via modifier tenant" ON modifier_ingredient_impacts;

DROP POLICY IF EXISTS "Modifier ingredient impacts: via modifier tenant" ON modifier_ingredient_impacts;
CREATE POLICY "Modifier ingredient impacts: via modifier tenant" ON modifier_ingredient_impacts
  FOR SELECT USING (
    is_super_admin() OR modifier_id IN (
      SELECT m.id FROM modifiers m JOIN modifier_groups g ON g.id = m.modifier_group_id
      WHERE g.tenant_id = current_tenant_id()
    )
  );

DROP POLICY IF EXISTS "Modifier ingredient impacts: manager/owner write" ON modifier_ingredient_impacts;

CREATE POLICY "Modifier ingredient impacts: manager/owner write" ON modifier_ingredient_impacts
  FOR ALL USING (
    is_manager_or_owner() AND modifier_id IN (
      SELECT m.id FROM modifiers m JOIN modifier_groups g ON g.id = m.modifier_group_id
      WHERE g.tenant_id = current_tenant_id()
    )
  )
  WITH CHECK (
    is_manager_or_owner() AND modifier_id IN (
      SELECT m.id FROM modifiers m JOIN modifier_groups g ON g.id = m.modifier_group_id
      WHERE g.tenant_id = current_tenant_id()
    )
  );

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Recipes: view own tenant" ON recipes;

DROP POLICY IF EXISTS "Recipes: view own tenant" ON recipes;
CREATE POLICY "Recipes: view own tenant" ON recipes
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "Recipes: manager/owner write" ON recipes;

CREATE POLICY "Recipes: manager/owner write" ON recipes
  FOR ALL USING (tenant_id = current_tenant_id() AND is_manager_or_owner())
  WITH CHECK (tenant_id = current_tenant_id() AND is_manager_or_owner());

ALTER TABLE recipe_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Recipe items: view via recipe tenant" ON recipe_items;

DROP POLICY IF EXISTS "Recipe items: view via recipe tenant" ON recipe_items;
CREATE POLICY "Recipe items: view via recipe tenant" ON recipe_items
  FOR SELECT USING (
    is_super_admin() OR recipe_id IN (SELECT id FROM recipes WHERE tenant_id = current_tenant_id())
  );

DROP POLICY IF EXISTS "Recipe items: manager/owner write" ON recipe_items;

CREATE POLICY "Recipe items: manager/owner write" ON recipe_items
  FOR ALL USING (
    is_manager_or_owner() AND recipe_id IN (SELECT id FROM recipes WHERE tenant_id = current_tenant_id())
  )
  WITH CHECK (
    is_manager_or_owner() AND recipe_id IN (SELECT id FROM recipes WHERE tenant_id = current_tenant_id())
  );

ALTER TABLE recipe_consumption_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Recipe consumption logs: scoped view" ON recipe_consumption_logs;

DROP POLICY IF EXISTS "Recipe consumption logs: scoped view" ON recipe_consumption_logs;
CREATE POLICY "Recipe consumption logs: scoped view" ON recipe_consumption_logs
  FOR SELECT USING (
    is_super_admin() OR (tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id()))
  );

-- INSERT hanya lewat consume_recipe() (SECURITY DEFINER, bypass RLS) — tidak ada policy INSERT langsung.

ALTER TABLE ingredient_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ingredient stock movements: scoped view" ON ingredient_stock_movements;

DROP POLICY IF EXISTS "Ingredient stock movements: scoped view" ON ingredient_stock_movements;
CREATE POLICY "Ingredient stock movements: scoped view" ON ingredient_stock_movements
  FOR SELECT USING (
    is_super_admin() OR (tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id()))
  );

ALTER TABLE ingredient_waste_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ingredient waste logs: scoped view" ON ingredient_waste_logs;

DROP POLICY IF EXISTS "Ingredient waste logs: scoped view" ON ingredient_waste_logs;
CREATE POLICY "Ingredient waste logs: scoped view" ON ingredient_waste_logs
  FOR SELECT USING (
    is_super_admin() OR (tenant_id = current_tenant_id() AND is_manager_or_owner() AND (is_owner() OR branch_id = current_branch_id()))
  );

ALTER TABLE ingredient_stock_opname_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ingredient stock opname logs: scoped view" ON ingredient_stock_opname_logs;

DROP POLICY IF EXISTS "Ingredient stock opname logs: scoped view" ON ingredient_stock_opname_logs;
CREATE POLICY "Ingredient stock opname logs: scoped view" ON ingredient_stock_opname_logs
  FOR SELECT USING (
    is_super_admin() OR (tenant_id = current_tenant_id() AND is_manager_or_owner() AND (is_owner() OR branch_id = current_branch_id()))
  );

ALTER TABLE units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Units: anyone authenticated can view" ON units;

DROP POLICY IF EXISTS "Units: anyone authenticated can view" ON units;
CREATE POLICY "Units: anyone authenticated can view" ON units
  FOR SELECT USING (auth.uid() IS NOT NULL);

ALTER TABLE unit_conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Unit conversions: view global or own tenant" ON unit_conversions;

DROP POLICY IF EXISTS "Unit conversions: view global or own tenant" ON unit_conversions;
CREATE POLICY "Unit conversions: view global or own tenant" ON unit_conversions
  FOR SELECT USING (is_super_admin() OR tenant_id IS NULL OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "Unit conversions: owner writes own tenant override" ON unit_conversions;

DROP POLICY IF EXISTS "Unit conversions: owner writes own tenant override" ON unit_conversions;
CREATE POLICY "Unit conversions: owner writes own tenant override" ON unit_conversions
  FOR ALL USING (is_super_admin() OR (tenant_id = current_tenant_id() AND is_owner()))
  WITH CHECK (is_super_admin() OR (tenant_id = current_tenant_id() AND is_owner()));

-- =========================================================
-- 21. INDEKS TAMBAHAN — hindari N+1 di join tenant/branch/ingredient/
--     product/variant/recipe yang sering dipakai bersamaan.
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_ingredients_tenant ON ingredients (tenant_id);

CREATE INDEX IF NOT EXISTS idx_recipes_tenant ON recipes (tenant_id);

CREATE INDEX IF NOT EXISTS idx_modifier_groups_tenant ON modifier_groups (tenant_id);

-- BUG FIX (Phase 2A.1 audit, found via live execution test): this function's
-- own RETURNS TABLE(order_item_id uuid, ...) output column creates an
-- implicit PL/pgSQL variable named order_item_id in scope for the whole
-- function body, which collided with order_item_modifiers.order_item_id
-- below ('column reference "order_item_id" is ambiguous') -- this would
-- have failed on every real checkout. Qualified with the table name.


-- =========================================================
-- 2. deduct_recipe_stock(order_id) — RPC utama yang diminta.
--    Idempotent lewat recipe_consumption_logs (source_type/source_id):
--    aman dipanggil berkali-kali untuk order yang sama (mis. dari webhook
--    yang retry, atau dipanggil manual lewat API route untuk order lama).
--    Fallback aman (poin Backward Compatibility): kalau sebuah order_item
--    tidak punya resep terdaftar (recipe_id snapshot kosong DAN tidak ada
--    recipe aktif untuk product/variant-nya), item itu DILEWATI tanpa
--    error — product-level stock (branch_stock) yang sudah dipotong di
--    checkout_order_v2() tetap berlaku seperti sebelum Phase 1 F&B Core.
-- =========================================================
CREATE OR REPLACE FUNCTION deduct_recipe_stock(p_order_id UUID)
RETURNS TABLE(order_item_id UUID, deducted BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_branch_id UUID;
  v_item RECORD;
  v_recipe_id UUID;
  v_modifier_ids UUID[];
  v_effective_qty INT;
  v_already BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pesanan tidak ditemukan';
  END IF;

  IF NOT is_super_admin() AND v_order.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan pesanan tenant Anda';
  END IF;

  -- "COMPLETED atau PAID" (poin 2) — di caPOS, order dianggap lunas begitu
  -- statusnya COMPLETED (diset checkout_order_v2() bersamaan dengan
  -- transaction_id terisi). Tidak ada status literal "PAID" terpisah di
  -- tabel orders; QR Self-Order yang sudah dibayar duluan (mark_qr_order_paid)
  -- tetap berujung ke COMPLETED lewat checkout_order_v2() yang sama saat
  -- transaksi benar-benar dibuat, jadi satu pintu ini cukup.
  IF v_order.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'Pesanan belum berstatus COMPLETED (status saat ini: %)', v_order.status;
  END IF;

  v_branch_id := COALESCE(v_order.branch_id, main_branch_id(v_order.tenant_id));

  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    order_item_id := v_item.id;
    v_effective_qty := v_item.qty - v_item.voided_qty;

    IF v_effective_qty <= 0 THEN
      deducted := false; reason := 'VOIDED'; RETURN NEXT; CONTINUE;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM recipe_consumption_logs
      WHERE source_type = 'order_item' AND source_id = v_item.id
    ) INTO v_already;

    IF v_already THEN
      deducted := false; reason := 'ALREADY_DEDUCTED'; RETURN NEXT; CONTINUE;
    END IF;

    -- Resolusi resep: pakai snapshot recipe_id yang dicatat saat order
    -- dibuat (create_kitchen_order) kalau ada; fallback ke resep aktif
    -- product/variant SAAT INI untuk order_item lama yang dibuat sebelum
    -- migrasi ini ada (snapshot-nya masih NULL).
    v_recipe_id := COALESCE(v_item.recipe_id, resolve_active_recipe(v_item.product_id, v_item.variant_id));

    IF v_recipe_id IS NULL THEN
      deducted := false; reason := 'NO_RECIPE'; RETURN NEXT; CONTINUE;
    END IF;

    -- Modifier terpilih: utamakan order_item_modifiers (ternormalisasi,
    -- baru); fallback ke snapshot JSONB modifier_selections untuk baris
    -- lama yang dibuat sebelum tabel order_item_modifiers ada.
    SELECT array_agg(modifier_id) INTO v_modifier_ids
    FROM order_item_modifiers WHERE order_item_modifiers.order_item_id = v_item.id;

    IF v_modifier_ids IS NULL THEN
      SELECT array_agg((x->>'modifier_id')::UUID) INTO v_modifier_ids
      FROM jsonb_array_elements(v_item.modifier_selections) x
      WHERE x->>'modifier_id' IS NOT NULL;
    END IF;

    PERFORM consume_recipe(
      v_order.tenant_id, v_branch_id, v_recipe_id, COALESCE(v_modifier_ids, '{}'::UUID[]),
      v_effective_qty, 'order_item', v_item.id, v_order.cashier_id
    );

    deducted := true; reason := 'OK'; RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION deduct_recipe_stock IS 'Migrasi 019. Potong branch_ingredients_stock berdasar recipe+modifier tiap order_item pada sebuah order COMPLETED, dan catat ke stock_movements-nya-ingredient (ingredient_stock_movements) + recipe_consumption_logs. Idempotent & fallback aman untuk produk tanpa resep. Dipanggil otomatis oleh checkout_order_v2(); bisa juga dipanggil manual (mis. via API route) untuk order lama.';

-- =========================================================
-- 3. deduct_recipe_stock_for_transaction(transaction_id) — padanan untuk
--    checkout_transaction() (kasir cepat, tanpa tiket dapur/order_items).
--    Item di jalur ini tidak mendukung varian/modifier (checkout_transaction
--    hanya menerima product_id+qty), jadi selalu memakai resep default
--    produk (variant_id NULL) tanpa modifier.
-- =========================================================
CREATE OR REPLACE FUNCTION deduct_recipe_stock_for_transaction(p_transaction_id UUID)
RETURNS TABLE(transaction_item_id UUID, deducted BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx transactions%ROWTYPE;
  v_branch_id UUID;
  v_item RECORD;
  v_recipe_id UUID;
  v_already BOOLEAN;
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;

  IF NOT is_super_admin() AND v_tx.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan transaksi tenant Anda';
  END IF;

  v_branch_id := COALESCE(v_tx.branch_id, main_branch_id(v_tx.tenant_id));

  FOR v_item IN SELECT * FROM transaction_items WHERE transaction_id = p_transaction_id LOOP
    transaction_item_id := v_item.id;

    SELECT EXISTS(
      SELECT 1 FROM recipe_consumption_logs
      WHERE source_type = 'transaction_item' AND source_id = v_item.id
    ) INTO v_already;

    IF v_already THEN
      deducted := false; reason := 'ALREADY_DEDUCTED'; RETURN NEXT; CONTINUE;
    END IF;

    v_recipe_id := COALESCE(v_item.recipe_id, resolve_active_recipe(v_item.product_id, v_item.variant_id));

    IF v_recipe_id IS NULL THEN
      deducted := false; reason := 'NO_RECIPE'; RETURN NEXT; CONTINUE;
    END IF;

    PERFORM consume_recipe(
      v_tx.tenant_id, v_branch_id, v_recipe_id, '{}'::UUID[],
      v_item.qty, 'transaction_item', v_item.id, v_tx.cashier_id
    );

    deducted := true; reason := 'OK'; RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION deduct_recipe_stock_for_transaction IS 'Migrasi 019. Padanan deduct_recipe_stock() untuk alur checkout_transaction() (kasir cepat tanpa tiket dapur). Dipanggil otomatis di akhir checkout_transaction().';

-- =========================================================
-- Migration 020 — Realtime Menu Availability ("Sold Out" / Menu 86)
--
-- Latar belakang: POS & KDS butuh toggle cepat "Habis/Sold Out" per
-- produk yang (a) langsung kelihatan di semua terminal kasir + KDS lain
-- lewat Supabase Realtime, dan (b) langsung memblokir pemesanan lewat
-- QR Self-Order — termasuk pelanggan yang HALAMANNYA SUDAH TERBUKA saat
-- item baru saja ditandai habis (bukan cuma di-refresh pertama kali).
--
-- Dua jalur realtime dipakai, sesuai siapa yang mendengarkan:
--
--  1. POS/KDS (kasir yang login, tenant-scoped RLS berlaku normal) —
--     dengar `postgres_changes` langsung dari tabel `products`. Ini
--     butuh tabel `products` masuk publication `supabase_realtime`
--     (belum pernah ditambahkan sebelumnya — baru dilakukan di sini).
--
--  2. Halaman publik /order/[branch]/[table] (anon, TANPA sesi login) —
--     `postgres_changes` tidak bisa dipakai di sini karena RLS
--     `products` mensyaratkan tenant_id = current_tenant_id(), yang
--     selalu NULL untuk anon (sama seperti alasan get_qr_order_page
--     dibuat sebagai SECURITY DEFINER, bukan policy SELECT langsung).
--     Jalur yang dipakai: Supabase Realtime **Broadcast** (channel
--     pub/sub biasa, bukan replikasi tabel) di topik `products-<tenant_id>`
--     — kasir/KDS mem-broadcast pesan begitu toggle berhasil, halaman QR
--     cukup subscribe ke topik yang sama tanpa perlu baca tabel apa pun.
--     Supaya browser pelanggan tahu topik mana yang harus di-subscribe,
--     `get_qr_order_page` di bawah ini ditambah field `branch.tenant_id`
--     (UUID publik, bukan data sensitif — cuma dipakai sebagai nama
--     topik, sama sekali tidak membuka akses baca ke tabel `products`).
-- =========================================================

-- 1. Tambahkan `products` ke publication supabase_realtime (idempotent —
--    pola yang sama dipakai migration_012 untuk `orders`/`order_items`).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'products'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE products;
  END IF;
END $$;

-- REPLICA IDENTITY FULL supaya payload UPDATE dari postgres_changes
-- menyertakan nilai LAMA (`old`) selain yang baru — dipakai POS/KDS untuk
-- tahu produk mana yang barusan berubah tanpa perlu reload semua data.
ALTER TABLE products REPLICA IDENTITY FULL;


SET check_function_bodies = on;
