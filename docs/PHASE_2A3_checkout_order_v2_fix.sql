-- =========================================================
-- Phase 2A.3 — corrective fix for checkout_order_v2()
-- =========================================================
-- NOT a new migration. This does not touch the schema (no new columns,
-- no new tables) — it only re-issues an already-deployed function body
-- via CREATE OR REPLACE FUNCTION, which Postgres/Supabase allows without
-- a migration number. The original function lives in
-- supabase/migration_013_capos_phase2_pos_operations.sql and that file
-- is intentionally left untouched, per the Phase 2A.3 DB change gate
-- (migration 012-015 must not be rewritten).
--
-- BUG: checkout_order_v2() copies each order_items row into
-- transaction_items when a KDS order is paid, but its INSERT only
-- listed (transaction_id, product_id, qty, subtotal). The
-- variant_id / variant_name / modifier_selections / recipe_id /
-- recipe_version / unit_price columns already exist on
-- transaction_items (added by the same migration_013, specifically so
-- this function would carry them through) but were never populated —
-- so a configured item's variant/modifier snapshot was silently
-- dropped the moment the order was paid, even though it survived
-- correctly up to that point on order_items.
--
-- FIX: the transaction_items INSERT now copies those six columns from
-- the source order_items row, same snapshot pattern already used
-- everywhere else in this function. No other behavior changes.
--
-- HOW TO APPLY: run this file once against your Supabase project
-- (SQL Editor, or `supabase db execute` / psql), after reviewing it.
-- Safe to re-run (CREATE OR REPLACE is idempotent).
-- =========================================================

