-- =========================================================
-- migration_021 — Biaya Layanan (service charge) & Pajak otomatis
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration_020.
--
-- Default 0% = perilaku lama TIDAK berubah. Baru aktif setelah owner
-- mengisi persentase di Pengaturan → Kwitansi → "Biaya Layanan & Pajak".
--
-- Urutan hitung (standar restoran Indonesia):
--   dasar   = subtotal - diskon
--   service = dasar x service%
--   pajak   = (dasar + service) x pajak%        -- mode "ditambahkan"
--   total   = dasar + service + pajak
--   Mode "sudah termasuk harga": pajak = (dasar + service) x p/(100+p),
--   total = dasar + service (pajak hanya dipecah di struk).
--
-- Tiga fungsi checkout di bawah adalah salinan fungsi yang ada, hanya
-- ditambah pemanggilan calc_charges() dan kolom service_amount/tax_amount.
-- =========================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS service_charge_pct NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (service_charge_pct >= 0 AND service_charge_pct <= 100),
  ADD COLUMN IF NOT EXISTS tax_pct            NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_pct >= 0 AND tax_pct <= 100),
  ADD COLUMN IF NOT EXISTS tax_inclusive      BOOLEAN      NOT NULL DEFAULT false;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS service_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount     NUMERIC NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION calc_charges(p_tenant_id UUID, p_base NUMERIC)
