-- =====================================================================
-- WP-01 — Snapshot HPP di transaction_items
-- Jalankan MANUAL di Supabase SQL Editor (repo tidak memuat service_role).
-- Urutan: jalankan SETELAH 20251104_product_branch_cost.sql
-- (trigger di bawah memanggil get_product_cost()).
-- =====================================================================

ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS cost_price_snapshot numeric(14,2),
  ADD COLUMN IF NOT EXISTS hpp_source text;

DO $$
BEGIN
  ALTER TABLE public.transaction_items
    ADD CONSTRAINT transaction_items_hpp_source_chk
    CHECK (hpp_source IS NULL OR hpp_source IN ('recipe','branch','wac','product','estimate'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.transaction_items.cost_price_snapshot IS
  'HPP per 1 unit saat item dibuat (WP-01). NULL = data lama sebelum migrasi ini -> laporan menandai "estimasi".';
COMMENT ON COLUMN public.transaction_items.hpp_source IS
  'Asal angka HPP: recipe | branch (product_branch_cost) | wac | product (products.cost_price) | estimate.';

-- Trigger BEFORE INSERT: mengisi snapshot untuk SEMUA jalur checkout
-- (checkout_transaction, checkout_order_v2, checkout_order_split_by_item,
-- dan sinkron offline) tanpa mengubah isi fungsi checkout yang sudah ada.
-- Semua jalur tersebut meng-INSERT transactions lebih dulu, baru items.
CREATE OR REPLACE FUNCTION public.trg_fill_item_cost_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_branch uuid;
  v_recipe uuid;
  v_cost   numeric;
  v_src    text;
BEGIN
  IF NEW.cost_price_snapshot IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT t.branch_id INTO v_branch FROM transactions t WHERE t.id = NEW.transaction_id;

  v_recipe := NEW.recipe_id;
  IF v_recipe IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT r.id INTO v_recipe
    FROM recipes r
    WHERE r.product_id = NEW.product_id
      AND r.variant_id IS NOT DISTINCT FROM NEW.variant_id
      AND r.is_active
    ORDER BY r.version DESC
    LIMIT 1;
  END IF;

  IF v_recipe IS NOT NULL THEN
    -- calculate_recipe_cost = biaya SATU BATCH resep; HPP per porsi = biaya / yield
    -- (sama dengan tampilan "/ porsi" di halaman Resep).
    v_cost := calculate_recipe_cost(v_recipe, v_branch)
              / GREATEST(COALESCE((SELECT r.yield_quantity FROM recipes r WHERE r.id = v_recipe), 1), 1);
    v_src  := 'recipe';
  END IF;

  IF v_cost IS NULL OR v_cost <= 0 THEN
    IF NEW.product_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM product_branch_cost pbc
                 WHERE pbc.product_id = NEW.product_id AND pbc.branch_id = v_branch) THEN
        v_src := 'branch';
      ELSE
        v_src := 'product';
      END IF;
      v_cost := get_product_cost(NEW.product_id, v_branch);
    END IF;
  END IF;

  NEW.cost_price_snapshot := COALESCE(v_cost, 0);
  NEW.hpp_source := CASE WHEN COALESCE(v_cost, 0) <= 0 THEN 'estimate' ELSE COALESCE(v_src, 'estimate') END;
  IF NEW.recipe_id IS NULL AND v_recipe IS NOT NULL THEN
    NEW.recipe_id := v_recipe;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transaction_items_cost_snapshot ON public.transaction_items;
CREATE TRIGGER trg_transaction_items_cost_snapshot
  BEFORE INSERT ON public.transaction_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_fill_item_cost_snapshot();

-- Backfill data lama: sengaja DIBIARKAN NULL (laporan menandainya "estimasi"
-- dan jatuh ke fallback berjenjang). recipe_consumption_logs tidak punya
-- kolom penghubung ke transaction_items, jadi tidak ada backfill yang
-- aman per item. Tool re-kalkulasi manual: jalankan UPDATE di bawah ini
-- HANYA bila Anda sadar angkanya memakai HPP hari ini (bukan HPP historis):
--
--   UPDATE public.transaction_items ti
--   SET cost_price_snapshot = get_product_cost(ti.product_id, t.branch_id),
--       hpp_source = 'estimate'
--   FROM public.transactions t
--   WHERE t.id = ti.transaction_id AND ti.cost_price_snapshot IS NULL;