CREATE OR REPLACE FUNCTION checkout_order_v2(
  p_order_id UUID,
  p_invoice_number TEXT,
  p_member_code TEXT,
  p_payments JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_item RECORD;
  v_pay JSONB;
  v_subtotal NUMERIC := 0;
  v_discount_pct NUMERIC := 0;
  v_member_id UUID := NULL;
  v_total NUMERIC;
  v_tx_id UUID;
  v_payments_sum NUMERIC := 0;
  v_branch_id UUID;
  v_stock RECORD;
  v_effective_qty INT;
  v_effective_subtotal NUMERIC;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pesanan tidak ditemukan';
  END IF;

  IF NOT is_super_admin() AND v_order.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan pesanan tenant Anda';
  END IF;

  IF v_order.status NOT IN ('READY', 'SERVED') THEN
    RAISE EXCEPTION 'Pesanan belum siap dibayar (status saat ini: %)', v_order.status;
  END IF;

  IF v_order.transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Pesanan ini sudah dibayar sebelumnya';
  END IF;

  IF jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'Rincian pembayaran kosong';
  END IF;

  v_branch_id := COALESCE(v_order.branch_id, main_branch_id(v_order.tenant_id));

  IF p_member_code IS NOT NULL AND p_member_code <> '' THEN
    SELECT id, discount_percentage INTO v_member_id, v_discount_pct
    FROM memberships
    WHERE tenant_id = v_order.tenant_id
      AND member_code = p_member_code
      AND is_active = true
      AND valid_until > now();
    IF v_member_id IS NULL THEN
      RAISE EXCEPTION 'Kode member tidak valid atau kedaluwarsa';
    END IF;
  END IF;

  SELECT COALESCE(SUM(subtotal), 0) INTO v_subtotal FROM order_items WHERE order_id = p_order_id;
  IF v_subtotal <= 0 THEN
    RAISE EXCEPTION 'Pesanan tidak memiliki item';
  END IF;

  -- Migrasi 019: diskon manual (Rupiah, wajib PIN supervisor lewat
  -- apply_manual_discount()) diterapkan SETELAH diskon persen member,
  -- lalu dibulatkan sekali di akhir supaya tidak ada selisih pembulatan.
  v_total := GREATEST(0, round(v_subtotal * (1 - v_discount_pct / 100)) - COALESCE(v_order.manual_discount_amount, 0));

  FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    IF (v_pay->>'method') NOT IN ('cash', 'qris', 'debit', 'credit', 'ewallet', 'bank_transfer') THEN
      RAISE EXCEPTION 'Metode pembayaran tidak valid: %', (v_pay->>'method');
    END IF;
    IF (v_pay->>'amount')::NUMERIC IS NULL OR (v_pay->>'amount')::NUMERIC <= 0 THEN
      RAISE EXCEPTION 'Nominal pembayaran tidak valid';
    END IF;
    v_payments_sum := v_payments_sum + (v_pay->>'amount')::NUMERIC;
  END LOOP;

  IF v_payments_sum <> v_total THEN
    RAISE EXCEPTION 'PAYMENT_MISMATCH: Total pembayaran (%) tidak sama dengan total tagihan (%)', v_payments_sum, v_total;
  END IF;

  v_tx_id := gen_random_uuid();

  INSERT INTO transactions (
    id, tenant_id, cashier_id, shift_id, invoice_number, total_amount,
    payment_method, member_id, is_offline_sync, branch_id, order_id
  ) VALUES (
    v_tx_id, v_order.tenant_id, v_order.cashier_id, v_order.shift_id, p_invoice_number, v_total,
    CASE WHEN jsonb_array_length(p_payments) > 1 THEN 'mixed' ELSE (p_payments->0->>'method') END,
    v_member_id, false, v_branch_id, p_order_id
  );

  FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    -- split_group_label (opsional, mis. "Orang 1/3") murni label kosmetik
    -- struk untuk mode Split Bill "Split by Amount" — tidak memengaruhi
    -- validasi nominal di atas.
    INSERT INTO transaction_payments (transaction_id, method, amount, reference_number, split_group_label)
      VALUES (v_tx_id, v_pay->>'method', (v_pay->>'amount')::NUMERIC, NULLIF(v_pay->>'reference_number', ''), NULLIF(v_pay->>'split_group_label', ''));
  END LOOP;

  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    v_effective_qty := v_item.qty - v_item.voided_qty;
    IF v_effective_qty <= 0 THEN
      CONTINUE;
    END IF;
    v_effective_subtotal := v_item.unit_price * v_effective_qty;

    INSERT INTO transaction_items (
      transaction_id, product_id, qty, subtotal,
      variant_id, variant_name, modifier_selections, recipe_id, recipe_version, unit_price
    ) VALUES (
      v_tx_id, v_item.product_id, v_effective_qty, v_effective_subtotal,
      v_item.variant_id, v_item.variant_name, v_item.modifier_selections, v_item.recipe_id, v_item.recipe_version, v_item.unit_price
    );

    SELECT track_stock INTO v_stock FROM products WHERE id = v_item.product_id;
    IF v_stock.track_stock THEN
      DECLARE
        v_stock_qty INT;
      BEGIN
        SELECT stock_qty INTO v_stock_qty FROM branch_stock
          WHERE branch_id = v_branch_id AND product_id = v_item.product_id
          FOR UPDATE;

        IF v_stock_qty IS NULL THEN
          v_stock_qty := 0;
          INSERT INTO branch_stock (tenant_id, branch_id, product_id, stock_qty)
            VALUES (v_order.tenant_id, v_branch_id, v_item.product_id, 0)
            ON CONFLICT (branch_id, product_id) DO NOTHING;
        END IF;

        IF v_stock_qty < v_effective_qty THEN
          RAISE EXCEPTION 'STOCK_INSUFFICIENT: Stok "%" tidak cukup di cabang ini (tersisa %, diminta %).',
            v_item.product_name, v_stock_qty, v_effective_qty;
        END IF;

        UPDATE branch_stock SET stock_qty = stock_qty - v_effective_qty, updated_at = now()
          WHERE branch_id = v_branch_id AND product_id = v_item.product_id;

        INSERT INTO stock_movements (tenant_id, branch_id, product_id, type, qty_change, note, created_by)
          VALUES (v_order.tenant_id, v_branch_id, v_item.product_id, 'sale', -v_effective_qty,
                  'Otomatis dari pesanan ' || v_order.order_number, v_order.cashier_id);
      END;
    END IF;
  END LOOP;

  UPDATE orders SET
    status = 'COMPLETED',
    completed_at = now(),
    transaction_id = v_tx_id
  WHERE id = p_order_id;

  IF v_order.order_type = 'dine_in' AND v_order.table_id IS NOT NULL THEN
    UPDATE branch_tables SET needs_cleaning = true, cleaning_started_at = now(), bill_printed_at = NULL WHERE id = v_order.table_id;
  END IF;


  -- Migrasi 019 (F&B Core wiring dipertahankan dari migration_014): potong
  -- branch_ingredients_stock berdasar recipe+modifier tiap order_item, kalau
  -- produknya sudah punya resep terdaftar. Kalau consume_recipe() RAISE
  -- EXCEPTION (stok bahan baku tidak cukup & tenant tidak mengizinkan stok
  -- negatif), SELURUH transaksi ini ikut rollback bersamaan — checkout tetap
  -- all-or-nothing.
  PERFORM deduct_recipe_stock(p_order_id);

  RETURN v_tx_id;
END;
$$;
