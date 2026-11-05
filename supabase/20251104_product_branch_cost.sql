-- ============================================================================
-- 20251104_product_branch_cost.sql
-- HPP menu per cabang (override dari HPP default tenant).
--
-- Jalankan file ini SEBELUM 20251104_hpp_snapshot.sql.
-- Idempoten — aman dijalankan ulang.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.product_branch_cost (
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  cost_price numeric(14,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_branch_cost_pkey PRIMARY KEY (branch_id, product_id),
  CONSTRAINT product_branch_cost_cost_check CHECK (cost_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_product_branch_cost_tenant
  ON public.product_branch_cost (tenant_id);

CREATE INDEX IF NOT EXISTS idx_product_branch_cost_product
  ON public.product_branch_cost (product_id);

ALTER TABLE public.product_branch_cost ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_branch_cost: read" ON public.product_branch_cost;
CREATE POLICY "product_branch_cost: read"
ON public.product_branch_cost
FOR SELECT
USING (
  public.is_super_admin()
  OR (
    tenant_id = public.current_tenant_id()
    AND (public.is_owner() OR branch_id = public.current_branch_id())
  )
);

DROP POLICY IF EXISTS "product_branch_cost: write" ON public.product_branch_cost;
CREATE POLICY "product_branch_cost: write"
ON public.product_branch_cost
FOR ALL
USING (
  tenant_id = public.current_tenant_id()
  AND public.is_manager_or_owner()
  AND (public.is_owner() OR branch_id = public.current_branch_id())
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.is_manager_or_owner()
  AND (public.is_owner() OR branch_id = public.current_branch_id())
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_branch_cost TO authenticated;

-- ---------------------------------------------------------------------------
-- Helper: tentukan resep aktif untuk 1 produk (varian cocok diprioritaskan).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pick_active_recipe(p_product_id uuid, p_variant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT r.id
  FROM public.recipes r
  WHERE r.product_id = p_product_id
    AND r.is_active = true
    AND (r.variant_id IS NULL OR r.variant_id = p_variant_id)
  ORDER BY (r.variant_id = p_variant_id) DESC NULLS LAST, r.version DESC
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Resolusi HPP berjenjang:
--   product_branch_cost → resep aktif cabang → products.cost_price → 0
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_product_cost(
  p_product_id uuid,
  p_branch_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_branch uuid := p_branch_id;
  v_cost numeric;
  v_recipe uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.products WHERE id = p_product_id;
  IF v_tenant IS NULL THEN
    RETURN 0;
  END IF;

  IF v_branch IS NULL THEN
    v_branch := public.main_branch_id(v_tenant);
  END IF;

  SELECT pbc.cost_price INTO v_cost
  FROM public.product_branch_cost pbc
  WHERE pbc.product_id = p_product_id AND pbc.branch_id = v_branch;

  IF v_cost IS NOT NULL AND v_cost > 0 THEN
    RETURN v_cost;
  END IF;

  v_recipe := public.pick_active_recipe(p_product_id, NULL);
  IF v_recipe IS NOT NULL THEN
    v_cost := public.calculate_recipe_cost(v_recipe, v_branch);
    IF v_cost IS NOT NULL AND v_cost > 0 THEN
      RETURN v_cost;
    END IF;
  END IF;

  SELECT COALESCE(cost_price, 0) INTO v_cost
  FROM public.products
  WHERE id = p_product_id;

  RETURN COALESCE(v_cost, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_cost(uuid, uuid) TO authenticated;

COMMENT ON TABLE public.product_branch_cost IS
  'HPP menu khusus per cabang. Bila tidak ada baris, sistem memakai HPP resep cabang atau products.cost_price (default tenant).';
