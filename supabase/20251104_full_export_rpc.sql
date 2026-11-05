-- =====================================================================
-- Export PDF Lengkap — mode "Semua Data"
-- Jalankan MANUAL di Supabase SQL Editor, SETELAH 20251104_profit_report_rpc.sql
--
-- Dua RPC (SECURITY INVOKER, RLS tetap berlaku):
--   get_export_counts(branch, from, to, tz)               -> jumlah baris per tabel
--   get_export_table(table, branch, from, to, tz, offset, limit, unmask)
--                                                         -> satu halaman baris (JSON)
-- Pagination dilakukan klien (WP-09: tidak ada lagi .limit(10000) diam-diam).
--
-- TIDAK PERNAH diexport: profiles.pin_hash/pin_updated_at, branches.midtrans_*,
-- payments.raw_response (tabel payments tidak ada di daftar), auth.users,
-- tenants.wifi_password (tabel tenants tidak ada di daftar).
-- Dimask default: telepon, email, rekening bank (owner bisa p_unmask = true).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.export_mask_phone(p text, p_unmask boolean DEFAULT false)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL OR p_unmask THEN p
    WHEN length(p) <= 6 THEN repeat('*', length(p))
    ELSE left(p, 2) || repeat('*', length(p) - 6) || right(p, 4)
  END;
$$;

CREATE OR REPLACE FUNCTION public.export_mask_email(p text, p_unmask boolean DEFAULT false)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL OR p_unmask THEN p
    WHEN position('@' in p) < 2 THEN '***'
    ELSE left(p, 2) || '***' || substring(p from position('@' in p))
  END;
$$;

CREATE OR REPLACE FUNCTION public.export_mask_tail4(p text, p_unmask boolean DEFAULT false)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL OR p_unmask THEN p
    ELSE '****' || right(p, 4)
  END;
$$;