RETURNS TABLE (service_amount NUMERIC, tax_amount NUMERIC, total_amount NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_s NUMERIC;
  v_t NUMERIC;
  v_incl BOOLEAN;
  v_service NUMERIC;
  v_tax NUMERIC;
BEGIN
  SELECT COALESCE(service_charge_pct, 0), COALESCE(tax_pct, 0), COALESCE(tax_inclusive, false)
    INTO v_s, v_t, v_incl
    FROM tenants WHERE id = p_tenant_id;

  v_s := COALESCE(v_s, 0);
  v_t := COALESCE(v_t, 0);
  v_service := round(p_base * v_s / 100);

  IF v_incl THEN
    v_tax := round((p_base + v_service) * v_t / (100 + v_t));
    RETURN QUERY SELECT v_service, v_tax, p_base + v_service;
  ELSE
    v_tax := round((p_base + v_service) * v_t / 100);
    RETURN QUERY SELECT v_service, v_tax, p_base + v_service + v_tax;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION calc_charges(UUID, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION "public"."checkout_order_split_by_item"("p_order_id" "uuid", "p_invoice_number" "text", "p_item_allocations" "jsonb", "p_payments" "jsonb", "p_split_label" "text" DEFAULT NULL::"text", "p_member_code" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_item order_items%ROWTYPE;
  v_alloc JSONB;
  v_qty INT;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_total NUMERIC;
  v_service NUMERIC := 0;
  v_tax NUMERIC := 0;
  v_discount_pct NUMERIC := 0;
  v_member_id UUID := NULL;
  v_tx_id UUID;
  v_pay JSONB;
  v_payments_sum NUMERIC := 0;
  v_branch_id UUID;
  v_stock RECORD;
  v_stock_qty INT;
  v_remaining_after INT;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pesanan tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_order.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan pesanan tenant Anda';
  END IF;
  IF v_order.status NOT IN ('READY', 'SERVED') THEN
    RAISE EXCEPTION 'Pesanan belum siap dibayar (status saat ini: %)', v_order.status;
  END IF;
  IF v_order.status = 'COMPLETED' OR v_order.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Pesanan sudah selesai/dibatalkan';
  END IF;
  IF p_item_allocations IS NULL OR jsonb_array_length(p_item_allocations) = 0 THEN
    RAISE EXCEPTION 'Alokasi item split kosong';
  END IF;
  IF p_payments IS NULL OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'Rincian pembayaran kosong';
  END IF;

  v_branch_id := COALESCE(v_order.branch_id, main_branch_id(v_order.tenant_id));

  IF p_member_code IS NOT NULL AND p_member_code <> '' THEN
    SELECT id, discount_percentage INTO v_member_id, v_discount_pct
    FROM memberships
    WHERE tenant_id = v_order.tenant_id AND member_code = p_member_code AND is_active = true AND valid_until > now();
    IF v_member_id IS NULL THEN
      RAISE EXCEPTION 'Kode member tidak valid atau kedaluwarsa';
    END IF;
  END IF;

  -- Pass 1: kunci & validasi semua baris alokasi dulu (all-or-nothing).
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_item_allocations) LOOP
    SELECT * INTO v_item FROM order_items WHERE id = (v_alloc->>'order_item_id')::UUID AND order_id = p_order_id FOR UPDATE;
    IF v_item.id IS NULL THEN
      RAISE EXCEPTION 'Item pesanan tidak ditemukan di order ini';
    END IF;
    v_qty := (v_alloc->>'qty')::INT;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Qty alokasi split tidak valid';
    END IF;
    IF v_qty > (v_item.qty - v_item.voided_qty - v_item.split_billed_qty) THEN
      RAISE EXCEPTION 'SPLIT_QTY_EXCEEDS: Qty alokasi (%) melebihi sisa "%" yang belum tertagih (%)',
        v_qty, v_item.product_name, (v_item.qty - v_item.voided_qty - v_item.split_billed_qty);
    END IF;
    v_subtotal := v_subtotal + (v_item.unit_price * v_qty);
  END LOOP;

  IF v_subtotal <= 0 THEN
    RAISE EXCEPTION 'Alokasi split tidak memiliki nilai';
  END IF;

  v_total := round(v_subtotal * (1 - v_discount_pct / 100));

  -- Migrasi 021: biaya service & pajak per sub-bill (default 0% = tanpa perubahan).
  SELECT c.service_amount, c.tax_amount, c.total_amount INTO v_service, v_tax, v_total
    FROM calc_charges(v_order.tenant_id, v_total) c;

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
    RAISE EXCEPTION 'PAYMENT_MISMATCH: Total pembayaran (%) tidak sama dengan total sub-bill ini (%)', v_payments_sum, v_total;
  END IF;

  v_tx_id := gen_random_uuid();

  INSERT INTO transactions (
    id, tenant_id, cashier_id, shift_id, invoice_number, total_amount,
    payment_method, member_id, is_offline_sync, branch_id, order_id, split_group_label,
    service_amount, tax_amount
  ) VALUES (
    v_tx_id, v_order.tenant_id, v_order.cashier_id, v_order.shift_id, p_invoice_number, v_total,
    CASE WHEN jsonb_array_length(p_payments) > 1 THEN 'mixed' ELSE (p_payments->0->>'method') END,
    v_member_id, false, v_branch_id, p_order_id, p_split_label,
    v_service, v_tax
  );

  FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    INSERT INTO transaction_payments (transaction_id, method, amount, reference_number, split_group_label)
      VALUES (v_tx_id, v_pay->>'method', (v_pay->>'amount')::NUMERIC, NULLIF(v_pay->>'reference_number', ''), p_split_label);
  END LOOP;

  -- Pass 2: catat transaction_items, kurangi stok (branch_stock,
  -- pola sama dengan checkout_order_v2), tandai split_billed_qty.
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_item_allocations) LOOP
    SELECT * INTO v_item FROM order_items WHERE id = (v_alloc->>'order_item_id')::UUID;
    v_qty := (v_alloc->>'qty')::INT;
    v_line_total := v_item.unit_price * v_qty;

    INSERT INTO transaction_items (transaction_id, product_id, qty, subtotal) VALUES (v_tx_id, v_item.product_id, v_qty, v_line_total);

    SELECT track_stock INTO v_stock FROM products WHERE id = v_item.product_id;
    IF v_stock.track_stock THEN
      SELECT stock_qty INTO v_stock_qty FROM branch_stock WHERE branch_id = v_branch_id AND product_id = v_item.product_id FOR UPDATE;
      IF v_stock_qty IS NULL THEN
        v_stock_qty := 0;
        INSERT INTO branch_stock (tenant_id, branch_id, product_id, stock_qty)
          VALUES (v_order.tenant_id, v_branch_id, v_item.product_id, 0) ON CONFLICT (branch_id, product_id) DO NOTHING;
      END IF;
      IF v_stock_qty < v_qty THEN
        RAISE EXCEPTION 'STOCK_INSUFFICIENT: Stok "%" tidak cukup (tersisa %, diminta %).', v_item.product_name, v_stock_qty, v_qty;
      END IF;
      UPDATE branch_stock SET stock_qty = stock_qty - v_qty, updated_at = now() WHERE branch_id = v_branch_id AND product_id = v_item.product_id;
      INSERT INTO stock_movements (tenant_id, branch_id, product_id, type, qty_change, note, created_by)
        VALUES (v_order.tenant_id, v_branch_id, v_item.product_id, 'sale', -v_qty,
                'Split bill dari pesanan ' || v_order.order_number || COALESCE(' (' || p_split_label || ')', ''), v_order.cashier_id);
    END IF;

    UPDATE order_items SET split_billed_qty = split_billed_qty + v_qty WHERE id = v_item.id;
  END LOOP;

  -- Order selesai total begitu SEMUA item (dikurangi void) sudah
  -- habis tertagih lewat split — cek ulang SETELAH update di atas.
  SELECT COUNT(*) INTO v_remaining_after FROM order_items
    WHERE order_id = p_order_id AND (qty - voided_qty - split_billed_qty) > 0;

  IF v_remaining_after = 0 THEN
    UPDATE orders SET status = 'COMPLETED', completed_at = now(), transaction_id = v_tx_id WHERE id = p_order_id;
    IF v_order.order_type = 'dine_in' AND v_order.table_id IS NOT NULL THEN
      UPDATE branch_tables SET needs_cleaning = true, cleaning_started_at = now(), bill_printed_at = NULL WHERE id = v_order.table_id;
    END IF;
  END IF;

  INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, old_value, new_value, reason)
    VALUES (v_order.tenant_id, v_branch_id, auth.uid(), 'SPLIT_BILL_ITEM', 'order', p_order_id, NULL,
            jsonb_build_object('transaction_id', v_tx_id, 'amount', v_total, 'split_label', p_split_label, 'order_fully_settled', v_remaining_after = 0),
            NULL);

  RETURN v_tx_id;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."checkout_order_v2"("p_order_id" "uuid", "p_invoice_number" "text", "p_member_code" "text", "p_payments" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_item RECORD;
  v_pay JSONB;
  v_subtotal NUMERIC := 0;
  v_discount_pct NUMERIC := 0;
  v_member_id UUID := NULL;
  v_total NUMERIC;
  v_service NUMERIC := 0;
  v_tax NUMERIC := 0;
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

  -- Migrasi 021: biaya service & pajak (default 0% = tanpa perubahan).
  SELECT c.service_amount, c.tax_amount, c.total_amount INTO v_service, v_tax, v_total
    FROM calc_charges(v_order.tenant_id, v_total) c;

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
    payment_method, member_id, is_offline_sync, branch_id, order_id,
    service_amount, tax_amount
  ) VALUES (
    v_tx_id, v_order.tenant_id, v_order.cashier_id, v_order.shift_id, p_invoice_number, v_total,
    CASE WHEN jsonb_array_length(p_payments) > 1 THEN 'mixed' ELSE (p_payments->0->>'method') END,
    v_member_id, false, v_branch_id, p_order_id,
    v_service, v_tax
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

    INSERT INTO transaction_items (transaction_id, product_id, qty, subtotal)
      VALUES (v_tx_id, v_item.product_id, v_effective_qty, v_effective_subtotal);

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

CREATE OR REPLACE FUNCTION "public"."checkout_transaction"("p_tenant_id" "uuid", "p_cashier_id" "uuid", "p_invoice_number" "text", "p_payment_method" "text", "p_member_code" "text", "p_items" "jsonb", "p_branch_id" "uuid" DEFAULT NULL::"uuid", "p_customer_id" "uuid" DEFAULT NULL::"uuid", "p_voucher_code" "text" DEFAULT NULL::"text", "p_promotion_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_item JSONB;
  v_product products%ROWTYPE;
  v_qty INT;
  v_subtotal NUMERIC := 0;
  v_discount_pct NUMERIC := 0;
  v_member_id UUID := NULL;
  v_member_discount NUMERIC := 0;
  v_promo_voucher_discount NUMERIC := 0;
  v_total NUMERIC;
  v_base NUMERIC;
  v_service NUMERIC := 0;
  v_tax NUMERIC := 0;
  v_tx_id UUID;
  v_shift_id UUID;
  v_branch_id UUID;
  v_stock_qty NUMERIC;
  v_pending_product_ids UUID[] := '{}';
  v_pending_qtys INT[] := '{}';
  v_pending_subtotals NUMERIC[] := '{}';
  v_i INT;
  v_voucher vouchers%ROWTYPE;
  v_customer customers%ROWTYPE;
  v_loyalty_points INT := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: bukan anggota tenant ini';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang kosong';
  END IF;

  v_branch_id := COALESCE(
    p_branch_id,
    (SELECT branch_id FROM profiles WHERE id = p_cashier_id),
    main_branch_id(p_tenant_id)
  );

  v_shift_id := open_shift(p_tenant_id, p_cashier_id);

  IF p_member_code IS NOT NULL AND p_member_code <> '' THEN
    SELECT id, discount_percentage INTO v_member_id, v_discount_pct
    FROM memberships
    WHERE tenant_id = p_tenant_id
      AND member_code = p_member_code
      AND is_active = true
      AND valid_until > now();
    IF v_member_id IS NULL THEN
      RAISE EXCEPTION 'Kode member tidak valid atau kedaluwarsa';
    END IF;
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM customers
      WHERE id = p_customer_id AND tenant_id = p_tenant_id AND is_active = true;
    IF v_customer.id IS NULL THEN
      RAISE EXCEPTION 'Pelanggan tidak ditemukan atau tidak aktif';
    END IF;
  END IF;

  v_tx_id := gen_random_uuid();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::INT;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 500 THEN
      RAISE EXCEPTION 'Qty item tidak valid';
    END IF;

    SELECT * INTO v_product FROM products
      WHERE id = (v_item->>'product_id')::UUID
        AND tenant_id = p_tenant_id
        AND is_available = true;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Produk tidak ditemukan atau tidak tersedia';
    END IF;

    IF v_product.track_stock THEN
      SELECT stock_qty INTO v_stock_qty FROM branch_stock
        WHERE branch_id = v_branch_id AND product_id = v_product.id
        FOR UPDATE;

      IF v_stock_qty IS NULL THEN
        v_stock_qty := 0;
        INSERT INTO branch_stock (tenant_id, branch_id, product_id, stock_qty)
          VALUES (p_tenant_id, v_branch_id, v_product.id, 0)
          ON CONFLICT (branch_id, product_id) DO NOTHING;
      END IF;

      IF v_stock_qty < v_qty THEN
        RAISE EXCEPTION 'STOCK_INSUFFICIENT: Stok "%" tidak cukup di cabang ini (tersisa %, diminta %).',
          v_product.name, v_stock_qty, v_qty;
      END IF;

      UPDATE branch_stock SET stock_qty = stock_qty - v_qty, updated_at = now()
        WHERE branch_id = v_branch_id AND product_id = v_product.id;

      INSERT INTO stock_movements (tenant_id, branch_id, product_id, type, qty_change, note, created_by)
        VALUES (p_tenant_id, v_branch_id, v_product.id, 'sale', -v_qty, 'Otomatis dari transaksi ' || p_invoice_number, p_cashier_id);
    END IF;

    v_subtotal := v_subtotal + (v_product.price * v_qty);

    v_pending_product_ids := array_append(v_pending_product_ids, v_product.id);
    v_pending_qtys := array_append(v_pending_qtys, v_qty);
    v_pending_subtotals := array_append(v_pending_subtotals, v_product.price * v_qty);
  END LOOP;

  v_member_discount := round(v_subtotal * v_discount_pct / 100);

  IF p_voucher_code IS NOT NULL AND p_voucher_code <> '' THEN
    SELECT * INTO v_voucher FROM vouchers
      WHERE tenant_id = p_tenant_id
        AND voucher_code = p_voucher_code
        AND is_active = true
      FOR UPDATE;

    IF v_voucher.id IS NULL THEN
      RAISE EXCEPTION 'Voucher tidak ditemukan atau tidak aktif';
    END IF;
    IF v_voucher.branch_id IS NOT NULL AND v_voucher.branch_id <> v_branch_id THEN
      RAISE EXCEPTION 'Voucher tidak berlaku untuk cabang ini';
    END IF;
    IF v_voucher.start_date > now() OR (v_voucher.expiry_date IS NOT NULL AND v_voucher.expiry_date < now()) THEN
      RAISE EXCEPTION 'Voucher sudah tidak berlaku (kedaluwarsa atau belum mulai)';
    END IF;
    IF v_voucher.usage_limit IS NOT NULL AND v_voucher.usage_count >= v_voucher.usage_limit THEN
      RAISE EXCEPTION 'Voucher sudah mencapai batas penggunaan';
    END IF;
    IF v_subtotal < v_voucher.min_purchase_amount THEN
      RAISE EXCEPTION 'Belanja belum mencapai minimum Rp% untuk voucher ini', v_voucher.min_purchase_amount;
    END IF;

    IF v_voucher.discount_type = 'PERCENTAGE' THEN
      v_promo_voucher_discount := round(v_subtotal * v_voucher.discount_value / 100);
      IF v_voucher.max_discount_amount IS NOT NULL AND v_promo_voucher_discount > v_voucher.max_discount_amount THEN
        v_promo_voucher_discount := v_voucher.max_discount_amount;
      END IF;
    ELSE
      v_promo_voucher_discount := LEAST(v_voucher.discount_value, v_subtotal);
    END IF;

    UPDATE vouchers SET usage_count = usage_count + 1, updated_at = now() WHERE id = v_voucher.id;

  ELSIF p_promotion_id IS NOT NULL THEN
    v_promo_voucher_discount := apply_promotion(p_promotion_id, v_subtotal);
  END IF;

  v_total := round(v_subtotal - v_member_discount - v_promo_voucher_discount);
  IF v_total < 0 THEN
    v_total := 0;
  END IF;

  -- Migrasi 021: biaya service & pajak (default 0% = tanpa perubahan).
  v_base := v_total;
  SELECT c.service_amount, c.tax_amount, c.total_amount INTO v_service, v_tax, v_total
    FROM calc_charges(p_tenant_id, v_base) c;

  INSERT INTO transactions (
    id, tenant_id, cashier_id, invoice_number, total_amount,
    payment_method, member_id, is_offline_sync, shift_id, branch_id,
    customer_id, voucher_id, promotion_id, subtotal_amount, discount_amount,
    service_amount, tax_amount
  ) VALUES (
    v_tx_id, p_tenant_id, p_cashier_id, p_invoice_number, v_total,
    p_payment_method, v_member_id, false, v_shift_id, v_branch_id,
    p_customer_id,
    CASE WHEN v_voucher.id IS NOT NULL THEN v_voucher.id ELSE NULL END,
    CASE WHEN v_voucher.id IS NULL AND p_promotion_id IS NOT NULL THEN p_promotion_id ELSE NULL END,
    v_subtotal, v_member_discount + v_promo_voucher_discount,
    v_service, v_tax
  );

  FOR v_i IN 1..array_length(v_pending_product_ids, 1) LOOP
    INSERT INTO transaction_items (transaction_id, product_id, qty, subtotal)
      VALUES (v_tx_id, v_pending_product_ids[v_i], v_pending_qtys[v_i], v_pending_subtotals[v_i]);
  END LOOP;

  IF v_voucher.id IS NOT NULL THEN
    INSERT INTO voucher_redemptions (voucher_id, transaction_id, customer_id, discount_given)
      VALUES (v_voucher.id, v_tx_id, p_customer_id, v_promo_voucher_discount);
  END IF;

  IF p_customer_id IS NOT NULL THEN
    v_loyalty_points := calculate_loyalty_points(p_tenant_id, v_base);
    IF v_loyalty_points > 0 THEN
      PERFORM earn_loyalty_points(v_tx_id, p_customer_id, v_loyalty_points);
      UPDATE transactions SET loyalty_points_earned = v_loyalty_points WHERE id = v_tx_id;
    END IF;

    UPDATE customers
      SET visit_count = visit_count + 1,
          lifetime_spend = lifetime_spend + v_base,
          last_visit_date = now(),
          updated_at = now()
      WHERE id = p_customer_id;
  END IF;

  -- BARU (Migrasi 019): potong branch_ingredients_stock berdasar resep
  -- DEFAULT tiap produk (jalur ini tidak punya konsep varian/modifier).
  -- Kalau consume_recipe() gagal (stok bahan baku kurang & tidak boleh
  -- negatif), seluruh transaksi ini ikut rollback (all-or-nothing).
  PERFORM deduct_recipe_stock_for_transaction(v_tx_id);

  RETURN v_tx_id;
END;
$$;
