-- ============================================================================
-- 20251104_profit_report_rpc.sql
-- RPC agregasi laba/rugi resmi (satu sumber angka untuk server & klien).
--
-- Jalankan setelah:
--   1) 20251104_product_branch_cost.sql
--   2) 20251104_hpp_snapshot.sql
-- Idempoten — aman dijalankan ulang.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_profit_report(
  p_tenant_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  omzet numeric,
  subtotal numeric,
  diskon numeric,
  hpp numeric,
  laba_kotor numeric,
  susut_stok numeric,
  komisi_channel numeric,
  biaya_operasional numeric,
  laba_bersih numeric,
  margin_kotor_pct numeric,
  total_transaksi bigint,
  item_terjual numeric,
  hpp_estimasi_item bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH tx AS (
    SELECT *
    FROM public.transactions t
    WHERE t.tenant_id = p_tenant_id
      AND (p_from IS NULL OR t.created_at >= p_from)
      AND (p_to IS NULL OR t.created_at <= p_to)
      AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
  ),
  item AS (
    SELECT
      ti.qty,
      ti.cost_price_snapshot,
      ti.hpp_source,
      ti.product_id,
      t.branch_id
    FROM public.transaction_items ti
    JOIN tx t ON t.id = ti.transaction_id
  ),
  -- Semantik HARUS sama dengan lib/hpp.ts:
  --   snapshot > 0                                  -> final (aktual)
  --   snapshot = 0 dengan sumber != 'estimate'       -> final (memang Rp0)
  --   selain itu (NULL / snapshot 0 estimasi)        -> fallback HPP cabang -> produk
  item_cost AS (
    SELECT
      i.qty,
      CASE
        WHEN COALESCE(i.cost_price_snapshot, 0) > 0 THEN i.cost_price_snapshot
        WHEN i.cost_price_snapshot IS NOT NULL
          AND COALESCE(i.hpp_source, '') NOT IN ('', 'estimate') THEN 0
        ELSE COALESCE(pbc.cost_price, p.cost_price, 0)
      END AS unit_cost,
      CASE
        WHEN COALESCE(i.cost_price_snapshot, 0) > 0 THEN false
        WHEN i.cost_price_snapshot IS NOT NULL
          AND COALESCE(i.hpp_source, '') NOT IN ('', 'estimate') THEN false
        WHEN COALESCE(pbc.cost_price, p.cost_price, 0) > 0 THEN false
        ELSE true
      END AS is_estimate
    FROM item i
    LEFT JOIN public.products p ON p.id = i.product_id
    LEFT JOIN public.product_branch_cost pbc
      ON pbc.product_id = i.product_id AND pbc.branch_id = i.branch_id
  ),
  agg AS (
    SELECT
      COALESCE(SUM(unit_cost * qty), 0) AS hpp_total,
      COALESCE(SUM(qty), 0) AS qty_total,
      COUNT(*) FILTER (WHERE is_estimate) AS estimate_count
    FROM item_cost
  ),
  susut AS (
    SELECT
      -- Opname bahan baku (fitur aktif sejak migration_16).
      COALESCE((
        SELECT SUM(o.total_loss_value) FROM public.stock_opnames o
        WHERE o.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
          AND (p_from IS NULL OR o.created_at >= p_from)
          AND (p_to IS NULL OR o.created_at <= p_to)
      ), 0)
      -- Opname produk lama (dibekukan, tetap dihitung untuk histori).
      + COALESCE((
        SELECT SUM(l.loss_value) FROM public.stock_opname_logs l
        WHERE l.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR l.branch_id = p_branch_id)
          AND (p_from IS NULL OR l.created_at >= p_from)
          AND (p_to IS NULL OR l.created_at <= p_to)
      ), 0)
      -- Waste produk jadi.
      + COALESCE((
        SELECT SUM(w.total_loss_amount) FROM public.waste_logs w
        WHERE w.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR w.branch_id = p_branch_id)
          AND (p_from IS NULL OR w.created_at >= p_from)
          AND (p_to IS NULL OR w.created_at <= p_to)
      ), 0)
      -- Waste bahan baku.
      + COALESCE((
        SELECT SUM(iw.total_loss_amount) FROM public.ingredient_waste_logs iw
        WHERE iw.tenant_id = p_tenant_id
          AND (p_branch_id IS NULL OR iw.branch_id = p_branch_id)
          AND (p_from IS NULL OR iw.created_at >= p_from)
          AND (p_to IS NULL OR iw.created_at <= p_to)
      ), 0) AS total
  ),
  komisi AS (
    SELECT COALESCE(SUM(channel_commission_amount), 0) AS total
    FROM public.orders o
    WHERE o.tenant_id = p_tenant_id
      AND (p_branch_id IS NULL OR o.branch_id = p_branch_id)
      AND (p_from IS NULL OR o.created_at >= p_from)
      AND (p_to IS NULL OR o.created_at <= p_to)
  ),
  opex AS (
    SELECT COALESCE(SUM(e.amount), 0) AS total
    FROM public.expenses e
    WHERE e.tenant_id = p_tenant_id
      AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
      AND (p_from IS NULL OR e.expense_date >= p_from::date)
      AND (p_to IS NULL OR e.expense_date <= p_to::date)
      AND upper(COALESCE(e.status, 'APPROVED')) IN ('APPROVED', 'PAID')
      AND e.voided_at IS NULL
  ),
  totals AS (
    SELECT
      COALESCE(SUM(total_amount), 0) AS omzet,
      COALESCE(SUM(COALESCE(subtotal_amount, total_amount)), 0) AS subtotal,
      COALESCE(SUM(discount_amount), 0) AS diskon,
      COUNT(*) AS tx_count
    FROM tx
  )
  SELECT
    totals.omzet,
    totals.subtotal,
    totals.diskon,
    agg.hpp_total AS hpp,
    totals.omzet - agg.hpp_total AS laba_kotor,
    susut.total AS susut_stok,
    komisi.total AS komisi_channel,
    opex.total AS biaya_operasional,
    totals.omzet - agg.hpp_total - susut.total - komisi.total - opex.total AS laba_bersih,
    CASE
      WHEN totals.omzet > 0
      THEN ROUND(((totals.omzet - agg.hpp_total) / totals.omzet) * 100, 2)
      ELSE 0
    END AS margin_kotor_pct,
    totals.tx_count AS total_transaksi,
    agg.qty_total AS item_terjual,
    agg.estimate_count AS hpp_estimasi_item
  FROM totals, agg, susut, komisi, opex;
$$;

GRANT EXECUTE ON FUNCTION public.get_profit_report(uuid, uuid, timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.get_profit_report(uuid, uuid, timestamptz, timestamptz) IS
  'Agregasi resmi omzet, HPP, laba kotor/bersih per periode & cabang. HPP memakai snapshot transaksi lalu fallback HPP cabang/produk. Kerugian mencakup opname bahan, opname produk lama, waste produk, dan waste bahan.';