-- ---------------------------------------------------------------------
-- Pemetaan tabel -> filter. Satu tempat saja, dipakai counts & table.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_scope(
  p_table     text,
  p_branch_id uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_tz        text,
  p_unmask    boolean
) RETURNS TABLE (tbl text, where_sql text, select_sql text, order_sql text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_t    uuid := current_tenant_id();
  v_dt   text := format(' AND t.%%I >= %L AND t.%%I <= %L', p_from, p_to);   -- pola tanggal timestamptz
  v_d1   date := (p_from AT TIME ZONE p_tz)::date;
  v_d2   date := (p_to   AT TIME ZONE p_tz)::date;
  -- filter parent untuk tabel anak (alias x)
  f_tx   text;
  f_ord  text;
  f_po   text;
  f_grn  text;
  f_opn  text;
  w      text;
  excl   text := NULL;
  mask   text := NULL;
  ord    text := 't.id';
  unm    text := CASE WHEN p_unmask THEN 'true' ELSE 'false' END;

  strict_b  text := CASE WHEN p_branch_id IS NULL THEN '' ELSE format(' AND t.branch_id = %L', p_branch_id) END;
  lenient_b text := CASE WHEN p_branch_id IS NULL THEN '' ELSE format(' AND (t.branch_id = %L OR t.branch_id IS NULL)', p_branch_id) END;
  xb        text := CASE WHEN p_branch_id IS NULL THEN '' ELSE format(' AND x.branch_id = %L', p_branch_id) END;
BEGIN
  IF v_t IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: profil tidak aktif' USING ERRCODE = '42501';
  END IF;

  f_tx  := format('x.tenant_id = %L AND x.created_at >= %L AND x.created_at <= %L', v_t, p_from, p_to) || xb;
  f_ord := f_tx;
  f_po  := f_tx;
  f_grn := f_tx;
  f_opn := f_tx;

  CASE p_table
    -- ===== A. Penjualan =====
    WHEN 'transactions' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';
    WHEN 'transaction_items' THEN
      w := format('t.transaction_id IN (SELECT x.id FROM transactions x WHERE %s)', f_tx);
    WHEN 'transaction_payments' THEN
      w := format('t.transaction_id IN (SELECT x.id FROM transactions x WHERE %s)', f_tx);
    WHEN 'orders' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';
    WHEN 'order_items' THEN
      w := format('t.order_id IN (SELECT x.id FROM orders x WHERE %s)', f_ord);
    WHEN 'qr_orders' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';
      mask := format('jsonb_build_object(''customer_phone'', public.export_mask_phone(t.customer_phone, %s))', unm);
    WHEN 'refunds' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';

    -- ===== B. Produk, Resep & HPP =====
    WHEN 'products' THEN w := format('t.tenant_id = %L', v_t);
    WHEN 'product_branch_cost' THEN w := format('t.tenant_id = %L', v_t) || strict_b; ord := 't.branch_id, t.product_id';
    WHEN 'product_variants' THEN w := format('t.tenant_id = %L', v_t);
    WHEN 'modifier_groups' THEN w := format('t.tenant_id = %L', v_t);
    WHEN 'modifiers' THEN w := format('t.modifier_group_id IN (SELECT x.id FROM modifier_groups x WHERE x.tenant_id = %L)', v_t);
    WHEN 'recipes' THEN w := format('t.tenant_id = %L', v_t);
    WHEN 'recipe_items' THEN w := format('t.recipe_id IN (SELECT x.id FROM recipes x WHERE x.tenant_id = %L)', v_t);
    WHEN 'ingredients' THEN w := format('t.tenant_id = %L', v_t);
    WHEN 'unit_conversions' THEN w := format('t.tenant_id = %L', v_t);
    WHEN 'branch_ingredients_stock' THEN w := format('t.tenant_id = %L', v_t) || strict_b;
    WHEN 'channel_pricings' THEN w := format('t.tenant_id = %L', v_t);

    -- ===== C. Inventori =====
    WHEN 'branch_stock' THEN w := format('t.tenant_id = %L', v_t) || strict_b;
    WHEN 'stock_movements' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';
    WHEN 'stock_opnames' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';
    WHEN 'stock_opname_items' THEN
      w := format('t.opname_id IN (SELECT x.id FROM stock_opnames x WHERE %s)', f_opn);
    WHEN 'stock_opname_logs' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';
    WHEN 'ingredient_stock_movements' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';
    WHEN 'ingredient_stock_opname_logs' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';
    WHEN 'ingredient_waste_logs' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';
    WHEN 'waste_logs' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';
    WHEN 'recipe_consumption_logs' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';

    -- ===== D. Purchasing =====
    WHEN 'suppliers' THEN
      w := format('t.tenant_id = %L', v_t);
      mask := format('jsonb_build_object(''bank_account'', public.export_mask_tail4(t.bank_account, %s))', unm);
    WHEN 'purchase_orders' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';
    WHEN 'po_items' THEN
      w := format('t.po_id IN (SELECT x.id FROM purchase_orders x WHERE %s)', f_po);
    WHEN 'goods_receipts' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';
    WHEN 'grn_items' THEN
      w := format('t.grn_id IN (SELECT x.id FROM goods_receipts x WHERE %s)', f_grn);
    WHEN 'purchase_invoices' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at'); ord := 't.created_at, t.id';

    -- ===== E. Pelanggan & Loyalty (PII dimask) =====
    WHEN 'customers' THEN
      w := format('t.tenant_id = %L', v_t) || lenient_b;
      mask := format('jsonb_build_object(''phone_number'', public.export_mask_phone(t.phone_number, %1$s), ''whatsapp_number'', public.export_mask_phone(t.whatsapp_number, %1$s), ''email'', public.export_mask_email(t.email, %1$s))', unm);
    WHEN 'memberships' THEN
      w := format('t.tenant_id = %L', v_t);
      mask := format('jsonb_build_object(''customer_phone'', public.export_mask_phone(t.customer_phone, %s))', unm);
    WHEN 'customer_points' THEN w := format('t.tenant_id = %L', v_t);
    WHEN 'customer_tiers' THEN w := format('t.tenant_id = %L', v_t);
    WHEN 'loyalty_points_log' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at'); ord := 't.created_at, t.id';
    WHEN 'loyalty_config' THEN w := format('t.tenant_id = %L', v_t);
    WHEN 'vouchers' THEN w := format('t.tenant_id = %L', v_t) || lenient_b;
    WHEN 'voucher_redemptions' THEN
      w := format('t.voucher_id IN (SELECT x.id FROM vouchers x WHERE x.tenant_id = %L)', v_t) || format(v_dt, 'redeemed_at', 'redeemed_at');
      ord := 't.redeemed_at, t.id';
    WHEN 'promotions' THEN w := format('t.tenant_id = %L', v_t) || lenient_b;
    WHEN 'promotion_rules' THEN
      w := format('t.promotion_id IN (SELECT x.id FROM promotions x WHERE x.tenant_id = %L)', v_t);
    WHEN 'referrals' THEN w := format('t.tenant_id = %L', v_t); ord := 't.code';
    WHEN 'referral_redemptions' THEN
      w := format('t.referrer_tenant_id = %L', v_t); excl := '{referred_tenant_id}';

    -- ===== F. Operasional & Tim =====
    WHEN 'branches' THEN
      w := format('t.tenant_id = %L', v_t) || CASE WHEN p_branch_id IS NULL THEN '' ELSE format(' AND t.id = %L', p_branch_id) END;
    WHEN 'profiles' THEN
      w := format('t.tenant_id = %L', v_t) || lenient_b; excl := '{pin_hash,pin_updated_at}';
    WHEN 'shifts' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'opened_at', 'opened_at') || strict_b; ord := 't.opened_at, t.id';
    WHEN 'attendance' THEN
      w := format('t.tenant_id = %L AND t.date_start >= %L AND t.date_start <= %L', v_t, v_d1, v_d2); ord := 't.date_start, t.id';
    WHEN 'cash_movements' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || strict_b; ord := 't.created_at, t.id';
    WHEN 'reservations' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'reservation_at', 'reservation_at') || strict_b; ord := 't.reservation_at, t.id';
      mask := format('jsonb_build_object(''customer_phone'', public.export_mask_phone(t.customer_phone, %s))', unm);
    WHEN 'branch_tables' THEN w := format('t.tenant_id = %L', v_t) || strict_b;
    WHEN 'expenses' THEN
      w := format('t.tenant_id = %L AND t.expense_date >= %L AND t.expense_date <= %L', v_t, v_d1, v_d2) || lenient_b; ord := 't.expense_date, t.id';
    WHEN 'audit_log' THEN
      w := format('t.tenant_id = %L', v_t) || format(v_dt, 'created_at', 'created_at') || lenient_b; ord := 't.created_at, t.id';
    ELSE
      RAISE EXCEPTION 'EXPORT_TABLE_UNKNOWN: tabel % tidak ada di daftar export', p_table USING ERRCODE = '22023';
  END CASE;

  tbl := p_table;
  where_sql := w;
  select_sql := 'to_jsonb(t)'
    || CASE WHEN excl IS NOT NULL THEN format(' - %L::text[]', excl) ELSE '' END
    || CASE WHEN mask IS NOT NULL THEN ' || ' || mask ELSE '' END;
  order_sql := ord;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------
