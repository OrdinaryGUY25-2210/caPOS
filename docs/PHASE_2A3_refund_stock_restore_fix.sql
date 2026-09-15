-- =========================================================
-- Phase 2A.3 — fix: recipe stock restoration on refund never
-- fires for orders paid through "Kirim ke Dapur" (KDS flow)
-- =========================================================
-- NOT a new migration number. Same discipline as
-- docs/PHASE_2A3_checkout_order_v2_fix.sql: one additive nullable
-- column + two CREATE OR REPLACE FUNCTION re-issues. No table is
-- dropped, no existing column changes meaning. Safe to run even if
-- you already applied the earlier checkout_order_v2 fix file — this
-- one supersedes it (it contains that same fix plus the addition
-- below), CREATE OR REPLACE is idempotent either way.
--
-- BUG: RefundModal.tsx already calls revert_recipe_stock() to restore
-- ingredient stock after a refund, and that function already exists
-- and is idempotent (transaction_items.restored_qty) — this part was
-- built correctly. But it looks up the original consumption record in
-- recipe_consumption_logs using ONLY source_type = 'transaction_item'.
--
-- That matches deduct_recipe_stock_for_transaction() (the "Bayar
-- Langsung" quick-pay path), which does log with source_type =
-- 'transaction_item'. It does NOT match deduct_recipe_stock() (called
-- from checkout_order_v2 — the "Kirim ke Dapur" / KDS path), which
-- logs with source_type = 'order_item' and source_id = order_items.id.
-- transaction_items.id and order_items.id are different rows/ids, and
-- nothing on transaction_items pointed back to the order_items row it
-- came from — so for every order that went through the kitchen (which,
-- after this phase, is now the ONLY path available for any item with a
-- variant/modifier — see the quick-pay guard added to app/pos/page.tsx),
-- revert_recipe_stock() silently found no log, fell through to the
-- simple branch_stock fallback, and never actually restored the
-- ingredients a recipe/modifier had consumed.
--
-- FIX:
--   1. transaction_items gets a new nullable order_item_id column,
--      populated by checkout_order_v2() at payment time (the same
--      snapshot pattern already used for variant_id/recipe_id/etc).
--   2. revert_recipe_stock() now checks recipe_consumption_logs under
--      BOTH possible source_type/source_id pairs before falling back.
-- No frontend change needed — RefundModal.tsx already calls the right
-- RPC with the right arguments.
--
-- HOW TO APPLY: run once against your Supabase project, after review.
-- =========================================================

ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS order_item_id UUID REFERENCES order_items(id);

CREATE INDEX IF NOT EXISTS idx_transaction_items_order_item ON transaction_items (order_item_id);

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
      variant_id, variant_name, modifier_selections, recipe_id, recipe_version, unit_price,
      order_item_id
    ) VALUES (
      v_tx_id, v_item.product_id, v_effective_qty, v_effective_subtotal,
      v_item.variant_id, v_item.variant_name, v_item.modifier_selections, v_item.recipe_id, v_item.recipe_version, v_item.unit_price,
      v_item.id
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

CREATE OR REPLACE FUNCTION revert_recipe_stock(
  p_transaction_id UUID,
  p_transaction_item_id UUID DEFAULT NULL, -- NULL = seluruh item transaksi ini
  p_refund_id UUID DEFAULT NULL            -- kalau diisi, qty dibatasi ke qty yang direfund di baris ini
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx transactions%ROWTYPE;
  v_refund refunds%ROWTYPE;
  v_item RECORD;
  v_restorable_qty INT;
  v_recipe_log RECORD;
  v_ratio NUMERIC;
  v_restored_count INT := 0;
  v_branch_id UUID;
  v_product products%ROWTYPE;
  -- Fix (lihat docs/PHASE_2A3_refund_stock_restore_fix.sql) — konsumsi
  -- resep bisa tercatat di recipe_consumption_logs lewat 2 source_type
  -- berbeda tergantung jalur pembayaran; kita cek keduanya sebelum
  -- menyerah ke fallback stok produk sederhana.
  v_log_source_type TEXT;
  v_log_source_id UUID;
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE id = p_transaction_id;
  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_tx.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan transaksi tenant Anda';
  END IF;

  v_branch_id := COALESCE(v_tx.branch_id, main_branch_id(v_tx.tenant_id));

  IF p_refund_id IS NOT NULL THEN
    SELECT * INTO v_refund FROM refunds WHERE id = p_refund_id FOR UPDATE;
    IF v_refund.id IS NULL THEN
      RAISE EXCEPTION 'Data refund tidak ditemukan';
    END IF;
    IF v_refund.transaction_id <> p_transaction_id THEN
      RAISE EXCEPTION 'Refund tidak sesuai dengan transaksi ini';
    END IF;
    IF v_refund.status <> 'COMPLETED' THEN
      RAISE EXCEPTION 'Stok hanya bisa dikembalikan untuk refund yang sudah COMPLETED';
    END IF;
    IF v_refund.stock_restored THEN
      RAISE EXCEPTION 'STOCK_ALREADY_RESTORED: Stok untuk refund ini sudah pernah dikembalikan';
    END IF;
  END IF;

  -- Loop tiap transaction_item yang relevan, KUNCI barisnya (mencegah 2
  -- request restore bersamaan untuk item yang sama lolos dua-duanya).
  FOR v_item IN
    SELECT ti.* FROM transaction_items ti
    WHERE ti.transaction_id = p_transaction_id
      AND (p_transaction_item_id IS NULL OR ti.id = p_transaction_item_id)
    FOR UPDATE
  LOOP
    -- Tentukan qty yang boleh direstore untuk baris ini:
    --  - kalau terikat ke 1 baris refund ITEM/PARTIAL tertentu, batasi ke
    --    qty yang tercatat di refunds.items untuk transaction_item ini;
    --  - kalau refund FULL (atau tidak ada p_refund_id, dipanggil manual
    --    oleh manager), boleh sampai seluruh qty yang belum direstore.
    IF p_refund_id IS NOT NULL AND v_refund.items IS NOT NULL THEN
      SELECT COALESCE((elem->>'qty')::INT, 0) INTO v_restorable_qty
      FROM jsonb_array_elements(v_refund.items) elem
      WHERE (elem->>'transaction_item_id')::UUID = v_item.id;
      v_restorable_qty := LEAST(COALESCE(v_restorable_qty, 0), v_item.qty - v_item.restored_qty);
    ELSE
      v_restorable_qty := v_item.qty - v_item.restored_qty;
    END IF;

    IF v_restorable_qty IS NULL OR v_restorable_qty <= 0 THEN
      CONTINUE;
    END IF;

    -- Jalur (b): resep — kalau ada jejak konsumsi resep untuk item ini,
    -- kembalikan proporsional ke branch_ingredients_stock. Dicek di KEDUA
    -- kemungkinan source_type: deduct_recipe_stock_for_transaction() (jalur
    -- Bayar Langsung) mencatat 'transaction_item'/v_item.id, sedangkan
    -- deduct_recipe_stock() (dipanggil dari checkout_order_v2 — jalur
    -- Kirim ke Dapur, yang sekarang jadi SATU-SATUNYA jalur untuk item
    -- bervarian/modifier) mencatat 'order_item'/order_items.id — beda dari
    -- transaction_items.id. Sebelum perbaikan ini hanya kemungkinan
    -- pertama yang dicek, jadi refund untuk order yang lewat dapur diam-
    -- diam TIDAK PERNAH menemukan log-nya dan jatuh ke fallback stok
    -- produk sederhana yang salah/kosong untuk produk berbasis resep.
    v_log_source_type := NULL;
    v_log_source_id := NULL;
    IF EXISTS (SELECT 1 FROM recipe_consumption_logs WHERE source_type = 'transaction_item' AND source_id = v_item.id) THEN
      v_log_source_type := 'transaction_item';
      v_log_source_id := v_item.id;
    ELSIF v_item.order_item_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM recipe_consumption_logs WHERE source_type = 'order_item' AND source_id = v_item.order_item_id) THEN
      v_log_source_type := 'order_item';
      v_log_source_id := v_item.order_item_id;
    END IF;

    IF v_log_source_type IS NOT NULL THEN
      v_ratio := v_restorable_qty::NUMERIC / v_item.qty::NUMERIC;

      FOR v_recipe_log IN
        SELECT ingredient_id, unit, SUM(quantity) AS total_qty
        FROM recipe_consumption_logs
        WHERE source_type = v_log_source_type AND source_id = v_log_source_id
        GROUP BY ingredient_id, unit
      LOOP
        UPDATE branch_ingredients_stock
        SET stock_qty = stock_qty + (v_recipe_log.total_qty * v_ratio), updated_at = now()
        WHERE branch_id = v_branch_id AND ingredient_id = v_recipe_log.ingredient_id;

        INSERT INTO ingredient_stock_movements (tenant_id, branch_id, ingredient_id, type, qty_change, unit, note, created_by)
          VALUES (v_tx.tenant_id, v_branch_id, v_recipe_log.ingredient_id, 'REFUND_RESTOCK',
                  v_recipe_log.total_qty * v_ratio, v_recipe_log.unit,
                  'Pengembalian stok dari void/refund transaksi ' || v_tx.invoice_number, auth.uid());
      END LOOP;
    ELSE

      -- Jalur (a): stok produk sederhana (branch_stock / track_stock).
      SELECT * INTO v_product FROM products WHERE id = v_item.product_id;
      IF v_product.id IS NOT NULL AND v_product.track_stock THEN
        UPDATE branch_stock SET stock_qty = stock_qty + v_restorable_qty, updated_at = now()
          WHERE branch_id = v_branch_id AND product_id = v_item.product_id;

        INSERT INTO stock_movements (tenant_id, branch_id, product_id, type, qty_change, note, created_by)
          VALUES (v_tx.tenant_id, v_branch_id, v_item.product_id, 'refund_restock', v_restorable_qty,
                  'Pengembalian stok dari void/refund transaksi ' || v_tx.invoice_number, auth.uid());
      END IF;
    END IF;

    UPDATE transaction_items SET restored_qty = restored_qty + v_restorable_qty WHERE id = v_item.id;
    v_restored_count := v_restored_count + 1;
  END LOOP;

  IF p_refund_id IS NOT NULL THEN
    UPDATE refunds SET stock_restored = true, stock_restored_at = now(), stock_restored_by = auth.uid() WHERE id = p_refund_id;
  END IF;

  INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, old_value, new_value, reason)
    VALUES (v_tx.tenant_id, v_branch_id, auth.uid(), 'STOCK_RESTORED', 'transaction', p_transaction_id, NULL,
            jsonb_build_object('refund_id', p_refund_id, 'transaction_item_id', p_transaction_item_id, 'items_touched', v_restored_count),
            NULL);

  RETURN jsonb_build_object('items_touched', v_restored_count);
END;
$$;
