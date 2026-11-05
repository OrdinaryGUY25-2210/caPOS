-- ============================================================================
-- 20251104_full_export_rpc.sql
-- Manifest export lengkap: daftar tabel + jumlah baris pada periode/cabang.
--
-- Dipakai untuk verifikasi sebelum/sesudah export "Semua Data" dan untuk
-- memastikan tidak ada domain yang terlewat. Tidak mengembalikan isi data.
-- Idempoten.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_export_manifest(
  p_tenant_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'tenant_id', p_tenant_id,
    'branch_id', p_branch_id,
    'period_from', p_from,
    'period_to', p_to,
    'tables', jsonb_build_array(
      jsonb_build_object('table', 'transactions', 'rows', (
        SELECT count(*) FROM public.transactions t
        WHERE t.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
          AND (p_from IS NULL OR t.created_at >= p_from)
          AND (p_to IS NULL OR t.created_at <= p_to)
      )),
      jsonb_build_object('table', 'transaction_items', 'rows', (
        SELECT count(*) FROM public.transaction_items ti
        JOIN public.transactions t ON t.id = ti.transaction_id
        WHERE t.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
          AND (p_from IS NULL OR t.created_at >= p_from)
          AND (p_to IS NULL OR t.created_at <= p_to)
      )),
      jsonb_build_object('table', 'transaction_payments', 'rows', (
        SELECT count(*) FROM public.transaction_payments tp
        JOIN public.transactions t ON t.id = tp.transaction_id
        WHERE t.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
          AND (p_from IS NULL OR t.created_at >= p_from)
          AND (p_to IS NULL OR t.created_at <= p_to)
      )),
      jsonb_build_object('table', 'orders', 'rows', (
        SELECT count(*) FROM public.orders o
        WHERE o.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
          AND (p_from IS NULL OR o.created_at >= p_from)
          AND (p_to IS NULL OR o.created_at <= p_to)
      )),
      jsonb_build_object('table', 'refunds', 'rows', (
        SELECT count(*) FROM public.refunds r
        WHERE r.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
          AND (p_from IS NULL OR r.created_at >= p_from)
          AND (p_to IS NULL OR r.created_at <= p_to)
      )),
      jsonb_build_object('table', 'products', 'rows', (
        SELECT count(*) FROM public.products p WHERE p.tenant_id = p_tenant_id
      )),
      jsonb_build_object('table', 'product_branch_cost', 'rows', (
        SELECT count(*) FROM public.product_branch_cost pbc
        WHERE pbc.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR pbc.branch_id = p_branch_id)
      )),
      jsonb_build_object('table', 'branch_ingredients_stock', 'rows', (
        SELECT count(*) FROM public.branch_ingredients_stock bis
        WHERE bis.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR bis.branch_id = p_branch_id)
      )),
      jsonb_build_object('table', 'stock_opnames', 'rows', (
        SELECT count(*) FROM public.stock_opnames o
        WHERE o.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
          AND (p_from IS NULL OR o.created_at >= p_from)
          AND (p_to IS NULL OR o.created_at <= p_to)
      )),
      jsonb_build_object('table', 'stock_opname_logs', 'rows', (
        SELECT count(*) FROM public.stock_opname_logs l
        WHERE l.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR l.branch_id = p_branch_id)
          AND (p_from IS NULL OR l.created_at >= p_from)
          AND (p_to IS NULL OR l.created_at <= p_to)
      )),
      jsonb_build_object('table', 'waste_logs', 'rows', (
        SELECT count(*) FROM public.waste_logs w
        WHERE w.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR w.branch_id = p_branch_id)
          AND (p_from IS NULL OR w.created_at >= p_from)
          AND (p_to IS NULL OR w.created_at <= p_to)
      )),
      jsonb_build_object('table', 'ingredient_waste_logs', 'rows', (
        SELECT count(*) FROM public.ingredient_waste_logs iw
        WHERE iw.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR iw.branch_id = p_branch_id)
          AND (p_from IS NULL OR iw.created_at >= p_from)
          AND (p_to IS NULL OR iw.created_at <= p_to)
      )),
      jsonb_build_object('table', 'recipe_consumption_logs', 'rows', (
        SELECT count(*) FROM public.recipe_consumption_logs c
        WHERE c.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
          AND (p_from IS NULL OR c.created_at >= p_from)
          AND (p_to IS NULL OR c.created_at <= p_to)
      )),
      jsonb_build_object('table', 'purchase_orders', 'rows', (
        SELECT count(*) FROM public.purchase_orders po
        WHERE po.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR po.branch_id = p_branch_id)
          AND (p_from IS NULL OR po.created_at >= p_from)
          AND (p_to IS NULL OR po.created_at <= p_to)
      )),
      jsonb_build_object('table', 'customers', 'rows', (
        SELECT count(*) FROM public.customers c
        WHERE c.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
      )),
      jsonb_build_object('table', 'vouchers', 'rows', (
        SELECT count(*) FROM public.vouchers v
        WHERE v.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR v.branch_id = p_branch_id)
      )),
      jsonb_build_object('table', 'voucher_branches', 'rows', (
        SELECT count(*) FROM public.voucher_branches vb
        JOIN public.vouchers v ON v.id = vb.voucher_id
        WHERE v.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR vb.branch_id = p_branch_id)
      )),
      jsonb_build_object('table', 'shifts', 'rows', (
        SELECT count(*) FROM public.shifts s
        WHERE s.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
          AND (p_from IS NULL OR s.opened_at >= p_from)
          AND (p_to IS NULL OR s.opened_at <= p_to)
      )),
      jsonb_build_object('table', 'reservations', 'rows', (
        SELECT count(*) FROM public.reservations r
        WHERE r.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
          AND (p_from IS NULL OR r.reservation_at >= p_from)
          AND (p_to IS NULL OR r.reservation_at <= p_to)
      ))
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_export_manifest(uuid, uuid, timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.get_export_manifest(uuid, uuid, timestamptz, timestamptz) IS
  'Manifest jumlah baris per domain untuk export "Semua Data" caPOS.';
