-- =====================================================================
-- WP-06 + WP-07 — Penjaga export server-side + RPC laporan laba
-- Jalankan MANUAL di Supabase SQL Editor, SETELAH:
--   20251104_product_branch_cost.sql, 20251104_hpp_snapshot.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- Penjaga: dipakai get_profit_report() dan get_full_export().
--  * Free Trial  -> DITOLAK (export PDF tidak tersedia dalam bentuk apa pun)
--  * Hanya owner / manager / super_admin
--  * Riwayat: Pro maks 30 hari, Supreme tanpa batas (WP-06, server-side)
-- Mengembalikan tier ('pro' | 'supreme').
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_export_allowed(
  p_from timestamptz,
  p_to   timestamptz,
  p_full boolean DEFAULT false
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid;
  v_tier   text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: silakan login ulang' USING ERRCODE = '42501';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'EXPORT_RANGE_INVALID: tanggal akhir harus sama/lebih besar dari tanggal awal' USING ERRCODE = '22023';
  END IF;

  IF is_super_admin() THEN
    RETURN 'supreme';
  END IF;

  v_tenant := current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: profil tidak aktif' USING ERRCODE = '42501';
  END IF;

  v_tier := COALESCE(tenant_tier(v_tenant), 'free');

  IF v_tier = 'free' THEN
    RAISE EXCEPTION 'EXPORT_PDF_TIER: Export laporan PDF tidak tersedia di paket Free Trial. Upgrade ke Pro atau Supreme.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT is_manager_or_owner() THEN
    RAISE EXCEPTION 'EXPORT_ROLE: hanya Owner/Manager yang boleh mengunduh laporan' USING ERRCODE = '42501';
  END IF;

  IF v_tier = 'pro' AND p_from < (date_trunc('day', now()) - interval '31 days') THEN
    RAISE EXCEPTION 'EXPORT_RANGE_LIMIT: paket Pro hanya bisa mengekspor 30 hari terakhir' USING ERRCODE = '42501';
  END IF;

  RETURN v_tier;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assert_export_allowed(timestamptz, timestamptz, boolean) TO authenticated;

-- ---------------------------------------------------------------------
-- get_profit_report — SATU definisi metrik (lib/metrics.ts mencerminkan
-- rumus yang sama). SECURITY INVOKER: RLS tetap berlaku.
--   Omzet        = SUM(transactions.total_amount)
--   Refund       = SUM(refunds.amount) status COMPLETED
--   HPP          = SUM(qty * COALESCE(cost_price_snapshot, HPP hari ini))
--   Laba Kotor   = Omzet - Refund - HPP
--   Susut        = stock_opname_logs.loss_value + waste_logs.total_loss_amount
--   Komisi       = orders.channel_commission_amount (via transactions.order_id)
--   OPEX         = expenses.amount status APPROVED (tidak void)
--   Laba Bersih  = Laba Kotor - Susut - Komisi - OPEX
-- p_branch_id NULL = semua cabang.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_profit_report(
  p_branch_id uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_tz        text DEFAULT 'Asia/Jakarta'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_tier   text;
  v_out    jsonb;
BEGIN
  v_tier := assert_export_allowed(p_from, p_to, false);

  WITH tx AS (
    SELECT t.id, t.branch_id, t.total_amount, t.subtotal_amount, t.discount_amount,
           t.payment_method, t.order_id, t.created_at,
           (t.created_at AT TIME ZONE p_tz)::date AS d
    FROM transactions t
    WHERE t.tenant_id = v_tenant
      AND t.created_at >= p_from AND t.created_at <= p_to
      AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
  ),
  items AS (
    SELECT ti.transaction_id, ti.product_id, ti.qty, ti.subtotal,
           tx.branch_id, tx.d,
           COALESCE(ti.cost_price_snapshot, get_product_cost(ti.product_id, tx.branch_id), 0) AS unit_cost,
           (ti.cost_price_snapshot IS NOT NULL) AS is_actual
    FROM transaction_items ti
    JOIN tx ON tx.id = ti.transaction_id
  ),
  item_calc AS (
    SELECT i.*, (i.qty * i.unit_cost) AS hpp_line, p.name AS product_name,
           COALESCE(NULLIF(p.category, ''), 'Tanpa Kategori') AS category
    FROM items i LEFT JOIN products p ON p.id = i.product_id
  ),
  refund_sum AS (
    SELECT r.branch_id, COALESCE(SUM(r.amount), 0) AS amt
    FROM refunds r
    WHERE r.tenant_id = v_tenant AND r.status = 'COMPLETED'
      AND r.created_at >= p_from AND r.created_at <= p_to
      AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
    GROUP BY r.branch_id
  ),
  loss_sum AS (
    SELECT b, SUM(v) AS amt FROM (
      SELECT l.branch_id AS b, l.loss_value AS v FROM stock_opname_logs l
       WHERE l.tenant_id = v_tenant AND l.created_at >= p_from AND l.created_at <= p_to
         AND (p_branch_id IS NULL OR l.branch_id = p_branch_id)
      UNION ALL
      SELECT w.branch_id, w.total_loss_amount FROM waste_logs w
       WHERE w.tenant_id = v_tenant AND w.created_at >= p_from AND w.created_at <= p_to
         AND (p_branch_id IS NULL OR w.branch_id = p_branch_id)
    ) u GROUP BY b
  ),
  comm_sum AS (
    SELECT o.branch_id, COALESCE(SUM(o.channel_commission_amount), 0) AS amt
    FROM orders o
    WHERE o.tenant_id = v_tenant
      AND o.id IN (SELECT order_id FROM tx WHERE order_id IS NOT NULL)
    GROUP BY o.branch_id
  ),
  opex_sum AS (
    SELECT e.branch_id, COALESCE(SUM(e.amount), 0) AS amt
    FROM expenses e
    WHERE e.tenant_id = v_tenant AND e.status = 'APPROVED' AND e.voided_at IS NULL
      AND e.expense_date >= (p_from AT TIME ZONE p_tz)::date
      AND e.expense_date <= (p_to AT TIME ZONE p_tz)::date
      AND (p_branch_id IS NULL OR e.branch_id = p_branch_id)
    GROUP BY e.branch_id
  ),
  branch_list AS (
    SELECT b.id, b.name FROM branches b
    WHERE b.tenant_id = v_tenant AND (p_branch_id IS NULL OR b.id = p_branch_id)
  ),
  by_branch AS (
    SELECT bl.id AS branch_id, bl.name AS branch_name,
      COALESCE((SELECT SUM(total_amount) FROM tx WHERE tx.branch_id = bl.id), 0) AS omzet,
      COALESCE((SELECT COUNT(*) FROM tx WHERE tx.branch_id = bl.id), 0) AS transaksi,
      COALESCE((SELECT SUM(hpp_line) FROM item_calc ic WHERE ic.branch_id = bl.id), 0) AS hpp,
      COALESCE((SELECT amt FROM refund_sum rs WHERE rs.branch_id = bl.id), 0) AS refund,
      COALESCE((SELECT amt FROM loss_sum ls WHERE ls.b = bl.id), 0) AS susut,
      COALESCE((SELECT amt FROM comm_sum cs WHERE cs.branch_id = bl.id), 0) AS komisi,
      COALESCE((SELECT amt FROM opex_sum os WHERE os.branch_id = bl.id), 0) AS opex
    FROM branch_list bl
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'tier', v_tier,
    'branch_id', p_branch_id,
    'from', p_from, 'to', p_to, 'tz', p_tz,
    'summary', jsonb_build_object(
      'omzet',     COALESCE((SELECT SUM(total_amount) FROM tx), 0),
      'subtotal',  COALESCE((SELECT SUM(COALESCE(subtotal_amount, total_amount)) FROM tx), 0),
      'diskon',    COALESCE((SELECT SUM(COALESCE(discount_amount, 0)) FROM tx), 0),
      'transaksi', (SELECT COUNT(*) FROM tx),
      'item_terjual', COALESCE((SELECT SUM(qty) FROM items), 0),
      'hpp',       COALESCE((SELECT SUM(hpp_line) FROM item_calc), 0),
      'refund',    COALESCE((SELECT SUM(amt) FROM refund_sum), 0),
      'susut',     COALESCE((SELECT SUM(amt) FROM loss_sum), 0),
      'komisi',    COALESCE((SELECT SUM(amt) FROM comm_sum), 0),
      'opex',      COALESCE((SELECT SUM(amt) FROM opex_sum), 0),
      'opex_tersedia', EXISTS (SELECT 1 FROM expenses e WHERE e.tenant_id = v_tenant AND e.status = 'APPROVED'),
      'hpp_lines_actual',   (SELECT COUNT(*) FROM items WHERE is_actual),
      'hpp_lines_estimate', (SELECT COUNT(*) FROM items WHERE NOT is_actual)
    ),
    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tanggal', d, 'transaksi', n, 'omzet', o, 'hpp', COALESCE(h, 0)) ORDER BY d)
      FROM (
        SELECT tx.d, COUNT(*) AS n, SUM(tx.total_amount) AS o,
               (SELECT SUM(ic.hpp_line) FROM item_calc ic WHERE ic.d = tx.d) AS h
        FROM tx GROUP BY tx.d
      ) x
    ), '[]'::jsonb),
    'daily_by_branch', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tanggal', d, 'branch_id', bid, 'cabang', bname, 'transaksi', n, 'omzet', o) ORDER BY d, bname)
      FROM (
        SELECT tx.d, tx.branch_id AS bid, COALESCE(b.name, 'Tanpa Cabang') AS bname, COUNT(*) AS n, SUM(tx.total_amount) AS o
        FROM tx LEFT JOIN branches b ON b.id = tx.branch_id
        GROUP BY tx.d, tx.branch_id, b.name
      ) x
    ), '[]'::jsonb),
    'by_payment', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('metode', m, 'transaksi', n, 'omzet', o) ORDER BY o DESC)
      FROM (SELECT UPPER(COALESCE(payment_method, 'cash')) AS m, COUNT(*) AS n, SUM(total_amount) AS o FROM tx GROUP BY 1) x
    ), '[]'::jsonb),
    'by_category', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('kategori', c, 'qty', q, 'omzet', o, 'hpp', h) ORDER BY (o - h) DESC)
      FROM (SELECT category AS c, SUM(qty) AS q, SUM(subtotal) AS o, SUM(hpp_line) AS h FROM item_calc GROUP BY category) x
    ), '[]'::jsonb),
    'top_menu', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('menu', n, 'qty', q, 'omzet', o, 'hpp', h) ORDER BY q DESC)
      FROM (SELECT COALESCE(product_name, 'Produk') AS n, SUM(qty) AS q, SUM(subtotal) AS o, SUM(hpp_line) AS h
            FROM item_calc GROUP BY 1 ORDER BY SUM(qty) DESC LIMIT 10) x
    ), '[]'::jsonb),
    'top_profit_menu', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('menu', n, 'qty', q, 'omzet', o, 'hpp', h, 'laba', o - h) ORDER BY (o - h) DESC)
      FROM (SELECT COALESCE(product_name, 'Produk') AS n, SUM(qty) AS q, SUM(subtotal) AS o, SUM(hpp_line) AS h
            FROM item_calc GROUP BY 1 ORDER BY SUM(subtotal) - SUM(hpp_line) DESC LIMIT 10) x
    ), '[]'::jsonb),
    'by_branch', COALESCE((SELECT jsonb_agg(to_jsonb(by_branch) ORDER BY omzet DESC) FROM by_branch), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_profit_report(uuid, timestamptz, timestamptz, text) TO authenticated;
