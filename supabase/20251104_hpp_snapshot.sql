-- ============================================================================
-- 20251104_hpp_snapshot.sql
-- Snapshot HPP per item transaksi + trigger pengisian otomatis.
--
-- Tujuan:
--   1. Laporan historis TIDAK berubah saat products.cost_price diedit.
--   2. HPP dihitung memakai cabang transaksi (bukan cabang utama).
--
-- Jalankan manual di Supabase SQL Editor.
-- URUTAN: jalankan 20251104_product_branch_cost.sql LEBIH DULU, lalu file ini.
-- Idempoten — aman dijalankan ulang.
-- ============================================================================

ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS cost_price_snapshot numeric(14,2),
  ADD COLUMN IF NOT EXISTS hpp_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transaction_items_hpp_source_check'
  ) THEN
    ALTER TABLE public.transaction_items
      ADD CONSTRAINT transaction_items_hpp_source_check
      CHECK (hpp_source IS NULL OR hpp_source IN ('recipe','branch','product','estimate'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transaction_items_tx
  ON public.transaction_items (transaction_id);

CREATE INDEX IF NOT EXISTS idx_transaction_items_product
  ON public.transaction_items (product_id);

-- ---------------------------------------------------------------------------
-- Trigger BEFORE INSERT: isi cost_price_snapshot & hpp_source.
-- (pick_active_recipe dibuat di 20251104_product_branch_cost.sql.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fill_transaction_item_hpp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_branch uuid;
  v_recipe uuid;
  v_cost numeric := 0;
  v_source text := 'estimate';
  v_branch_cost numeric;
  v_product_cost numeric;
BEGIN
  IF NEW.cost_price_snapshot IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT t.tenant_id, COALESCE(t.branch_id, public.main_branch_id(t.tenant_id))
    INTO v_tenant, v_branch
  FROM public.transactions t
  WHERE t.id = NEW.transaction_id;

  IF v_tenant IS NULL THEN
    SELECT tenant_id, public.main_branch_id(tenant_id)
      INTO v_tenant, v_branch
    FROM public.products
    WHERE id = NEW.product_id;
  END IF;

  v_recipe := COALESCE(NEW.recipe_id, public.pick_active_recipe(NEW.product_id, NEW.variant_id));

  IF v_recipe IS NOT NULL THEN
    v_cost := COALESCE(public.calculate_recipe_cost(v_recipe, v_branch), 0);
    IF v_cost > 0 THEN
      v_source := 'recipe';
    END IF;
  END IF;

  IF v_cost <= 0 THEN
    SELECT pbc.cost_price INTO v_branch_cost
    FROM public.product_branch_cost pbc
    WHERE pbc.product_id = NEW.product_id AND pbc.branch_id = v_branch;

    IF v_branch_cost IS NOT NULL AND v_branch_cost > 0 THEN
      v_cost := v_branch_cost;
      v_source := 'branch';
    END IF;
  END IF;

  IF v_cost <= 0 THEN
    SELECT p.cost_price INTO v_product_cost
    FROM public.products p
    WHERE p.id = NEW.product_id;

    IF v_product_cost IS NOT NULL AND v_product_cost > 0 THEN
      v_cost := v_product_cost;
      v_source := 'product';
    END IF;
  END IF;

  NEW.cost_price_snapshot := COALESCE(v_cost, 0);
  NEW.hpp_source := v_source;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_transaction_item_hpp ON public.transaction_items;
CREATE TRIGGER trg_fill_transaction_item_hpp
BEFORE INSERT ON public.transaction_items
FOR EACH ROW
EXECUTE FUNCTION public.fill_transaction_item_hpp();

-- ---------------------------------------------------------------------------
-- Backfill transaksi lama.
-- Tahap 1: dari recipe_consumption_logs.cost_snapshot (paling akurat).
-- Tahap 2: dari HPP cabang / produk (ditandai sumbernya).
-- ---------------------------------------------------------------------------
UPDATE public.transaction_items ti
SET cost_price_snapshot = sub.cost,
    hpp_source = 'recipe'
FROM (
  SELECT source_id, SUM(quantity * cost_snapshot) AS cost
  FROM public.recipe_consumption_logs
  WHERE source_type = 'transaction_item'
  GROUP BY source_id
) sub
WHERE ti.id = sub.source_id
  AND ti.cost_price_snapshot IS NULL
  AND sub.cost > 0;

-- Tahap 2: HPP khusus cabang untuk item yang belum punya snapshot.
-- (Alias target `ti` TIDAK boleh dipakai di JOIN dalam FROM — pakai koma +
--  predikat di WHERE agar valid di PostgreSQL.)
DO $$
BEGIN
  IF to_regclass('public.product_branch_cost') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE public.transaction_items ti
      SET cost_price_snapshot = pbc.cost_price,
          hpp_source = 'branch'
      FROM public.product_branch_cost pbc, public.transactions t
      WHERE t.id = ti.transaction_id
        AND pbc.product_id = ti.product_id
        AND pbc.branch_id = t.branch_id
        AND pbc.cost_price > 0
        AND ti.cost_price_snapshot IS NULL
    $sql$;
  END IF;
END $$;

-- Tahap 3: fallback HPP default produk (tenant-level).
UPDATE public.transaction_items ti
SET cost_price_snapshot = COALESCE(
      (SELECT p.cost_price FROM public.products p WHERE p.id = ti.product_id),
      0
    ),
    hpp_source = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = ti.product_id AND COALESCE(p.cost_price, 0) > 0
      ) THEN 'product'
      ELSE 'estimate'
    END
WHERE ti.cost_price_snapshot IS NULL;

-- Tahap 4: rapikan penanda estimasi untuk snapshot 0 tanpa sumber.
UPDATE public.transaction_items
SET hpp_source = 'estimate'
WHERE COALESCE(cost_price_snapshot, 0) = 0
  AND hpp_source IS NULL;

COMMENT ON COLUMN public.transaction_items.cost_price_snapshot IS
  'HPP per unit saat transaksi terjadi (diisi trigger fill_transaction_item_hpp). Dipakai laporan historis agar tidak berubah saat harga produk diedit.';
COMMENT ON COLUMN public.transaction_items.hpp_source IS
  'Sumber HPP: recipe | branch | product | estimate.';
