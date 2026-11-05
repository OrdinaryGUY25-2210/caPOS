-- =====================================================================
-- WP-02 — HPP menu per cabang
-- Jalankan MANUAL di Supabase SQL Editor.
-- products.cost_price TETAP ada sebagai default tenant (backward compatible).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.product_branch_cost (
  tenant_id  uuid NOT NULL,
  branch_id  uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  cost_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_branch_cost_tenant ON public.product_branch_cost (tenant_id);

ALTER TABLE public.product_branch_cost ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pbc_select ON public.product_branch_cost;
CREATE POLICY pbc_select ON public.product_branch_cost
  FOR SELECT USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS pbc_write ON public.product_branch_cost;
CREATE POLICY pbc_write ON public.product_branch_cost
  FOR ALL
  USING (tenant_id = public.current_tenant_id() AND public.is_manager_or_owner())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_manager_or_owner());

-- Helper fallback: override cabang -> default tenant -> 0.
-- (Biaya resep dihitung terpisah lewat calculate_recipe_cost(recipe, branch);
-- trigger snapshot di 20251104_hpp_snapshot.sql memakainya lebih dulu.)
CREATE OR REPLACE FUNCTION public.get_product_cost(p_product_id uuid, p_branch_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER  -- RLS tetap berlaku untuk pemanggil biasa; di dalam trigger
                  -- checkout (SECURITY DEFINER) fungsi ini jalan sebagai owner.
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT pbc.cost_price FROM product_branch_cost pbc
      WHERE pbc.product_id = p_product_id AND pbc.branch_id = p_branch_id),
    (SELECT p.cost_price FROM products p WHERE p.id = p_product_id),
    0
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_product_cost(uuid, uuid) TO authenticated;