-- Daftar kunci tabel yang boleh diexport (urutan = urutan bagian laporan).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_table_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    'transactions','transaction_items','transaction_payments','orders','order_items','qr_orders','refunds',
    'products','product_branch_cost','product_variants','modifier_groups','modifiers','recipes','recipe_items',
    'ingredients','unit_conversions','branch_ingredients_stock','channel_pricings',
    'branch_stock','stock_movements','stock_opnames','stock_opname_items','stock_opname_logs',
    'ingredient_stock_movements','ingredient_stock_opname_logs','ingredient_waste_logs','waste_logs','recipe_consumption_logs',
    'suppliers','purchase_orders','po_items','goods_receipts','grn_items','purchase_invoices',
    'customers','memberships','customer_points','customer_tiers','loyalty_points_log','loyalty_config',
    'vouchers','voucher_redemptions','promotions','promotion_rules','referrals','referral_redemptions',
    'branches','profiles','shifts','attendance','cash_movements','reservations','branch_tables','expenses','audit_log'
  ];
$$;

CREATE OR REPLACE FUNCTION public.get_export_counts(
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
  v_key text;
  v_sc  record;
  v_n   bigint;
  v_out jsonb := '{}'::jsonb;
BEGIN
  PERFORM assert_export_allowed(p_from, p_to, true);
  FOREACH v_key IN ARRAY export_table_keys() LOOP
    SELECT * INTO v_sc FROM export_scope(v_key, p_branch_id, p_from, p_to, p_tz, false);
    EXECUTE format('SELECT COUNT(*) FROM public.%I t WHERE %s', v_sc.tbl, v_sc.where_sql) INTO v_n;
    v_out := v_out || jsonb_build_object(v_key, v_n);
  END LOOP;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_export_table(
  p_table     text,
  p_branch_id uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_tz        text    DEFAULT 'Asia/Jakarta',
  p_offset    integer DEFAULT 0,
  p_limit     integer DEFAULT 2000,
  p_unmask    boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tier  text;
  v_sc    record;
  v_total bigint;
  v_rows  jsonb;
  v_lim   integer := LEAST(GREATEST(COALESCE(p_limit, 2000), 1), 5000);
  v_off   integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  v_tier := assert_export_allowed(p_from, p_to, true);

  IF p_unmask AND NOT (is_owner() OR is_super_admin()) THEN
    RAISE EXCEPTION 'EXPORT_UNMASK_DENIED: hanya Owner yang boleh membuka data yang dimask' USING ERRCODE = '42501';
  END IF;

  -- Batas baris per tabel: Pro 50.000, Supreme tanpa batas (rencana 6.9)
  IF v_tier = 'pro' AND v_off >= 50000 THEN
    RETURN jsonb_build_object('table', p_table, 'total', NULL, 'offset', v_off, 'rows', '[]'::jsonb, 'capped', true);
  END IF;

  SELECT * INTO v_sc FROM export_scope(p_table, p_branch_id, p_from, p_to, p_tz, p_unmask);

  EXECUTE format('SELECT COUNT(*) FROM public.%I t WHERE %s', v_sc.tbl, v_sc.where_sql) INTO v_total;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(q.j), ''[]''::jsonb) FROM (SELECT %s AS j FROM public.%I t WHERE %s ORDER BY %s OFFSET %s LIMIT %s) q',
    v_sc.select_sql, v_sc.tbl, v_sc.where_sql, v_sc.order_sql, v_off, v_lim
  ) INTO v_rows;

  RETURN jsonb_build_object('table', p_table, 'total', v_total, 'offset', v_off, 'rows', v_rows,
                            'capped', (v_tier = 'pro' AND v_total > 50000));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_export_counts(uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_export_table(text, uuid, timestamptz, timestamptz, text, integer, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_scope(text, uuid, timestamptz, timestamptz, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_table_keys() TO authenticated;
