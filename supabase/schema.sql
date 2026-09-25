-- =========================================================================
-- caPOS -- Skema Database Konsolidasi (Supabase / PostgreSQL)
-- =========================================================================
-- File ini adalah hasil KONSOLIDASI dari schema.sql versi sebelumnya +
-- migration_001 sampai migration_017 (lihat supabase/migration_*.sql untuk
-- riwayat lengkap tiap perubahan; DATABASE_CONSOLIDATION_REPORT.md berisi
-- peta lengkap migrasi -> objek, konflik yang diselesaikan, dan catatan
-- audit). Ini BUKAN gabungan mentah (concatenation) dari 17 file migrasi
-- itu -- setiap tabel/fungsi/kebijakan RLS di bawah adalah versi EFEKTIF
-- TERAKHIR setelah seluruh ALTER/CREATE OR REPLACE/DROP+CREATE dari
-- migration_001..017 diterapkan berurutan (diverifikasi dengan cara
-- benar-benar me-replay ke-17 migrasi tsb di database PostgreSQL kosong,
-- lalu pg_dump hasil akhirnya -- BUKAN disusun manual baris per baris).
--
-- CARA PAKAI:
--   - Database Supabase BARU (kosong): jalankan file ini SATU KALI di SQL
--     Editor. Ini saja sudah cukup -- TIDAK perlu menjalankan
--     migration_001..017 setelahnya.
--   - Database Supabase yang SUDAH PERNAH menjalankan sebagian/seluruh
--     migration_001..017: JANGAN jalankan file ini (akan bentrok dengan
--     objek yang sudah ada). Migrasi individual di supabase/migration_*.sql
--     tetap dipertahankan sebagai riwayat & untuk database yang belum
--     ter-update penuh.
--   - Migrasi baru SETELAH file ini (mis. migration_018 dst, di luar
--     folder ini) tetap ditambahkan sebagai file migration_XXX terpisah
--     seperti biasa -- file schema.sql ini TIDAK otomatis ikut berubah,
--     perlu dikonsolidasi ulang secara berkala.
--
-- CATATAN PENTING (lihat DATABASE_CONSOLIDATION_REPORT.md untuk detail):
--   - migration_16.sql menyatakan dirinya "FINAL LOCK" dan secara eksplisit
--     berkata "jangan buat migration_17.sql" -- namun migration_017 tetap
--     dibuat setelahnya. Baris ini didokumentasikan apa adanya di
--     schema_migrations_log di bagian akhir file ini.
--   - Beberapa komentar objek (COMMENT ON ...) menyebut "Migrasi 019"
--     yang TIDAK ADA sebagai file migrasi terpisah di repo ini -- kemungkinan
--     penomoran internal yang tidak pernah dipisah jadi file sendiri.
--     Fungsi terkait tetap dikonsolidasi dari migration_013/014 sesuai isi
--     aktualnya, bukan dari file "migration_019" yang tidak ada.
-- =========================================================================

-- Dibutuhkan untuk gen_random_bytes() (dipakai al. oleh branch_tables.qr_token
-- dan hashing PIN karyawan). gen_random_uuid() sendiri sudah built-in di
-- PostgreSQL 13+ (pg_catalog) dan tidak butuh extension ini, tapi
-- gen_random_bytes() berasal dari pgcrypto. Supabase pada umumnya sudah
-- mengaktifkan extension ini secara default; baris ini dibuat eksplisit
-- (dan dipindah ke AWAL file, bukan di tengah seperti urutan asli di
-- migration_013) supaya schema.sql ini portable & tidak bergantung urutan.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'caPOS: skema database konsolidasi (migration 001-017). Mencakup multi-tenant multi-cabang F&B POS, profil/role & langganan, menu (produk/varian/modifier), inventori & resep (BOM) dengan deduksi stok otomatis, POS + KDS + shift/kas, refund/void dengan restorasi stok, manajemen meja, purchasing/GRN, CRM/loyalty/promosi, QR self-order/QRIS/reservasi, dan modul keuangan.';


--
-- Name: sub_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sub_status AS ENUM (
    'trial',
    'active',
    'past_due',
    'expired'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'super_admin',
    'owner',
    'manager',
    'cashier',
    'kitchen'
);


--
-- Name: adjust_ingredient_stock(uuid, uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.adjust_ingredient_stock(p_ingredient_id uuid, p_branch_id uuid, p_qty_change numeric, p_type text DEFAULT 'ADJUSTMENT'::text, p_note text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tenant_id UUID := current_tenant_id();
BEGIN
  IF NOT is_manager_or_owner() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Hanya Owner/Manager yang boleh menyesuaikan stok bahan baku';
  END IF;

  INSERT INTO branch_ingredients_stock (tenant_id, branch_id, ingredient_id, stock_qty)
  VALUES (v_tenant_id, p_branch_id, p_ingredient_id, GREATEST(p_qty_change, 0))
  ON CONFLICT (branch_id, ingredient_id) DO UPDATE
    SET stock_qty = branch_ingredients_stock.stock_qty + p_qty_change, updated_at = now();

  INSERT INTO ingredient_stock_movements (tenant_id, branch_id, ingredient_id, type, qty_change, unit, note, created_by)
  SELECT v_tenant_id, p_branch_id, p_ingredient_id, p_type, p_qty_change, inventory_unit, p_note, auth.uid()
  FROM ingredients WHERE id = p_ingredient_id;

  RETURN TRUE;
END;
$$;


--
-- Name: adjust_stock(uuid, numeric, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.adjust_stock(p_product_id uuid, p_qty_change numeric, p_type text, p_note text, p_branch_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tenant_id UUID;
  v_branch_id UUID;
BEGIN
  IF NOT is_manager_or_owner() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Manager/Owner yang boleh mengubah stok.';
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM products WHERE id = p_product_id;
  IF v_tenant_id IS NULL OR v_tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Produk tidak ditemukan di tenant Anda.';
  END IF;

  v_branch_id := COALESCE(p_branch_id, current_branch_id(), main_branch_id(v_tenant_id));
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan untuk tenant ini.';
  END IF;

  -- Manager (bukan owner) hanya boleh mengubah stok cabang tempat dia
  -- ditugaskan — mencegah manager cabang A mengubah stok cabang B.
  IF NOT is_owner() AND v_branch_id <> current_branch_id() THEN
    RAISE EXCEPTION 'Akses ditolak: Anda hanya bisa mengubah stok cabang tempat Anda bertugas.';
  END IF;

  INSERT INTO branch_stock (tenant_id, branch_id, product_id, stock_qty)
    VALUES (v_tenant_id, v_branch_id, p_product_id, GREATEST(p_qty_change, 0))
    ON CONFLICT (branch_id, product_id)
    DO UPDATE SET stock_qty = branch_stock.stock_qty + p_qty_change, updated_at = now();

  INSERT INTO stock_movements (tenant_id, branch_id, product_id, type, qty_change, note, created_by)
    VALUES (v_tenant_id, v_branch_id, p_product_id, p_type, p_qty_change, p_note, auth.uid());
END;
$$;


--
-- Name: admin_upsert_referral_code(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_upsert_referral_code(p_tenant_id uuid, p_code text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Super Admin yang boleh mengatur kode referral tenant lain.';
  END IF;

  INSERT INTO referrals (tenant_id, code)
    VALUES (p_tenant_id, p_code)
  ON CONFLICT (tenant_id) DO UPDATE SET code = EXCLUDED.code;
END;
$$;


--
-- Name: apply_manual_discount(uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_manual_discount(p_order_id uuid, p_discount_amount numeric, p_reason text, p_supervisor_pin text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_subtotal NUMERIC;
  v_supervisor_id UUID;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pesanan tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_order.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan pesanan tenant Anda';
  END IF;
  IF v_order.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Pesanan sudah selesai/dibatalkan, tidak bisa diberi diskon manual';
  END IF;
  IF p_discount_amount IS NULL OR p_discount_amount < 0 THEN
    RAISE EXCEPTION 'Nominal diskon tidak valid';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Alasan diskon manual wajib diisi';
  END IF;

  SELECT COALESCE(SUM(unit_price * (qty - voided_qty)), 0) INTO v_subtotal FROM order_items WHERE order_id = p_order_id;
  IF p_discount_amount > v_subtotal THEN
    RAISE EXCEPTION 'Nominal diskon melebihi subtotal pesanan (%)', v_subtotal;
  END IF;

  v_supervisor_id := require_supervisor_authorization(
    'MANUAL_DISCOUNT', 'order', p_order_id, v_order.tenant_id, v_order.branch_id,
    p_reason, p_supervisor_pin, jsonb_build_object('discount_amount', p_discount_amount)
  );

  UPDATE orders SET
    manual_discount_amount = p_discount_amount,
    manual_discount_reason = p_reason,
    manual_discount_by = COALESCE(v_supervisor_id, auth.uid())
  WHERE id = p_order_id;

  INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, old_value, new_value, reason)
    VALUES (v_order.tenant_id, v_order.branch_id, auth.uid(), 'MANUAL_DISCOUNT', 'order', p_order_id,
            jsonb_build_object('manual_discount_amount', v_order.manual_discount_amount),
            jsonb_build_object('manual_discount_amount', p_discount_amount, 'authorized_by', v_supervisor_id), p_reason);
END;
$$;


--
-- Name: FUNCTION apply_manual_discount(p_order_id uuid, p_discount_amount numeric, p_reason text, p_supervisor_pin text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.apply_manual_discount(p_order_id uuid, p_discount_amount numeric, p_reason text, p_supervisor_pin text) IS 'Migrasi 019: diskon manual Rupiah pada 1 order, wajib PIN supervisor untuk kasir. Diterapkan di checkout_order_v2 di atas diskon member.';


--
-- Name: apply_promotion(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_promotion(p_promotion_id uuid, p_transaction_amount numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_promo promotions%ROWTYPE;
  v_rule promotion_rules%ROWTYPE;
  v_discount NUMERIC := 0;
  v_min_purchase NUMERIC := 0;
  v_max_discount NUMERIC := NULL;
  v_now TIME := CURRENT_TIME;
BEGIN
  SELECT * INTO v_promo FROM promotions WHERE id = p_promotion_id;
  IF v_promo.id IS NULL OR NOT v_promo.is_active THEN
    RETURN 0;
  END IF;

  -- Validasi periode promo
  IF v_promo.start_date > now() OR (v_promo.end_date IS NOT NULL AND v_promo.end_date < now()) THEN
    RETURN 0;
  END IF;

  -- Parse rules
  FOR v_rule IN SELECT * FROM promotion_rules WHERE promotion_id = p_promotion_id LOOP
    CASE v_rule.rule_type
      WHEN 'MIN_PURCHASE' THEN
        v_min_purchase := (v_rule.rule_value)::NUMERIC;
      WHEN 'MAX_DISCOUNT' THEN
        v_max_discount := (v_rule.rule_value)::NUMERIC;
      WHEN 'HAPPY_HOUR' THEN
        -- Format: "08:00-11:00,14:00-17:00"
        -- Untuk simplicity, skip validasi jam di function ini
        NULL;
      ELSE
        NULL;
    END CASE;
  END LOOP;

  -- Validasi minimum pembelian
  IF p_transaction_amount < v_min_purchase THEN
    RETURN 0;
  END IF;

  -- Hitung diskon berdasarkan tipe promo
  CASE v_promo.promo_type
    WHEN 'PERCENTAGE' THEN
      v_discount := ROUND(p_transaction_amount * v_promo.discount_value / 100, 2);
      IF v_max_discount IS NOT NULL AND v_discount > v_max_discount THEN
        v_discount := v_max_discount;
      END IF;
    WHEN 'NOMINAL' THEN
      v_discount := v_promo.discount_value;
      IF v_discount > p_transaction_amount THEN
        v_discount := p_transaction_amount;
      END IF;
    ELSE
      v_discount := 0;
  END CASE;

  RETURN v_discount;
END;
$$;


--
-- Name: approve_refund(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_refund(p_refund_id uuid, p_decision text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_refund refunds%ROWTYPE;
BEGIN
  IF NOT is_manager_or_owner() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya manager/owner yang bisa menyetujui refund';
  END IF;
  IF p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'Keputusan tidak valid';
  END IF;

  SELECT * INTO v_refund FROM refunds WHERE id = p_refund_id FOR UPDATE;
  IF v_refund.id IS NULL THEN
    RAISE EXCEPTION 'Permintaan refund tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_refund.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan refund tenant Anda';
  END IF;
  IF v_refund.status <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Permintaan refund ini sudah diputuskan sebelumnya';
  END IF;

  UPDATE refunds SET
    status = CASE WHEN p_decision = 'APPROVED' THEN 'COMPLETED' ELSE 'REJECTED' END,
    approved_by = auth.uid(),
    decided_at = now()
  WHERE id = p_refund_id;

  INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, old_value, new_value, reason)
    VALUES (v_refund.tenant_id, v_refund.branch_id, auth.uid(), 'REFUND_' || p_decision, 'refund', p_refund_id,
            jsonb_build_object('status', 'PENDING_APPROVAL'), jsonb_build_object('status', p_decision), NULL);
END;
$$;


--
-- Name: assign_customer_tier(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_customer_tier(p_customer_id uuid, p_tier_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT is_manager_or_owner() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Hanya Owner/Manager yang boleh mengubah tier pelanggan';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND tenant_id = current_tenant_id()) THEN
    RAISE EXCEPTION 'Pelanggan tidak ditemukan di tenant Anda';
  END IF;

  IF p_tier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM customer_tiers WHERE id = p_tier_id AND tenant_id = current_tenant_id()
  ) THEN
    RAISE EXCEPTION 'Tier tidak ditemukan di tenant Anda';
  END IF;

  UPDATE customers SET tier_id = p_tier_id, updated_at = now()
    WHERE id = p_customer_id AND tenant_id = current_tenant_id();
END;
$$;


--
-- Name: FUNCTION assign_customer_tier(p_customer_id uuid, p_tier_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.assign_customer_tier(p_customer_id uuid, p_tier_id uuid) IS 'migration_16 (bagian H9). RPC baru untuk fitur Kartu Member Digital — assign pelanggan ke tier tertentu. Tidak menggantikan/mengubah createCustomer/updateCustomer yang sudah ada.';


--
-- Name: calculate_loyalty_points(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_loyalty_points(p_tenant_id uuid, p_transaction_amount numeric) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_config loyalty_config%ROWTYPE;
  v_points INT;
BEGIN
  SELECT * INTO v_config FROM loyalty_config WHERE tenant_id = p_tenant_id;
  
  IF v_config.id IS NULL OR NOT v_config.is_enabled THEN
    RETURN 0;
  END IF;

  IF p_transaction_amount < v_config.min_purchase_for_points THEN
    RETURN 0;
  END IF;

  v_points := FLOOR(p_transaction_amount * v_config.points_per_rupiah)::INT;
  RETURN v_points;
END;
$$;


--
-- Name: calculate_recipe_cost(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_recipe_cost(p_recipe_id uuid, p_branch_id uuid DEFAULT NULL::uuid) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(SUM(
    ri.quantity * COALESCE(
      (SELECT bis.cost_price FROM branch_ingredients_stock bis
       WHERE bis.ingredient_id = ri.ingredient_id
         AND bis.branch_id = COALESCE(p_branch_id, main_branch_id((SELECT tenant_id FROM recipes WHERE id = p_recipe_id)))),
      0)
  ), 0)
  FROM recipe_items ri
  WHERE ri.recipe_id = p_recipe_id;
$$;


--
-- Name: calculate_weighted_average_cost(uuid, uuid, uuid, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_weighted_average_cost(p_tenant_id uuid, p_branch_id uuid, p_product_id uuid, p_new_qty numeric, p_new_unit_price numeric) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_current_qty NUMERIC;
  v_current_cost NUMERIC;
  v_weighted_avg NUMERIC;
BEGIN
  SELECT stock_qty, cost_price INTO v_current_qty, v_current_cost
  FROM branch_ingredients_stock
  WHERE branch_id = p_branch_id AND ingredient_id = p_product_id;

  IF v_current_qty IS NULL OR v_current_qty = 0 THEN
    RETURN p_new_unit_price;
  END IF;

  v_weighted_avg := (v_current_qty * COALESCE(v_current_cost, 0) + p_new_qty * p_new_unit_price)
                    / (v_current_qty + p_new_qty);

  RETURN ROUND(v_weighted_avg, 2);
END;
$$;


--
-- Name: cancel_order(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_order(p_order_id uuid, p_reason text, p_supervisor_pin text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_total NUMERIC;
  v_supervisor_id UUID;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pesanan tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_order.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan pesanan tenant Anda';
  END IF;
  IF v_order.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Pesanan sudah selesai/dibatalkan';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Alasan pembatalan wajib diisi';
  END IF;

  SELECT COALESCE(SUM(unit_price * (qty - voided_qty)), 0) INTO v_total FROM order_items WHERE order_id = p_order_id;

  v_supervisor_id := require_supervisor_authorization(
    'CANCEL_ORDER', 'order', p_order_id, v_order.tenant_id, v_order.branch_id,
    p_reason, p_supervisor_pin, jsonb_build_object('amount', v_total)
  );

  IF NOT is_manager_or_owner() AND NOT is_super_admin() AND v_supervisor_id IS NULL AND v_total > 50000 THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: Batalkan pesanan di atas Rp50.000 wajib persetujuan manager';
  END IF;

  UPDATE orders SET status = 'CANCELLED', notes = COALESCE(notes || ' | ', '') || 'DIBATALKAN: ' || p_reason WHERE id = p_order_id;

  -- Meja dibebaskan otomatis (table_live_status mengecualikan CANCELLED
  -- dari "order aktif") — bersihkan juga bill_printed_at supaya tidak
  -- nyangkut kalau meja ini dipakai order baru nanti.
  IF v_order.order_type = 'dine_in' AND v_order.table_id IS NOT NULL THEN
    UPDATE branch_tables SET bill_printed_at = NULL WHERE id = v_order.table_id;
  END IF;

  INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, old_value, new_value, reason)
    VALUES (v_order.tenant_id, v_order.branch_id, auth.uid(), 'VOID_ORDER', 'order', p_order_id,
            jsonb_build_object('status', v_order.status),
            jsonb_build_object('status', 'CANCELLED', 'amount', v_total, 'authorized_by', v_supervisor_id), p_reason);
END;
$$;


--
-- Name: capos_enforce_expense_insert_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.capos_enforce_expense_insert_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role NOT IN ('owner', 'super_admin') AND NEW.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Hanya owner/admin yang dapat membuat expense dengan status selain PENDING';
  END IF;
  IF v_role NOT IN ('owner', 'super_admin') THEN
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: capos_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.capos_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: checkout_order_split_by_item(uuid, text, jsonb, jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.checkout_order_split_by_item(p_order_id uuid, p_invoice_number text, p_item_allocations jsonb, p_payments jsonb, p_split_label text DEFAULT NULL::text, p_member_code text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_item order_items%ROWTYPE;
  v_alloc JSONB;
  v_qty INT;
  v_line_total NUMERIC;
  v_subtotal NUMERIC := 0;
  v_total NUMERIC;
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
    payment_method, member_id, is_offline_sync, branch_id, order_id, split_group_label
  ) VALUES (
    v_tx_id, v_order.tenant_id, v_order.cashier_id, v_order.shift_id, p_invoice_number, v_total,
    CASE WHEN jsonb_array_length(p_payments) > 1 THEN 'mixed' ELSE (p_payments->0->>'method') END,
    v_member_id, false, v_branch_id, p_order_id, p_split_label
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


--
-- Name: FUNCTION checkout_order_split_by_item(p_order_id uuid, p_invoice_number text, p_item_allocations jsonb, p_payments jsonb, p_split_label text, p_member_code text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.checkout_order_split_by_item(p_order_id uuid, p_invoice_number text, p_item_allocations jsonb, p_payments jsonb, p_split_label text, p_member_code text) IS 'Migrasi 019: Split Bill mode "Split by Item" — 1 sub-bill = 1 transaksi terpisah untuk sebagian order_items. Dipanggil sekali per sub-bill dari SplitBillModal.tsx. Order baru berstatus COMPLETED setelah seluruh item habis dialokasikan ke sub-bill manapun.';


--
-- Name: checkout_order_v2(uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.checkout_order_v2(p_order_id uuid, p_invoice_number text, p_member_code text, p_payments jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
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


--
-- Name: checkout_transaction(uuid, uuid, text, text, text, jsonb, uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.checkout_transaction(p_tenant_id uuid, p_cashier_id uuid, p_invoice_number text, p_payment_method text, p_member_code text, p_items jsonb, p_branch_id uuid DEFAULT NULL::uuid, p_customer_id uuid DEFAULT NULL::uuid, p_voucher_code text DEFAULT NULL::text, p_promotion_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
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

  INSERT INTO transactions (
    id, tenant_id, cashier_id, invoice_number, total_amount,
    payment_method, member_id, is_offline_sync, shift_id, branch_id,
    customer_id, voucher_id, promotion_id, subtotal_amount, discount_amount
  ) VALUES (
    v_tx_id, p_tenant_id, p_cashier_id, p_invoice_number, v_total,
    p_payment_method, v_member_id, false, v_shift_id, v_branch_id,
    p_customer_id,
    CASE WHEN v_voucher.id IS NOT NULL THEN v_voucher.id ELSE NULL END,
    CASE WHEN v_voucher.id IS NULL AND p_promotion_id IS NOT NULL THEN p_promotion_id ELSE NULL END,
    v_subtotal, v_member_discount + v_promo_voucher_discount
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
    v_loyalty_points := calculate_loyalty_points(p_tenant_id, v_total);
    IF v_loyalty_points > 0 THEN
      PERFORM earn_loyalty_points(v_tx_id, p_customer_id, v_loyalty_points);
      UPDATE transactions SET loyalty_points_earned = v_loyalty_points WHERE id = v_tx_id;
    END IF;

    UPDATE customers
      SET visit_count = visit_count + 1,
          lifetime_spend = lifetime_spend + v_total,
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


--
-- Name: FUNCTION checkout_transaction(p_tenant_id uuid, p_cashier_id uuid, p_invoice_number text, p_payment_method text, p_member_code text, p_items jsonb, p_branch_id uuid, p_customer_id uuid, p_voucher_code text, p_promotion_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.checkout_transaction(p_tenant_id uuid, p_cashier_id uuid, p_invoice_number text, p_payment_method text, p_member_code text, p_items jsonb, p_branch_id uuid, p_customer_id uuid, p_voucher_code text, p_promotion_id uuid) IS 'Checkout otoritatif (Migrasi 017 + Migrasi 019) — server menghitung subtotal, diskon member, diskon voucher/promosi, total akhir, poin loyalitas, DAN memotong stok bahan baku berbasis resep default produk lewat deduct_recipe_stock_for_transaction(). Client TIDAK PERNAH mengirim harga/total/diskon, hanya product_id+qty.';


--
-- Name: close_shift(uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_shift(p_shift_id uuid, p_actual_cash numeric, p_notes text DEFAULT NULL::text) RETURNS TABLE(shift_id uuid, opening_cash numeric, expected_cash numeric, actual_cash numeric, difference numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_shift shifts%ROWTYPE;
  v_summary RECORD;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'Shift tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_shift.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan shift tenant Anda';
  END IF;
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'Shift ini sudah ditutup sebelumnya';
  END IF;
  IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
    RAISE EXCEPTION 'Actual Cash tidak valid';
  END IF;

  SELECT * INTO v_summary FROM shift_cash_summary(p_shift_id);

  UPDATE shifts SET
    status = 'closed',
    closed_at = now(),
    closed_by = auth.uid(),
    closing_cash_expected = v_summary.expected_cash,
    closing_cash_actual = p_actual_cash,
    cash_difference = p_actual_cash - v_summary.expected_cash,
    closing_notes = p_notes
  WHERE id = p_shift_id;

  RETURN QUERY
  SELECT v_shift.id, v_shift.opening_cash, v_summary.expected_cash, p_actual_cash,
         (p_actual_cash - v_summary.expected_cash);
END;
$$;


--
-- Name: compute_subscription_status(public.sub_status, timestamp with time zone, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_subscription_status(p_current_status public.sub_status, p_trial_ends_at timestamp with time zone, p_valid_until timestamp with time zone, p_super_trial_ends_at timestamp with time zone) RETURNS public.sub_status
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    -- Selama masih dalam window trial super (kode referral Super Admin),
    -- jangan sentuh status apa pun — tenant_tier() sudah menganggapnya
    -- 'supreme' terlepas dari nilai status ini.
    WHEN p_super_trial_ends_at IS NOT NULL AND p_super_trial_ends_at > now() THEN p_current_status
    WHEN p_current_status = 'trial' AND p_trial_ends_at IS NOT NULL AND p_trial_ends_at < now() THEN 'expired'::sub_status
    WHEN p_current_status = 'active' AND p_valid_until IS NOT NULL AND p_valid_until < now() - INTERVAL '3 days' THEN 'expired'::sub_status
    WHEN p_current_status = 'active' AND p_valid_until IS NOT NULL AND p_valid_until < now() THEN 'past_due'::sub_status
    WHEN p_current_status = 'past_due' AND p_valid_until IS NOT NULL AND p_valid_until < now() - INTERVAL '3 days' THEN 'expired'::sub_status
    -- Owner memperpanjang/membayar lagi (valid_until dimajukan lewat
    -- webhook Midtrans, yang juga sudah set status='active' langsung) —
    -- kalau baris ini tetap tersentuh trigger dengan valid_until di masa
    -- depan, pastikan tidak nyangkut di past_due/expired lama.
    WHEN p_current_status IN ('past_due', 'expired') AND p_valid_until IS NOT NULL AND p_valid_until >= now() THEN 'active'::sub_status
    ELSE p_current_status
  END;
$$;


--
-- Name: consume_recipe(uuid, uuid, uuid, uuid[], integer, text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_recipe(p_tenant_id uuid, p_branch_id uuid, p_recipe_id uuid, p_modifier_ids uuid[], p_qty integer, p_source_type text, p_source_id uuid, p_created_by uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_req RECORD;
  v_available NUMERIC;
  v_allow_negative BOOLEAN;
  v_recipe_version INT;
  v_ing_name TEXT;
BEGIN
  IF p_tenant_id IS DISTINCT FROM current_tenant_id() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Tenant tidak sesuai';
  END IF;

  SELECT allow_negative_ingredient_stock INTO v_allow_negative FROM tenants WHERE id = p_tenant_id;
  SELECT version INTO v_recipe_version FROM recipes WHERE id = p_recipe_id;

  -- Pass 1: lock + validasi SEMUA ingredient dulu, baru kurangi (all-or-nothing).
  FOR v_req IN
    SELECT r.ingredient_id, r.quantity * p_qty AS required_qty, r.unit
    FROM recipe_ingredient_requirements(p_recipe_id, p_modifier_ids) r
  LOOP
    INSERT INTO branch_ingredients_stock (tenant_id, branch_id, ingredient_id, stock_qty)
    VALUES (p_tenant_id, p_branch_id, v_req.ingredient_id, 0)
    ON CONFLICT (branch_id, ingredient_id) DO NOTHING;

    SELECT stock_qty INTO v_available
    FROM branch_ingredients_stock
    WHERE branch_id = p_branch_id AND ingredient_id = v_req.ingredient_id
    FOR UPDATE;

    IF COALESCE(v_available, 0) < v_req.required_qty AND NOT COALESCE(v_allow_negative, false) THEN
      SELECT name INTO v_ing_name FROM ingredients WHERE id = v_req.ingredient_id;
      RAISE EXCEPTION 'Stok % tidak cukup (tersedia %, butuh %)', v_ing_name, COALESCE(v_available, 0), v_req.required_qty;
    END IF;
  END LOOP;

  -- Pass 2: deduct + log.
  FOR v_req IN
    SELECT r.ingredient_id, r.quantity * p_qty AS required_qty, r.unit
    FROM recipe_ingredient_requirements(p_recipe_id, p_modifier_ids) r
  LOOP
    UPDATE branch_ingredients_stock
    SET stock_qty = stock_qty - v_req.required_qty, updated_at = now()
    WHERE branch_id = p_branch_id AND ingredient_id = v_req.ingredient_id;

    INSERT INTO ingredient_stock_movements (tenant_id, branch_id, ingredient_id, type, qty_change, unit, note, created_by)
    VALUES (p_tenant_id, p_branch_id, v_req.ingredient_id, 'RECIPE_CONSUMPTION', -v_req.required_qty, v_req.unit,
            'Konsumsi resep dari ' || p_source_type || ' ' || p_source_id::TEXT, p_created_by);

    INSERT INTO recipe_consumption_logs (
      tenant_id, branch_id, source_type, source_id, recipe_id, recipe_version,
      ingredient_id, quantity, unit, cost_snapshot
    )
    SELECT p_tenant_id, p_branch_id, p_source_type, p_source_id, p_recipe_id, v_recipe_version,
           v_req.ingredient_id, v_req.required_qty, v_req.unit,
           v_req.required_qty * COALESCE(
             (SELECT cost_price FROM branch_ingredients_stock WHERE branch_id = p_branch_id AND ingredient_id = v_req.ingredient_id), 0);
  END LOOP;

  RETURN TRUE;
END;
$$;


--
-- Name: convert_unit(uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_unit(p_tenant_id uuid, p_qty numeric, p_from_unit text, p_to_unit text) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_factor NUMERIC;
BEGIN
  IF p_from_unit = p_to_unit THEN
    RETURN p_qty;
  END IF;

  SELECT factor INTO v_factor FROM unit_conversions
  WHERE tenant_id = p_tenant_id AND from_unit = p_from_unit AND to_unit = p_to_unit;

  IF v_factor IS NULL THEN
    SELECT factor INTO v_factor FROM unit_conversions
    WHERE tenant_id IS NULL AND from_unit = p_from_unit AND to_unit = p_to_unit;
  END IF;

  IF v_factor IS NULL THEN
    RAISE EXCEPTION 'Konversi unit % -> % belum dikonfigurasi', p_from_unit, p_to_unit;
  END IF;

  RETURN p_qty * v_factor;
END;
$$;


--
-- Name: create_branch(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_branch(p_name text, p_address text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tenant_id UUID;
  v_branch_id UUID;
BEGIN
  IF NOT is_owner() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Owner yang boleh menambah cabang.';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Nama cabang wajib diisi.';
  END IF;

  v_tenant_id := current_tenant_id();

  INSERT INTO branches (tenant_id, name, address, is_main, is_active)
    VALUES (v_tenant_id, trim(p_name), NULLIF(trim(coalesce(p_address, '')), ''), false, true)
    RETURNING id INTO v_branch_id;

  RETURN v_branch_id;
END;
$$;


--
-- Name: create_kitchen_order(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_kitchen_order(p_tenant_id uuid, p_branch_id uuid, p_shift_id uuid, p_cashier_id uuid, p_order_type text, p_table_number text, p_customer_name text, p_notes text, p_items jsonb, p_table_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_item JSONB;
  v_product products%ROWTYPE;
  v_variant product_variants%ROWTYPE;
  v_mod modifiers%ROWTYPE;
  v_qty INT;
  v_order_id UUID;
  v_order_number TEXT;
  v_seq INT;
  v_table branch_tables%ROWTYPE;
  v_resolved_table_number TEXT;
  v_variant_id UUID;
  v_variant_name TEXT;
  v_unit_price NUMERIC;
  v_modifier_ids UUID[];
  v_modifier_selections JSONB;
  v_recipe_id UUID;
  v_recipe_version INT;
  v_order_item_id UUID;
BEGIN
  IF NOT is_super_admin() AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: bukan anggota tenant ini';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Pesanan kosong';
  END IF;

  IF p_order_type NOT IN ('dine_in', 'takeaway', 'delivery') THEN
    RAISE EXCEPTION 'Tipe pesanan tidak valid';
  END IF;

  v_resolved_table_number := NULLIF(trim(p_table_number), '');

  IF p_table_id IS NOT NULL THEN
    SELECT * INTO v_table FROM branch_tables WHERE id = p_table_id FOR UPDATE;

    IF v_table.id IS NULL OR NOT v_table.is_active THEN
      RAISE EXCEPTION 'TABLE_NOT_FOUND: Meja tidak ditemukan atau tidak aktif';
    END IF;

    IF v_table.tenant_id <> p_tenant_id OR v_table.branch_id <> p_branch_id THEN
      RAISE EXCEPTION 'Akses ditolak: meja bukan milik cabang ini';
    END IF;

    IF EXISTS (
      SELECT 1 FROM orders o
      WHERE o.table_id = p_table_id AND o.status NOT IN ('COMPLETED', 'CANCELLED')
    ) THEN
      RAISE EXCEPTION 'TABLE_OCCUPIED: Meja % sedang digunakan', v_table.table_number;
    END IF;

    IF v_table.needs_cleaning THEN
      RAISE EXCEPTION 'TABLE_CLEANING: Meja % masih menunggu dibersihkan', v_table.table_number;
    END IF;

    v_resolved_table_number := v_table.table_number;
  END IF;

  IF p_order_type = 'dine_in' AND p_table_id IS NULL AND v_resolved_table_number IS NULL THEN
    RAISE EXCEPTION 'Pesanan dine-in wajib memilih meja';
  END IF;

  SELECT COUNT(*) + 1 INTO v_seq FROM orders
    WHERE branch_id = p_branch_id AND created_at::date = CURRENT_DATE;
  v_order_number := 'ORD-' || lpad(v_seq::text, 3, '0');

  v_order_id := gen_random_uuid();

  INSERT INTO orders (
    id, tenant_id, branch_id, shift_id, cashier_id, order_number,
    order_type, table_id, table_number, customer_name, status, notes
  ) VALUES (
    v_order_id, p_tenant_id, p_branch_id, p_shift_id, p_cashier_id, v_order_number,
    p_order_type, p_table_id, v_resolved_table_number, NULLIF(trim(p_customer_name), ''), 'NEW', p_notes
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::INT;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 500 THEN
      RAISE EXCEPTION 'Qty item tidak valid';
    END IF;

    SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::UUID AND tenant_id = p_tenant_id;
    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Produk tidak ditemukan';
    END IF;

    -- ---- BARU (Migrasi 019): varian terstruktur, opsional ----
    v_variant_id := NULLIF(v_item->>'variant_id', '')::UUID;
    v_variant_name := NULL;
    v_unit_price := v_product.price;

    IF v_variant_id IS NOT NULL THEN
      SELECT * INTO v_variant FROM product_variants
        WHERE id = v_variant_id AND product_id = v_product.id AND is_available = true;
      IF v_variant.id IS NULL THEN
        RAISE EXCEPTION 'Varian produk tidak ditemukan atau tidak tersedia';
      END IF;
      v_unit_price := v_variant.price;
      v_variant_name := v_variant.name;
    END IF;

    -- ---- BARU (Migrasi 019): modifier terstruktur, opsional ----
    v_modifier_ids := NULL;
    v_modifier_selections := '[]'::jsonb;

    IF jsonb_typeof(v_item->'modifier_ids') = 'array' AND jsonb_array_length(v_item->'modifier_ids') > 0 THEN
      SELECT array_agg(elem::UUID) INTO v_modifier_ids
      FROM jsonb_array_elements_text(v_item->'modifier_ids') elem;

      -- Semua id yang dikirim harus benar-benar ada, tersedia, DAN terpasang
      -- ke produk ini lewat product_modifier_groups (mencegah kasir/klien
      -- menambahkan modifier produk lain untuk memanipulasi harga/resep).
      IF (
        SELECT COUNT(*) FROM modifiers m
        JOIN product_modifier_groups pmg ON pmg.modifier_group_id = m.modifier_group_id
        WHERE m.id = ANY(v_modifier_ids) AND m.is_available = true AND pmg.product_id = v_product.id
      ) <> array_length(v_modifier_ids, 1) THEN
        RAISE EXCEPTION 'Salah satu modifier tidak valid untuk produk ini';
      END IF;

      FOR v_mod IN SELECT * FROM modifiers WHERE id = ANY(v_modifier_ids) LOOP
        v_unit_price := v_unit_price + v_mod.price_adjustment;
        v_modifier_selections := v_modifier_selections || jsonb_build_object(
          'modifier_id', v_mod.id, 'name', v_mod.name, 'price_adjustment', v_mod.price_adjustment
        );
      END LOOP;
    END IF;

    -- ---- BARU (Migrasi 019): snapshot resep aktif produk/varian ----
    v_recipe_id := resolve_active_recipe(v_product.id, v_variant_id);
    v_recipe_version := NULL;
    IF v_recipe_id IS NOT NULL THEN
      SELECT version INTO v_recipe_version FROM recipes WHERE id = v_recipe_id;
    END IF;

    INSERT INTO order_items (
      order_id, product_id, station_id, product_name, variant_notes, qty, unit_price, subtotal,
      variant_id, variant_name, modifier_selections, recipe_id, recipe_version
    ) VALUES (
      v_order_id, v_product.id, v_product.station_id, v_product.name, NULLIF(v_item->>'variant_notes', ''),
      v_qty, v_unit_price, v_unit_price * v_qty,
      v_variant_id, v_variant_name, v_modifier_selections, v_recipe_id, v_recipe_version
    ) RETURNING id INTO v_order_item_id;

    IF v_modifier_ids IS NOT NULL THEN
      INSERT INTO order_item_modifiers (order_item_id, modifier_id, name, price_adjustment)
      SELECT v_order_item_id, m.id, m.name, m.price_adjustment
      FROM modifiers m WHERE m.id = ANY(v_modifier_ids);
    END IF;
  END LOOP;

  RETURN v_order_id;
END;
$$;


--
-- Name: FUNCTION create_kitchen_order(p_tenant_id uuid, p_branch_id uuid, p_shift_id uuid, p_cashier_id uuid, p_order_type text, p_table_number text, p_customer_name text, p_notes text, p_items jsonb, p_table_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_kitchen_order(p_tenant_id uuid, p_branch_id uuid, p_shift_id uuid, p_cashier_id uuid, p_order_type text, p_table_number text, p_customer_name text, p_notes text, p_items jsonb, p_table_id uuid) IS 'Phase 2 Update 1 + Migrasi 019: menerima p_table_id untuk assignment meja (row-lock, cek occupied/cleaning), DAN sekarang tiap item di p_items boleh menyertakan "variant_id"/"modifier_ids" opsional untuk mengaitkan order_items ke product_variants/modifiers/recipes secara terstruktur. Item tanpa kedua field itu berperilaku identik dengan sebelum Migrasi 019 (backward compatible).';


--
-- Name: create_main_branch_for_tenant(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_main_branch_for_tenant() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO branches (tenant_id, name, is_main, is_active)
    VALUES (NEW.id, 'Cabang Utama', true, true);
  RETURN NEW;
END;
$$;


--
-- Name: create_online_order(uuid, uuid, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_online_order(p_tenant_id uuid, p_branch_id uuid, p_channel text, p_customer_name text, p_notes text, p_items jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_item JSONB;
  v_product products%ROWTYPE;
  v_qty INT;
  v_unit_price NUMERIC;
  v_commission_pct NUMERIC;
  v_order_id UUID;
  v_order_number TEXT;
  v_seq INT;
  v_commission_total NUMERIC := 0;
BEGIN
  IF NOT is_super_admin() AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: bukan anggota tenant ini';
  END IF;

  IF p_channel NOT IN ('gofood', 'grabfood', 'shopeefood', 'website') THEN
    RAISE EXCEPTION 'Kanal tidak valid';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Pesanan kosong';
  END IF;

  SELECT COUNT(*) + 1 INTO v_seq FROM orders
    WHERE branch_id = p_branch_id AND created_at::date = CURRENT_DATE;
  v_order_number := upper(left(p_channel, 2)) || '-' || lpad(v_seq::text, 3, '0');
  v_order_id := gen_random_uuid();

  INSERT INTO orders (
    id, tenant_id, branch_id, order_number, order_type, customer_name, status, notes, channel
  ) VALUES (
    v_order_id, p_tenant_id, p_branch_id, v_order_number, 'delivery',
    NULLIF(trim(p_customer_name), ''), 'NEW', p_notes, p_channel
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::INT;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 500 THEN
      RAISE EXCEPTION 'Qty item tidak valid';
    END IF;

    SELECT * INTO v_product FROM products
      WHERE id = (v_item->>'product_id')::UUID AND tenant_id = p_tenant_id AND is_available = true;
    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Produk tidak ditemukan atau tidak tersedia';
    END IF;

    v_unit_price := get_channel_price(v_product.id, p_channel);

    SELECT COALESCE(commission_pct, 0) INTO v_commission_pct FROM channel_pricings
      WHERE product_id = v_product.id AND channel = p_channel AND is_active = true;
    v_commission_pct := COALESCE(v_commission_pct, 0);

    INSERT INTO order_items (order_id, product_id, station_id, product_name, qty, unit_price, subtotal)
      VALUES (v_order_id, v_product.id, v_product.station_id, v_product.name, v_qty, v_unit_price, v_unit_price * v_qty);

    v_commission_total := v_commission_total + (v_unit_price * v_qty * v_commission_pct / 100);
  END LOOP;

  UPDATE orders SET channel_commission_amount = round(v_commission_total) WHERE id = v_order_id;

  RETURN v_order_id;
END;
$$;


--
-- Name: create_reservation(uuid, text, text, timestamp with time zone, integer, numeric, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_reservation(p_branch_id uuid, p_customer_name text, p_customer_phone text, p_reservation_at timestamp with time zone, p_party_size integer, p_deposit_amount numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_table_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_branch branches%ROWTYPE;
  v_is_staff BOOLEAN;
  v_reservation_id UUID;
  v_status TEXT := 'pending';
BEGIN
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id AND is_active = true;
  IF v_branch.id IS NULL THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan';
  END IF;

  IF p_customer_name IS NULL OR trim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'Nama pelanggan wajib diisi';
  END IF;
  IF p_customer_phone IS NULL OR trim(p_customer_phone) = '' THEN
    RAISE EXCEPTION 'No. WhatsApp wajib diisi';
  END IF;
  IF p_party_size IS NULL OR p_party_size <= 0 THEN
    RAISE EXCEPTION 'Jumlah tamu tidak valid';
  END IF;
  IF p_reservation_at IS NULL OR p_reservation_at < now() - INTERVAL '1 hour' THEN
    RAISE EXCEPTION 'Tanggal & jam reservasi tidak valid';
  END IF;

  v_is_staff := is_super_admin() OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = v_branch.tenant_id AND role IN ('owner', 'manager'))
  );

  -- Staff (Manager/Owner) yang input langsung -> otomatis 'confirmed'.
  -- Pelanggan lewat form publik -> 'pending' menunggu konfirmasi staff.
  IF v_is_staff THEN
    v_status := 'confirmed';
  END IF;

  IF p_table_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM branch_tables WHERE id = p_table_id AND branch_id = p_branch_id) THEN
      RAISE EXCEPTION 'Meja tidak ditemukan di cabang ini';
    END IF;
  END IF;

  INSERT INTO reservations (
    id, tenant_id, branch_id, table_id, customer_name, customer_phone,
    party_size, reservation_at, deposit_amount, status, notes, created_by
  ) VALUES (
    gen_random_uuid(), v_branch.tenant_id, p_branch_id, p_table_id, trim(p_customer_name), trim(p_customer_phone),
    p_party_size, p_reservation_at, COALESCE(p_deposit_amount, 0), v_status, p_notes,
    CASE WHEN v_is_staff THEN auth.uid() ELSE NULL END
  ) RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$$;


--
-- Name: current_branch_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_branch_id() RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT branch_id FROM profiles WHERE id = auth.uid();
$$;


--
-- Name: current_tenant_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_tenant_id() RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid() AND is_active = true;
$$;


--
-- Name: deduct_recipe_stock(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deduct_recipe_stock(p_order_id uuid) RETURNS TABLE(order_item_id uuid, deducted boolean, reason text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_branch_id UUID;
  v_item RECORD;
  v_recipe_id UUID;
  v_modifier_ids UUID[];
  v_effective_qty INT;
  v_already BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pesanan tidak ditemukan';
  END IF;

  IF NOT is_super_admin() AND v_order.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan pesanan tenant Anda';
  END IF;

  -- "COMPLETED atau PAID" (poin 2) — di caPOS, order dianggap lunas begitu
  -- statusnya COMPLETED (diset checkout_order_v2() bersamaan dengan
  -- transaction_id terisi). Tidak ada status literal "PAID" terpisah di
  -- tabel orders; QR Self-Order yang sudah dibayar duluan (mark_qr_order_paid)
  -- tetap berujung ke COMPLETED lewat checkout_order_v2() yang sama saat
  -- transaksi benar-benar dibuat, jadi satu pintu ini cukup.
  IF v_order.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'Pesanan belum berstatus COMPLETED (status saat ini: %)', v_order.status;
  END IF;

  v_branch_id := COALESCE(v_order.branch_id, main_branch_id(v_order.tenant_id));

  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    order_item_id := v_item.id;
    v_effective_qty := v_item.qty - v_item.voided_qty;

    IF v_effective_qty <= 0 THEN
      deducted := false; reason := 'VOIDED'; RETURN NEXT; CONTINUE;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM recipe_consumption_logs
      WHERE source_type = 'order_item' AND source_id = v_item.id
    ) INTO v_already;

    IF v_already THEN
      deducted := false; reason := 'ALREADY_DEDUCTED'; RETURN NEXT; CONTINUE;
    END IF;

    -- Resolusi resep: pakai snapshot recipe_id yang dicatat saat order
    -- dibuat (create_kitchen_order) kalau ada; fallback ke resep aktif
    -- product/variant SAAT INI untuk order_item lama yang dibuat sebelum
    -- migrasi ini ada (snapshot-nya masih NULL).
    v_recipe_id := COALESCE(v_item.recipe_id, resolve_active_recipe(v_item.product_id, v_item.variant_id));

    IF v_recipe_id IS NULL THEN
      deducted := false; reason := 'NO_RECIPE'; RETURN NEXT; CONTINUE;
    END IF;

    -- Modifier terpilih: utamakan order_item_modifiers (ternormalisasi,
    -- baru); fallback ke snapshot JSONB modifier_selections untuk baris
    -- lama yang dibuat sebelum tabel order_item_modifiers ada.
    SELECT array_agg(modifier_id) INTO v_modifier_ids
    FROM order_item_modifiers WHERE order_item_modifiers.order_item_id = v_item.id;

    IF v_modifier_ids IS NULL THEN
      SELECT array_agg((x->>'modifier_id')::UUID) INTO v_modifier_ids
      FROM jsonb_array_elements(v_item.modifier_selections) x
      WHERE x->>'modifier_id' IS NOT NULL;
    END IF;

    PERFORM consume_recipe(
      v_order.tenant_id, v_branch_id, v_recipe_id, COALESCE(v_modifier_ids, '{}'::UUID[]),
      v_effective_qty, 'order_item', v_item.id, v_order.cashier_id
    );

    deducted := true; reason := 'OK'; RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;


--
-- Name: FUNCTION deduct_recipe_stock(p_order_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.deduct_recipe_stock(p_order_id uuid) IS 'Migrasi 019. Potong branch_ingredients_stock berdasar recipe+modifier tiap order_item pada sebuah order COMPLETED, dan catat ke stock_movements-nya-ingredient (ingredient_stock_movements) + recipe_consumption_logs. Idempotent & fallback aman untuk produk tanpa resep. Dipanggil otomatis oleh checkout_order_v2(); bisa juga dipanggil manual (mis. via API route) untuk order lama.';


--
-- Name: deduct_recipe_stock_for_transaction(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deduct_recipe_stock_for_transaction(p_transaction_id uuid) RETURNS TABLE(transaction_item_id uuid, deducted boolean, reason text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tx transactions%ROWTYPE;
  v_branch_id UUID;
  v_item RECORD;
  v_recipe_id UUID;
  v_already BOOLEAN;
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;

  IF NOT is_super_admin() AND v_tx.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan transaksi tenant Anda';
  END IF;

  v_branch_id := COALESCE(v_tx.branch_id, main_branch_id(v_tx.tenant_id));

  FOR v_item IN SELECT * FROM transaction_items WHERE transaction_id = p_transaction_id LOOP
    transaction_item_id := v_item.id;

    SELECT EXISTS(
      SELECT 1 FROM recipe_consumption_logs
      WHERE source_type = 'transaction_item' AND source_id = v_item.id
    ) INTO v_already;

    IF v_already THEN
      deducted := false; reason := 'ALREADY_DEDUCTED'; RETURN NEXT; CONTINUE;
    END IF;

    v_recipe_id := COALESCE(v_item.recipe_id, resolve_active_recipe(v_item.product_id, v_item.variant_id));

    IF v_recipe_id IS NULL THEN
      deducted := false; reason := 'NO_RECIPE'; RETURN NEXT; CONTINUE;
    END IF;

    PERFORM consume_recipe(
      v_tx.tenant_id, v_branch_id, v_recipe_id, '{}'::UUID[],
      v_item.qty, 'transaction_item', v_item.id, v_tx.cashier_id
    );

    deducted := true; reason := 'OK'; RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;


--
-- Name: FUNCTION deduct_recipe_stock_for_transaction(p_transaction_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.deduct_recipe_stock_for_transaction(p_transaction_id uuid) IS 'Migrasi 019. Padanan deduct_recipe_stock() untuk alur checkout_transaction() (kasir cepat tanpa tiket dapur). Dipanggil otomatis di akhir checkout_transaction().';


--
-- Name: earn_loyalty_points(uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.earn_loyalty_points(p_transaction_id uuid, p_customer_id uuid, p_points integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_customer customers%ROWTYPE;
  v_transaction transactions%ROWTYPE;
  v_config loyalty_config%ROWTYPE;
  v_current_balance INT;
  v_expiry_date DATE;
BEGIN
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
  IF v_customer.id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_transaction FROM transactions WHERE id = p_transaction_id;
  IF v_transaction.id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_config FROM loyalty_config WHERE tenant_id = v_customer.tenant_id;
  
  -- Hitung saldo poin sebelumnya
  SELECT COALESCE(SUM(CASE WHEN transaction_type IN ('EARN', 'ADJUST') THEN points_amount ELSE -points_amount END), 0)
  INTO v_current_balance FROM loyalty_points_log WHERE customer_id = p_customer_id;

  v_current_balance := v_current_balance + p_points;
  v_expiry_date := CURRENT_DATE + INTERVAL '1 day' * v_config.points_expiry_days;

  -- Insert loyalty log
  INSERT INTO loyalty_points_log (
    tenant_id, customer_id, transaction_id, transaction_type, points_amount,
    description, balance_after, expiry_date
  ) VALUES (
    v_customer.tenant_id, p_customer_id, p_transaction_id, 'EARN', p_points,
    'Poin dari transaksi #' || v_transaction.invoice_number,
    v_current_balance, v_expiry_date
  );

  RETURN TRUE;
END;
$$;


--
-- Name: enforce_branch_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_branch_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tier TEXT;
  v_count INT;
BEGIN
  v_tier := tenant_tier(NEW.tenant_id);
  SELECT COUNT(*) INTO v_count FROM branches WHERE tenant_id = NEW.tenant_id;

  IF v_tier = 'free' AND v_count >= 1 THEN
    RAISE EXCEPTION 'FREE_TIER_BRANCH_LIMIT: Paket Free Trial maksimal 1 cabang. Upgrade ke Pro (3 cabang) atau Supreme (unlimited).';
  ELSIF v_tier = 'pro' AND v_count >= 3 THEN
    RAISE EXCEPTION 'PRO_TIER_BRANCH_LIMIT: Paket Pro maksimal 3 cabang. Upgrade ke Supreme untuk cabang tanpa batas.';
  END IF;
  -- v_tier = 'supreme' -> tidak ada batas.

  RETURN NEW;
END;
$$;


--
-- Name: enforce_cashier_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_cashier_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count INT;
BEGIN
  -- Limit "2 karyawan tambahan" berlaku untuk role cashier MAUPUN manager
  -- — keduanya dihitung sebagai "karyawan tambahan" di luar owner.
  IF NEW.role NOT IN ('cashier', 'manager') THEN
    RETURN NEW;
  END IF;

  IF tenant_tier(NEW.tenant_id) = 'free' THEN
    SELECT COUNT(*) INTO v_count FROM profiles
      WHERE tenant_id = NEW.tenant_id AND role IN ('cashier', 'manager') AND is_active = true;
    IF v_count >= 2 THEN
      RAISE EXCEPTION 'FREE_TIER_CASHIER_LIMIT: Paket Free Trial maksimal 2 akun karyawan aktif (kasir/manager). Nonaktifkan karyawan lama atau upgrade ke Pro untuk tambah karyawan.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_menu_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_menu_limit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count INT;
BEGIN
  IF tenant_tier(NEW.tenant_id) = 'free' THEN
    SELECT COUNT(*) INTO v_count FROM products WHERE tenant_id = NEW.tenant_id;
    IF v_count >= 10 THEN
      RAISE EXCEPTION 'FREE_TIER_MENU_LIMIT: Paket Free Trial maksimal 10 menu. Upgrade ke Pro untuk menu unlimited.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: enforce_recipe_product_stock_purity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_recipe_product_stock_purity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.stock_mode = 'recipe' AND NEW.track_stock = true THEN
    RAISE EXCEPTION 'RECIPE_PRODUCT_STOCK_LOCKED: Produk ini punya resep aktif (made-to-order) — '
      'stoknya otomatis mengikuti ketersediaan bahan baku dan tidak boleh dilacak manual. '
      'Kelola stoknya lewat halaman Bahan Baku/Stok Opname, bukan track_stock produk.';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: enforce_subscription_cutoff(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_subscription_cutoff() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_status sub_status;
BEGIN
  SELECT status INTO v_status FROM subscriptions WHERE tenant_id = NEW.tenant_id;

  IF v_status = 'expired' THEN
    RAISE EXCEPTION 'SUBSCRIPTION_EXPIRED: Langganan kafe ini sudah kedaluwarsa. Perpanjang paket di '
      'Dashboard > Status Langganan untuk bisa melakukan transaksi kembali.';
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION enforce_subscription_cutoff(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.enforce_subscription_cutoff() IS 'migration_16 (bagian F, Auto-Cutoff). Menolak transaksi penjualan baru begitu status subscriptions tenant = expired. Dipasang di tabel transactions (bukan mengubah fungsi checkout_transaction) supaya berlaku untuk semua jalur checkout tanpa menyentuh RPC yang sudah ada.';


--
-- Name: generate_branch_slug(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_branch_slug(p_name text, p_branch_id uuid DEFAULT NULL::uuid) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_base TEXT;
  v_candidate TEXT;
  v_exists BOOLEAN;
BEGIN
  v_base := NULLIF(slugify(p_name), '');
  IF v_base IS NULL THEN
    v_base := 'cabang';
  END IF;
  v_candidate := v_base;

  LOOP
    SELECT EXISTS (
      SELECT 1 FROM branches WHERE slug = v_candidate AND id IS DISTINCT FROM p_branch_id
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
    v_candidate := v_base || '-' || lower(substr(md5(gen_random_uuid()::text), 1, 4));
  END LOOP;

  RETURN v_candidate;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid,
    category_id uuid NOT NULL,
    amount numeric NOT NULL,
    description text,
    expense_date date DEFAULT CURRENT_DATE NOT NULL,
    attachment_url text,
    is_recurring boolean DEFAULT false NOT NULL,
    recurrence_frequency text,
    recurrence_end_date date,
    source_recurring_expense_id uuid,
    status text DEFAULT 'PENDING'::text NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    voided_at timestamp with time zone,
    voided_by uuid,
    void_reason text,
    CONSTRAINT chk_recurrence_fields CHECK (((is_recurring = false) OR ((is_recurring = true) AND (recurrence_frequency IS NOT NULL)))),
    CONSTRAINT expenses_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT expenses_recurrence_frequency_check CHECK ((recurrence_frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'yearly'::text]))),
    CONSTRAINT expenses_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])))
);


--
-- Name: TABLE expenses; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.expenses IS 'Operational expenses (rule #7). Tidak pernah di-hard-delete — pembatalan pakai voided_at/voided_by/void_reason. Baris dengan is_recurring=true berfungsi sebagai template, bukan transaksi aktual.';


--
-- Name: generate_recurring_expenses(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_recurring_expenses(p_tenant_id uuid) RETURNS SETOF public.expenses
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_template expenses%ROWTYPE;
  v_next_date DATE;
  v_new_row expenses%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles
    -- BUG FIX (Phase A final): original checked role IN ('owner','admin'), but
    -- 'admin' is not a member of the user_role enum, which raised
    -- "invalid input value for enum user_role" on every call regardless of caller.
    WHERE id = auth.uid() AND tenant_id = p_tenant_id AND role IN ('owner', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: hanya owner/admin yang dapat generate recurring expenses';
  END IF;

  FOR v_template IN
    SELECT * FROM expenses
    WHERE tenant_id = p_tenant_id
      AND is_recurring = true
      AND voided_at IS NULL
      AND (recurrence_end_date IS NULL OR recurrence_end_date >= current_date)
  LOOP
    v_next_date := (CASE v_template.recurrence_frequency
      WHEN 'daily' THEN v_template.expense_date + INTERVAL '1 day'
      WHEN 'weekly' THEN v_template.expense_date + INTERVAL '1 week'
      WHEN 'monthly' THEN v_template.expense_date + INTERVAL '1 month'
      WHEN 'yearly' THEN v_template.expense_date + INTERVAL '1 year'
    END)::date;

    -- Hindari duplikasi kalau fungsi ini dipanggil lebih dari sekali
    -- untuk periode yang sama (idempotency, rule #39).
    IF EXISTS (
      SELECT 1 FROM expenses
      WHERE source_recurring_expense_id = v_template.id
        AND expense_date = v_next_date
    ) THEN
      CONTINUE;
    END IF;

    IF v_next_date > current_date THEN
      CONTINUE;
    END IF;

    INSERT INTO expenses (
      tenant_id, branch_id, category_id, amount, description, expense_date,
      is_recurring, source_recurring_expense_id, status, created_by
    ) VALUES (
      v_template.tenant_id, v_template.branch_id, v_template.category_id,
      v_template.amount, v_template.description, v_next_date,
      false, v_template.id, 'PENDING', auth.uid()
    ) RETURNING * INTO v_new_row;

    RETURN NEXT v_new_row;
  END LOOP;

  RETURN;
END;
$$;


--
-- Name: FUNCTION generate_recurring_expenses(p_tenant_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.generate_recurring_expenses(p_tenant_id uuid) IS 'Membuat instance expense baru dari template recurring yang jatuh tempo. Setiap instance tetap PENDING dan butuh approval terpisah — tidak auto-approved.';


--
-- Name: get_branch_public_info(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_branch_public_info(p_branch_slug text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_branch branches%ROWTYPE;
BEGIN
  SELECT * INTO v_branch FROM branches WHERE slug = p_branch_slug AND is_active = true;
  IF v_branch.id IS NULL THEN
    RETURN jsonb_build_object('error', 'branch_not_found');
  END IF;

  RETURN jsonb_build_object(
    'id', v_branch.id, 'name', v_branch.name, 'address', v_branch.address, 'slug', v_branch.slug
  );
END;
$$;


--
-- Name: get_channel_price(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_channel_price(p_product_id uuid, p_channel text) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT round(p.price * (1 + COALESCE(cp.markup_pct, 0) / 100))
  FROM products p
  LEFT JOIN channel_pricings cp
    ON cp.product_id = p.id AND cp.channel = p_channel AND cp.is_active = true
  WHERE p.id = p_product_id;
$$;


--
-- Name: get_qr_order_page(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_qr_order_page(p_branch_slug text, p_table_number text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_branch branches%ROWTYPE;
  v_table branch_tables%ROWTYPE;
  v_result JSONB;
BEGIN
  SELECT * INTO v_branch FROM branches WHERE slug = p_branch_slug AND is_active = true;
  IF v_branch.id IS NULL THEN
    RETURN jsonb_build_object('error', 'branch_not_found');
  END IF;

  SELECT * INTO v_table FROM branch_tables
    WHERE branch_id = v_branch.id AND table_number = p_table_number AND is_active = true;
  IF v_table.id IS NULL THEN
    RETURN jsonb_build_object('error', 'table_not_found');
  END IF;

  SELECT jsonb_build_object(
    'branch', jsonb_build_object(
      'name', v_branch.name, 'slug', v_branch.slug, 'address', v_branch.address,
      -- BARU (Migrasi 020) — hanya dipakai sebagai nama topik broadcast
      -- realtime ketersediaan menu, bukan untuk query apa pun di klien.
      'tenant_id', v_branch.tenant_id
    ),
    'table', jsonb_build_object('id', v_table.id, 'table_number', v_table.table_number, 'capacity', v_table.capacity),
    'products', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id, 'name', p.name, 'price', p.price,
          'category', COALESCE(p.category, 'Lainnya'), 'image_url', p.image_url
        )
        ORDER BY p.category NULLS LAST, p.name
      )
      FROM products p WHERE p.tenant_id = v_branch.tenant_id AND p.is_available = true
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;


--
-- Name: FUNCTION get_qr_order_page(p_branch_slug text, p_table_number text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_qr_order_page(p_branch_slug text, p_table_number text) IS 'Migrasi 020: sama seperti sebelumnya (migration_014) + field branch.tenant_id, dipakai SelfOrderClient.tsx sebagai nama topik broadcast realtime.products-<tenant_id> untuk menerima notifikasi Sold Out/Menu 86 secara instan.';


--
-- Name: get_qr_order_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_qr_order_status(p_qr_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'order_number', o.order_number,
    'table_number', o.table_number,
    'status', o.status,
    'payment_method', q.payment_method,
    'payment_status', q.payment_status,
    'total_amount', q.total_amount,
    'created_at', o.created_at,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_name', oi.product_name, 'qty', oi.qty,
        'variant_notes', oi.variant_notes, 'subtotal', oi.subtotal
      ))
      FROM order_items oi WHERE oi.order_id = o.id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM qr_orders q
  JOIN orders o ON o.id = q.order_id
  WHERE q.id = p_qr_order_id;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  RETURN v_result;
END;
$$;


--
-- Name: get_reservation_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_reservation_status(p_reservation_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'customer_name', r.customer_name, 'reservation_at', r.reservation_at,
    'party_size', r.party_size, 'status', r.status, 'deposit_amount', r.deposit_amount,
    'deposit_status', r.deposit_status
  ) INTO v_result
  FROM reservations r WHERE r.id = p_reservation_id;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  RETURN v_result;
END;
$$;


--
-- Name: growth_summary(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.growth_summary(p_tenant_id uuid) RETURNS TABLE(total_customers bigint, repeat_customers bigint, repeat_visit_rate numeric, avg_ltv numeric, inactive_customers_count bigint)
    LANGUAGE sql STABLE
    AS $$
  SELECT
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE is_repeat_customer)::BIGINT,
    ROUND(COALESCE(COUNT(*) FILTER (WHERE is_repeat_customer)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 0), 1),
    ROUND(COALESCE(AVG(lifetime_value), 0), 0),
    COUNT(*) FILTER (WHERE days_since_last_visit > 30)::BIGINT
  FROM customer_visit_stats
  WHERE tenant_id = p_tenant_id;
$$;


--
-- Name: is_ingredient_available(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_ingredient_available(p_ingredient_id uuid, p_branch_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT
    (SELECT status = 'active' AND NOT is_86 FROM ingredients WHERE id = p_ingredient_id)
    AND COALESCE(
      (SELECT stock_qty > 0 FROM branch_ingredients_stock WHERE ingredient_id = p_ingredient_id AND branch_id = p_branch_id),
      false
    );
$$;


--
-- Name: is_manager_or_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_manager_or_owner() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'manager')
  );
$$;


--
-- Name: is_modifier_available(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_modifier_available(p_modifier_id uuid, p_branch_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT
    m.is_available AND NOT EXISTS (
      SELECT 1 FROM modifier_ingredient_impacts mii
      WHERE mii.modifier_id = m.id AND mii.quantity_delta > 0
        AND NOT is_ingredient_available(mii.ingredient_id, p_branch_id)
    )
  FROM modifiers m WHERE m.id = p_modifier_id;
$$;


--
-- Name: is_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_owner() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner');
$$;


--
-- Name: is_product_available_at_branch(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_product_available_at_branch(p_product_id uuid, p_variant_id uuid, p_branch_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT
    COALESCE((SELECT is_available FROM products WHERE id = p_product_id), true)
    AND NOT EXISTS (
      SELECT 1 FROM recipe_items ri
      WHERE ri.recipe_id = resolve_active_recipe(p_product_id, p_variant_id)
        AND NOT is_ingredient_available(ri.ingredient_id, p_branch_id)
    );
$$;


--
-- Name: FUNCTION is_product_available_at_branch(p_product_id uuid, p_variant_id uuid, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_product_available_at_branch(p_product_id uuid, p_variant_id uuid, p_branch_id uuid) IS 'Final Availability = Manual Availability (products.is_available) AND Ingredient Availability (semua ingredient recipe aktif tersedia). Query ini, jangan tulis ulang products.is_available.';


--
-- Name: is_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  );
$$;


--
-- Name: main_branch_id(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.main_branch_id(p_tenant_id uuid) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT id FROM branches WHERE tenant_id = p_tenant_id AND is_main = true LIMIT 1;
$$;


--
-- Name: mark_bill_printed(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_bill_printed(p_order_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pesanan tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_order.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan pesanan tenant Anda';
  END IF;
  IF v_order.order_type <> 'dine_in' OR v_order.table_id IS NULL THEN
    RAISE EXCEPTION 'Hanya order dine-in dengan meja yang punya status cetak bill';
  END IF;
  IF v_order.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Pesanan sudah selesai/dibatalkan';
  END IF;

  UPDATE branch_tables SET bill_printed_at = now() WHERE id = v_order.table_id;
END;
$$;


--
-- Name: FUNCTION mark_bill_printed(p_order_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.mark_bill_printed(p_order_id uuid) IS 'Migrasi 019: dipanggil saat kasir menekan "Cetak Bill" sebelum pembayaran — memajukan meja ke status BILL_PRINTED tanpa mengubah status order KDS.';


--
-- Name: mark_qr_order_paid(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_qr_order_paid(p_qr_order_id uuid, p_payment_reference text, p_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order_id UUID;
BEGIN
  IF p_status NOT IN ('pending', 'paid', 'failed') THEN
    RAISE EXCEPTION 'Status pembayaran tidak valid';
  END IF;

  SELECT order_id INTO v_order_id FROM qr_orders WHERE id = p_qr_order_id;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'qr_order tidak ditemukan';
  END IF;

  UPDATE qr_orders
    SET payment_status = p_status, payment_reference = COALESCE(p_payment_reference, payment_reference)
    WHERE id = p_qr_order_id;

  IF p_status = 'paid' THEN
    UPDATE orders SET status = 'ACCEPTED', accepted_at = now()
      WHERE id = v_order_id AND status = 'NEW';
  END IF;
END;
$$;


--
-- Name: menu_engineering_report(uuid, uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.menu_engineering_report(p_tenant_id uuid, p_branch_id uuid DEFAULT NULL::uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date) RETURNS TABLE(product_id uuid, product_name text, category text, price numeric, cost_price numeric, margin_amount numeric, margin_pct numeric, qty_sold numeric, revenue numeric, avg_qty_sold numeric, avg_margin_amount numeric, classification text, recommendation text)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  RETURN QUERY
  WITH sales AS (
    SELECT
      p.id AS s_product_id, p.name AS s_product_name, p.category AS s_category,
      p.price AS s_price, p.cost_price AS s_cost_price,
      (p.price - p.cost_price) AS s_margin_amount,
      COALESCE(SUM(ti.qty) FILTER (
        WHERE (p_date_from IS NULL OR t.created_at::date >= p_date_from)
          AND (p_date_to IS NULL OR t.created_at::date <= p_date_to)
          AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
      ), 0) AS s_qty_sold,
      COALESCE(SUM(ti.subtotal) FILTER (
        WHERE (p_date_from IS NULL OR t.created_at::date >= p_date_from)
          AND (p_date_to IS NULL OR t.created_at::date <= p_date_to)
          AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
      ), 0) AS s_revenue
    FROM products p
    LEFT JOIN transaction_items ti ON ti.product_id = p.id
    LEFT JOIN transactions t ON t.id = ti.transaction_id AND t.tenant_id = p_tenant_id
    WHERE p.tenant_id = p_tenant_id AND p.is_available = true
    GROUP BY p.id, p.name, p.category, p.price, p.cost_price
  ),
  agg AS (
    SELECT AVG(s_qty_sold) AS avg_qty, AVG(s_margin_amount) AS avg_margin FROM sales
  )
  SELECT
    s.s_product_id, s.s_product_name, s.s_category, s.s_price, s.s_cost_price,
    s.s_margin_amount,
    CASE WHEN s.s_price > 0 THEN ROUND(s.s_margin_amount / s.s_price * 100, 1) ELSE 0 END,
    s.s_qty_sold, s.s_revenue,
    ROUND(a.avg_qty, 2), ROUND(a.avg_margin, 0),
    CASE
      WHEN s.s_qty_sold >= a.avg_qty AND s.s_margin_amount >= a.avg_margin THEN 'STAR'
      WHEN s.s_qty_sold >= a.avg_qty AND s.s_margin_amount < a.avg_margin THEN 'PLOWHORSE'
      WHEN s.s_qty_sold < a.avg_qty AND s.s_margin_amount >= a.avg_margin THEN 'PUZZLE'
      ELSE 'DOG'
    END,
    CASE
      WHEN s.s_qty_sold >= a.avg_qty AND s.s_margin_amount >= a.avg_margin
        THEN 'Andalan — pertahankan kualitas & posisi menonjol di menu.'
      WHEN s.s_qty_sold >= a.avg_qty AND s.s_margin_amount < a.avg_margin
        THEN 'Laris tapi margin tipis — pertimbangkan naikkan harga sedikit atau tekan HPP.'
      WHEN s.s_qty_sold < a.avg_qty AND s.s_margin_amount >= a.avg_margin
        THEN 'Margin bagus tapi kurang laku — promosikan atau reposisi tampilan menu.'
      ELSE 'Penjualan & margin rendah — pertimbangkan hapus dari katalog.'
    END
  FROM sales s CROSS JOIN agg a
  ORDER BY s.s_revenue DESC;
END;
$$;


--
-- Name: merge_table_orders(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_table_orders(p_source_order_id uuid, p_target_order_id uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_source orders%ROWTYPE;
  v_target orders%ROWTYPE;
  v_moved_count INT;
BEGIN
  IF p_source_order_id = p_target_order_id THEN
    RAISE EXCEPTION 'Meja sumber dan tujuan tidak boleh sama';
  END IF;

  -- Kunci berurutan berdasarkan id supaya 2 request merge yang saling
  -- bersilangan (A->B dan B->A bersamaan) tidak deadlock.
  IF p_source_order_id < p_target_order_id THEN
    SELECT * INTO v_source FROM orders WHERE id = p_source_order_id FOR UPDATE;
    SELECT * INTO v_target FROM orders WHERE id = p_target_order_id FOR UPDATE;
  ELSE
    SELECT * INTO v_target FROM orders WHERE id = p_target_order_id FOR UPDATE;
    SELECT * INTO v_source FROM orders WHERE id = p_source_order_id FOR UPDATE;
  END IF;

  IF v_source.id IS NULL OR v_target.id IS NULL THEN
    RAISE EXCEPTION 'Pesanan sumber/tujuan tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND (v_source.tenant_id <> current_tenant_id() OR v_target.tenant_id <> current_tenant_id()) THEN
    RAISE EXCEPTION 'Akses ditolak: bukan pesanan tenant Anda';
  END IF;
  IF v_source.order_type <> 'dine_in' OR v_target.order_type <> 'dine_in' THEN
    RAISE EXCEPTION 'Hanya order dine-in yang bisa digabung mejanya';
  END IF;
  IF v_source.status IN ('COMPLETED', 'CANCELLED') OR v_target.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Pesanan sudah selesai/dibatalkan, tidak bisa digabung';
  END IF;
  IF v_source.branch_id <> v_target.branch_id THEN
    RAISE EXCEPTION 'Kedua meja harus berada di cabang yang sama';
  END IF;

  -- Pindahkan semua order_items sumber ke order tujuan — baris item
  -- TIDAK dihapus (poin 33 lama: histori/void tetap terjaga), hanya
  -- order_id-nya berubah.
  UPDATE order_items SET order_id = p_target_order_id WHERE order_id = p_source_order_id;
  GET DIAGNOSTICS v_moved_count = ROW_COUNT;

  UPDATE orders SET status = 'CANCELLED',
    notes = COALESCE(notes || ' | ', '') || 'DIGABUNG_KE: ' || v_target.order_number
  WHERE id = p_source_order_id;

  -- Bebaskan meja sumber; meja tujuan tetap OCCUPIED/BILL_PRINTED apa
  -- adanya (tidak diubah oleh merge).
  IF v_source.table_id IS NOT NULL THEN
    UPDATE branch_tables SET bill_printed_at = NULL WHERE id = v_source.table_id;
  END IF;

  INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, old_value, new_value, reason)
    VALUES (v_target.tenant_id, v_target.branch_id, auth.uid(), 'MERGE_TABLE', 'order', p_target_order_id,
            jsonb_build_object('source_order_id', p_source_order_id, 'source_order_number', v_source.order_number),
            jsonb_build_object('target_order_id', p_target_order_id, 'target_order_number', v_target.order_number, 'items_moved', v_moved_count),
            p_reason);
END;
$$;


--
-- Name: FUNCTION merge_table_orders(p_source_order_id uuid, p_target_order_id uuid, p_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.merge_table_orders(p_source_order_id uuid, p_target_order_id uuid, p_reason text) IS 'Migrasi 019: gabungkan 2 order dine-in aktif jadi 1 tagihan (order_items sumber dipindah ke order tujuan, order sumber CANCELLED, meja sumber dibebaskan). Dipakai tombol "Gabung Meja" di TableStatusBoard.tsx / /api/tables/merge.';


--
-- Name: move_table_order(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_table_order(p_order_id uuid, p_new_table_id uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_new_table branch_tables%ROWTYPE;
  v_old_table_id UUID;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pesanan tidak ditemukan';
  END IF;

  IF NOT is_super_admin() AND v_order.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan pesanan tenant Anda';
  END IF;

  IF v_order.order_type <> 'dine_in' THEN
    RAISE EXCEPTION 'Hanya order dine-in yang punya meja untuk dipindah';
  END IF;

  IF v_order.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Pesanan sudah selesai/dibatalkan, tidak bisa dipindah mejanya';
  END IF;

  SELECT * INTO v_new_table FROM branch_tables WHERE id = p_new_table_id FOR UPDATE;
  IF v_new_table.id IS NULL OR NOT v_new_table.is_active THEN
    RAISE EXCEPTION 'TABLE_NOT_FOUND: Meja tujuan tidak ditemukan atau tidak aktif';
  END IF;
  IF v_new_table.tenant_id <> v_order.tenant_id OR v_new_table.branch_id <> v_order.branch_id THEN
    RAISE EXCEPTION 'Akses ditolak: meja tujuan bukan milik cabang ini';
  END IF;
  IF v_new_table.needs_cleaning THEN
    RAISE EXCEPTION 'TABLE_CLEANING: Meja % masih menunggu dibersihkan', v_new_table.table_number;
  END IF;
  IF EXISTS (
    SELECT 1 FROM orders o
    WHERE o.table_id = p_new_table_id AND o.status NOT IN ('COMPLETED', 'CANCELLED') AND o.id <> p_order_id
  ) THEN
    RAISE EXCEPTION 'TABLE_OCCUPIED: Meja % sedang digunakan', v_new_table.table_number;
  END IF;

  v_old_table_id := v_order.table_id;

  UPDATE orders SET table_id = p_new_table_id, table_number = v_new_table.table_number WHERE id = p_order_id;

  INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, old_value, new_value, reason)
    VALUES (
      v_order.tenant_id, v_order.branch_id, auth.uid(), 'MOVE_TABLE', 'order', p_order_id,
      jsonb_build_object('table_id', v_old_table_id),
      jsonb_build_object('table_id', p_new_table_id, 'table_number', v_new_table.table_number),
      p_reason
    );
END;
$$;


--
-- Name: FUNCTION move_table_order(p_order_id uuid, p_new_table_id uuid, p_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.move_table_order(p_order_id uuid, p_new_table_id uuid, p_reason text) IS 'Phase 2: pindah order dine-in aktif ke meja lain. Order tetap sama (bukan transaksi baru) — hanya table_id yang berubah, dicatat di audit_log.';


--
-- Name: open_shift(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.open_shift(p_tenant_id uuid, p_cashier_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_shift_id UUID;
BEGIN
  SELECT id INTO v_shift_id FROM shifts
    WHERE tenant_id = p_tenant_id AND cashier_id = p_cashier_id AND status = 'open'
    LIMIT 1;

  IF v_shift_id IS NULL THEN
    INSERT INTO shifts (tenant_id, cashier_id, status)
      VALUES (p_tenant_id, p_cashier_id, 'open')
      RETURNING id INTO v_shift_id;
  END IF;

  RETURN v_shift_id;
END;
$$;


--
-- Name: open_shift_v2(uuid, uuid, uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.open_shift_v2(p_tenant_id uuid, p_branch_id uuid, p_cashier_id uuid, p_opening_cash numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_shift_id UUID;
BEGIN
  IF NOT is_super_admin() AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: bukan anggota tenant ini';
  END IF;

  IF p_opening_cash IS NULL OR p_opening_cash < 0 THEN
    RAISE EXCEPTION 'Modal awal kas tidak valid';
  END IF;

  SELECT id INTO v_shift_id FROM shifts
    WHERE tenant_id = p_tenant_id AND cashier_id = p_cashier_id AND status = 'open'
    LIMIT 1;

  IF v_shift_id IS NULL THEN
    INSERT INTO shifts (tenant_id, branch_id, cashier_id, status, opening_cash)
      VALUES (p_tenant_id, p_branch_id, p_cashier_id, 'open', p_opening_cash)
      RETURNING id INTO v_shift_id;
  END IF;

  RETURN v_shift_id;
END;
$$;


--
-- Name: override_item_price(uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.override_item_price(p_order_item_id uuid, p_new_unit_price numeric, p_reason text, p_supervisor_pin text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_item order_items%ROWTYPE;
  v_order orders%ROWTYPE;
  v_supervisor_id UUID;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_order_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Item pesanan tidak ditemukan';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id;
  IF NOT is_super_admin() AND v_order.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan pesanan tenant Anda';
  END IF;
  IF v_order.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Pesanan sudah selesai/dibatalkan, harga tidak bisa diubah';
  END IF;
  IF p_new_unit_price IS NULL OR p_new_unit_price < 0 THEN
    RAISE EXCEPTION 'Harga baru tidak valid';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Alasan price override wajib diisi';
  END IF;

  v_supervisor_id := require_supervisor_authorization(
    'PRICE_OVERRIDE', 'order_item', p_order_item_id, v_order.tenant_id, v_order.branch_id,
    p_reason, p_supervisor_pin,
    jsonb_build_object('old_price', v_item.unit_price, 'new_price', p_new_unit_price)
  );

  UPDATE order_items SET
    original_unit_price = COALESCE(original_unit_price, unit_price),
    unit_price = p_new_unit_price,
    subtotal = p_new_unit_price * qty,
    price_override_reason = p_reason,
    price_overridden_by = COALESCE(v_supervisor_id, auth.uid()),
    price_overridden_at = now()
  WHERE id = p_order_item_id;

  INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, old_value, new_value, reason)
    VALUES (v_order.tenant_id, v_order.branch_id, auth.uid(), 'PRICE_OVERRIDE', 'order_item', p_order_item_id,
            jsonb_build_object('unit_price', v_item.unit_price),
            jsonb_build_object('unit_price', p_new_unit_price, 'authorized_by', v_supervisor_id), p_reason);
END;
$$;


--
-- Name: FUNCTION override_item_price(p_order_item_id uuid, p_new_unit_price numeric, p_reason text, p_supervisor_pin text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.override_item_price(p_order_item_id uuid, p_new_unit_price numeric, p_reason text, p_supervisor_pin text) IS 'Migrasi 019: ubah harga 1 order_item, wajib PIN supervisor untuk kasir. Menyimpan original_unit_price untuk jejak audit.';


--
-- Name: prevent_ingredient_hard_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_ingredient_hard_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM recipe_items WHERE ingredient_id = OLD.id)
     OR EXISTS (SELECT 1 FROM recipe_consumption_logs WHERE ingredient_id = OLD.id)
     OR EXISTS (SELECT 1 FROM ingredient_stock_movements WHERE ingredient_id = OLD.id) THEN
    RAISE EXCEPTION 'Ingredient "%" tidak bisa dihapus karena sudah dipakai di recipe/histori. Nonaktifkan (status=inactive) saja.', OLD.name;
  END IF;
  RETURN OLD;
END;
$$;


--
-- Name: prevent_modifier_hard_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_modifier_hard_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM order_items
       WHERE modifier_selections @> jsonb_build_array(jsonb_build_object('modifier_id', OLD.id::text))
     )
     OR EXISTS (
       SELECT 1 FROM transaction_items
       WHERE modifier_selections @> jsonb_build_array(jsonb_build_object('modifier_id', OLD.id::text))
     ) THEN
    RAISE EXCEPTION 'Modifier "%" tidak bisa dihapus karena pernah dipakai di order. Nonaktifkan saja (is_available=false).', OLD.name;
  END IF;
  RETURN OLD;
END;
$$;


--
-- Name: prevent_recipe_hard_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_recipe_hard_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM recipe_consumption_logs WHERE recipe_id = OLD.id)
     OR EXISTS (SELECT 1 FROM order_items WHERE recipe_id = OLD.id)
     OR EXISTS (SELECT 1 FROM transaction_items WHERE recipe_id = OLD.id) THEN
    RAISE EXCEPTION 'Recipe "%" (v%) tidak bisa dihapus karena sudah dipakai di transaksi. Nonaktifkan saja (is_active=false) dan buat versi baru.', OLD.name, OLD.version;
  END IF;
  RETURN OLD;
END;
$$;


--
-- Name: prevent_variant_hard_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_variant_hard_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM order_items WHERE variant_id = OLD.id)
     OR EXISTS (SELECT 1 FROM transaction_items WHERE variant_id = OLD.id)
     OR EXISTS (SELECT 1 FROM recipes WHERE variant_id = OLD.id) THEN
    RAISE EXCEPTION 'Varian "%" tidak bisa dihapus karena sudah dipakai di order/recipe. Nonaktifkan saja (is_available=false).', OLD.name;
  END IF;
  RETURN OLD;
END;
$$;


--
-- Name: process_goods_receipt(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_goods_receipt(p_grn_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_grn goods_receipts%ROWTYPE;
  v_po purchase_orders%ROWTYPE;
  v_item RECORD;
  v_wac NUMERIC;
  v_branch_id UUID;
  v_base_qty NUMERIC;
BEGIN
  SELECT * INTO v_grn FROM goods_receipts WHERE id = p_grn_id;
  IF v_grn.id IS NULL THEN
    RAISE EXCEPTION 'GRN tidak ditemukan';
  END IF;

  SELECT * INTO v_po FROM purchase_orders WHERE id = v_grn.po_id;
  IF v_po.id IS NULL THEN
    RAISE EXCEPTION 'PO tidak ditemukan';
  END IF;

  v_branch_id := COALESCE(v_grn.branch_id, main_branch_id(v_grn.tenant_id));

  FOR v_item IN SELECT gi.* FROM grn_items gi WHERE gi.grn_id = p_grn_id
  LOOP
    IF v_item.ingredient_id IS NULL THEN
      -- Baris lama tanpa ingredient_id (pembelian produk jadi) — biarkan
      -- seperti perilaku lama, cukup catat stock_movements produk seperti sebelumnya.
      INSERT INTO stock_movements (tenant_id, branch_id, product_id, type, qty_change, note, created_by)
      VALUES (v_grn.tenant_id, v_branch_id, v_item.product_id, 'purchase', v_item.qty_received,
              'GRN ' || v_grn.grn_number || ' dari PO ' || v_po.po_number, v_grn.received_by);
      CONTINUE;
    END IF;

    -- Konversi ke inventory_unit ingredient kalau purchase_unit beda.
    SELECT convert_unit(
      v_grn.tenant_id, v_item.qty_received,
      COALESCE(v_item.purchase_unit, (SELECT purchase_unit FROM ingredients WHERE id = v_item.ingredient_id)),
      (SELECT inventory_unit FROM ingredients WHERE id = v_item.ingredient_id)
    ) INTO v_base_qty;

    v_wac := calculate_weighted_average_cost(
      v_grn.tenant_id, v_branch_id, v_item.ingredient_id, v_base_qty,
      v_item.unit_price / NULLIF(v_base_qty / NULLIF(v_item.qty_received, 0), 0)
    );

    INSERT INTO branch_ingredients_stock (tenant_id, branch_id, ingredient_id, stock_qty, cost_price, updated_at)
    VALUES (v_grn.tenant_id, v_branch_id, v_item.ingredient_id, v_base_qty, v_wac, now())
    ON CONFLICT (branch_id, ingredient_id) DO UPDATE SET
      stock_qty = branch_ingredients_stock.stock_qty + EXCLUDED.stock_qty,
      cost_price = v_wac,
      updated_at = now();

    INSERT INTO ingredient_stock_movements (tenant_id, branch_id, ingredient_id, type, qty_change, unit, note, created_by)
    SELECT v_grn.tenant_id, v_branch_id, v_item.ingredient_id, 'PURCHASE', v_base_qty, inventory_unit,
           'GRN ' || v_grn.grn_number || ' dari PO ' || v_po.po_number, v_grn.received_by
    FROM ingredients WHERE id = v_item.ingredient_id;

    UPDATE po_items SET qty_received = qty_received + v_item.qty_received
    WHERE po_id = v_po.id AND ingredient_id = v_item.ingredient_id;
  END LOOP;

  UPDATE purchase_orders SET
    status = CASE
      WHEN (SELECT COUNT(*) FROM po_items WHERE po_id = v_po.id AND qty_received < qty_ordered) = 0
      THEN 'RECEIVED' ELSE 'PARTIAL_RECEIVED'
    END,
    received_date = CASE WHEN status <> 'RECEIVED' THEN CURRENT_DATE ELSE received_date END,
    updated_at = now()
  WHERE id = v_po.id;

  RETURN TRUE;
END;
$$;


--
-- Name: process_referral_on_payment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_referral_on_payment(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- (1) Beri reward ke referrer tenant ini, kalau ada & belum pernah.
  UPDATE referrals r
  SET accumulated_uses = LEAST(r.accumulated_uses + 1, 5)
  FROM referral_redemptions rr
  WHERE rr.referred_tenant_id = p_tenant_id
    AND rr.reward_granted = false
    AND r.tenant_id = rr.referrer_tenant_id;

  UPDATE referral_redemptions
  SET reward_granted = true
  WHERE referred_tenant_id = p_tenant_id AND reward_granted = false;

  -- (2) Reset akumulasi diskon tenant ini sendiri (dia baru saja "belanja"
  -- diskonnya, apa pun jumlahnya, tidak harus penuh 5/5).
  UPDATE referrals SET accumulated_uses = 0 WHERE tenant_id = p_tenant_id;

  -- (3) Konsumsi diskon 2% pendaftar baru (kalau masih ada & ini
  -- pembayaran pertamanya).
  UPDATE subscriptions SET pending_signup_discount_pct = 0 WHERE tenant_id = p_tenant_id;
END;
$$;


--
-- Name: product_effective_stock(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.product_effective_stock(p_product_id uuid, p_branch_id uuid) RETURNS numeric
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_mode TEXT;
  v_recipe_id UUID;
  v_portions NUMERIC;
BEGIN
  SELECT stock_mode INTO v_mode FROM products WHERE id = p_product_id;

  IF v_mode = 'recipe' THEN
    v_recipe_id := resolve_active_recipe(p_product_id, NULL);
    IF v_recipe_id IS NULL THEN
      RETURN 0;
    END IF;

    SELECT MIN(FLOOR(COALESCE(bis.stock_qty, 0) / r.quantity))
    INTO v_portions
    FROM recipe_items r
    LEFT JOIN branch_ingredients_stock bis
      ON bis.branch_id = p_branch_id AND bis.ingredient_id = r.ingredient_id
    WHERE r.recipe_id = v_recipe_id AND r.quantity > 0;

    RETURN GREATEST(COALESCE(v_portions, 0), 0);
  END IF;

  -- Produk 'manual' (bukan olahan/tanpa resep) — tetap pakai branch_stock,
  -- perilaku sebelum migration_16 TIDAK berubah.
  RETURN COALESCE((SELECT stock_qty FROM branch_stock WHERE product_id = p_product_id AND branch_id = p_branch_id), 0);
END;
$$;


--
-- Name: FUNCTION product_effective_stock(p_product_id uuid, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.product_effective_stock(p_product_id uuid, p_branch_id uuid) IS 'migration_16. Stok tampil untuk 1 produk di 1 cabang — untuk produk made-to-order (stock_mode = recipe), dihitung murni dari porsi maksimum yang bisa dibuat dari branch_ingredients_stock saat ini (bukan angka stok yang di-cache di kolom manapun).';


--
-- Name: recipe_ingredient_requirements(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recipe_ingredient_requirements(p_recipe_id uuid, p_modifier_ids uuid[] DEFAULT '{}'::uuid[]) RETURNS TABLE(ingredient_id uuid, quantity numeric, unit text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT x.ingredient_id, SUM(x.quantity) AS quantity, MIN(x.unit) AS unit
  FROM (
    SELECT ri.ingredient_id, ri.quantity, ri.unit
    FROM recipe_items ri WHERE ri.recipe_id = p_recipe_id
    UNION ALL
    SELECT mii.ingredient_id, mii.quantity_delta, mii.unit
    FROM modifier_ingredient_impacts mii
    WHERE mii.modifier_id = ANY (COALESCE(p_modifier_ids, '{}'))
  ) x
  GROUP BY x.ingredient_id
  HAVING SUM(x.quantity) <> 0;
$$;


--
-- Name: record_cash_movement(uuid, text, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_cash_movement(p_shift_id uuid, p_type text, p_amount numeric, p_reason text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_shift shifts%ROWTYPE;
  v_id UUID;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'Shift tidak ditemukan';
  END IF;

  IF NOT is_super_admin() AND v_shift.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan shift tenant Anda';
  END IF;

  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'Shift sudah ditutup, tidak bisa mencatat kas lagi';
  END IF;

  IF p_type NOT IN ('cash_in', 'cash_out') THEN
    RAISE EXCEPTION 'Jenis pergerakan kas tidak valid';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Nominal harus lebih dari 0';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Keterangan wajib diisi (mis. "Beli Es Batu Darurat")';
  END IF;

  INSERT INTO cash_movements (tenant_id, branch_id, shift_id, type, amount, reason, created_by)
    VALUES (v_shift.tenant_id, v_shift.branch_id, p_shift_id, p_type, p_amount, trim(p_reason), auth.uid())
    RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


--
-- Name: record_ingredient_waste(uuid, uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_ingredient_waste(p_ingredient_id uuid, p_branch_id uuid, p_qty_wasted numeric, p_waste_type text, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tenant_id UUID := current_tenant_id();
  v_cost NUMERIC;
  v_log_id UUID;
BEGIN
  IF p_qty_wasted <= 0 THEN
    RAISE EXCEPTION 'Jumlah waste harus lebih dari 0';
  END IF;

  SELECT cost_price INTO v_cost FROM branch_ingredients_stock
  WHERE branch_id = p_branch_id AND ingredient_id = p_ingredient_id;

  INSERT INTO ingredient_waste_logs (
    tenant_id, branch_id, ingredient_id, waste_type, qty_wasted, cost_price, total_loss_amount, note, recorded_by
  ) VALUES (
    v_tenant_id, p_branch_id, p_ingredient_id, p_waste_type, p_qty_wasted,
    COALESCE(v_cost, 0), p_qty_wasted * COALESCE(v_cost, 0), p_note, auth.uid()
  ) RETURNING id INTO v_log_id;

  UPDATE branch_ingredients_stock
  SET stock_qty = GREATEST(stock_qty - p_qty_wasted, 0), updated_at = now()
  WHERE branch_id = p_branch_id AND ingredient_id = p_ingredient_id;

  INSERT INTO ingredient_stock_movements (tenant_id, branch_id, ingredient_id, type, qty_change, unit, note, created_by)
  SELECT v_tenant_id, p_branch_id, p_ingredient_id, 'WASTE', -p_qty_wasted, inventory_unit, p_note, auth.uid()
  FROM ingredients WHERE id = p_ingredient_id;

  RETURN v_log_id;
END;
$$;


--
-- Name: redeem_loyalty_points(uuid, integer, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.redeem_loyalty_points(p_customer_id uuid, p_points_to_redeem integer, p_discount_amount numeric) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_customer customers%ROWTYPE;
  v_available_points INT;
  v_config loyalty_config%ROWTYPE;
  v_current_balance INT;
BEGIN
  SELECT * INTO v_customer FROM customers WHERE id = p_customer_id;
  IF v_customer.id IS NULL THEN
    RAISE EXCEPTION 'Pelanggan tidak ditemukan';
  END IF;

  SELECT * INTO v_config FROM loyalty_config WHERE tenant_id = v_customer.tenant_id;

  IF NOT v_config.is_enabled THEN
    RAISE EXCEPTION 'Program loyalitas tidak aktif';
  END IF;

  -- Hitung poin tersedia (belum expired)
  SELECT COALESCE(SUM(CASE WHEN transaction_type IN ('EARN', 'ADJUST') THEN points_amount ELSE -points_amount END), 0)
  INTO v_available_points FROM loyalty_points_log 
  WHERE customer_id = p_customer_id AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE);

  IF v_available_points < p_points_to_redeem THEN
    RAISE EXCEPTION 'Poin tidak cukup. Tersedia: %, Diminta: %', v_available_points, p_points_to_redeem;
  END IF;

  -- Hitung saldo setelah redeem
  v_current_balance := v_available_points - p_points_to_redeem;

  -- Insert redeem log
  INSERT INTO loyalty_points_log (
    tenant_id, customer_id, transaction_type, points_amount, 
    description, balance_after
  ) VALUES (
    v_customer.tenant_id, p_customer_id, 'REDEEM', -p_points_to_redeem,
    'Tukar poin menjadi diskon Rp' || p_discount_amount,
    v_current_balance
  );

  RETURN TRUE;
END;
$$;


--
-- Name: redeem_referral_code(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.redeem_referral_code(p_code text, p_new_tenant_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_referrer_tenant_id UUID;
BEGIN
  -- Kode khusus Super Admin dicek di kode aplikasi (dibandingkan dengan
  -- env var), BUKAN di sini — fungsi ini hanya menangani kode referral
  -- biasa milik tenant lain.
  SELECT tenant_id INTO v_referrer_tenant_id FROM referrals WHERE code = p_code FOR UPDATE;

  IF v_referrer_tenant_id IS NULL THEN
    RETURN 'invalid';
  END IF;

  IF v_referrer_tenant_id = p_new_tenant_id THEN
    RETURN 'invalid'; -- tidak boleh pakai kode sendiri
  END IF;

  INSERT INTO referral_redemptions (code, referrer_tenant_id, referred_tenant_id)
    VALUES (p_code, v_referrer_tenant_id, p_new_tenant_id);

  RETURN 'referrer';
END;
$$;


--
-- Name: redeem_special_code(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.redeem_special_code(p_code text, p_new_tenant_id uuid) RETURNS TABLE(trial_days integer, discount_pct numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_row admin_special_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM admin_special_codes WHERE code = p_code FOR UPDATE;

  IF v_row.id IS NULL
     OR NOT v_row.is_active
     OR v_row.expires_at < now()
     OR (v_row.max_uses IS NOT NULL AND v_row.used_count >= v_row.max_uses) THEN
    RETURN; -- kosong = tidak valid, biar caller lanjut coba kode referral biasa
  END IF;

  UPDATE admin_special_codes SET used_count = used_count + 1 WHERE id = v_row.id;

  trial_days := v_row.trial_days;
  discount_pct := v_row.discount_pct;
  RETURN NEXT;
END;
$$;


--
-- Name: refresh_all_subscription_statuses(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_all_subscription_statuses() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  UPDATE subscriptions SET updated_at = updated_at
  WHERE status IN ('trial', 'active', 'past_due')
    AND (
      (status = 'trial' AND trial_ends_at < now())
      OR (status IN ('active', 'past_due') AND valid_until < now())
    )
    AND (super_trial_ends_at IS NULL OR super_trial_ends_at < now());
$$;


--
-- Name: FUNCTION refresh_all_subscription_statuses(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_all_subscription_statuses() IS 'migration_16. Dipanggil pg_cron setiap jam. UPDATE "kosong" (updated_at=updated_at) ini sengaja dipakai hanya untuk memicu trigger trg_subscriptions_auto_status di atas pada baris yang sudah lewat tanggal tapi tidak pernah di-UPDATE siapa pun (mis. trial yang tidak pernah bayar sama sekali).';


--
-- Name: request_refund(uuid, text, numeric, jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_refund(p_transaction_id uuid, p_refund_type text, p_amount numeric, p_items jsonb, p_reason_category text, p_reason_note text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tx transactions%ROWTYPE;
  v_already_refunded NUMERIC;
  v_refund_id UUID;
  v_status TEXT;
  v_approved_by UUID;
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_tx.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan transaksi tenant Anda';
  END IF;
  IF p_refund_type NOT IN ('FULL', 'PARTIAL', 'ITEM') THEN
    RAISE EXCEPTION 'Tipe refund tidak valid';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Nominal refund tidak valid';
  END IF;
  IF p_reason_category NOT IN ('CUSTOMER_REQUEST','WRONG_ORDER','DUPLICATE_PAYMENT','PRODUCT_UNAVAILABLE','DAMAGED','QUALITY_ISSUE','OTHER') THEN
    RAISE EXCEPTION 'Kategori alasan tidak valid';
  END IF;

  -- "Jumlah refund melebihi jumlah yang dapat dikembalikan" (poin 70) —
  -- hanya hitung refund yang sudah COMPLETED/masih PENDING_APPROVAL
  -- (supaya tidak ada 2 request tumpang tindih melebihi total transaksi).
  SELECT COALESCE(SUM(amount), 0) INTO v_already_refunded FROM refunds
    WHERE transaction_id = p_transaction_id AND status IN ('COMPLETED', 'PENDING_APPROVAL');

  IF v_already_refunded + p_amount > v_tx.total_amount THEN
    RAISE EXCEPTION 'REFUND_EXCEEDS_TOTAL: Jumlah refund (%) melebihi sisa yang dapat dikembalikan (%)',
      p_amount, (v_tx.total_amount - v_already_refunded);
  END IF;

  IF is_manager_or_owner() OR is_super_admin() OR p_amount <= 50000 THEN
    v_status := 'COMPLETED';
    v_approved_by := auth.uid();
  ELSE
    v_status := 'PENDING_APPROVAL';
    v_approved_by := NULL;
  END IF;

  INSERT INTO refunds (tenant_id, branch_id, transaction_id, refund_type, amount, items, reason_category, reason_note, status, requested_by, approved_by, decided_at)
    VALUES (v_tx.tenant_id, v_tx.branch_id, p_transaction_id, p_refund_type, p_amount, p_items, p_reason_category, p_reason_note,
            v_status, auth.uid(), v_approved_by, CASE WHEN v_status = 'COMPLETED' THEN now() ELSE NULL END)
    RETURNING id INTO v_refund_id;

  INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, old_value, new_value, reason)
    VALUES (v_tx.tenant_id, v_tx.branch_id, auth.uid(),
            CASE WHEN p_refund_type = 'FULL' THEN 'REFUND_ORDER' ELSE 'REFUND_ITEM' END,
            'transaction', p_transaction_id, NULL,
            jsonb_build_object('refund_id', v_refund_id, 'amount', p_amount, 'status', v_status),
            p_reason_note);

  RETURN v_refund_id;
END;
$$;


--
-- Name: FUNCTION request_refund(p_transaction_id uuid, p_refund_type text, p_amount numeric, p_items jsonb, p_reason_category text, p_reason_note text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.request_refund(p_transaction_id uuid, p_refund_type text, p_amount numeric, p_items jsonb, p_reason_category text, p_reason_note text) IS 'Phase 2: kasir bisa self-approve refund <= Rp50.000 (status langsung COMPLETED); di atas itu wajib manager/owner (status PENDING_APPROVAL sampai approve_refund dipanggil). Tidak pernah mengubah baris transactions/transaction_items asli, tidak menyentuh inventory.';


--
-- Name: require_supervisor_authorization(text, text, uuid, uuid, uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.require_supervisor_authorization(p_action text, p_entity_type text, p_entity_id uuid, p_tenant_id uuid, p_branch_id uuid, p_reason text, p_supervisor_pin text, p_metadata jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_role TEXT;
  v_supervisor_id UUID;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();

  IF v_role IN ('manager', 'owner', 'super_admin') THEN
    -- Sudah supervisor — tidak perlu PIN tambahan, tapi tetap dicatat
    -- di audit_log oleh fungsi pemanggil masing-masing (bukan di sini)
    -- supaya tidak ada duplikasi baris log untuk kejadian yang sama.
    RETURN auth.uid();
  END IF;

  IF p_supervisor_pin IS NULL OR trim(p_supervisor_pin) = '' THEN
    RAISE EXCEPTION 'PIN_REQUIRED: Tindakan ini wajib otorisasi PIN supervisor';
  END IF;

  SELECT supervisor_id INTO v_supervisor_id FROM verify_supervisor_pin(p_supervisor_pin, p_branch_id);

  IF v_supervisor_id IS NULL THEN
    -- Dicatat juga supaya percobaan PIN salah berulang kelihatan di audit
    -- (indikasi kasir mencoba menebak PIN), TANPA menyimpan PIN itu sendiri.
    INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, old_value, new_value, reason)
      VALUES (p_tenant_id, p_branch_id, auth.uid(), 'PIN_AUTH_FAILED', p_entity_type, p_entity_id, NULL,
              jsonb_build_object('attempted_action', p_action), p_reason);
    RAISE EXCEPTION 'INVALID_PIN: PIN supervisor salah atau tidak ditemukan';
  END IF;

  INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, old_value, new_value, reason)
    VALUES (p_tenant_id, p_branch_id, auth.uid(), 'PIN_AUTH_' || p_action, p_entity_type, p_entity_id, NULL,
            COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('supervisor_id', v_supervisor_id, 'cashier_id', auth.uid()),
            p_reason);

  RETURN v_supervisor_id;
END;
$$;


--
-- Name: FUNCTION require_supervisor_authorization(p_action text, p_entity_type text, p_entity_id uuid, p_tenant_id uuid, p_branch_id uuid, p_reason text, p_supervisor_pin text, p_metadata jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.require_supervisor_authorization(p_action text, p_entity_type text, p_entity_id uuid, p_tenant_id uuid, p_branch_id uuid, p_reason text, p_supervisor_pin text, p_metadata jsonb) IS 'Migrasi 019: helper internal dipanggil dari void_order_item/cancel_order/apply_manual_discount/override_item_price. Kasir WAJIB PIN valid; manager/owner/super_admin lolos otomatis. Selalu tercatat ke audit_log, termasuk percobaan PIN gagal.';


--
-- Name: resolve_active_recipe(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_active_recipe(p_product_id uuid, p_variant_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT id FROM recipes
  WHERE product_id = p_product_id AND is_active = true
    AND (variant_id = p_variant_id OR variant_id IS NULL)
  ORDER BY (variant_id IS NOT NULL) DESC
  LIMIT 1;
$$;


--
-- Name: revert_recipe_stock(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revert_recipe_stock(p_transaction_id uuid, p_transaction_item_id uuid DEFAULT NULL::uuid, p_refund_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
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
    -- kembalikan proporsional ke branch_ingredients_stock.
    IF EXISTS (SELECT 1 FROM recipe_consumption_logs WHERE source_type = 'transaction_item' AND source_id = v_item.id) THEN
      v_ratio := v_restorable_qty::NUMERIC / v_item.qty::NUMERIC;

      FOR v_recipe_log IN
        SELECT ingredient_id, unit, SUM(quantity) AS total_qty
        FROM recipe_consumption_logs
        WHERE source_type = 'transaction_item' AND source_id = v_item.id
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


--
-- Name: FUNCTION revert_recipe_stock(p_transaction_id uuid, p_transaction_item_id uuid, p_refund_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.revert_recipe_stock(p_transaction_id uuid, p_transaction_item_id uuid, p_refund_id uuid) IS 'Migrasi 019: dipanggil dari toggle "Restore Stock to Inventory" di RefundModal.tsx setelah refund COMPLETED. Mengembalikan stok resep (branch_ingredients_stock, kalau recipe_consumption_logs ada) atau stok produk sederhana (branch_stock, fallback). Idempotent lewat transaction_items.restored_qty.';


--
-- Name: review_approval_request(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.review_approval_request(p_request_id uuid, p_approve boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_req approval_requests%ROWTYPE;
BEGIN
  IF NOT is_super_admin() AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Manager/Owner yang boleh meninjau pengajuan.';
  END IF;

  SELECT * INTO v_req FROM approval_requests WHERE id = p_request_id AND status = 'pending';
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Pengajuan tidak ditemukan atau sudah ditinjau sebelumnya.';
  END IF;

  IF NOT is_super_admin() AND v_req.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan pengajuan tenant Anda.';
  END IF;

  IF p_approve THEN
    IF v_req.type = 'new_menu' THEN
      INSERT INTO products (tenant_id, name, price, category, image_url, is_available)
      VALUES (
        v_req.tenant_id,
        v_req.payload->>'name',
        (v_req.payload->>'price')::NUMERIC,
        v_req.payload->>'category',
        v_req.payload->>'image_url',
        true
      );
    ELSIF v_req.type = 'price_change' THEN
      UPDATE products SET price = (v_req.payload->>'price')::NUMERIC
        WHERE id = v_req.target_id AND tenant_id = v_req.tenant_id;
    END IF;
  END IF;

  UPDATE approval_requests
    SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = p_request_id;
END;
$$;


--
-- Name: seat_reservation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seat_reservation(p_reservation_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_res reservations%ROWTYPE;
  v_table branch_tables%ROWTYPE;
  v_order_id UUID;
  v_order_number TEXT;
  v_seq INT;
BEGIN
  IF NOT is_manager_or_owner() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Manager/Owner/Kasir yang boleh check-in reservasi';
  END IF;

  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id;
  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Reservasi tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_res.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  IF v_res.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Reservasi harus berstatus confirmed sebelum check-in';
  END IF;
  IF v_res.table_id IS NULL THEN
    RAISE EXCEPTION 'Alokasikan meja terlebih dahulu sebelum check-in';
  END IF;

  SELECT * INTO v_table FROM branch_tables WHERE id = v_res.table_id;

  SELECT COUNT(*) + 1 INTO v_seq FROM orders
    WHERE branch_id = v_res.branch_id AND created_at::date = CURRENT_DATE;
  v_order_number := 'RSV-' || lpad(v_seq::text, 3, '0');
  v_order_id := gen_random_uuid();

  INSERT INTO orders (
    id, tenant_id, branch_id, table_id, order_number, order_type,
    table_number, customer_name, status, channel
  ) VALUES (
    v_order_id, v_res.tenant_id, v_res.branch_id, v_res.table_id, v_order_number, 'dine_in',
    v_table.table_number, v_res.customer_name, 'NEW', 'reservation'
  );

  UPDATE reservations SET status = 'seated', order_id = v_order_id WHERE id = p_reservation_id;

  RETURN v_order_id;
END;
$$;


--
-- Name: seed_default_customer_tiers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_customer_tiers() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO customer_tiers (tenant_id, tier_name, min_spend_monthly, discount_percentage, points_multiplier, benefits)
  VALUES
    (NEW.id, 'Reguler', 0, 0, 1, ARRAY['Kumpulkan poin di setiap transaksi']),
    (NEW.id, 'Silver', 500000, 5, 1.2, ARRAY['Diskon 5%', 'Poin 1.2x']),
    (NEW.id, 'Gold', 2000000, 10, 1.5, ARRAY['Diskon 10%', 'Poin 1.5x', 'Prioritas info promo'])
  ON CONFLICT (tenant_id, tier_name) DO NOTHING;
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION seed_default_customer_tiers(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.seed_default_customer_tiers() IS 'migration_16 (bagian H7). Tenant baru otomatis dapat 3 tier member default (Reguler/Silver/Gold) begitu tenants di-insert (dipicu /api/register) — melengkapi alur self-service #2 supaya Kartu Member Digital & tier langsung siap pakai tanpa setup manual Owner.';


--
-- Name: set_employee_branch(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_employee_branch(p_employee_id uuid, p_branch_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tenant_id UUID;
  v_employee_tenant UUID;
  v_branch_tenant UUID;
BEGIN
  IF NOT is_manager_or_owner() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Manager/Owner yang boleh menugaskan cabang karyawan.';
  END IF;

  v_tenant_id := current_tenant_id();

  SELECT tenant_id INTO v_employee_tenant FROM profiles WHERE id = p_employee_id;
  IF v_employee_tenant IS NULL OR v_employee_tenant <> v_tenant_id THEN
    RAISE EXCEPTION 'Karyawan tidak ditemukan di tenant Anda.';
  END IF;

  IF p_branch_id IS NOT NULL THEN
    SELECT tenant_id INTO v_branch_tenant FROM branches WHERE id = p_branch_id;
    IF v_branch_tenant IS NULL OR v_branch_tenant <> v_tenant_id THEN
      RAISE EXCEPTION 'Cabang tidak ditemukan di tenant Anda.';
    END IF;
  END IF;

  UPDATE profiles SET branch_id = p_branch_id WHERE id = p_employee_id;
END;
$$;


--
-- Name: set_monthly_target(integer, integer, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_monthly_target(p_year integer, p_month integer, p_target_amount numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT is_manager_or_owner() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Manager/Owner yang boleh mengatur target.';
  END IF;

  INSERT INTO monthly_targets (tenant_id, year, month, target_amount, created_by)
    VALUES (current_tenant_id(), p_year, p_month, p_target_amount, auth.uid())
  ON CONFLICT (tenant_id, year, month)
    DO UPDATE SET target_amount = EXCLUDED.target_amount, updated_at = now(), created_by = auth.uid();
END;
$$;


--
-- Name: set_supervisor_pin(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_supervisor_pin(p_pin text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role NOT IN ('manager', 'owner', 'super_admin') THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Manager/Owner yang bisa mengeset PIN supervisor';
  END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'PIN harus terdiri dari 4-6 digit angka';
  END IF;

  UPDATE profiles SET pin_hash = crypt(p_pin, gen_salt('bf')), pin_updated_at = now() WHERE id = auth.uid();
END;
$_$;


--
-- Name: FUNCTION set_supervisor_pin(p_pin text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.set_supervisor_pin(p_pin text) IS 'Migrasi 019: Manager/Owner/Super Admin mengeset PIN otorisasi mereka sendiri. Dipanggil dari halaman profil/pengaturan.';


--
-- Name: shift_cash_summary(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.shift_cash_summary(p_shift_id uuid) RETURNS TABLE(opening_cash numeric, total_cash_sales numeric, total_cash_in numeric, total_cash_out numeric, expected_cash numeric, total_transactions numeric, total_transactions_count bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_shift shifts%ROWTYPE;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'Shift tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_shift.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;

  RETURN QUERY
  SELECT
    v_shift.opening_cash,
    COALESCE((
      SELECT SUM(tp.amount) FROM transaction_payments tp
      JOIN transactions t ON t.id = tp.transaction_id
      WHERE t.shift_id = p_shift_id AND tp.method = 'cash'
    ), 0) AS total_cash_sales,
    COALESCE((SELECT SUM(amount) FROM cash_movements WHERE shift_id = p_shift_id AND type = 'cash_in'), 0) AS total_cash_in,
    COALESCE((SELECT SUM(amount) FROM cash_movements WHERE shift_id = p_shift_id AND type = 'cash_out'), 0) AS total_cash_out,
    v_shift.opening_cash
      + COALESCE((
          SELECT SUM(tp.amount) FROM transaction_payments tp
          JOIN transactions t ON t.id = tp.transaction_id
          WHERE t.shift_id = p_shift_id AND tp.method = 'cash'
        ), 0)
      + COALESCE((SELECT SUM(amount) FROM cash_movements WHERE shift_id = p_shift_id AND type = 'cash_in'), 0)
      - COALESCE((SELECT SUM(amount) FROM cash_movements WHERE shift_id = p_shift_id AND type = 'cash_out'), 0)
      AS expected_cash,
    COALESCE((SELECT SUM(total_amount) FROM transactions WHERE shift_id = p_shift_id), 0) AS total_transactions,
    COALESCE((SELECT COUNT(*) FROM transactions WHERE shift_id = p_shift_id), 0) AS total_transactions_count;
END;
$$;


--
-- Name: slugify(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.slugify(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT trim(both '-' FROM regexp_replace(lower(trim(p_text)), '[^a-z0-9]+', '-', 'g'));
$$;


--
-- Name: submit_ingredient_stock_opname(uuid, uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_ingredient_stock_opname(p_ingredient_id uuid, p_branch_id uuid, p_physical_qty numeric, p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tenant_id UUID := current_tenant_id();
  v_system_qty NUMERIC;
  v_cost NUMERIC;
  v_diff NUMERIC;
  v_log_id UUID;
BEGIN
  IF NOT is_manager_or_owner() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Hanya Owner/Manager yang boleh melakukan stock opname';
  END IF;

  SELECT stock_qty, cost_price INTO v_system_qty, v_cost
  FROM branch_ingredients_stock WHERE branch_id = p_branch_id AND ingredient_id = p_ingredient_id;

  v_system_qty := COALESCE(v_system_qty, 0);
  v_diff := p_physical_qty - v_system_qty;

  INSERT INTO ingredient_stock_opname_logs (
    tenant_id, branch_id, ingredient_id, system_qty, physical_qty, difference_qty,
    cost_price_snapshot, loss_value, reason, note, created_by
  ) VALUES (
    v_tenant_id, p_branch_id, p_ingredient_id, v_system_qty, p_physical_qty, v_diff,
    COALESCE(v_cost, 0),
    CASE WHEN v_diff < 0 THEN abs(v_diff) * COALESCE(v_cost, 0) ELSE 0 END,
    p_reason, p_note, auth.uid()
  ) RETURNING id INTO v_log_id;

  INSERT INTO branch_ingredients_stock (tenant_id, branch_id, ingredient_id, stock_qty, cost_price)
  VALUES (v_tenant_id, p_branch_id, p_ingredient_id, p_physical_qty, COALESCE(v_cost, 0))
  ON CONFLICT (branch_id, ingredient_id) DO UPDATE
    SET stock_qty = p_physical_qty, updated_at = now();

  INSERT INTO ingredient_stock_movements (tenant_id, branch_id, ingredient_id, type, qty_change, unit, note, created_by)
  SELECT v_tenant_id, p_branch_id, p_ingredient_id, 'STOCK_OPNAME', v_diff, inventory_unit,
         COALESCE(p_note, 'Stock opname'), auth.uid()
  FROM ingredients WHERE id = p_ingredient_id;

  RETURN v_log_id;
END;
$$;


--
-- Name: submit_qr_order(text, text, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_qr_order(p_branch_slug text, p_table_number text, p_customer_name text, p_customer_phone text, p_payment_method text, p_notes text, p_items jsonb) RETURNS TABLE(order_id uuid, qr_order_id uuid, order_number text, total_amount numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_branch branches%ROWTYPE;
  v_table branch_tables%ROWTYPE;
  v_item JSONB;
  v_product products%ROWTYPE;
  v_qty INT;
  v_order_id UUID;
  v_qr_order_id UUID;
  v_order_number TEXT;
  v_seq INT;
  v_total NUMERIC := 0;
BEGIN
  IF p_payment_method NOT IN ('qris', 'pay_at_cashier') THEN
    RAISE EXCEPTION 'Metode pembayaran tidak valid';
  END IF;

  SELECT * INTO v_branch FROM branches WHERE slug = p_branch_slug AND is_active = true;
  IF v_branch.id IS NULL THEN
    RAISE EXCEPTION 'TABLE_OR_BRANCH_NOT_FOUND: Cabang tidak ditemukan atau tidak aktif';
  END IF;

  SELECT * INTO v_table FROM branch_tables
    WHERE branch_id = v_branch.id AND table_number = p_table_number AND is_active = true;
  IF v_table.id IS NULL THEN
    RAISE EXCEPTION 'TABLE_OR_BRANCH_NOT_FOUND: Meja tidak ditemukan atau tidak aktif';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang kosong';
  END IF;
  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'Jumlah jenis item pesanan terlalu banyak';
  END IF;

  -- Nomor pesanan harian per cabang, prefix "QR-" supaya gampang dibedakan
  -- dari tiket POS ("ORD-") di layar KDS.
  SELECT COUNT(*) + 1 INTO v_seq FROM orders
    WHERE branch_id = v_branch.id AND created_at::date = CURRENT_DATE;
  v_order_number := 'QR-' || lpad(v_seq::text, 3, '0');
  v_order_id := gen_random_uuid();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::INT;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 50 THEN
      RAISE EXCEPTION 'Qty item tidak valid';
    END IF;

    SELECT * INTO v_product FROM products
      WHERE id = (v_item->>'product_id')::UUID
        AND tenant_id = v_branch.tenant_id
        AND is_available = true;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Produk tidak ditemukan atau tidak tersedia';
    END IF;

    v_total := v_total + (v_product.price * v_qty);
  END LOOP;

  INSERT INTO orders (
    id, tenant_id, branch_id, table_id, order_number, order_type,
    table_number, customer_name, status, notes, channel
  ) VALUES (
    v_order_id, v_branch.tenant_id, v_branch.id, v_table.id, v_order_number, 'dine_in',
    v_table.table_number, NULLIF(trim(p_customer_name), ''), 'NEW', p_notes, 'qr_self_order'
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::INT;
    SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::UUID AND tenant_id = v_branch.tenant_id;

    INSERT INTO order_items (
      order_id, product_id, station_id, product_name, variant_notes, qty, unit_price, subtotal
    ) VALUES (
      v_order_id, v_product.id, v_product.station_id, v_product.name,
      NULLIF(trim(v_item->>'variant_notes'), ''), v_qty, v_product.price, v_product.price * v_qty
    );
  END LOOP;

  INSERT INTO qr_orders (
    id, tenant_id, branch_id, table_id, order_id, customer_name, customer_phone,
    payment_method, payment_status, total_amount
  ) VALUES (
    gen_random_uuid(), v_branch.tenant_id, v_branch.id, v_table.id, v_order_id,
    NULLIF(trim(p_customer_name), ''), NULLIF(trim(p_customer_phone), ''),
    p_payment_method, CASE WHEN p_payment_method = 'qris' THEN 'pending' ELSE 'unpaid' END, v_total
  ) RETURNING id INTO v_qr_order_id;

  RETURN QUERY SELECT v_order_id, v_qr_order_id, v_order_number, v_total;
END;
$$;


--
-- Name: submit_stock_opname(uuid, uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_stock_opname(p_branch_id uuid, p_product_id uuid, p_physical_qty numeric, p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  RAISE EXCEPTION 'DEPRECATED_PRODUCT_STOCK_OPNAME: Stok opname berbasis produk sudah tidak didukung sejak migration_16. '
    'Gunakan submit_stock_opname_item(p_branch_id, p_ingredient_id, p_physical_qty, p_reason, p_note) — '
    'opname sekarang dilakukan per bahan baku (ingredient), bukan per produk jadi.';
END;
$$;


--
-- Name: FUNCTION submit_stock_opname(p_branch_id uuid, p_product_id uuid, p_physical_qty numeric, p_reason text, p_note text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.submit_stock_opname(p_branch_id uuid, p_product_id uuid, p_physical_qty numeric, p_reason text, p_note text) IS 'DIBEKUKAN sejak migration_16 — selalu RAISE EXCEPTION. Dipertahankan (bukan di-DROP) hanya supaya signature lama tidak error "function does not exist" kalau ada caller lama yang lupa diperbarui. Ganti ke submit_stock_opname_item().';


--
-- Name: submit_stock_opname_item(uuid, uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_stock_opname_item(p_branch_id uuid, p_ingredient_id uuid, p_physical_qty numeric, p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tenant_id UUID := current_tenant_id();
  v_opname_id UUID;
  v_system_qty NUMERIC;
  v_cost NUMERIC;
  v_unit TEXT;
  v_diff NUMERIC;
  v_loss NUMERIC;
  v_item_id UUID;
BEGIN
  IF NOT is_manager_or_owner() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Hanya Owner/Manager yang boleh melakukan stock opname';
  END IF;

  IF p_physical_qty IS NULL OR p_physical_qty < 0 THEN
    RAISE EXCEPTION 'Jumlah fisik tidak valid';
  END IF;

  SELECT stock_qty, cost_price INTO v_system_qty, v_cost
  FROM branch_ingredients_stock WHERE branch_id = p_branch_id AND ingredient_id = p_ingredient_id;
  v_system_qty := COALESCE(v_system_qty, 0);
  v_cost := COALESCE(v_cost, 0);

  SELECT inventory_unit INTO v_unit FROM ingredients WHERE id = p_ingredient_id AND tenant_id = v_tenant_id;
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'Bahan baku tidak ditemukan di tenant Anda';
  END IF;

  v_diff := p_physical_qty - v_system_qty;
  v_loss := CASE WHEN v_diff < 0 THEN abs(v_diff) * v_cost ELSE 0 END;

  IF v_diff <> 0 AND (p_reason IS NULL OR length(trim(p_reason)) = 0) THEN
    RAISE EXCEPTION 'Alasan selisih wajib diisi kalau stok fisik berbeda dari stok sistem';
  END IF;

  -- Cari/buat header "sesi hari ini" milik (tenant, branch, pencatat).
  SELECT id INTO v_opname_id FROM stock_opnames
  WHERE tenant_id = v_tenant_id AND branch_id = p_branch_id AND created_by = auth.uid()
    AND created_at::date = (now() AT TIME ZONE 'UTC')::date
  ORDER BY created_at DESC LIMIT 1;

  IF v_opname_id IS NULL THEN
    INSERT INTO stock_opnames (tenant_id, branch_id, status, created_by, note)
      VALUES (v_tenant_id, p_branch_id, 'submitted', auth.uid(), p_note)
      RETURNING id INTO v_opname_id;
  END IF;

  INSERT INTO stock_opname_items (
    opname_id, ingredient_id, unit, system_qty, physical_qty, difference_qty,
    cost_price_snapshot, loss_value, reason, note
  ) VALUES (
    v_opname_id, p_ingredient_id, v_unit, v_system_qty, p_physical_qty, v_diff,
    v_cost, v_loss, p_reason, p_note
  )
  ON CONFLICT (opname_id, ingredient_id) DO UPDATE SET
    system_qty = EXCLUDED.system_qty,
    physical_qty = EXCLUDED.physical_qty,
    difference_qty = EXCLUDED.difference_qty,
    cost_price_snapshot = EXCLUDED.cost_price_snapshot,
    loss_value = EXCLUDED.loss_value,
    reason = EXCLUDED.reason,
    note = EXCLUDED.note
  RETURNING id INTO v_item_id;

  UPDATE stock_opnames
    SET total_loss_value = (SELECT COALESCE(SUM(loss_value), 0) FROM stock_opname_items WHERE opname_id = v_opname_id)
    WHERE id = v_opname_id;

  -- Revisi stok bahan baku sungguhan (sumber kebenaran HPP & resep).
  INSERT INTO branch_ingredients_stock (tenant_id, branch_id, ingredient_id, stock_qty, cost_price)
    VALUES (v_tenant_id, p_branch_id, p_ingredient_id, p_physical_qty, v_cost)
  ON CONFLICT (branch_id, ingredient_id) DO UPDATE
    SET stock_qty = p_physical_qty, updated_at = now();

  INSERT INTO ingredient_stock_movements (tenant_id, branch_id, ingredient_id, type, qty_change, unit, note, created_by)
    VALUES (v_tenant_id, p_branch_id, p_ingredient_id, 'STOCK_OPNAME', v_diff, v_unit,
            COALESCE(p_note, 'Stock opname'), auth.uid());

  -- Mirror ke log lama (additif) supaya laporan/fungsi lain yang sudah
  -- membaca ingredient_stock_opname_logs sejak migration_012 tetap jalan
  -- tanpa perlu tahu soal header/detail baru ini.
  INSERT INTO ingredient_stock_opname_logs (
    tenant_id, branch_id, ingredient_id, system_qty, physical_qty, difference_qty,
    cost_price_snapshot, loss_value, reason, note, created_by
  ) VALUES (
    v_tenant_id, p_branch_id, p_ingredient_id, v_system_qty, p_physical_qty, v_diff,
    v_cost, v_loss, p_reason, p_note, auth.uid()
  );

  RETURN v_item_id;
END;
$$;


--
-- Name: FUNCTION submit_stock_opname_item(p_branch_id uuid, p_ingredient_id uuid, p_physical_qty numeric, p_reason text, p_note text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.submit_stock_opname_item(p_branch_id uuid, p_ingredient_id uuid, p_physical_qty numeric, p_reason text, p_note text) IS 'Migration_16 — RPC utama Stok Opname (bahan baku). Menggantikan submit_stock_opname() lama (berbasis products, kini dibekukan) sebagai satu-satunya jalur input opname dari frontend.';


--
-- Name: sync_customer_points_from_log(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_customer_points_from_log() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tenant_id UUID;
  v_delta INT;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM customers WHERE id = NEW.customer_id;
  IF v_tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_delta := CASE WHEN NEW.transaction_type IN ('EARN', 'ADJUST') THEN NEW.points_amount ELSE -NEW.points_amount END;

  INSERT INTO customer_points (tenant_id, customer_id, points_balance, lifetime_earned, lifetime_redeemed)
  VALUES (
    v_tenant_id,
    NEW.customer_id,
    GREATEST(v_delta, 0) + LEAST(v_delta, 0),
    CASE WHEN NEW.transaction_type IN ('EARN', 'ADJUST') AND NEW.points_amount > 0 THEN NEW.points_amount ELSE 0 END,
    CASE WHEN NEW.transaction_type = 'REDEEM' THEN NEW.points_amount ELSE 0 END
  )
  ON CONFLICT (customer_id) DO UPDATE SET
    points_balance = GREATEST(customer_points.points_balance + v_delta, 0),
    lifetime_earned = customer_points.lifetime_earned +
      (CASE WHEN NEW.transaction_type IN ('EARN', 'ADJUST') AND NEW.points_amount > 0 THEN NEW.points_amount ELSE 0 END),
    lifetime_redeemed = customer_points.lifetime_redeemed +
      (CASE WHEN NEW.transaction_type = 'REDEEM' THEN NEW.points_amount ELSE 0 END),
    updated_at = now();

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION sync_customer_points_from_log(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sync_customer_points_from_log() IS 'migration_16 (bagian H3). Jaga customer_points tetap sinkron setiap kali earn_loyalty_points() atau redeem_loyalty_points() menulis baris baru ke loyalty_points_log. Fungsi lama itu sendiri TIDAK diubah — trigger ini murni observer tambahan di tabel log-nya.';


--
-- Name: sync_product_stock_mode(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_product_stock_mode() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_product_id UUID;
  v_has_active_recipe BOOLEAN;
BEGIN
  v_product_id := COALESCE(NEW.product_id, OLD.product_id);

  SELECT EXISTS (
    SELECT 1 FROM recipes WHERE product_id = v_product_id AND is_active = true
  ) INTO v_has_active_recipe;

  IF v_has_active_recipe THEN
    UPDATE products SET stock_mode = 'recipe', track_stock = false WHERE id = v_product_id AND stock_mode <> 'recipe';
  ELSE
    UPDATE products SET stock_mode = 'manual' WHERE id = v_product_id AND stock_mode <> 'manual';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: tenant_tier(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tenant_tier(p_tenant_id uuid) RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE
    WHEN super_trial_ends_at IS NOT NULL AND super_trial_ends_at > now() THEN 'supreme'
    WHEN status = 'active' AND plan = 'yearly' THEN 'supreme'
    WHEN status = 'active' AND plan = 'monthly' THEN 'pro'
    ELSE 'free'
  END
  FROM subscriptions WHERE tenant_id = p_tenant_id;
$$;


--
-- Name: trg_set_branch_slug(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_set_branch_slug() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.slug IS NULL OR trim(NEW.slug) = '' THEN
    NEW.slug := generate_branch_slug(NEW.name, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trg_subscriptions_auto_status_fn(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_subscriptions_auto_status_fn() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.status := compute_subscription_status(NEW.status, NEW.trial_ends_at, NEW.valid_until, NEW.super_trial_ends_at);
  RETURN NEW;
END;
$$;


--
-- Name: update_order_status(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_order_status(p_order_id uuid, p_new_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_allowed BOOLEAN := false;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Pesanan tidak ditemukan';
  END IF;

  IF NOT is_super_admin() AND v_order.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan pesanan tenant Anda';
  END IF;

  IF p_new_status = 'CANCELLED' THEN
    v_allowed := v_order.status NOT IN ('COMPLETED', 'CANCELLED');
  ELSE
    v_allowed := (v_order.status = 'NEW' AND p_new_status = 'ACCEPTED')
      OR (v_order.status = 'ACCEPTED' AND p_new_status = 'PREPARING')
      OR (v_order.status = 'PREPARING' AND p_new_status = 'READY')
      OR (v_order.status = 'READY' AND p_new_status = 'SERVED')
      OR (v_order.status = 'SERVED' AND p_new_status = 'COMPLETED');
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transisi status tidak valid: % -> %', v_order.status, p_new_status;
  END IF;

  UPDATE orders SET
    status = p_new_status,
    accepted_at = CASE WHEN p_new_status = 'ACCEPTED' THEN now() ELSE accepted_at END,
    preparing_at = CASE WHEN p_new_status = 'PREPARING' THEN now() ELSE preparing_at END,
    ready_at = CASE WHEN p_new_status = 'READY' THEN now() ELSE ready_at END,
    served_at = CASE WHEN p_new_status = 'SERVED' THEN now() ELSE served_at END,
    completed_at = CASE WHEN p_new_status = 'COMPLETED' THEN now() ELSE completed_at END,
    cancelled_at = CASE WHEN p_new_status = 'CANCELLED' THEN now() ELSE cancelled_at END
  WHERE id = p_order_id;
END;
$$;


--
-- Name: update_reservation_status(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_reservation_status(p_reservation_id uuid, p_new_status text, p_table_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_res reservations%ROWTYPE;
  v_allowed BOOLEAN := false;
BEGIN
  IF NOT is_manager_or_owner() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Manager/Owner yang boleh mengubah status reservasi';
  END IF;

  SELECT * INTO v_res FROM reservations WHERE id = p_reservation_id;
  IF v_res.id IS NULL THEN
    RAISE EXCEPTION 'Reservasi tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_res.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan reservasi tenant Anda';
  END IF;

  IF p_new_status IN ('cancelled', 'no_show') THEN
    v_allowed := v_res.status NOT IN ('completed', 'cancelled', 'no_show');
  ELSE
    v_allowed := (v_res.status = 'pending' AND p_new_status = 'confirmed')
      OR (v_res.status = 'confirmed' AND p_new_status = 'seated')
      OR (v_res.status = 'seated' AND p_new_status = 'completed');
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Transisi status tidak valid: % -> %', v_res.status, p_new_status;
  END IF;

  UPDATE reservations SET
    status = p_new_status,
    table_id = COALESCE(p_table_id, table_id)
  WHERE id = p_reservation_id;
END;
$$;


--
-- Name: validate_ingredient_availability(uuid, uuid, uuid[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_ingredient_availability(p_branch_id uuid, p_recipe_id uuid, p_modifier_ids uuid[], p_qty integer) RETURNS TABLE(ingredient_id uuid, ingredient_name text, required_qty numeric, available_qty numeric, is_sufficient boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT
    r.ingredient_id,
    i.name,
    r.quantity * p_qty,
    COALESCE(bis.stock_qty, 0),
    COALESCE(bis.stock_qty, 0) >= (r.quantity * p_qty)
  FROM recipe_ingredient_requirements(p_recipe_id, p_modifier_ids) r
  JOIN ingredients i ON i.id = r.ingredient_id
  LEFT JOIN branch_ingredients_stock bis
    ON bis.branch_id = p_branch_id AND bis.ingredient_id = r.ingredient_id;
$$;


--
-- Name: verify_supervisor_pin(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_supervisor_pin(p_pin text, p_branch_id uuid DEFAULT NULL::uuid) RETURNS TABLE(supervisor_id uuid, supervisor_name text, supervisor_role text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_pin IS NULL OR trim(p_pin) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.full_name, p.role::TEXT
  FROM profiles p
  WHERE p.tenant_id = current_tenant_id()
    AND p.is_active = true
    AND p.role IN ('manager', 'owner', 'super_admin')
    AND p.pin_hash IS NOT NULL
    AND p.pin_hash = crypt(p_pin, p.pin_hash)
    -- Owner/super_admin akses semua cabang; manager dicocokkan ke
    -- cabang yang sama dengan tempat aksi terjadi (kalau diberikan).
    AND (p_branch_id IS NULL OR p.role IN ('owner', 'super_admin') OR p.branch_id = p_branch_id)
  ORDER BY (p.role = 'manager') DESC -- utamakan manager cabang setempat kalau ada beberapa cocok
  LIMIT 1;
END;
$$;


--
-- Name: FUNCTION verify_supervisor_pin(p_pin text, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.verify_supervisor_pin(p_pin text, p_branch_id uuid) IS 'Migrasi 019: dipakai SupervisorPinModal untuk validasi PIN sebelum tindakan sensitif. Tidak pernah mengembalikan pin_hash. Kosong (0 baris) berarti PIN salah/tidak ada supervisor cocok.';


--
-- Name: void_order_item(uuid, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_order_item(p_order_item_id uuid, p_void_qty integer, p_reason text, p_supervisor_pin text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_item order_items%ROWTYPE;
  v_order orders%ROWTYPE;
  v_amount NUMERIC;
  v_supervisor_id UUID;
BEGIN
  SELECT * INTO v_item FROM order_items WHERE id = p_order_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'Item pesanan tidak ditemukan';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_item.order_id;
  IF NOT is_super_admin() AND v_order.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan pesanan tenant Anda';
  END IF;
  IF v_order.status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Pesanan sudah selesai/dibatalkan — gunakan Refund, bukan Void, untuk pesanan yang sudah lunas';
  END IF;

  IF p_void_qty IS NULL OR p_void_qty <= 0 OR p_void_qty > (v_item.qty - v_item.voided_qty) THEN
    RAISE EXCEPTION 'Qty void tidak valid (tersisa % dari % yang bisa di-void)', (v_item.qty - v_item.voided_qty), v_item.qty;
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Alasan void wajib diisi';
  END IF;

  v_amount := v_item.unit_price * p_void_qty;

  -- Migrasi 019: PIN supervisor wajib untuk kasir (peran apa pun,
  -- berapa pun nominalnya) — menggantikan pengecekan is_manager_or_owner()
  -- polos di migration_016 dengan gerbang PIN yang juga tercatat sendiri.
  v_supervisor_id := require_supervisor_authorization(
    'VOID_ITEM', 'order_item', p_order_item_id, v_order.tenant_id, v_order.branch_id,
    p_reason, p_supervisor_pin, jsonb_build_object('amount', v_amount, 'void_qty', p_void_qty)
  );

  IF NOT is_manager_or_owner() AND NOT is_super_admin() AND v_supervisor_id IS NULL AND v_amount > 50000 THEN
    RAISE EXCEPTION 'APPROVAL_REQUIRED: Void di atas Rp50.000 wajib persetujuan manager';
  END IF;

  UPDATE order_items SET
    voided_qty = voided_qty + p_void_qty,
    void_reason = p_reason,
    voided_by = auth.uid(),
    voided_at = now()
  WHERE id = p_order_item_id;

  INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, old_value, new_value, reason)
    VALUES (
      v_order.tenant_id, v_order.branch_id, auth.uid(), 'VOID_ITEM', 'order_item', p_order_item_id,
      jsonb_build_object('voided_qty', v_item.voided_qty),
      jsonb_build_object('voided_qty', v_item.voided_qty + p_void_qty, 'amount', v_amount, 'authorized_by', v_supervisor_id),
      p_reason
    );
END;
$$;


--
-- Name: admin_special_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_special_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    trial_days integer DEFAULT 5 NOT NULL,
    discount_pct numeric DEFAULT 2 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    max_uses integer,
    used_count integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    requested_by uuid,
    type text NOT NULL,
    target_id uuid,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    employee_id uuid,
    type text NOT NULL,
    date_start date NOT NULL,
    date_end date NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    user_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    old_value jsonb,
    new_value jsonb,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE audit_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_log IS 'Log audit generik lintas fitur (Phase 2). Append-only lewat desain: tidak ada policy UPDATE/DELETE, jadi kasir/manager tidak bisa mengedit histori lewat client mana pun.';


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    name text NOT NULL,
    price numeric NOT NULL,
    category text,
    image_url text,
    is_available boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    cost_price numeric DEFAULT 0 NOT NULL,
    track_stock boolean DEFAULT false NOT NULL,
    stock_qty numeric DEFAULT 0 NOT NULL,
    low_stock_threshold numeric DEFAULT 5 NOT NULL,
    station_id uuid,
    stock_mode text DEFAULT 'manual'::text NOT NULL,
    CONSTRAINT products_stock_mode_check CHECK ((stock_mode = ANY (ARRAY['manual'::text, 'recipe'::text])))
);

ALTER TABLE ONLY public.products REPLICA IDENTITY FULL;


--
-- Name: COLUMN products.cost_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.cost_price IS 'HPP (Harga Pokok Penjualan) per unit — dipakai untuk hitung estimasi laba kotor di Laporan PDF.';


--
-- Name: COLUMN products.track_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.track_stock IS 'Kalau true, stock_qty otomatis berkurang tiap checkout & produk ini muncul di halaman Stok & HPP.';


--
-- Name: COLUMN products.stock_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.stock_mode IS 'migration_16. "recipe" = made-to-order, stok murni dari branch_ingredients_stock via resep aktif (diset otomatis oleh trigger sync_product_stock_mode, JANGAN diubah manual dari client). "manual" = stok dilacak langsung di products/branch_stock seperti sebelum Phase 1 F&B Core.';


--
-- Name: transaction_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid,
    product_id uuid,
    qty integer NOT NULL,
    subtotal numeric NOT NULL,
    variant_id uuid,
    variant_name text,
    modifier_selections jsonb DEFAULT '[]'::jsonb NOT NULL,
    recipe_id uuid,
    recipe_version integer,
    unit_price numeric,
    restored_qty integer DEFAULT 0 NOT NULL
);


--
-- Name: COLUMN transaction_items.restored_qty; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transaction_items.restored_qty IS 'Migrasi 019: qty dari item ini yang stoknya SUDAH dikembalikan lewat revert_recipe_stock() (dipanggil dari toggle "Restore Stock to Inventory" di RefundModal). Mencegah pengembalian stok dobel kalau 1 transaksi direfund bertahap.';


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    cashier_id uuid,
    shift_id uuid,
    invoice_number text NOT NULL,
    total_amount numeric NOT NULL,
    payment_method text DEFAULT 'cash'::text,
    member_id uuid,
    is_offline_sync boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    branch_id uuid,
    order_id uuid,
    split_group_label text,
    customer_id uuid,
    voucher_id uuid,
    promotion_id uuid,
    subtotal_amount numeric,
    discount_amount numeric DEFAULT 0,
    loyalty_points_earned integer DEFAULT 0
);


--
-- Name: COLUMN transactions.subtotal_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.subtotal_amount IS 'Subtotal sebelum diskon apa pun — dipakai untuk analitik "discount rate" (rule #43 master prompt).';


--
-- Name: COLUMN transactions.discount_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.discount_amount IS 'Total diskon (member + promosi/voucher, TIDAK termasuk penukaran poin loyalitas) yang benar-benar diterapkan server saat checkout.';


--
-- Name: best_seller_analytics; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.best_seller_analytics WITH (security_invoker='true') AS
 SELECT t.tenant_id,
    t.branch_id,
    p.name AS product_name,
    sum(ti.qty) AS total_qty
   FROM ((public.transaction_items ti
     JOIN public.transactions t ON ((t.id = ti.transaction_id)))
     JOIN public.products p ON ((p.id = ti.product_id)))
  GROUP BY t.tenant_id, t.branch_id, p.name;


--
-- Name: branch_ingredients_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branch_ingredients_stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    ingredient_id uuid,
    stock_qty numeric DEFAULT 0 NOT NULL,
    low_stock_threshold numeric,
    cost_price numeric DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE branch_ingredients_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.branch_ingredients_stock IS 'Stok ingredient per (tenant, branch, ingredient) — sumber kebenaran inventory bahan baku (Phase 1).';


--
-- Name: branch_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branch_stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    product_id uuid,
    stock_qty numeric DEFAULT 0 NOT NULL,
    low_stock_threshold numeric DEFAULT 5 NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: branch_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branch_tables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    table_number text NOT NULL,
    capacity integer DEFAULT 4 NOT NULL,
    qr_token text DEFAULT encode(public.gen_random_bytes(12), 'hex'::text) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    needs_cleaning boolean DEFAULT false NOT NULL,
    cleaning_started_at timestamp with time zone,
    bill_printed_at timestamp with time zone
);


--
-- Name: COLUMN branch_tables.needs_cleaning; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.branch_tables.needs_cleaning IS 'Phase 2 Update 1: diset true otomatis oleh checkout_order_v2() begitu order dine-in di meja ini lunas. Kasir/manager membersihkan lalu set false lewat tombol "Selesai Dibersihkan" (update langsung, RLS branch-scoped sudah menegakkan izin).';


--
-- Name: COLUMN branch_tables.bill_printed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.branch_tables.bill_printed_at IS 'Migrasi 019: diset lewat mark_bill_printed() saat kasir mencetak bill (pra-bayar) untuk order aktif di meja ini. table_live_status membaca ini untuk status BILL_PRINTED (di antara OCCUPIED dan CLEANING). Dibersihkan otomatis saat order lunas/batal.';


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    name text NOT NULL,
    address text,
    is_main boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    slug text NOT NULL
);


--
-- Name: COLUMN branches.is_main; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.branches.is_main IS 'Cabang pertama tenant, dibuat otomatis lewat trigger create_main_branch_for_tenant(). Dipakai sebagai fallback saat sebuah request tidak menyertakan branch_id secara eksplisit.';


--
-- Name: budget_vs_actual; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.budget_vs_actual AS
SELECT
    NULL::uuid AS budget_id,
    NULL::uuid AS tenant_id,
    NULL::uuid AS branch_id,
    NULL::uuid AS category_id,
    NULL::integer AS period_year,
    NULL::integer AS period_month,
    NULL::numeric AS budget_amount,
    NULL::numeric AS actual_amount,
    NULL::numeric AS pct_used,
    NULL::numeric AS warning_threshold_pct,
    NULL::numeric AS critical_threshold_pct,
    NULL::text AS status;


--
-- Name: VIEW budget_vs_actual; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.budget_vs_actual IS 'Rule #8 — real-time budget vs actual. RLS pada budgets/expenses dasarnya sudah membatasi baris yang terlihat, tapi view ini SECURITY INVOKER (default) supaya tetap mewarisi RLS caller, bukan security definer.';


--
-- Name: budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid,
    category_id uuid,
    period_year integer NOT NULL,
    period_month integer NOT NULL,
    amount numeric NOT NULL,
    warning_threshold_pct numeric DEFAULT 80 NOT NULL,
    critical_threshold_pct numeric DEFAULT 100 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT budgets_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT budgets_critical_threshold_pct_check CHECK (((critical_threshold_pct >= (0)::numeric) AND (critical_threshold_pct <= (200)::numeric))),
    CONSTRAINT budgets_period_month_check CHECK (((period_month >= 1) AND (period_month <= 12))),
    CONSTRAINT budgets_period_year_check CHECK (((period_year >= 2000) AND (period_year <= 2100))),
    CONSTRAINT budgets_warning_threshold_pct_check CHECK (((warning_threshold_pct >= (0)::numeric) AND (warning_threshold_pct <= (100)::numeric)))
);


--
-- Name: TABLE budgets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.budgets IS 'Rule #8 — Monthly/Branch/Category budget. Perbandingan vs actual dihitung oleh view budget_vs_actual di bawah, bukan disimpan sebagai angka statis (supaya selalu real-time terhadap expenses terbaru).';


--
-- Name: cash_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    shift_id uuid,
    type text NOT NULL,
    amount numeric NOT NULL,
    reason text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT cash_movements_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT cash_movements_type_check CHECK ((type = ANY (ARRAY['cash_in'::text, 'cash_out'::text])))
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    shift_id uuid,
    cashier_id uuid,
    order_number text NOT NULL,
    order_type text DEFAULT 'dine_in'::text NOT NULL,
    table_number text,
    customer_name text,
    status text DEFAULT 'NEW'::text NOT NULL,
    notes text,
    accepted_at timestamp with time zone,
    preparing_at timestamp with time zone,
    ready_at timestamp with time zone,
    served_at timestamp with time zone,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    transaction_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    channel text DEFAULT 'pos'::text NOT NULL,
    channel_commission_amount numeric DEFAULT 0 NOT NULL,
    table_id uuid,
    manual_discount_amount numeric DEFAULT 0 NOT NULL,
    manual_discount_reason text,
    manual_discount_by uuid,
    CONSTRAINT orders_channel_check CHECK ((channel = ANY (ARRAY['pos'::text, 'qr_self_order'::text, 'reservation'::text, 'gofood'::text, 'grabfood'::text, 'shopeefood'::text, 'website'::text]))),
    CONSTRAINT orders_order_type_check CHECK ((order_type = ANY (ARRAY['dine_in'::text, 'takeaway'::text, 'delivery'::text]))),
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['NEW'::text, 'ACCEPTED'::text, 'PREPARING'::text, 'READY'::text, 'SERVED'::text, 'COMPLETED'::text, 'CANCELLED'::text])))
);


--
-- Name: TABLE orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.orders IS 'Order F&B untuk Kitchen Display System (Phase 2). Timestamp per status (accepted_at, preparing_at, dst) dipakai untuk menghitung durasi/timer penyiapan di KDS.';


--
-- Name: COLUMN orders.manual_discount_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.orders.manual_discount_amount IS 'Migrasi 019: potongan manual (Rupiah, bukan persen member) yang diberikan kasir dengan otorisasi PIN supervisor. Ditambahkan ke checkout_order_v2() di atas diskon member yang sudah ada.';


--
-- Name: channel_commission_report; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.channel_commission_report WITH (security_invoker='true') AS
 SELECT t.tenant_id,
    o.branch_id,
    o.channel,
    date(t.created_at) AS sale_date,
    count(DISTINCT t.id) AS total_orders,
    sum(t.total_amount) AS gross_revenue,
    sum(o.channel_commission_amount) AS total_commission,
    sum((t.total_amount - o.channel_commission_amount)) AS net_revenue
   FROM (public.transactions t
     JOIN public.orders o ON ((o.id = t.order_id)))
  WHERE (o.channel <> 'pos'::text)
  GROUP BY t.tenant_id, o.branch_id, o.channel, (date(t.created_at));


--
-- Name: channel_pricings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_pricings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    product_id uuid,
    channel text NOT NULL,
    markup_pct numeric DEFAULT 0 NOT NULL,
    commission_pct numeric DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT channel_pricings_channel_check CHECK ((channel = ANY (ARRAY['gofood'::text, 'grabfood'::text, 'shopeefood'::text, 'website'::text])))
);


--
-- Name: customer_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    customer_id uuid,
    points_balance integer DEFAULT 0 NOT NULL,
    lifetime_earned integer DEFAULT 0 NOT NULL,
    lifetime_redeemed integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE customer_points; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_points IS 'migration_16 (bagian H2). Cache saldo poin per pelanggan, disinkronkan otomatis oleh trigger trg_sync_customer_points dari loyalty_points_log — JANGAN diupdate manual dari client, saldo sebenarnya tetap loyalty_points_log (audit trail).';


--
-- Name: customer_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    tier_name text NOT NULL,
    min_spend_monthly numeric DEFAULT 0,
    min_spend_yearly numeric DEFAULT 0,
    discount_percentage numeric DEFAULT 0,
    points_multiplier numeric DEFAULT 1,
    benefits text[] DEFAULT '{}'::text[],
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE customer_tiers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customer_tiers IS 'Definisi tingkatan member dengan benefit berbeda (Phase 3).';


--
-- Name: member_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    member_code text DEFAULT ((((('MBR-'::text || to_char(now(), 'YYYY'::text)) || '-'::text) || lpad((nextval('public.member_seq'::regclass))::text, 4, '0'::text)) || '-'::text) || upper(substr(md5((gen_random_uuid())::text), 1, 4))),
    discount_percentage numeric DEFAULT 10,
    valid_until timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: customer_visit_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.customer_visit_stats WITH (security_invoker='true') AS
 SELECT m.tenant_id,
    m.id AS member_id,
    m.customer_name,
    m.customer_phone,
    count(t.id) AS visit_count,
    COALESCE(sum(t.total_amount), (0)::numeric) AS lifetime_value,
    min(t.created_at) AS first_visit_at,
    max(t.created_at) AS last_visit_at,
        CASE
            WHEN (max(t.created_at) IS NULL) THEN NULL::integer
            ELSE (EXTRACT(day FROM (now() - max(t.created_at))))::integer
        END AS days_since_last_visit,
    (count(t.id) > 1) AS is_repeat_customer
   FROM (public.memberships m
     LEFT JOIN public.transactions t ON ((t.member_id = m.id)))
  GROUP BY m.tenant_id, m.id, m.customer_name, m.customer_phone;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    customer_code text NOT NULL,
    customer_name text NOT NULL,
    phone_number text,
    whatsapp_number text,
    email text,
    address text,
    city text,
    province text,
    birthday date,
    favorite_menu text[] DEFAULT '{}'::text[],
    visit_count integer DEFAULT 0,
    lifetime_spend numeric DEFAULT 0,
    last_visit_date timestamp with time zone,
    tier_id uuid,
    is_active boolean DEFAULT true,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE customers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.customers IS 'Master data pelanggan untuk CRM & loyalty program (Phase 3).';


--
-- Name: daily_sales_analytics; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.daily_sales_analytics WITH (security_invoker='true') AS
 SELECT tenant_id,
    branch_id,
    date(created_at) AS sale_date,
    count(id) AS total_orders,
    sum(total_amount) AS total_revenue
   FROM public.transactions
  GROUP BY tenant_id, branch_id, (date(created_at));


--
-- Name: expense_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: goods_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goods_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    po_id uuid,
    grn_number text NOT NULL,
    receipt_date timestamp with time zone DEFAULT now(),
    supplier_id uuid,
    notes text,
    received_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE goods_receipts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.goods_receipts IS 'Goods Receipt Note (GRN) - penerimaan barang fisik (Phase 3).';


--
-- Name: grn_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grn_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    grn_id uuid,
    po_item_id uuid,
    product_id uuid,
    product_name text NOT NULL,
    unit text NOT NULL,
    qty_received numeric NOT NULL,
    unit_price numeric NOT NULL,
    actual_cost numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    ingredient_id uuid,
    purchase_unit text,
    CONSTRAINT grn_items_qty_received_check CHECK ((qty_received > (0)::numeric))
);


--
-- Name: TABLE grn_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grn_items IS 'Item yang diterima dalam GRN. Digunakan untuk update stok dan perhitungan HPP weighted average.';


--
-- Name: inactive_customers; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.inactive_customers WITH (security_invoker='true') AS
 SELECT tenant_id,
    member_id,
    customer_name,
    customer_phone,
    visit_count,
    lifetime_value,
    first_visit_at,
    last_visit_at,
    days_since_last_visit,
    is_repeat_customer
   FROM public.customer_visit_stats
  WHERE ((last_visit_at IS NOT NULL) AND (days_since_last_visit > 30));


--
-- Name: ingredient_stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingredient_stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    ingredient_id uuid,
    type text NOT NULL,
    qty_change numeric NOT NULL,
    unit text,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ingredient_stock_movements_type_check CHECK ((type = ANY (ARRAY['PURCHASE'::text, 'SALE'::text, 'RECIPE_CONSUMPTION'::text, 'WASTE'::text, 'SPOILAGE'::text, 'DAMAGE'::text, 'ADJUSTMENT'::text, 'STOCK_OPNAME'::text, 'TRANSFER_IN'::text, 'TRANSFER_OUT'::text, 'REFUND'::text, 'RETURN'::text])))
);


--
-- Name: ingredient_stock_opname_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingredient_stock_opname_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    ingredient_id uuid,
    system_qty numeric NOT NULL,
    physical_qty numeric NOT NULL,
    difference_qty numeric NOT NULL,
    cost_price_snapshot numeric DEFAULT 0 NOT NULL,
    loss_value numeric DEFAULT 0 NOT NULL,
    reason text,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ingredient_waste_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingredient_waste_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    ingredient_id uuid,
    waste_type text NOT NULL,
    qty_wasted numeric NOT NULL,
    cost_price numeric DEFAULT 0 NOT NULL,
    total_loss_amount numeric DEFAULT 0 NOT NULL,
    note text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ingredient_waste_logs_qty_wasted_check CHECK ((qty_wasted > (0)::numeric)),
    CONSTRAINT ingredient_waste_logs_waste_type_check CHECK ((waste_type = ANY (ARRAY['EXPIRED'::text, 'DAMAGED'::text, 'SPOILED'::text, 'SPILLAGE'::text, 'WRONG_PREPARATION'::text, 'STAFF_MEAL'::text, 'LOSS'::text, 'OTHER'::text])))
);


--
-- Name: TABLE ingredient_waste_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ingredient_waste_logs IS 'Waste ingredient (Phase 1) — terpisah dari waste_logs lama (product-based di migration_013), yang TIDAK dihapus.';


--
-- Name: ingredients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingredients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    name text NOT NULL,
    category text,
    purchase_unit text NOT NULL,
    inventory_unit text NOT NULL,
    purchase_to_inventory_ratio numeric,
    low_stock_threshold numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    is_86 boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ingredients_purchase_to_inventory_ratio_check CHECK (((purchase_to_inventory_ratio IS NULL) OR (purchase_to_inventory_ratio > (0)::numeric))),
    CONSTRAINT ingredients_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
);


--
-- Name: TABLE ingredients; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ingredients IS 'Ingredient/material master (Phase 1). Termasuk packaging (cup/lid/straw/bungkus). Tidak boleh hard-delete kalau sudah dipakai recipe/histori — lihat trigger prevent_ingredient_hard_delete.';


--
-- Name: kitchen_stations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kitchen_stations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    name text NOT NULL,
    code text NOT NULL,
    printer_name text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE kitchen_stations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kitchen_stations IS 'Stasiun dapur per cabang (Phase 2). Item menu di-assign ke satu stasiun lewat products.station_id supaya KDS & printer routing tahu tiket harus tampil/cetak di layar/printer mana.';


--
-- Name: loyalty_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    points_per_rupiah numeric DEFAULT 0.1,
    points_expiry_days integer DEFAULT 365,
    min_points_for_redemption integer DEFAULT 100,
    min_purchase_for_points numeric DEFAULT 0,
    is_enabled boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    redeem_rupiah_per_point numeric DEFAULT 100 NOT NULL
);


--
-- Name: TABLE loyalty_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.loyalty_config IS 'Konfigurasi sistem poin loyalitas per tenant (Phase 3).';


--
-- Name: COLUMN loyalty_config.redeem_rupiah_per_point; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.loyalty_config.redeem_rupiah_per_point IS 'migration_16. Nilai 1 poin saat ditukar jadi potongan Rupiah di kasir — dipakai frontend (POS) untuk menghitung p_discount_amount sebelum memanggil redeem_loyalty_points(). Tidak divalidasi ulang oleh redeem_loyalty_points() (fungsi lama, tidak diubah) — potongan tetap dibatasi wajar oleh UI (lihat components/crm/MemberCardModal.tsx & app/pos/page.tsx).';


--
-- Name: loyalty_points_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_points_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    customer_id uuid,
    transaction_id uuid,
    transaction_type text NOT NULL,
    points_amount integer NOT NULL,
    description text,
    balance_after integer,
    expiry_date date,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT loyalty_points_log_transaction_type_check CHECK ((transaction_type = ANY (ARRAY['EARN'::text, 'REDEEM'::text, 'EXPIRE'::text, 'ADJUST'::text])))
);


--
-- Name: TABLE loyalty_points_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.loyalty_points_log IS 'Audit trail poin loyalitas (earn, redeem, expire) (Phase 3).';


--
-- Name: modifier_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modifier_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    name text NOT NULL,
    is_required boolean DEFAULT false NOT NULL,
    min_select integer DEFAULT 0 NOT NULL,
    max_select integer DEFAULT 1 NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT modifier_groups_check CHECK ((min_select <= max_select))
);


--
-- Name: modifier_ingredient_impacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modifier_ingredient_impacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    modifier_id uuid,
    ingredient_id uuid,
    quantity_delta numeric NOT NULL,
    unit text NOT NULL
);


--
-- Name: TABLE modifier_ingredient_impacts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.modifier_ingredient_impacts IS 'Dampak modifier ke konsumsi ingredient (Phase 1), mis. Extra Shot = +9g Coffee Beans, Oat Milk = +150ml Oat Milk, Less Sugar = -5g Sugar.';


--
-- Name: modifiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modifiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    modifier_group_id uuid,
    name text NOT NULL,
    price_adjustment numeric DEFAULT 0 NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: monthly_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    year integer NOT NULL,
    month integer NOT NULL,
    target_amount numeric DEFAULT 0 NOT NULL,
    created_by uuid,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT monthly_targets_month_check CHECK (((month >= 1) AND (month <= 12)))
);


--
-- Name: order_item_modifiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_item_modifiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_item_id uuid NOT NULL,
    modifier_id uuid,
    name text NOT NULL,
    price_adjustment numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE order_item_modifiers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.order_item_modifiers IS 'Versi ternormalisasi dari order_items.modifier_selections (Migrasi 019). Diisi otomatis oleh create_kitchen_order(). Dipakai deduct_recipe_stock() untuk resolusi modifier & untuk laporan modifier terlaris tanpa parsing JSONB.';


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    product_id uuid,
    station_id uuid,
    product_name text NOT NULL,
    variant_notes text,
    qty integer NOT NULL,
    unit_price numeric NOT NULL,
    subtotal numeric NOT NULL,
    item_status text DEFAULT 'NEW'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    voided_qty integer DEFAULT 0 NOT NULL,
    void_reason text,
    voided_by uuid,
    voided_at timestamp with time zone,
    variant_id uuid,
    variant_name text,
    modifier_selections jsonb DEFAULT '[]'::jsonb NOT NULL,
    recipe_id uuid,
    recipe_version integer,
    original_unit_price numeric,
    price_override_reason text,
    price_overridden_by uuid,
    price_overridden_at timestamp with time zone,
    split_billed_qty integer DEFAULT 0 NOT NULL,
    CONSTRAINT order_items_item_status_check CHECK ((item_status = ANY (ARRAY['NEW'::text, 'PREPARING'::text, 'READY'::text]))),
    CONSTRAINT order_items_qty_check CHECK ((qty > 0))
);


--
-- Name: COLUMN order_items.voided_qty; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.voided_qty IS 'Phase 2 Update 3: qty yang dibatalkan dari qty asli. Baris item TIDAK pernah dihapus/diubah qty aslinya — sisa yang ditagih dihitung (qty - voided_qty) di checkout_order_v2().';


--
-- Name: COLUMN order_items.original_unit_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.original_unit_price IS 'Migrasi 019: harga asli SEBELUM override_item_price() dipanggil (NULL = belum pernah di-override). unit_price yang dipakai checkout tetap kolom unit_price yang sudah ada — ini murni jejak audit.';


--
-- Name: COLUMN order_items.split_billed_qty; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.order_items.split_billed_qty IS 'Migrasi 019: qty dari item ini yang SUDAH masuk salah satu sub-bill Split by Item. Sisa yang belum tertagih = qty - voided_qty - split_billed_qty. Order baru COMPLETED setelah semua item habis tertagih (lewat split ATAU checkout_order_v2 biasa).';


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    order_id text NOT NULL,
    plan text NOT NULL,
    amount numeric NOT NULL,
    discount_pct numeric DEFAULT 0,
    status text DEFAULT 'pending'::text NOT NULL,
    raw_response jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: peak_hours_analytics; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.peak_hours_analytics WITH (security_invoker='true') AS
 SELECT t.tenant_id,
    ord.branch_id,
    (EXTRACT(hour FROM t.created_at))::integer AS hour_of_day,
    count(DISTINCT t.id) AS total_orders,
    count(DISTINCT ti.id) AS item_count,
    sum(ti.qty) AS total_qty,
    sum(t.total_amount) AS total_revenue,
    avg(t.total_amount) AS avg_transaction_value
   FROM ((public.transactions t
     LEFT JOIN public.transaction_items ti ON ((t.id = ti.transaction_id)))
     LEFT JOIN public.orders ord ON ((t.order_id = ord.id)))
  WHERE (t.created_at >= (CURRENT_DATE - '30 days'::interval))
  GROUP BY t.tenant_id, ord.branch_id, ((EXTRACT(hour FROM t.created_at))::integer);


--
-- Name: VIEW peak_hours_analytics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.peak_hours_analytics IS 'View untuk analisis jam-jam sibuk (Phase 3).';


--
-- Name: po_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.po_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id uuid,
    product_id uuid,
    product_name text NOT NULL,
    unit text NOT NULL,
    qty_ordered numeric NOT NULL,
    qty_received numeric DEFAULT 0,
    unit_price numeric NOT NULL,
    subtotal numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ingredient_id uuid,
    purchase_unit text,
    CONSTRAINT po_items_qty_ordered_check CHECK ((qty_ordered > (0)::numeric)),
    CONSTRAINT po_items_unit_price_check CHECK ((unit_price > (0)::numeric))
);


--
-- Name: TABLE po_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.po_items IS 'Item detail dalam PO. qty_received diupdate saat Goods Receipt (GRN).';


--
-- Name: COLUMN po_items.ingredient_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.po_items.ingredient_id IS 'Isi ini untuk pembelian bahan baku/material (ingredient). product_id lama tetap dipakai untuk pembelian produk jadi (kalau ada). Salah satu harus terisi.';


--
-- Name: product_modifier_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_modifier_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    modifier_group_id uuid,
    display_order integer DEFAULT 0 NOT NULL
);


--
-- Name: product_profitability; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.product_profitability WITH (security_invoker='true') AS
 SELECT p.id,
    p.tenant_id,
    ord.branch_id,
    p.name AS product_name,
    p.category,
    count(DISTINCT ti.id) AS sale_count,
    sum(ti.qty) AS total_qty_sold,
    sum(ti.subtotal) AS total_revenue,
    COALESCE(avg(p.cost_price), (0)::numeric) AS avg_cost_price,
    ((sum(ti.qty))::numeric * COALESCE(avg(p.cost_price), (0)::numeric)) AS total_cogs,
    (sum(ti.subtotal) - ((sum(ti.qty))::numeric * COALESCE(avg(p.cost_price), (0)::numeric))) AS gross_profit,
    round((((sum(ti.subtotal) - ((sum(ti.qty))::numeric * COALESCE(avg(p.cost_price), (0)::numeric))) / NULLIF(sum(ti.subtotal), (0)::numeric)) * (100)::numeric), 2) AS profit_margin_pct,
    max(tr.created_at) AS last_sale_date
   FROM (((public.products p
     LEFT JOIN public.transaction_items ti ON ((p.id = ti.product_id)))
     LEFT JOIN public.transactions tr ON ((ti.transaction_id = tr.id)))
     LEFT JOIN public.orders ord ON ((tr.order_id = ord.id)))
  GROUP BY p.id, p.tenant_id, ord.branch_id, p.name, p.category;


--
-- Name: VIEW product_profitability; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.product_profitability IS 'View untuk laporan profitabilitas per produk (Phase 3). Fixed in Phase 2A.1 audit: corrected column names to match actual products schema, added branch_id.';


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    product_id uuid,
    name text NOT NULL,
    sku text,
    price numeric NOT NULL,
    cost_price numeric,
    is_available boolean DEFAULT true NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT product_variants_price_check CHECK ((price >= (0)::numeric))
);


--
-- Name: TABLE product_variants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.product_variants IS 'Varian produk terstruktur (Phase 1). variant_notes bebas-teks lama tetap dipertahankan untuk order lama.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    tenant_id uuid,
    role public.user_role DEFAULT 'cashier'::public.user_role,
    job_title text,
    full_name text,
    email text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    branch_id uuid,
    pin_hash text,
    pin_updated_at timestamp with time zone
);


--
-- Name: COLUMN profiles.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.role IS 'Role sistem. Pemetaan label UI Manajemen Karyawan (Single Source of Truth sejak migration_16): owner -> "Admin", manager -> "Supervisor", cashier -> "Kasir", kitchen -> "Dapur". super_admin khusus operator platform caPOS, tidak dibuat lewat Manajemen Karyawan tenant manapun.';


--
-- Name: COLUMN profiles.branch_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.branch_id IS 'Cabang penugasan karyawan (manager/cashier). NULL = owner/super_admin (akses semua cabang tenant).';


--
-- Name: COLUMN profiles.pin_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.pin_hash IS 'Migrasi 019: hash bcrypt PIN supervisor (4-6 digit). NULL = belum diset. Hanya diisi lewat set_supervisor_pin() oleh manager/owner/super_admin untuk akun mereka SENDIRI — tidak ada jalur untuk mengeset PIN akun orang lain.';


--
-- Name: promotion_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotion_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promotion_id uuid,
    rule_type text NOT NULL,
    rule_value text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT promotion_rules_rule_type_check CHECK ((rule_type = ANY (ARRAY['MIN_PURCHASE'::text, 'MAX_DISCOUNT'::text, 'CATEGORY'::text, 'MEMBER_ONLY'::text, 'HAPPY_HOUR'::text, 'SPECIFIC_PRODUCT'::text])))
);


--
-- Name: TABLE promotion_rules; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.promotion_rules IS 'Aturan detail untuk setiap promosi (minimum pembelian, max diskon, jam berlaku, dst).';


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    promo_name text NOT NULL,
    promo_code text,
    promo_type text NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    start_date timestamp with time zone DEFAULT now(),
    end_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT promotions_promo_type_check CHECK ((promo_type = ANY (ARRAY['PERCENTAGE'::text, 'NOMINAL'::text, 'BOGO'::text, 'BUNDLE'::text])))
);


--
-- Name: TABLE promotions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.promotions IS 'Master promosi dengan berbagai tipe (Phase 3).';


--
-- Name: purchase_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    po_id uuid,
    supplier_id uuid,
    invoice_number text NOT NULL,
    invoice_date date,
    due_date date,
    amount numeric NOT NULL,
    status text DEFAULT 'UNPAID'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT purchase_invoices_status_check CHECK ((status = ANY (ARRAY['UNPAID'::text, 'partial_paid'::text, 'PAID'::text])))
);


--
-- Name: TABLE purchase_invoices; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.purchase_invoices IS 'Invoice pembelian dari pemasok untuk tracking pembayaran & audit.';


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    supplier_id uuid,
    po_number text NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    po_date timestamp with time zone DEFAULT now(),
    expected_delivery_date date,
    received_date date,
    subtotal_amount numeric DEFAULT 0,
    tax_amount numeric DEFAULT 0,
    total_amount numeric DEFAULT 0,
    notes text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT purchase_orders_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'SENT'::text, 'CONFIRMED'::text, 'PARTIAL_RECEIVED'::text, 'RECEIVED'::text, 'CANCELLED'::text])))
);


--
-- Name: TABLE purchase_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.purchase_orders IS 'Purchase Order (PO) ke pemasok (Phase 3). Dokumen pemesanan bahan baku berdasarkan low stock alert.';


--
-- Name: qr_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qr_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    table_id uuid,
    order_id uuid,
    customer_name text,
    customer_phone text,
    payment_method text NOT NULL,
    payment_status text DEFAULT 'unpaid'::text NOT NULL,
    payment_reference text,
    total_amount numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT qr_orders_payment_method_check CHECK ((payment_method = ANY (ARRAY['qris'::text, 'pay_at_cashier'::text]))),
    CONSTRAINT qr_orders_payment_status_check CHECK ((payment_status = ANY (ARRAY['unpaid'::text, 'pending'::text, 'paid'::text, 'failed'::text])))
);


--
-- Name: recipe_consumption_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recipe_consumption_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    source_type text NOT NULL,
    source_id uuid NOT NULL,
    recipe_id uuid,
    recipe_version integer,
    ingredient_id uuid,
    quantity numeric NOT NULL,
    unit text NOT NULL,
    cost_snapshot numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT recipe_consumption_logs_source_type_check CHECK ((source_type = ANY (ARRAY['order_item'::text, 'transaction_item'::text])))
);


--
-- Name: TABLE recipe_consumption_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.recipe_consumption_logs IS 'Jejak audit tiap automatic ingredient deduction (Phase 1) — dipakai untuk COGS berbasis recipe & investigasi selisih stok.';


--
-- Name: recipe_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recipe_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipe_id uuid,
    ingredient_id uuid,
    quantity numeric NOT NULL,
    unit text NOT NULL,
    wastage_percentage numeric DEFAULT 0,
    notes text,
    CONSTRAINT recipe_items_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: recipes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recipes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    product_id uuid,
    variant_id uuid,
    name text,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    yield_quantity numeric DEFAULT 1 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE recipes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.recipes IS 'Recipe/BOM (Phase 1). Mendukung versioning — recipe lama TIDAK diubah/dihapus, cukup is_active=false lalu buat baris versi baru, supaya histori transaksi lama tetap merujuk ke recipe/cost snapshot saat itu.';


--
-- Name: referral_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    referrer_tenant_id uuid,
    referred_tenant_id uuid,
    reward_granted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referrals (
    tenant_id uuid NOT NULL,
    code text NOT NULL,
    accumulated_uses integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid,
    transaction_id uuid NOT NULL,
    refund_type text NOT NULL,
    amount numeric NOT NULL,
    items jsonb,
    reason_category text NOT NULL,
    reason_note text,
    status text DEFAULT 'COMPLETED'::text NOT NULL,
    requested_by uuid,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    stock_restored boolean DEFAULT false NOT NULL,
    stock_restored_at timestamp with time zone,
    stock_restored_by uuid,
    CONSTRAINT refunds_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT refunds_reason_category_check CHECK ((reason_category = ANY (ARRAY['CUSTOMER_REQUEST'::text, 'WRONG_ORDER'::text, 'DUPLICATE_PAYMENT'::text, 'PRODUCT_UNAVAILABLE'::text, 'DAMAGED'::text, 'QUALITY_ISSUE'::text, 'OTHER'::text]))),
    CONSTRAINT refunds_refund_type_check CHECK ((refund_type = ANY (ARRAY['FULL'::text, 'PARTIAL'::text, 'ITEM'::text]))),
    CONSTRAINT refunds_status_check CHECK ((status = ANY (ARRAY['PENDING_APPROVAL'::text, 'COMPLETED'::text, 'REJECTED'::text])))
);


--
-- Name: reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reservations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    table_id uuid,
    customer_name text NOT NULL,
    customer_phone text NOT NULL,
    party_size integer NOT NULL,
    reservation_at timestamp with time zone NOT NULL,
    duration_minutes integer DEFAULT 90 NOT NULL,
    reminder_window_minutes integer DEFAULT 60 NOT NULL,
    deposit_amount numeric DEFAULT 0 NOT NULL,
    deposit_status text DEFAULT 'unpaid'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    order_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT reservations_deposit_status_check CHECK ((deposit_status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'refunded'::text, 'forfeited'::text]))),
    CONSTRAINT reservations_party_size_check CHECK ((party_size > 0)),
    CONSTRAINT reservations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'seated'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text])))
);


--
-- Name: reservation_calendar; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.reservation_calendar WITH (security_invoker='true') AS
 SELECT r.id,
    r.tenant_id,
    r.branch_id,
    r.table_id,
    bt.table_number,
    r.customer_name,
    r.customer_phone,
    r.party_size,
    r.reservation_at,
    r.duration_minutes,
    r.deposit_amount,
    r.deposit_status,
    r.status,
    r.notes
   FROM (public.reservations r
     LEFT JOIN public.branch_tables bt ON ((bt.id = r.table_id)));


--
-- Name: schema_migrations_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations_log (
    id integer NOT NULL,
    version text NOT NULL,
    description text,
    is_final boolean DEFAULT false NOT NULL,
    applied_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE schema_migrations_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.schema_migrations_log IS 'migration_16 adalah migration TERAKHIR (is_final=true). Jangan buat migration_17.sql — revisi skema selanjutnya masuk sebagai perubahan pada migration_16.sql ini (kalau belum di-apply ke production manapun) atau patch data terpisah di luar folder migrations.';


--
-- Name: schema_migrations_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schema_migrations_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: schema_migrations_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schema_migrations_log_id_seq OWNED BY public.schema_migrations_log.id;


--
-- Name: shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    cashier_id uuid,
    opened_at timestamp with time zone DEFAULT now(),
    closed_at timestamp with time zone,
    status text DEFAULT 'open'::text NOT NULL,
    branch_id uuid,
    opening_cash numeric DEFAULT 0 NOT NULL,
    closing_cash_expected numeric,
    closing_cash_actual numeric,
    cash_difference numeric,
    closing_notes text,
    closed_by uuid
);


--
-- Name: TABLE shifts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.shifts IS 'Sesi kerja kasir. Sejak migration_16, halaman "Manajemen Kasir" (/dashboard/cashiers) HANYA membaca tabel profiles (role=cashier) + shifts (status=open) untuk menampilkan monitoring kasir yang sedang bertugas. Pembuatan/pengeditan akun kasir TIDAK LAGI dilakukan dari halaman itu — satu-satunya jalur resmi adalah /dashboard/employees (Manajemen Karyawan) via /api/employees.';


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    product_id uuid,
    type text NOT NULL,
    qty_change numeric NOT NULL,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    branch_id uuid
);


--
-- Name: stock_opname_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_opname_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opname_id uuid,
    ingredient_id uuid,
    unit text,
    system_qty numeric NOT NULL,
    physical_qty numeric NOT NULL,
    difference_qty numeric NOT NULL,
    cost_price_snapshot numeric DEFAULT 0 NOT NULL,
    loss_value numeric DEFAULT 0 NOT NULL,
    reason text,
    note text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE stock_opname_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stock_opname_items IS 'Baris detail stok opname PER BAHAN BAKU (migration_16). ingredient_id adalah satu-satunya relasi produk/komponen resep di tabel ini — TIDAK ADA kolom product_id, sesuai keputusan bahwa opname mengukur bahan baku fisik, bukan produk jadi olahan.';


--
-- Name: stock_opname_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_opname_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    product_id uuid,
    system_qty numeric NOT NULL,
    physical_qty numeric NOT NULL,
    difference_qty numeric NOT NULL,
    cost_price_snapshot numeric NOT NULL,
    loss_value numeric DEFAULT 0 NOT NULL,
    reason text,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE stock_opname_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stock_opname_logs IS 'DIBEKUKAN sejak migration_16 (INSERT ditutup lewat RLS) — data lama (opname berbasis products, migration_011) dipertahankan hanya untuk histori/audit. Fitur Stok Opname aktif sekarang sepenuhnya berbasis bahan baku: lihat stock_opnames / stock_opname_items / submit_stock_opname_item().';


--
-- Name: COLUMN stock_opname_logs.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stock_opname_logs.reason IS 'Alasan selisih: expired (bahan basi/expired), damaged (rusak/tumpah), cashier_discrepancy (selisih transaksi kasir), input_correction (koreksi input). Wajib diisi kalau difference_qty <> 0.';


--
-- Name: stock_opnames; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_opnames (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    status text DEFAULT 'submitted'::text NOT NULL,
    note text,
    total_loss_value numeric DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    submitted_at timestamp with time zone DEFAULT now(),
    CONSTRAINT stock_opnames_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text])))
);


--
-- Name: TABLE stock_opnames; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stock_opnames IS 'Header sesi stok opname bahan baku (migration_16). Menggantikan pola lama 1-baris-per-produk di stock_opname_logs — sekarang 1 sesi bisa mencakup banyak bahan baku sekaligus lewat stock_opname_items. Dibuat otomatis oleh submit_stock_opname_item() (1 sesi terbuka per tenant+branch+hari+pencatat), TIDAK diinsert langsung oleh client.';


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    status public.sub_status DEFAULT 'trial'::public.sub_status,
    plan text,
    trial_ends_at timestamp with time zone DEFAULT (now() + '28 days'::interval),
    valid_until timestamp with time zone DEFAULT (now() + '28 days'::interval),
    referred_by_code text,
    pending_signup_discount_pct numeric DEFAULT 0,
    super_trial_ends_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    supplier_code text NOT NULL,
    company_name text NOT NULL,
    contact_person text,
    phone_number text,
    whatsapp_number text,
    email text,
    address text,
    city text,
    province text,
    postal_code text,
    payment_terms text,
    categories text[] DEFAULT '{}'::text[],
    bank_account text,
    bank_name text,
    account_holder_name text,
    notes text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE suppliers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.suppliers IS 'Master data pemasok (Phase 3). Menyimpan informasi kontak, kategori bahan, dan rekening bank untuk transfer pembayaran.';


--
-- Name: table_live_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.table_live_status WITH (security_invoker='true') AS
 SELECT id AS table_id,
    tenant_id,
    branch_id,
    table_number,
    capacity,
    is_active,
        CASE
            WHEN ((EXISTS ( SELECT 1
               FROM public.orders o
              WHERE ((o.table_id = bt.id) AND (o.status <> ALL (ARRAY['COMPLETED'::text, 'CANCELLED'::text]))))) AND (bill_printed_at IS NOT NULL)) THEN 'BILL_PRINTED'::text
            WHEN (EXISTS ( SELECT 1
               FROM public.orders o
              WHERE ((o.table_id = bt.id) AND (o.status <> ALL (ARRAY['COMPLETED'::text, 'CANCELLED'::text]))))) THEN 'OCCUPIED'::text
            WHEN needs_cleaning THEN 'CLEANING'::text
            WHEN (EXISTS ( SELECT 1
               FROM public.reservations r
              WHERE ((r.table_id = bt.id) AND (r.status = 'confirmed'::text) AND ((r.reservation_at >= now()) AND (r.reservation_at <= (now() + ((r.reminder_window_minutes || ' minutes'::text))::interval)))))) THEN 'RESERVED'::text
            ELSE 'AVAILABLE'::text
        END AS status,
    ( SELECT o.id
           FROM public.orders o
          WHERE ((o.table_id = bt.id) AND (o.status <> ALL (ARRAY['COMPLETED'::text, 'CANCELLED'::text])))
          ORDER BY o.created_at DESC
         LIMIT 1) AS active_order_id,
    ( SELECT o.order_number
           FROM public.orders o
          WHERE ((o.table_id = bt.id) AND (o.status <> ALL (ARRAY['COMPLETED'::text, 'CANCELLED'::text])))
          ORDER BY o.created_at DESC
         LIMIT 1) AS active_order_number,
    ( SELECT o.status
           FROM public.orders o
          WHERE ((o.table_id = bt.id) AND (o.status <> ALL (ARRAY['COMPLETED'::text, 'CANCELLED'::text])))
          ORDER BY o.created_at DESC
         LIMIT 1) AS active_order_status,
    ( SELECT COALESCE(sum((oi.unit_price * ((oi.qty - oi.voided_qty))::numeric)), (0)::numeric) AS "coalesce"
           FROM public.order_items oi
          WHERE (oi.order_id = ( SELECT o.id
                   FROM public.orders o
                  WHERE ((o.table_id = bt.id) AND (o.status <> ALL (ARRAY['COMPLETED'::text, 'CANCELLED'::text])))
                  ORDER BY o.created_at DESC
                 LIMIT 1))) AS active_order_total,
    ( SELECT o.created_at
           FROM public.orders o
          WHERE ((o.table_id = bt.id) AND (o.status <> ALL (ARRAY['COMPLETED'::text, 'CANCELLED'::text])))
          ORDER BY o.created_at DESC
         LIMIT 1) AS occupied_at,
    cleaning_started_at,
    bill_printed_at,
    ( SELECT r.id
           FROM public.reservations r
          WHERE ((r.table_id = bt.id) AND (r.status = 'confirmed'::text) AND ((r.reservation_at >= now()) AND (r.reservation_at <= (now() + ((r.reminder_window_minutes || ' minutes'::text))::interval))))
          ORDER BY r.reservation_at
         LIMIT 1) AS upcoming_reservation_id
   FROM public.branch_tables bt
  WHERE (is_active = true);


--
-- Name: VIEW table_live_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.table_live_status IS 'Migrasi 019: menambah status BILL_PRINTED (dari branch_tables.bill_printed_at) di antara OCCUPIED dan CLEANING. active_order_total sekarang menghitung (qty - voided_qty) supaya konsisten dengan total yang benar-benar ditagih.';


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    has_custom_website boolean DEFAULT false,
    custom_website_url text,
    show_wifi_on_receipt boolean DEFAULT false,
    wifi_ssid text,
    wifi_password text,
    created_at timestamp with time zone DEFAULT now(),
    receipt_paper_width text DEFAULT '80mm'::text NOT NULL,
    allow_negative_ingredient_stock boolean DEFAULT false NOT NULL,
    CONSTRAINT tenants_receipt_paper_width_check CHECK ((receipt_paper_width = ANY (ARRAY['58mm'::text, '80mm'::text])))
);


--
-- Name: COLUMN tenants.receipt_paper_width; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenants.receipt_paper_width IS 'migration_16 (bagian I). Lebar kertas printer thermal tenant (58mm/80mm) — diatur di /dashboard/settings, dipakai app/pos/page.tsx untuk width Receipt & printReceipt() supaya tidak lagi hardcode 80mm untuk semua tenant.';


--
-- Name: COLUMN tenants.allow_negative_ingredient_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenants.allow_negative_ingredient_stock IS 'Kalau true, consume_recipe()/deduct tetap lanjut walau stok ingredient tidak cukup (stok boleh minus). Default false (blokir transaksi kalau stok kurang).';


--
-- Name: transaction_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id uuid,
    method text NOT NULL,
    amount numeric NOT NULL,
    reference_number text,
    created_at timestamp with time zone DEFAULT now(),
    split_group_label text,
    CONSTRAINT transaction_payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT transaction_payments_method_check CHECK ((method = ANY (ARRAY['cash'::text, 'qris'::text, 'debit'::text, 'credit'::text, 'ewallet'::text, 'bank_transfer'::text, 'online_platform'::text])))
);


--
-- Name: TABLE transaction_payments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.transaction_payments IS 'Rincian pembayaran per transaksi (Phase 2) — mendukung split/partial payment. SUM(amount) per transaction_id harus sama dengan transactions.total_amount, ditegakkan di dalam checkout_order_v2().';


--
-- Name: unit_conversions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unit_conversions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    from_unit text NOT NULL,
    to_unit text NOT NULL,
    factor numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT unit_conversions_factor_check CHECK ((factor > (0)::numeric))
);


--
-- Name: TABLE unit_conversions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.unit_conversions IS 'Faktor konversi antar unit (Phase 1). Contoh baris pack/box -> pcs bersifat tenant-specific (jumlah isi beda per supplier), jadi TIDAK diisi default global — tenant mengisi sendiri lewat admin.';


--
-- Name: units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.units (
    code text NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: TABLE units; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.units IS 'Unit master global (Phase 1). "bungkus" adalah unit resmi dan TIDAK boleh dihapus/diganti jadi "pcs" oleh migrasi manapun.';


--
-- Name: v_active_cashier_shifts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_active_cashier_shifts AS
 SELECT p.id AS cashier_id,
    p.tenant_id,
    p.full_name,
    p.email,
    p.branch_id,
    b.name AS branch_name,
    p.is_active AS account_active,
    s.id AS shift_id,
    s.opened_at,
    (s.id IS NOT NULL) AS is_on_shift
   FROM ((public.profiles p
     LEFT JOIN public.branches b ON ((b.id = p.branch_id)))
     LEFT JOIN LATERAL ( SELECT shifts.id,
            shifts.opened_at
           FROM public.shifts
          WHERE ((shifts.cashier_id = p.id) AND (shifts.status = 'open'::text))
          ORDER BY shifts.opened_at DESC
         LIMIT 1) s ON (true))
  WHERE (p.role = 'cashier'::public.user_role);


--
-- Name: VIEW v_active_cashier_shifts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_active_cashier_shifts IS 'Sumber data untuk halaman monitoring Manajemen Kasir (view-only, migration_16). RLS mengikuti tabel profiles/shifts yang mendasarinya (postgres menerapkan security_invoker secara default untuk view biasa, jadi kebijakan tenant/branch scoping tetap berlaku).';


--
-- Name: v_member_card; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_member_card WITH (security_invoker='true') AS
 SELECT c.id AS customer_id,
    c.tenant_id,
    c.customer_code AS member_code,
    c.customer_name,
    c.phone_number,
    c.email,
    c.is_active,
    c.lifetime_spend,
    c.visit_count,
    ct.id AS tier_id,
    COALESCE(ct.tier_name, 'Reguler'::text) AS tier_name,
    COALESCE(ct.discount_percentage, (0)::numeric) AS tier_discount_percentage,
    COALESCE(ct.benefits, '{}'::text[]) AS tier_benefits,
    COALESCE(cp.points_balance, 0) AS points_balance,
    COALESCE(cp.lifetime_earned, 0) AS lifetime_earned,
    COALESCE(cp.lifetime_redeemed, 0) AS lifetime_redeemed
   FROM ((public.customers c
     LEFT JOIN public.customer_tiers ct ON ((ct.id = c.tier_id)))
     LEFT JOIN public.customer_points cp ON ((cp.customer_id = c.id)));


--
-- Name: VIEW v_member_card; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_member_card IS 'migration_16 (bagian H8). Sumber data Kartu Member Digital (/dashboard/crm/customers) — Nama, Status Tier, member_code (dirender jadi QR/Barcode di frontend lewat lib qrcode), dan Saldo Poin.';


--
-- Name: v_stock_opname_history; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_stock_opname_history AS
 SELECT i.id,
    i.created_at,
    i.system_qty,
    i.physical_qty,
    i.difference_qty,
    i.loss_value,
    i.reason,
    i.note,
    i.unit,
    ing.name AS ingredient_name,
    o.tenant_id,
    o.branch_id,
    br.name AS branch_name,
    p.full_name AS created_by_name
   FROM ((((public.stock_opname_items i
     JOIN public.stock_opnames o ON ((o.id = i.opname_id)))
     JOIN public.ingredients ing ON ((ing.id = i.ingredient_id)))
     LEFT JOIN public.branches br ON ((br.id = o.branch_id)))
     LEFT JOIN public.profiles p ON ((p.id = o.created_by)));


--
-- Name: VIEW v_stock_opname_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_stock_opname_history IS 'Sumber data tab Riwayat /dashboard/stock-opname (migration_16, ingredient-based).';


--
-- Name: v_subscription_quota; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_subscription_quota WITH (security_invoker='true') AS
 SELECT tenant_id,
    status,
    plan,
    public.tenant_tier(tenant_id) AS tier,
    trial_ends_at,
    valid_until,
    ( SELECT count(*) AS count
           FROM public.branches b
          WHERE (b.tenant_id = s.tenant_id)) AS branch_count,
        CASE public.tenant_tier(tenant_id)
            WHEN 'free'::text THEN 1
            WHEN 'pro'::text THEN 3
            ELSE NULL::integer
        END AS branch_limit,
    ( SELECT count(*) AS count
           FROM public.profiles p
          WHERE ((p.tenant_id = s.tenant_id) AND (p.role = ANY (ARRAY['cashier'::public.user_role, 'manager'::public.user_role, 'kitchen'::public.user_role])))) AS staff_count,
        CASE public.tenant_tier(tenant_id)
            WHEN 'free'::text THEN 2
            ELSE NULL::integer
        END AS staff_limit
   FROM public.subscriptions s;


--
-- Name: VIEW v_subscription_quota; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_subscription_quota IS 'migration_16 (bagian F). Sumber data kartu "Kuota Cabang/Staf" di /dashboard/subscription — branch_limit/staff_limit NULL berarti unlimited untuk tier tsb.';


--
-- Name: voucher_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voucher_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    voucher_id uuid,
    transaction_id uuid,
    customer_id uuid,
    discount_given numeric NOT NULL,
    redeemed_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE voucher_redemptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.voucher_redemptions IS 'Audit trail penggunaan voucher (Phase 3).';


--
-- Name: vouchers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vouchers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    promotion_id uuid,
    voucher_code text NOT NULL,
    voucher_name text,
    discount_type text NOT NULL,
    discount_value numeric NOT NULL,
    max_discount_amount numeric,
    min_purchase_amount numeric DEFAULT 0,
    usage_limit integer,
    usage_count integer DEFAULT 0,
    is_active boolean DEFAULT true,
    start_date timestamp with time zone DEFAULT now(),
    expiry_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT vouchers_discount_type_check CHECK ((discount_type = ANY (ARRAY['PERCENTAGE'::text, 'NOMINAL'::text])))
);


--
-- Name: TABLE vouchers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.vouchers IS 'Voucher/kupon dengan tracking penggunaan (Phase 3).';


--
-- Name: waste_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.waste_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    product_id uuid,
    product_name text NOT NULL,
    waste_type text NOT NULL,
    qty_wasted integer NOT NULL,
    cost_price numeric,
    total_loss_amount numeric,
    notes text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT waste_logs_qty_wasted_check CHECK ((qty_wasted > 0)),
    CONSTRAINT waste_logs_waste_type_check CHECK ((waste_type = ANY (ARRAY['EXPIRED'::text, 'DAMAGED'::text, 'SPOILED'::text, 'LOSS'::text])))
);


--
-- Name: TABLE waste_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.waste_logs IS 'Pencatatan waste/kerugian dari barang kadaluarsa/rusak (Phase 3).';


--
-- Name: schema_migrations_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations_log ALTER COLUMN id SET DEFAULT nextval('public.schema_migrations_log_id_seq'::regclass);


--
-- Name: admin_special_codes admin_special_codes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_special_codes
    ADD CONSTRAINT admin_special_codes_code_key UNIQUE (code);


--
-- Name: admin_special_codes admin_special_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_special_codes
    ADD CONSTRAINT admin_special_codes_pkey PRIMARY KEY (id);


--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: branch_ingredients_stock branch_ingredients_stock_branch_id_ingredient_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_ingredients_stock
    ADD CONSTRAINT branch_ingredients_stock_branch_id_ingredient_id_key UNIQUE (branch_id, ingredient_id);


--
-- Name: branch_ingredients_stock branch_ingredients_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_ingredients_stock
    ADD CONSTRAINT branch_ingredients_stock_pkey PRIMARY KEY (id);


--
-- Name: branch_stock branch_stock_branch_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_stock
    ADD CONSTRAINT branch_stock_branch_id_product_id_key UNIQUE (branch_id, product_id);


--
-- Name: branch_stock branch_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_stock
    ADD CONSTRAINT branch_stock_pkey PRIMARY KEY (id);


--
-- Name: branch_tables branch_tables_branch_id_table_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_tables
    ADD CONSTRAINT branch_tables_branch_id_table_number_key UNIQUE (branch_id, table_number);


--
-- Name: branch_tables branch_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_tables
    ADD CONSTRAINT branch_tables_pkey PRIMARY KEY (id);


--
-- Name: branch_tables branch_tables_qr_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_tables
    ADD CONSTRAINT branch_tables_qr_token_key UNIQUE (qr_token);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: branches branches_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_slug_key UNIQUE (slug);


--
-- Name: budgets budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_pkey PRIMARY KEY (id);


--
-- Name: budgets budgets_tenant_id_branch_id_category_id_period_year_period__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_tenant_id_branch_id_category_id_period_year_period__key UNIQUE NULLS NOT DISTINCT (tenant_id, branch_id, category_id, period_year, period_month);


--
-- Name: cash_movements cash_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_pkey PRIMARY KEY (id);


--
-- Name: channel_pricings channel_pricings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_pricings
    ADD CONSTRAINT channel_pricings_pkey PRIMARY KEY (id);


--
-- Name: channel_pricings channel_pricings_product_id_channel_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_pricings
    ADD CONSTRAINT channel_pricings_product_id_channel_key UNIQUE (product_id, channel);


--
-- Name: customer_points customer_points_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_points
    ADD CONSTRAINT customer_points_customer_id_key UNIQUE (customer_id);


--
-- Name: customer_points customer_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_points
    ADD CONSTRAINT customer_points_pkey PRIMARY KEY (id);


--
-- Name: customer_tiers customer_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tiers
    ADD CONSTRAINT customer_tiers_pkey PRIMARY KEY (id);


--
-- Name: customer_tiers customer_tiers_tenant_id_tier_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tiers
    ADD CONSTRAINT customer_tiers_tenant_id_tier_name_key UNIQUE (tenant_id, tier_name);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: customers customers_tenant_id_customer_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_tenant_id_customer_code_key UNIQUE (tenant_id, customer_code);


--
-- Name: expense_categories expense_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (id);


--
-- Name: expense_categories expense_categories_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: goods_receipts goods_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_pkey PRIMARY KEY (id);


--
-- Name: goods_receipts goods_receipts_tenant_id_grn_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_tenant_id_grn_number_key UNIQUE (tenant_id, grn_number);


--
-- Name: grn_items grn_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_pkey PRIMARY KEY (id);


--
-- Name: ingredient_stock_movements ingredient_stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_stock_movements
    ADD CONSTRAINT ingredient_stock_movements_pkey PRIMARY KEY (id);


--
-- Name: ingredient_stock_opname_logs ingredient_stock_opname_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_stock_opname_logs
    ADD CONSTRAINT ingredient_stock_opname_logs_pkey PRIMARY KEY (id);


--
-- Name: ingredient_waste_logs ingredient_waste_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_waste_logs
    ADD CONSTRAINT ingredient_waste_logs_pkey PRIMARY KEY (id);


--
-- Name: ingredients ingredients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_pkey PRIMARY KEY (id);


--
-- Name: ingredients ingredients_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: kitchen_stations kitchen_stations_branch_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kitchen_stations
    ADD CONSTRAINT kitchen_stations_branch_id_code_key UNIQUE (branch_id, code);


--
-- Name: kitchen_stations kitchen_stations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kitchen_stations
    ADD CONSTRAINT kitchen_stations_pkey PRIMARY KEY (id);


--
-- Name: loyalty_config loyalty_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_config
    ADD CONSTRAINT loyalty_config_pkey PRIMARY KEY (id);


--
-- Name: loyalty_config loyalty_config_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_config
    ADD CONSTRAINT loyalty_config_tenant_id_key UNIQUE (tenant_id);


--
-- Name: loyalty_points_log loyalty_points_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_points_log
    ADD CONSTRAINT loyalty_points_log_pkey PRIMARY KEY (id);


--
-- Name: memberships memberships_member_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_member_code_key UNIQUE (member_code);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);


--
-- Name: modifier_groups modifier_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifier_groups
    ADD CONSTRAINT modifier_groups_pkey PRIMARY KEY (id);


--
-- Name: modifier_ingredient_impacts modifier_ingredient_impacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifier_ingredient_impacts
    ADD CONSTRAINT modifier_ingredient_impacts_pkey PRIMARY KEY (id);


--
-- Name: modifiers modifiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifiers
    ADD CONSTRAINT modifiers_pkey PRIMARY KEY (id);


--
-- Name: monthly_targets monthly_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_targets
    ADD CONSTRAINT monthly_targets_pkey PRIMARY KEY (id);


--
-- Name: monthly_targets monthly_targets_tenant_id_year_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_targets
    ADD CONSTRAINT monthly_targets_tenant_id_year_month_key UNIQUE (tenant_id, year, month);


--
-- Name: order_item_modifiers order_item_modifiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_modifiers
    ADD CONSTRAINT order_item_modifiers_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_branch_id_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_branch_id_order_number_key UNIQUE (branch_id, order_number);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payments payments_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_key UNIQUE (order_id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: po_items po_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_items
    ADD CONSTRAINT po_items_pkey PRIMARY KEY (id);


--
-- Name: product_modifier_groups product_modifier_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_modifier_groups
    ADD CONSTRAINT product_modifier_groups_pkey PRIMARY KEY (id);


--
-- Name: product_modifier_groups product_modifier_groups_product_id_modifier_group_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_modifier_groups
    ADD CONSTRAINT product_modifier_groups_product_id_modifier_group_id_key UNIQUE (product_id, modifier_group_id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: promotion_rules promotion_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_rules
    ADD CONSTRAINT promotion_rules_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_tenant_id_promo_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_tenant_id_promo_code_key UNIQUE (tenant_id, promo_code);


--
-- Name: purchase_invoices purchase_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_pkey PRIMARY KEY (id);


--
-- Name: purchase_invoices purchase_invoices_tenant_id_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_tenant_id_invoice_number_key UNIQUE (tenant_id, invoice_number);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_tenant_id_po_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_tenant_id_po_number_key UNIQUE (tenant_id, po_number);


--
-- Name: qr_orders qr_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_orders
    ADD CONSTRAINT qr_orders_pkey PRIMARY KEY (id);


--
-- Name: recipe_consumption_logs recipe_consumption_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_consumption_logs
    ADD CONSTRAINT recipe_consumption_logs_pkey PRIMARY KEY (id);


--
-- Name: recipe_items recipe_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_items
    ADD CONSTRAINT recipe_items_pkey PRIMARY KEY (id);


--
-- Name: recipes recipes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_pkey PRIMARY KEY (id);


--
-- Name: referral_redemptions referral_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_redemptions
    ADD CONSTRAINT referral_redemptions_pkey PRIMARY KEY (id);


--
-- Name: referral_redemptions referral_redemptions_referred_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_redemptions
    ADD CONSTRAINT referral_redemptions_referred_tenant_id_key UNIQUE (referred_tenant_id);


--
-- Name: referrals referrals_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_code_key UNIQUE (code);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (tenant_id);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: reservations reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations_log schema_migrations_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations_log
    ADD CONSTRAINT schema_migrations_log_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations_log schema_migrations_log_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations_log
    ADD CONSTRAINT schema_migrations_log_version_key UNIQUE (version);


--
-- Name: shifts shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: stock_opname_items stock_opname_items_opname_id_ingredient_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opname_items
    ADD CONSTRAINT stock_opname_items_opname_id_ingredient_id_key UNIQUE (opname_id, ingredient_id);


--
-- Name: stock_opname_items stock_opname_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opname_items
    ADD CONSTRAINT stock_opname_items_pkey PRIMARY KEY (id);


--
-- Name: stock_opname_logs stock_opname_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opname_logs
    ADD CONSTRAINT stock_opname_logs_pkey PRIMARY KEY (id);


--
-- Name: stock_opnames stock_opnames_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opnames
    ADD CONSTRAINT stock_opnames_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_tenant_id_supplier_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_tenant_id_supplier_code_key UNIQUE (tenant_id, supplier_code);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: transaction_items transaction_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_pkey PRIMARY KEY (id);


--
-- Name: transaction_payments transaction_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_payments
    ADD CONSTRAINT transaction_payments_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: unit_conversions unit_conversions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_conversions
    ADD CONSTRAINT unit_conversions_pkey PRIMARY KEY (id);


--
-- Name: units units_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.units
    ADD CONSTRAINT units_pkey PRIMARY KEY (code);


--
-- Name: voucher_redemptions voucher_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_pkey PRIMARY KEY (id);


--
-- Name: vouchers vouchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_pkey PRIMARY KEY (id);


--
-- Name: vouchers vouchers_tenant_id_voucher_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_tenant_id_voucher_code_key UNIQUE (tenant_id, voucher_code);


--
-- Name: waste_logs waste_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_logs
    ADD CONSTRAINT waste_logs_pkey PRIMARY KEY (id);


--
-- Name: idx_approval_requests_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_requests_tenant_status ON public.approval_requests USING btree (tenant_id, status);


--
-- Name: idx_attendance_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_tenant_status ON public.attendance USING btree (tenant_id, status);


--
-- Name: idx_audit_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id);


--
-- Name: idx_audit_log_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_tenant_branch ON public.audit_log USING btree (tenant_id, branch_id, created_at DESC);


--
-- Name: idx_branch_ing_stock_ingredient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branch_ing_stock_ingredient ON public.branch_ingredients_stock USING btree (ingredient_id);


--
-- Name: idx_branch_ing_stock_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branch_ing_stock_tenant_branch ON public.branch_ingredients_stock USING btree (tenant_id, branch_id);


--
-- Name: idx_branch_stock_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branch_stock_product ON public.branch_stock USING btree (product_id);


--
-- Name: idx_branch_stock_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branch_stock_tenant_branch ON public.branch_stock USING btree (tenant_id, branch_id);


--
-- Name: idx_branch_tables_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branch_tables_branch ON public.branch_tables USING btree (tenant_id, branch_id, is_active);


--
-- Name: idx_branches_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_branches_tenant ON public.branches USING btree (tenant_id, is_active);


--
-- Name: idx_budgets_tenant_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budgets_tenant_period ON public.budgets USING btree (tenant_id, period_year, period_month);


--
-- Name: idx_cash_movements_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_movements_shift ON public.cash_movements USING btree (shift_id);


--
-- Name: idx_cash_movements_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_movements_tenant_branch ON public.cash_movements USING btree (tenant_id, branch_id, created_at DESC);


--
-- Name: idx_channel_pricings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_pricings_tenant ON public.channel_pricings USING btree (tenant_id, channel);


--
-- Name: idx_customer_points_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_points_tenant ON public.customer_points USING btree (tenant_id);


--
-- Name: idx_customers_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_tenant_branch ON public.customers USING btree (tenant_id, branch_id);


--
-- Name: idx_customers_tier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_tier ON public.customers USING btree (tier_id);


--
-- Name: idx_expense_categories_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_categories_tenant ON public.expense_categories USING btree (tenant_id);


--
-- Name: idx_expenses_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_branch ON public.expenses USING btree (branch_id);


--
-- Name: idx_expenses_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_category ON public.expenses USING btree (category_id);


--
-- Name: idx_expenses_recurring_templates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_recurring_templates ON public.expenses USING btree (tenant_id, is_recurring) WHERE (is_recurring = true);


--
-- Name: idx_expenses_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_status ON public.expenses USING btree (tenant_id, status) WHERE (voided_at IS NULL);


--
-- Name: idx_expenses_tenant_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_tenant_date ON public.expenses USING btree (tenant_id, expense_date);


--
-- Name: idx_grn_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grn_branch ON public.goods_receipts USING btree (branch_id, created_at DESC);


--
-- Name: idx_grn_items_grn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grn_items_grn ON public.grn_items USING btree (grn_id);


--
-- Name: idx_grn_items_ingredient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grn_items_ingredient ON public.grn_items USING btree (ingredient_id);


--
-- Name: idx_grn_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grn_po ON public.goods_receipts USING btree (po_id);


--
-- Name: idx_ingredients_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ingredients_tenant ON public.ingredients USING btree (tenant_id);


--
-- Name: idx_ingredients_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ingredients_tenant_status ON public.ingredients USING btree (tenant_id, status);


--
-- Name: idx_ism_ingredient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ism_ingredient ON public.ingredient_stock_movements USING btree (ingredient_id, created_at DESC);


--
-- Name: idx_ism_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ism_tenant_branch ON public.ingredient_stock_movements USING btree (tenant_id, branch_id, created_at DESC);


--
-- Name: idx_isol_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_isol_tenant_branch ON public.ingredient_stock_opname_logs USING btree (tenant_id, branch_id, created_at DESC);


--
-- Name: idx_iwl_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iwl_branch ON public.ingredient_waste_logs USING btree (branch_id, created_at DESC);


--
-- Name: idx_kitchen_stations_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kitchen_stations_tenant_branch ON public.kitchen_stations USING btree (tenant_id, branch_id);


--
-- Name: idx_loyalty_config_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_config_tenant ON public.loyalty_config USING btree (tenant_id);


--
-- Name: idx_loyalty_log_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_log_customer ON public.loyalty_points_log USING btree (customer_id, created_at DESC);


--
-- Name: idx_loyalty_log_tx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loyalty_log_tx ON public.loyalty_points_log USING btree (transaction_id);


--
-- Name: idx_memberships_tenant_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memberships_tenant_code ON public.memberships USING btree (tenant_id, member_code) WHERE (is_active = true);


--
-- Name: idx_mii_ingredient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mii_ingredient ON public.modifier_ingredient_impacts USING btree (ingredient_id);


--
-- Name: idx_mii_modifier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mii_modifier ON public.modifier_ingredient_impacts USING btree (modifier_id);


--
-- Name: idx_modifier_groups_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_modifier_groups_tenant ON public.modifier_groups USING btree (tenant_id);


--
-- Name: idx_modifiers_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_modifiers_group ON public.modifiers USING btree (modifier_group_id, display_order);


--
-- Name: idx_monthly_targets_tenant_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monthly_targets_tenant_period ON public.monthly_targets USING btree (tenant_id, year, month);


--
-- Name: idx_oim_modifier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oim_modifier ON public.order_item_modifiers USING btree (modifier_id);


--
-- Name: idx_oim_order_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oim_order_item ON public.order_item_modifiers USING btree (order_item_id);


--
-- Name: idx_order_items_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order ON public.order_items USING btree (order_id);


--
-- Name: idx_order_items_recipe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_recipe ON public.order_items USING btree (recipe_id);


--
-- Name: idx_order_items_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_station ON public.order_items USING btree (station_id);


--
-- Name: idx_order_items_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_variant ON public.order_items USING btree (variant_id);


--
-- Name: idx_orders_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_channel ON public.orders USING btree (tenant_id, branch_id, channel, created_at DESC);


--
-- Name: idx_orders_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_shift ON public.orders USING btree (shift_id);


--
-- Name: idx_orders_table; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_table ON public.orders USING btree (table_id);


--
-- Name: idx_orders_tenant_branch_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_tenant_branch_status ON public.orders USING btree (tenant_id, branch_id, status, created_at DESC);


--
-- Name: idx_payments_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_order_id ON public.payments USING btree (order_id);


--
-- Name: idx_payments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_tenant ON public.payments USING btree (tenant_id, created_at DESC);


--
-- Name: idx_pmg_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pmg_product ON public.product_modifier_groups USING btree (product_id);


--
-- Name: idx_po_items_ingredient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_items_ingredient ON public.po_items USING btree (ingredient_id);


--
-- Name: idx_po_items_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_items_po ON public.po_items USING btree (po_id);


--
-- Name: idx_po_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_supplier ON public.purchase_orders USING btree (supplier_id);


--
-- Name: idx_po_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_tenant_status ON public.purchase_orders USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_product_variants_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_product ON public.product_variants USING btree (product_id, display_order);


--
-- Name: idx_products_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_station ON public.products USING btree (station_id);


--
-- Name: idx_products_tenant_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_tenant_category ON public.products USING btree (tenant_id, category) WHERE (is_available = true);


--
-- Name: idx_profiles_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_tenant ON public.profiles USING btree (tenant_id);


--
-- Name: idx_promo_rules_promo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_promo_rules_promo ON public.promotion_rules USING btree (promotion_id);


--
-- Name: idx_promo_tenant_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_promo_tenant_active ON public.promotions USING btree (tenant_id, is_active);


--
-- Name: idx_purchase_inv_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_inv_supplier ON public.purchase_invoices USING btree (supplier_id);


--
-- Name: idx_qr_orders_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_orders_order ON public.qr_orders USING btree (order_id);


--
-- Name: idx_qr_orders_payment_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_orders_payment_ref ON public.qr_orders USING btree (payment_reference);


--
-- Name: idx_qr_orders_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qr_orders_tenant_branch ON public.qr_orders USING btree (tenant_id, branch_id, created_at DESC);


--
-- Name: idx_rcl_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rcl_source ON public.recipe_consumption_logs USING btree (source_type, source_id);


--
-- Name: idx_rcl_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rcl_tenant_branch ON public.recipe_consumption_logs USING btree (tenant_id, branch_id, created_at DESC);


--
-- Name: idx_recipe_items_ingredient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recipe_items_ingredient ON public.recipe_items USING btree (ingredient_id);


--
-- Name: idx_recipe_items_recipe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recipe_items_recipe ON public.recipe_items USING btree (recipe_id);


--
-- Name: idx_recipes_active_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_recipes_active_default ON public.recipes USING btree (product_id) WHERE (is_active AND (variant_id IS NULL));


--
-- Name: idx_recipes_active_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_recipes_active_variant ON public.recipes USING btree (product_id, variant_id) WHERE (is_active AND (variant_id IS NOT NULL));


--
-- Name: idx_recipes_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recipes_product ON public.recipes USING btree (product_id, variant_id);


--
-- Name: idx_recipes_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recipes_tenant ON public.recipes USING btree (tenant_id);


--
-- Name: idx_referral_redemptions_referrer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_referral_redemptions_referrer ON public.referral_redemptions USING btree (referrer_tenant_id, reward_granted);


--
-- Name: idx_refunds_tenant_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refunds_tenant_branch ON public.refunds USING btree (tenant_id, branch_id, created_at DESC);


--
-- Name: idx_refunds_transaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refunds_transaction ON public.refunds USING btree (transaction_id);


--
-- Name: idx_reservations_branch_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservations_branch_time ON public.reservations USING btree (tenant_id, branch_id, reservation_at);


--
-- Name: idx_reservations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reservations_status ON public.reservations USING btree (tenant_id, branch_id, status);


--
-- Name: idx_shifts_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shifts_branch ON public.shifts USING btree (branch_id);


--
-- Name: idx_shifts_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shifts_tenant_status ON public.shifts USING btree (tenant_id, cashier_id, status);


--
-- Name: idx_stock_movements_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_movements_branch ON public.stock_movements USING btree (tenant_id, branch_id, created_at DESC);


--
-- Name: idx_stock_movements_tenant_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_movements_tenant_product ON public.stock_movements USING btree (tenant_id, product_id, created_at DESC);


--
-- Name: idx_stock_opname_items_ingredient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_opname_items_ingredient ON public.stock_opname_items USING btree (ingredient_id);


--
-- Name: idx_stock_opname_items_opname; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_opname_items_opname ON public.stock_opname_items USING btree (opname_id);


--
-- Name: idx_stock_opname_tenant_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_opname_tenant_branch_date ON public.stock_opname_logs USING btree (tenant_id, branch_id, created_at DESC);


--
-- Name: idx_stock_opnames_tenant_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_opnames_tenant_branch_date ON public.stock_opnames USING btree (tenant_id, branch_id, created_at DESC);


--
-- Name: idx_suppliers_tenant_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_tenant_active ON public.suppliers USING btree (tenant_id, is_active);


--
-- Name: idx_tiers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tiers_tenant ON public.customer_tiers USING btree (tenant_id);


--
-- Name: idx_transaction_items_recipe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_items_recipe ON public.transaction_items USING btree (recipe_id);


--
-- Name: idx_transaction_items_tx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_items_tx ON public.transaction_items USING btree (transaction_id);


--
-- Name: idx_transaction_items_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_items_variant ON public.transaction_items USING btree (variant_id);


--
-- Name: idx_transaction_payments_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_payments_method ON public.transaction_payments USING btree (method);


--
-- Name: idx_transaction_payments_tx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_payments_tx ON public.transaction_payments USING btree (transaction_id);


--
-- Name: idx_transactions_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_branch ON public.transactions USING btree (tenant_id, branch_id, created_at DESC);


--
-- Name: idx_transactions_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_customer ON public.transactions USING btree (tenant_id, customer_id);


--
-- Name: idx_transactions_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_order ON public.transactions USING btree (order_id);


--
-- Name: idx_transactions_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_shift ON public.transactions USING btree (shift_id);


--
-- Name: idx_transactions_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_tenant_created ON public.transactions USING btree (tenant_id, created_at DESC);


--
-- Name: idx_unit_conversions_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_unit_conversions_unique ON public.unit_conversions USING btree (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), from_unit, to_unit);


--
-- Name: idx_voucher_redeem_tx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voucher_redeem_tx ON public.voucher_redemptions USING btree (transaction_id);


--
-- Name: idx_vouchers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vouchers_tenant ON public.vouchers USING btree (tenant_id, is_active);


--
-- Name: idx_waste_logs_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waste_logs_branch ON public.waste_logs USING btree (branch_id, created_at DESC);


--
-- Name: idx_waste_logs_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_waste_logs_type ON public.waste_logs USING btree (waste_type);


--
-- Name: budget_vs_actual _RETURN; Type: RULE; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.budget_vs_actual AS
 SELECT b.id AS budget_id,
    b.tenant_id,
    b.branch_id,
    b.category_id,
    b.period_year,
    b.period_month,
    b.amount AS budget_amount,
    COALESCE(sum(e.amount) FILTER (WHERE ((e.status = 'APPROVED'::text) AND (e.voided_at IS NULL))), (0)::numeric) AS actual_amount,
    round(((COALESCE(sum(e.amount) FILTER (WHERE ((e.status = 'APPROVED'::text) AND (e.voided_at IS NULL))), (0)::numeric) / NULLIF(b.amount, (0)::numeric)) * (100)::numeric), 1) AS pct_used,
    b.warning_threshold_pct,
    b.critical_threshold_pct,
        CASE
            WHEN (b.amount = (0)::numeric) THEN 'NO_BUDGET'::text
            WHEN (COALESCE(sum(e.amount) FILTER (WHERE ((e.status = 'APPROVED'::text) AND (e.voided_at IS NULL))), (0)::numeric) >= ((b.amount * b.critical_threshold_pct) / (100)::numeric)) THEN 'CRITICAL'::text
            WHEN (COALESCE(sum(e.amount) FILTER (WHERE ((e.status = 'APPROVED'::text) AND (e.voided_at IS NULL))), (0)::numeric) >= ((b.amount * b.warning_threshold_pct) / (100)::numeric)) THEN 'WARNING'::text
            ELSE 'OK'::text
        END AS status
   FROM (public.budgets b
     LEFT JOIN public.expenses e ON (((e.tenant_id = b.tenant_id) AND ((b.branch_id IS NULL) OR (e.branch_id = b.branch_id)) AND ((b.category_id IS NULL) OR (e.category_id = b.category_id)) AND (EXTRACT(year FROM e.expense_date) = (b.period_year)::numeric) AND (EXTRACT(month FROM e.expense_date) = (b.period_month)::numeric))))
  GROUP BY b.id;


--
-- Name: branches trg_branches_set_slug; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_branches_set_slug BEFORE INSERT OR UPDATE OF name ON public.branches FOR EACH ROW EXECUTE FUNCTION public.trg_set_branch_slug();


--
-- Name: budgets trg_budgets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_budgets_updated_at BEFORE UPDATE ON public.budgets FOR EACH ROW EXECUTE FUNCTION public.capos_set_updated_at();


--
-- Name: tenants trg_create_main_branch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_create_main_branch AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.create_main_branch_for_tenant();


--
-- Name: branches trg_enforce_branch_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_branch_limit BEFORE INSERT ON public.branches FOR EACH ROW EXECUTE FUNCTION public.enforce_branch_limit();


--
-- Name: profiles trg_enforce_cashier_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_cashier_limit BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_cashier_limit();


--
-- Name: products trg_enforce_menu_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_menu_limit BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.enforce_menu_limit();


--
-- Name: products trg_enforce_recipe_product_stock_purity; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_recipe_product_stock_purity BEFORE UPDATE OF track_stock, stock_mode ON public.products FOR EACH ROW EXECUTE FUNCTION public.enforce_recipe_product_stock_purity();


--
-- Name: transactions trg_enforce_subscription_cutoff; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_subscription_cutoff BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_cutoff();


--
-- Name: expense_categories trg_expense_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_expense_categories_updated_at BEFORE UPDATE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION public.capos_set_updated_at();


--
-- Name: expenses trg_expenses_enforce_insert_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_expenses_enforce_insert_status BEFORE INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.capos_enforce_expense_insert_status();


--
-- Name: expenses trg_expenses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_expenses_updated_at BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.capos_set_updated_at();


--
-- Name: ingredients trg_prevent_ingredient_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_ingredient_delete BEFORE DELETE ON public.ingredients FOR EACH ROW EXECUTE FUNCTION public.prevent_ingredient_hard_delete();


--
-- Name: modifiers trg_prevent_modifier_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_modifier_delete BEFORE DELETE ON public.modifiers FOR EACH ROW EXECUTE FUNCTION public.prevent_modifier_hard_delete();


--
-- Name: recipes trg_prevent_recipe_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_recipe_delete BEFORE DELETE ON public.recipes FOR EACH ROW EXECUTE FUNCTION public.prevent_recipe_hard_delete();


--
-- Name: product_variants trg_prevent_variant_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_variant_delete BEFORE DELETE ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.prevent_variant_hard_delete();


--
-- Name: tenants trg_seed_default_customer_tiers; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_seed_default_customer_tiers AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.seed_default_customer_tiers();


--
-- Name: subscriptions trg_subscriptions_auto_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subscriptions_auto_status BEFORE INSERT OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.trg_subscriptions_auto_status_fn();


--
-- Name: loyalty_points_log trg_sync_customer_points; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_customer_points AFTER INSERT ON public.loyalty_points_log FOR EACH ROW EXECUTE FUNCTION public.sync_customer_points_from_log();


--
-- Name: recipes trg_sync_product_stock_mode; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_product_stock_mode AFTER INSERT OR UPDATE OF is_active, product_id ON public.recipes FOR EACH ROW EXECUTE FUNCTION public.sync_product_stock_mode();


--
-- Name: admin_special_codes admin_special_codes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_special_codes
    ADD CONSTRAINT admin_special_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: approval_requests approval_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id);


--
-- Name: approval_requests approval_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);


--
-- Name: approval_requests approval_requests_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: attendance attendance_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: attendance attendance_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);


--
-- Name: attendance attendance_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: audit_log audit_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: branch_ingredients_stock branch_ingredients_stock_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_ingredients_stock
    ADD CONSTRAINT branch_ingredients_stock_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: branch_ingredients_stock branch_ingredients_stock_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_ingredients_stock
    ADD CONSTRAINT branch_ingredients_stock_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE RESTRICT;


--
-- Name: branch_ingredients_stock branch_ingredients_stock_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_ingredients_stock
    ADD CONSTRAINT branch_ingredients_stock_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: branch_stock branch_stock_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_stock
    ADD CONSTRAINT branch_stock_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: branch_stock branch_stock_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_stock
    ADD CONSTRAINT branch_stock_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: branch_stock branch_stock_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_stock
    ADD CONSTRAINT branch_stock_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: branch_tables branch_tables_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_tables
    ADD CONSTRAINT branch_tables_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: branch_tables branch_tables_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branch_tables
    ADD CONSTRAINT branch_tables_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: branches branches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: budgets budgets_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: budgets budgets_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.expense_categories(id) ON DELETE CASCADE;


--
-- Name: budgets budgets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: cash_movements cash_movements_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: cash_movements cash_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: cash_movements cash_movements_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE CASCADE;


--
-- Name: cash_movements cash_movements_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_movements
    ADD CONSTRAINT cash_movements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: channel_pricings channel_pricings_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_pricings
    ADD CONSTRAINT channel_pricings_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: channel_pricings channel_pricings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_pricings
    ADD CONSTRAINT channel_pricings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: customer_points customer_points_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_points
    ADD CONSTRAINT customer_points_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customer_points customer_points_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_points
    ADD CONSTRAINT customer_points_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: customer_tiers customer_tiers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_tiers
    ADD CONSTRAINT customer_tiers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: customers customers_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: customers customers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: customers customers_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES public.customer_tiers(id);


--
-- Name: expenses expenses_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);


--
-- Name: expenses expenses_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: expenses expenses_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.expense_categories(id) ON DELETE RESTRICT;


--
-- Name: expenses expenses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: expenses expenses_source_recurring_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_source_recurring_expense_id_fkey FOREIGN KEY (source_recurring_expense_id) REFERENCES public.expenses(id) ON DELETE SET NULL;


--
-- Name: expenses expenses_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.profiles(id);


--
-- Name: goods_receipts goods_receipts_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: goods_receipts goods_receipts_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE RESTRICT;


--
-- Name: goods_receipts goods_receipts_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.profiles(id);


--
-- Name: goods_receipts goods_receipts_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: goods_receipts goods_receipts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: grn_items grn_items_grn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_grn_id_fkey FOREIGN KEY (grn_id) REFERENCES public.goods_receipts(id) ON DELETE CASCADE;


--
-- Name: grn_items grn_items_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id);


--
-- Name: grn_items grn_items_po_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_po_item_id_fkey FOREIGN KEY (po_item_id) REFERENCES public.po_items(id) ON DELETE SET NULL;


--
-- Name: grn_items grn_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: grn_items grn_items_purchase_unit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_purchase_unit_fkey FOREIGN KEY (purchase_unit) REFERENCES public.units(code);


--
-- Name: ingredient_stock_movements ingredient_stock_movements_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_stock_movements
    ADD CONSTRAINT ingredient_stock_movements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: ingredient_stock_movements ingredient_stock_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_stock_movements
    ADD CONSTRAINT ingredient_stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: ingredient_stock_movements ingredient_stock_movements_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_stock_movements
    ADD CONSTRAINT ingredient_stock_movements_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id);


--
-- Name: ingredient_stock_movements ingredient_stock_movements_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_stock_movements
    ADD CONSTRAINT ingredient_stock_movements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ingredient_stock_movements ingredient_stock_movements_unit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_stock_movements
    ADD CONSTRAINT ingredient_stock_movements_unit_fkey FOREIGN KEY (unit) REFERENCES public.units(code);


--
-- Name: ingredient_stock_opname_logs ingredient_stock_opname_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_stock_opname_logs
    ADD CONSTRAINT ingredient_stock_opname_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: ingredient_stock_opname_logs ingredient_stock_opname_logs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_stock_opname_logs
    ADD CONSTRAINT ingredient_stock_opname_logs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: ingredient_stock_opname_logs ingredient_stock_opname_logs_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_stock_opname_logs
    ADD CONSTRAINT ingredient_stock_opname_logs_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id);


--
-- Name: ingredient_stock_opname_logs ingredient_stock_opname_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_stock_opname_logs
    ADD CONSTRAINT ingredient_stock_opname_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ingredient_waste_logs ingredient_waste_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_waste_logs
    ADD CONSTRAINT ingredient_waste_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: ingredient_waste_logs ingredient_waste_logs_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_waste_logs
    ADD CONSTRAINT ingredient_waste_logs_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id);


--
-- Name: ingredient_waste_logs ingredient_waste_logs_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_waste_logs
    ADD CONSTRAINT ingredient_waste_logs_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: ingredient_waste_logs ingredient_waste_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredient_waste_logs
    ADD CONSTRAINT ingredient_waste_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ingredients ingredients_inventory_unit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_inventory_unit_fkey FOREIGN KEY (inventory_unit) REFERENCES public.units(code);


--
-- Name: ingredients ingredients_purchase_unit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_purchase_unit_fkey FOREIGN KEY (purchase_unit) REFERENCES public.units(code);


--
-- Name: ingredients ingredients_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingredients
    ADD CONSTRAINT ingredients_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: kitchen_stations kitchen_stations_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kitchen_stations
    ADD CONSTRAINT kitchen_stations_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: kitchen_stations kitchen_stations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kitchen_stations
    ADD CONSTRAINT kitchen_stations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: loyalty_config loyalty_config_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_config
    ADD CONSTRAINT loyalty_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: loyalty_points_log loyalty_points_log_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_points_log
    ADD CONSTRAINT loyalty_points_log_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: loyalty_points_log loyalty_points_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_points_log
    ADD CONSTRAINT loyalty_points_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: loyalty_points_log loyalty_points_log_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loyalty_points_log
    ADD CONSTRAINT loyalty_points_log_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE SET NULL;


--
-- Name: memberships memberships_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: modifier_groups modifier_groups_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifier_groups
    ADD CONSTRAINT modifier_groups_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: modifier_ingredient_impacts modifier_ingredient_impacts_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifier_ingredient_impacts
    ADD CONSTRAINT modifier_ingredient_impacts_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE RESTRICT;


--
-- Name: modifier_ingredient_impacts modifier_ingredient_impacts_modifier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifier_ingredient_impacts
    ADD CONSTRAINT modifier_ingredient_impacts_modifier_id_fkey FOREIGN KEY (modifier_id) REFERENCES public.modifiers(id) ON DELETE CASCADE;


--
-- Name: modifier_ingredient_impacts modifier_ingredient_impacts_unit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifier_ingredient_impacts
    ADD CONSTRAINT modifier_ingredient_impacts_unit_fkey FOREIGN KEY (unit) REFERENCES public.units(code);


--
-- Name: modifiers modifiers_modifier_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modifiers
    ADD CONSTRAINT modifiers_modifier_group_id_fkey FOREIGN KEY (modifier_group_id) REFERENCES public.modifier_groups(id) ON DELETE CASCADE;


--
-- Name: monthly_targets monthly_targets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_targets
    ADD CONSTRAINT monthly_targets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: monthly_targets monthly_targets_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_targets
    ADD CONSTRAINT monthly_targets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: order_item_modifiers order_item_modifiers_modifier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_modifiers
    ADD CONSTRAINT order_item_modifiers_modifier_id_fkey FOREIGN KEY (modifier_id) REFERENCES public.modifiers(id) ON DELETE RESTRICT;


--
-- Name: order_item_modifiers order_item_modifiers_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_modifiers
    ADD CONSTRAINT order_item_modifiers_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_price_overridden_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_price_overridden_by_fkey FOREIGN KEY (price_overridden_by) REFERENCES public.profiles(id);


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: order_items order_items_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id);


--
-- Name: order_items order_items_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.kitchen_stations(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: order_items order_items_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.profiles(id);


--
-- Name: orders orders_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: orders orders_cashier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES public.profiles(id);


--
-- Name: orders orders_manual_discount_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_manual_discount_by_fkey FOREIGN KEY (manual_discount_by) REFERENCES public.profiles(id);


--
-- Name: orders orders_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id);


--
-- Name: orders orders_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.branch_tables(id) ON DELETE SET NULL;


--
-- Name: orders orders_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: orders orders_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);


--
-- Name: payments payments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: po_items po_items_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_items
    ADD CONSTRAINT po_items_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id);


--
-- Name: po_items po_items_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_items
    ADD CONSTRAINT po_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: po_items po_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_items
    ADD CONSTRAINT po_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: po_items po_items_purchase_unit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.po_items
    ADD CONSTRAINT po_items_purchase_unit_fkey FOREIGN KEY (purchase_unit) REFERENCES public.units(code);


--
-- Name: product_modifier_groups product_modifier_groups_modifier_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_modifier_groups
    ADD CONSTRAINT product_modifier_groups_modifier_group_id_fkey FOREIGN KEY (modifier_group_id) REFERENCES public.modifier_groups(id) ON DELETE CASCADE;


--
-- Name: product_modifier_groups product_modifier_groups_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_modifier_groups
    ADD CONSTRAINT product_modifier_groups_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: products products_station_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.kitchen_stations(id) ON DELETE SET NULL;


--
-- Name: products products_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: promotion_rules promotion_rules_promotion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotion_rules
    ADD CONSTRAINT promotion_rules_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE CASCADE;


--
-- Name: promotions promotions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: promotions promotions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: purchase_invoices purchase_invoices_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: purchase_invoices purchase_invoices_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: purchase_invoices purchase_invoices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_invoices
    ADD CONSTRAINT purchase_invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: purchase_orders purchase_orders_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: purchase_orders purchase_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: purchase_orders purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;


--
-- Name: purchase_orders purchase_orders_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: purchase_orders purchase_orders_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id);


--
-- Name: qr_orders qr_orders_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_orders
    ADD CONSTRAINT qr_orders_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: qr_orders qr_orders_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_orders
    ADD CONSTRAINT qr_orders_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: qr_orders qr_orders_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_orders
    ADD CONSTRAINT qr_orders_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.branch_tables(id) ON DELETE SET NULL;


--
-- Name: qr_orders qr_orders_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_orders
    ADD CONSTRAINT qr_orders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: recipe_consumption_logs recipe_consumption_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_consumption_logs
    ADD CONSTRAINT recipe_consumption_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: recipe_consumption_logs recipe_consumption_logs_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_consumption_logs
    ADD CONSTRAINT recipe_consumption_logs_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id);


--
-- Name: recipe_consumption_logs recipe_consumption_logs_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_consumption_logs
    ADD CONSTRAINT recipe_consumption_logs_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id);


--
-- Name: recipe_consumption_logs recipe_consumption_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_consumption_logs
    ADD CONSTRAINT recipe_consumption_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: recipe_consumption_logs recipe_consumption_logs_unit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_consumption_logs
    ADD CONSTRAINT recipe_consumption_logs_unit_fkey FOREIGN KEY (unit) REFERENCES public.units(code);


--
-- Name: recipe_items recipe_items_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_items
    ADD CONSTRAINT recipe_items_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE RESTRICT;


--
-- Name: recipe_items recipe_items_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_items
    ADD CONSTRAINT recipe_items_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE CASCADE;


--
-- Name: recipe_items recipe_items_unit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipe_items
    ADD CONSTRAINT recipe_items_unit_fkey FOREIGN KEY (unit) REFERENCES public.units(code);


--
-- Name: recipes recipes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: recipes recipes_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: recipes recipes_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: recipes recipes_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recipes
    ADD CONSTRAINT recipes_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: referral_redemptions referral_redemptions_referred_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_redemptions
    ADD CONSTRAINT referral_redemptions_referred_tenant_id_fkey FOREIGN KEY (referred_tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: referral_redemptions referral_redemptions_referrer_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referral_redemptions
    ADD CONSTRAINT referral_redemptions_referrer_tenant_id_fkey FOREIGN KEY (referrer_tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: referrals referrals_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: refunds refunds_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);


--
-- Name: refunds refunds_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: refunds refunds_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id);


--
-- Name: refunds refunds_stock_restored_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_stock_restored_by_fkey FOREIGN KEY (stock_restored_by) REFERENCES public.profiles(id);


--
-- Name: refunds refunds_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: refunds refunds_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);


--
-- Name: reservations reservations_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: reservations reservations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: reservations reservations_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: reservations reservations_table_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.branch_tables(id) ON DELETE SET NULL;


--
-- Name: reservations reservations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: shifts shifts_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: shifts shifts_cashier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES public.profiles(id);


--
-- Name: shifts shifts_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.profiles(id);


--
-- Name: shifts shifts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: stock_movements stock_movements_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: stock_movements stock_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: stock_movements stock_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: stock_movements stock_movements_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: stock_opname_items stock_opname_items_ingredient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opname_items
    ADD CONSTRAINT stock_opname_items_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE RESTRICT;


--
-- Name: stock_opname_items stock_opname_items_opname_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opname_items
    ADD CONSTRAINT stock_opname_items_opname_id_fkey FOREIGN KEY (opname_id) REFERENCES public.stock_opnames(id) ON DELETE CASCADE;


--
-- Name: stock_opname_items stock_opname_items_unit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opname_items
    ADD CONSTRAINT stock_opname_items_unit_fkey FOREIGN KEY (unit) REFERENCES public.units(code);


--
-- Name: stock_opname_logs stock_opname_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opname_logs
    ADD CONSTRAINT stock_opname_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: stock_opname_logs stock_opname_logs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opname_logs
    ADD CONSTRAINT stock_opname_logs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: stock_opname_logs stock_opname_logs_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opname_logs
    ADD CONSTRAINT stock_opname_logs_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: stock_opname_logs stock_opname_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opname_logs
    ADD CONSTRAINT stock_opname_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: stock_opnames stock_opnames_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opnames
    ADD CONSTRAINT stock_opnames_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


--
-- Name: stock_opnames stock_opnames_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opnames
    ADD CONSTRAINT stock_opnames_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: stock_opnames stock_opnames_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_opnames
    ADD CONSTRAINT stock_opnames_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: suppliers suppliers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: transaction_items transaction_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: transaction_items transaction_items_recipe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id);


--
-- Name: transaction_items transaction_items_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: transaction_items transaction_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_items
    ADD CONSTRAINT transaction_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: transaction_payments transaction_payments_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_payments
    ADD CONSTRAINT transaction_payments_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_cashier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES public.profiles(id);


--
-- Name: transactions transactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.memberships(id);


--
-- Name: transactions transactions_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: transactions transactions_promotion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id);


--
-- Name: transactions transactions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_voucher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES public.vouchers(id) ON DELETE SET NULL;


--
-- Name: unit_conversions unit_conversions_from_unit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_conversions
    ADD CONSTRAINT unit_conversions_from_unit_fkey FOREIGN KEY (from_unit) REFERENCES public.units(code);


--
-- Name: unit_conversions unit_conversions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_conversions
    ADD CONSTRAINT unit_conversions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: unit_conversions unit_conversions_to_unit_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unit_conversions
    ADD CONSTRAINT unit_conversions_to_unit_fkey FOREIGN KEY (to_unit) REFERENCES public.units(code);


--
-- Name: voucher_redemptions voucher_redemptions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: voucher_redemptions voucher_redemptions_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: voucher_redemptions voucher_redemptions_voucher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voucher_redemptions
    ADD CONSTRAINT voucher_redemptions_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES public.vouchers(id) ON DELETE CASCADE;


--
-- Name: vouchers vouchers_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: vouchers vouchers_promotion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE CASCADE;


--
-- Name: vouchers vouchers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vouchers
    ADD CONSTRAINT vouchers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: waste_logs waste_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_logs
    ADD CONSTRAINT waste_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;


--
-- Name: waste_logs waste_logs_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_logs
    ADD CONSTRAINT waste_logs_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: waste_logs waste_logs_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_logs
    ADD CONSTRAINT waste_logs_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: waste_logs waste_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.waste_logs
    ADD CONSTRAINT waste_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: memberships Access memberships by tenant_id; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access memberships by tenant_id" ON public.memberships USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: products Access products by tenant_id; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access products by tenant_id" ON public.products USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: transaction_items Access transaction_items by parent tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access transaction_items by parent tenant" ON public.transaction_items USING ((public.is_super_admin() OR (transaction_id IN ( SELECT transactions.id
   FROM public.transactions
  WHERE (transactions.tenant_id = public.current_tenant_id())))));


--
-- Name: transactions Access transactions by tenant_id and branch; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Access transactions by tenant_id and branch" ON public.transactions USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id IS NULL) OR (branch_id = public.current_branch_id())))));


--
-- Name: approval_requests Approval requests: create own request; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Approval requests: create own request" ON public.approval_requests FOR INSERT WITH CHECK (((tenant_id = public.current_tenant_id()) AND (requested_by = auth.uid())));


--
-- Name: approval_requests Approval requests: manager/owner review; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Approval requests: manager/owner review" ON public.approval_requests FOR UPDATE USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner())));


--
-- Name: approval_requests Approval requests: view own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Approval requests: view own tenant" ON public.approval_requests FOR SELECT USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: attendance Attendance: create own request; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Attendance: create own request" ON public.attendance FOR INSERT WITH CHECK (((tenant_id = public.current_tenant_id()) AND ((employee_id = auth.uid()) OR public.is_manager_or_owner())));


--
-- Name: attendance Attendance: manager/owner review; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Attendance: manager/owner review" ON public.attendance FOR UPDATE USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner())));


--
-- Name: attendance Attendance: view own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Attendance: view own tenant" ON public.attendance FOR SELECT USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: audit_log Audit log: insert tenant members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Audit log: insert tenant members" ON public.audit_log FOR INSERT WITH CHECK ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: audit_log Audit log: read branch-scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Audit log: read branch-scoped" ON public.audit_log FOR SELECT USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: branch_ingredients_stock Branch ingredient stock: manager/owner scoped write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Branch ingredient stock: manager/owner scoped write" ON public.branch_ingredients_stock USING (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner() AND (public.is_owner() OR (branch_id = public.current_branch_id()))));


--
-- Name: branch_ingredients_stock Branch ingredient stock: scoped view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Branch ingredient stock: scoped view" ON public.branch_ingredients_stock FOR SELECT USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: branch_stock Branch stock: manager/owner scoped insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Branch stock: manager/owner scoped insert" ON public.branch_stock FOR INSERT WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner() AND (public.is_owner() OR (branch_id = public.current_branch_id()))));


--
-- Name: branch_stock Branch stock: manager/owner scoped write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Branch stock: manager/owner scoped write" ON public.branch_stock FOR UPDATE USING (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner() AND (public.is_owner() OR (branch_id = public.current_branch_id()))));


--
-- Name: branch_stock Branch stock: scoped view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Branch stock: scoped view" ON public.branch_stock FOR SELECT USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: branch_tables Branch tables: branch-scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Branch tables: branch-scoped" ON public.branch_tables USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: branches Branches: owner insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Branches: owner insert" ON public.branches FOR INSERT WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_owner()));


--
-- Name: branches Branches: owner update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Branches: owner update" ON public.branches FOR UPDATE USING (((tenant_id = public.current_tenant_id()) AND public.is_owner()));


--
-- Name: branches Branches: view own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Branches: view own tenant" ON public.branches FOR SELECT USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: cash_movements Cash movements: branch-scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Cash movements: branch-scoped" ON public.cash_movements USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: channel_pricings Channel pricings: manager/owner delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Channel pricings: manager/owner delete" ON public.channel_pricings FOR DELETE USING (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner()));


--
-- Name: channel_pricings Channel pricings: manager/owner update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Channel pricings: manager/owner update" ON public.channel_pricings FOR UPDATE USING (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner()));


--
-- Name: channel_pricings Channel pricings: manager/owner write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Channel pricings: manager/owner write" ON public.channel_pricings FOR INSERT WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner()));


--
-- Name: channel_pricings Channel pricings: view own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Channel pricings: view own tenant" ON public.channel_pricings FOR SELECT USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: ingredient_stock_movements Ingredient stock movements: scoped view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Ingredient stock movements: scoped view" ON public.ingredient_stock_movements FOR SELECT USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: ingredient_stock_opname_logs Ingredient stock opname logs: scoped view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Ingredient stock opname logs: scoped view" ON public.ingredient_stock_opname_logs FOR SELECT USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner() AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: ingredient_waste_logs Ingredient waste logs: scoped view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Ingredient waste logs: scoped view" ON public.ingredient_waste_logs FOR SELECT USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner() AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: ingredients Ingredients: manager/owner write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Ingredients: manager/owner write" ON public.ingredients USING (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner())) WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner()));


--
-- Name: ingredients Ingredients: view own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Ingredients: view own tenant" ON public.ingredients FOR SELECT USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: kitchen_stations Kitchen stations: branch-scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Kitchen stations: branch-scoped" ON public.kitchen_stations USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: modifier_groups Modifier groups: manager/owner write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Modifier groups: manager/owner write" ON public.modifier_groups USING (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner())) WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner()));


--
-- Name: modifier_groups Modifier groups: view own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Modifier groups: view own tenant" ON public.modifier_groups FOR SELECT USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: modifier_ingredient_impacts Modifier ingredient impacts: manager/owner write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Modifier ingredient impacts: manager/owner write" ON public.modifier_ingredient_impacts USING ((public.is_manager_or_owner() AND (modifier_id IN ( SELECT m.id
   FROM (public.modifiers m
     JOIN public.modifier_groups g ON ((g.id = m.modifier_group_id)))
  WHERE (g.tenant_id = public.current_tenant_id()))))) WITH CHECK ((public.is_manager_or_owner() AND (modifier_id IN ( SELECT m.id
   FROM (public.modifiers m
     JOIN public.modifier_groups g ON ((g.id = m.modifier_group_id)))
  WHERE (g.tenant_id = public.current_tenant_id())))));


--
-- Name: modifier_ingredient_impacts Modifier ingredient impacts: via modifier tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Modifier ingredient impacts: via modifier tenant" ON public.modifier_ingredient_impacts FOR SELECT USING ((public.is_super_admin() OR (modifier_id IN ( SELECT m.id
   FROM (public.modifiers m
     JOIN public.modifier_groups g ON ((g.id = m.modifier_group_id)))
  WHERE (g.tenant_id = public.current_tenant_id())))));


--
-- Name: modifiers Modifiers: manager/owner write via group tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Modifiers: manager/owner write via group tenant" ON public.modifiers USING ((public.is_manager_or_owner() AND (modifier_group_id IN ( SELECT modifier_groups.id
   FROM public.modifier_groups
  WHERE (modifier_groups.tenant_id = public.current_tenant_id()))))) WITH CHECK ((public.is_manager_or_owner() AND (modifier_group_id IN ( SELECT modifier_groups.id
   FROM public.modifier_groups
  WHERE (modifier_groups.tenant_id = public.current_tenant_id())))));


--
-- Name: modifiers Modifiers: view via group tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Modifiers: view via group tenant" ON public.modifiers FOR SELECT USING ((public.is_super_admin() OR (modifier_group_id IN ( SELECT modifier_groups.id
   FROM public.modifier_groups
  WHERE (modifier_groups.tenant_id = public.current_tenant_id())))));


--
-- Name: monthly_targets Monthly targets: manager/owner update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Monthly targets: manager/owner update" ON public.monthly_targets FOR UPDATE USING (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner()));


--
-- Name: monthly_targets Monthly targets: manager/owner write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Monthly targets: manager/owner write" ON public.monthly_targets FOR INSERT WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner()));


--
-- Name: monthly_targets Monthly targets: view own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Monthly targets: view own tenant" ON public.monthly_targets FOR SELECT USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: order_item_modifiers Order item modifiers: via parent order; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Order item modifiers: via parent order" ON public.order_item_modifiers USING ((EXISTS ( SELECT 1
   FROM (public.order_items oi
     JOIN public.orders o ON ((o.id = oi.order_id)))
  WHERE ((oi.id = order_item_modifiers.order_item_id) AND (public.is_super_admin() OR ((o.tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (o.branch_id = public.current_branch_id()))))))));


--
-- Name: order_items Order items: via parent order; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Order items: via parent order" ON public.order_items USING ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND (public.is_super_admin() OR ((o.tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (o.branch_id = public.current_branch_id()))))))));


--
-- Name: orders Orders: branch-scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Orders: branch-scoped" ON public.orders USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: payments Payments: read own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Payments: read own tenant" ON public.payments FOR SELECT USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: product_modifier_groups Product modifier groups: manager/owner write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Product modifier groups: manager/owner write" ON public.product_modifier_groups USING ((public.is_manager_or_owner() AND (product_id IN ( SELECT products.id
   FROM public.products
  WHERE (products.tenant_id = public.current_tenant_id()))))) WITH CHECK ((public.is_manager_or_owner() AND (product_id IN ( SELECT products.id
   FROM public.products
  WHERE (products.tenant_id = public.current_tenant_id())))));


--
-- Name: product_modifier_groups Product modifier groups: via product tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Product modifier groups: via product tenant" ON public.product_modifier_groups FOR SELECT USING ((public.is_super_admin() OR (product_id IN ( SELECT products.id
   FROM public.products
  WHERE (products.tenant_id = public.current_tenant_id())))));


--
-- Name: product_variants Product variants: manager/owner write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Product variants: manager/owner write" ON public.product_variants USING (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner())) WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner()));


--
-- Name: product_variants Product variants: view own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Product variants: view own tenant" ON public.product_variants FOR SELECT USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: profiles Profiles: own row, own tenant, or super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Profiles: own row, own tenant, or super_admin" ON public.profiles USING ((public.is_super_admin() OR (id = auth.uid()) OR (tenant_id = public.current_tenant_id())));


--
-- Name: qr_orders QR orders: branch-scoped view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "QR orders: branch-scoped view" ON public.qr_orders FOR SELECT USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: recipe_consumption_logs Recipe consumption logs: scoped view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Recipe consumption logs: scoped view" ON public.recipe_consumption_logs FOR SELECT USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: recipe_items Recipe items: manager/owner write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Recipe items: manager/owner write" ON public.recipe_items USING ((public.is_manager_or_owner() AND (recipe_id IN ( SELECT recipes.id
   FROM public.recipes
  WHERE (recipes.tenant_id = public.current_tenant_id()))))) WITH CHECK ((public.is_manager_or_owner() AND (recipe_id IN ( SELECT recipes.id
   FROM public.recipes
  WHERE (recipes.tenant_id = public.current_tenant_id())))));


--
-- Name: recipe_items Recipe items: view via recipe tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Recipe items: view via recipe tenant" ON public.recipe_items FOR SELECT USING ((public.is_super_admin() OR (recipe_id IN ( SELECT recipes.id
   FROM public.recipes
  WHERE (recipes.tenant_id = public.current_tenant_id())))));


--
-- Name: recipes Recipes: manager/owner write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Recipes: manager/owner write" ON public.recipes USING (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner())) WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner()));


--
-- Name: recipes Recipes: view own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Recipes: view own tenant" ON public.recipes FOR SELECT USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: referral_redemptions Referral redemptions: view own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Referral redemptions: view own" ON public.referral_redemptions FOR SELECT USING ((public.is_super_admin() OR (referrer_tenant_id = public.current_tenant_id()) OR (referred_tenant_id = public.current_tenant_id())));


--
-- Name: referrals Referrals: own tenant or super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Referrals: own tenant or super_admin" ON public.referrals FOR SELECT USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: refunds Refunds: branch-scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Refunds: branch-scoped" ON public.refunds USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id = public.current_branch_id()))))) WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: reservations Reservations: branch-scoped view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Reservations: branch-scoped view" ON public.reservations FOR SELECT USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: shifts Shifts: own tenant or super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Shifts: own tenant or super_admin" ON public.shifts USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: admin_special_codes Special codes: super admin only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Special codes: super admin only" ON public.admin_special_codes USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: stock_movements Stock movements: manager/owner write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Stock movements: manager/owner write" ON public.stock_movements FOR INSERT WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner() AND (created_by = auth.uid())));


--
-- Name: stock_movements Stock movements: view own tenant and branch; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Stock movements: view own tenant and branch" ON public.stock_movements FOR SELECT USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.is_owner() OR (branch_id IS NULL) OR (branch_id = public.current_branch_id())))));


--
-- Name: stock_opname_items Stock opname items: manager/owner scoped view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Stock opname items: manager/owner scoped view" ON public.stock_opname_items FOR SELECT USING ((public.is_super_admin() OR (opname_id IN ( SELECT stock_opnames.id
   FROM public.stock_opnames
  WHERE ((stock_opnames.tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner() AND (public.is_owner() OR (stock_opnames.branch_id = public.current_branch_id())))))));


--
-- Name: stock_opname_logs Stock opname: manager/owner insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Stock opname: manager/owner insert" ON public.stock_opname_logs FOR INSERT WITH CHECK (false);


--
-- Name: stock_opname_logs Stock opname: manager/owner view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Stock opname: manager/owner view" ON public.stock_opname_logs FOR SELECT USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner() AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: stock_opnames Stock opnames: manager/owner scoped view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Stock opnames: manager/owner scoped view" ON public.stock_opnames FOR SELECT USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner() AND (public.is_owner() OR (branch_id = public.current_branch_id())))));


--
-- Name: subscriptions Subscriptions: own tenant or super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Subscriptions: own tenant or super_admin" ON public.subscriptions USING ((public.is_super_admin() OR (tenant_id = public.current_tenant_id())));


--
-- Name: tenants Tenants: own tenant or super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenants: own tenant or super_admin" ON public.tenants USING ((public.is_super_admin() OR (id = public.current_tenant_id())));


--
-- Name: transaction_payments Transaction payments: via parent transaction; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Transaction payments: via parent transaction" ON public.transaction_payments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.transactions t
  WHERE ((t.id = transaction_payments.transaction_id) AND (public.is_super_admin() OR (t.tenant_id = public.current_tenant_id()))))));


--
-- Name: unit_conversions Unit conversions: owner writes own tenant override; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Unit conversions: owner writes own tenant override" ON public.unit_conversions USING ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND public.is_owner()))) WITH CHECK ((public.is_super_admin() OR ((tenant_id = public.current_tenant_id()) AND public.is_owner())));


--
-- Name: unit_conversions Unit conversions: view global or own tenant; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Unit conversions: view global or own tenant" ON public.unit_conversions FOR SELECT USING ((public.is_super_admin() OR (tenant_id IS NULL) OR (tenant_id = public.current_tenant_id())));


--
-- Name: units Units: anyone authenticated can view; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Units: anyone authenticated can view" ON public.units FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: admin_special_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_special_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: approval_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: branch_ingredients_stock; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.branch_ingredients_stock ENABLE ROW LEVEL SECURITY;

--
-- Name: branch_stock; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.branch_stock ENABLE ROW LEVEL SECURITY;

--
-- Name: branch_tables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.branch_tables ENABLE ROW LEVEL SECURITY;

--
-- Name: branches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

--
-- Name: budgets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

--
-- Name: budgets budgets_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY budgets_select ON public.budgets FOR SELECT USING ((tenant_id = ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: budgets budgets_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY budgets_write ON public.budgets USING (((tenant_id = ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::public.user_role, 'super_admin'::public.user_role]))))))) WITH CHECK ((tenant_id = ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: cash_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: channel_pricings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.channel_pricings ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_points ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_tiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_tiers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: expense_categories expense_categories_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expense_categories_select ON public.expense_categories FOR SELECT USING ((tenant_id = ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: expense_categories expense_categories_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expense_categories_write ON public.expense_categories USING (((tenant_id = ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::public.user_role, 'super_admin'::public.user_role]))))))) WITH CHECK ((tenant_id = ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses expenses_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_insert ON public.expenses FOR INSERT WITH CHECK (((tenant_id = ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) AND (created_by = auth.uid())));


--
-- Name: expenses expenses_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_select ON public.expenses FOR SELECT USING ((tenant_id = ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: expenses expenses_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_update ON public.expenses FOR UPDATE USING (((tenant_id = ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) AND (voided_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = ANY (ARRAY['owner'::public.user_role, 'super_admin'::public.user_role]))))))) WITH CHECK ((tenant_id = ( SELECT profiles.tenant_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: ingredient_stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ingredient_stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: ingredient_stock_opname_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ingredient_stock_opname_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: ingredient_waste_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ingredient_waste_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: ingredients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;

--
-- Name: kitchen_stations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kitchen_stations ENABLE ROW LEVEL SECURITY;

--
-- Name: loyalty_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loyalty_config ENABLE ROW LEVEL SECURITY;

--
-- Name: loyalty_points_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loyalty_points_log ENABLE ROW LEVEL SECURITY;

--
-- Name: memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: modifier_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.modifier_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: modifier_ingredient_impacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.modifier_ingredient_impacts ENABLE ROW LEVEL SECURITY;

--
-- Name: modifiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.modifiers ENABLE ROW LEVEL SECURITY;

--
-- Name: monthly_targets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.monthly_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: order_item_modifiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_item_modifiers ENABLE ROW LEVEL SECURITY;

--
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: product_modifier_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_modifier_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: product_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: promotions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: qr_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.qr_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: recipe_consumption_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recipe_consumption_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: recipe_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recipe_items ENABLE ROW LEVEL SECURITY;

--
-- Name: recipes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

--
-- Name: referral_redemptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.referral_redemptions ENABLE ROW LEVEL SECURITY;

--
-- Name: referrals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

--
-- Name: refunds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

--
-- Name: reservations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_points rls_customer_points; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_customer_points ON public.customer_points FOR SELECT USING (((tenant_id = public.current_tenant_id()) OR public.is_super_admin()));


--
-- Name: customer_tiers rls_customer_tiers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_customer_tiers ON public.customer_tiers FOR SELECT USING (((tenant_id = public.current_tenant_id()) OR public.is_super_admin()));


--
-- Name: customer_tiers rls_customer_tiers_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_customer_tiers_update ON public.customer_tiers FOR UPDATE USING (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: customer_tiers rls_customer_tiers_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_customer_tiers_write ON public.customer_tiers FOR INSERT WITH CHECK (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner()));


--
-- Name: customers rls_customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_customers ON public.customers USING (((tenant_id = public.current_tenant_id()) OR public.is_super_admin()));


--
-- Name: customers rls_customers_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_customers_insert ON public.customers FOR INSERT WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: customers rls_customers_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_customers_update ON public.customers FOR UPDATE USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: loyalty_config rls_loyalty_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_loyalty_config ON public.loyalty_config FOR SELECT USING (((tenant_id = public.current_tenant_id()) OR public.is_super_admin()));


--
-- Name: loyalty_config rls_loyalty_config_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_loyalty_config_write ON public.loyalty_config USING (((tenant_id = public.current_tenant_id()) AND public.is_manager_or_owner())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: loyalty_points_log rls_loyalty_points_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_loyalty_points_log ON public.loyalty_points_log FOR SELECT USING (((tenant_id = public.current_tenant_id()) OR public.is_super_admin()));


--
-- Name: purchase_orders rls_po; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_po ON public.purchase_orders USING (((tenant_id = public.current_tenant_id()) OR public.is_super_admin()));


--
-- Name: purchase_orders rls_po_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_po_insert ON public.purchase_orders FOR INSERT WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: purchase_orders rls_po_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_po_update ON public.purchase_orders FOR UPDATE USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: promotions rls_promotions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_promotions ON public.promotions USING (((tenant_id = public.current_tenant_id()) OR public.is_super_admin()));


--
-- Name: suppliers rls_suppliers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_suppliers ON public.suppliers USING (((tenant_id = public.current_tenant_id()) OR public.is_super_admin()));


--
-- Name: suppliers rls_suppliers_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_suppliers_insert ON public.suppliers FOR INSERT WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: suppliers rls_suppliers_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_suppliers_update ON public.suppliers FOR UPDATE USING ((tenant_id = public.current_tenant_id())) WITH CHECK ((tenant_id = public.current_tenant_id()));


--
-- Name: vouchers rls_vouchers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_vouchers ON public.vouchers USING (((tenant_id = public.current_tenant_id()) OR public.is_super_admin()));


--
-- Name: waste_logs rls_waste_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rls_waste_logs ON public.waste_logs USING (((tenant_id = public.current_tenant_id()) OR public.is_super_admin()));


--
-- Name: shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_opname_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_opname_items ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_opname_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_opname_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_opnames; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_opnames ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: tenants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

--
-- Name: transaction_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transaction_items ENABLE ROW LEVEL SECURITY;

--
-- Name: transaction_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transaction_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: unit_conversions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unit_conversions ENABLE ROW LEVEL SECURITY;

--
-- Name: units; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

--
-- Name: vouchers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;

--
-- Name: waste_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.waste_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: FUNCTION create_online_order(p_tenant_id uuid, p_branch_id uuid, p_channel text, p_customer_name text, p_notes text, p_items jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_online_order(p_tenant_id uuid, p_branch_id uuid, p_channel text, p_customer_name text, p_notes text, p_items jsonb) TO authenticated;


--
-- Name: FUNCTION create_reservation(p_branch_id uuid, p_customer_name text, p_customer_phone text, p_reservation_at timestamp with time zone, p_party_size integer, p_deposit_amount numeric, p_notes text, p_table_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_reservation(p_branch_id uuid, p_customer_name text, p_customer_phone text, p_reservation_at timestamp with time zone, p_party_size integer, p_deposit_amount numeric, p_notes text, p_table_id uuid) TO anon;
GRANT ALL ON FUNCTION public.create_reservation(p_branch_id uuid, p_customer_name text, p_customer_phone text, p_reservation_at timestamp with time zone, p_party_size integer, p_deposit_amount numeric, p_notes text, p_table_id uuid) TO authenticated;


--
-- Name: FUNCTION get_branch_public_info(p_branch_slug text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_branch_public_info(p_branch_slug text) TO anon;
GRANT ALL ON FUNCTION public.get_branch_public_info(p_branch_slug text) TO authenticated;


--
-- Name: FUNCTION get_qr_order_page(p_branch_slug text, p_table_number text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_qr_order_page(p_branch_slug text, p_table_number text) TO anon;
GRANT ALL ON FUNCTION public.get_qr_order_page(p_branch_slug text, p_table_number text) TO authenticated;


--
-- Name: FUNCTION get_qr_order_status(p_qr_order_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_qr_order_status(p_qr_order_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_qr_order_status(p_qr_order_id uuid) TO authenticated;


--
-- Name: FUNCTION get_reservation_status(p_reservation_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_reservation_status(p_reservation_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_reservation_status(p_reservation_id uuid) TO authenticated;


--
-- Name: FUNCTION seat_reservation(p_reservation_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.seat_reservation(p_reservation_id uuid) TO authenticated;


--
-- Name: FUNCTION submit_qr_order(p_branch_slug text, p_table_number text, p_customer_name text, p_customer_phone text, p_payment_method text, p_notes text, p_items jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.submit_qr_order(p_branch_slug text, p_table_number text, p_customer_name text, p_customer_phone text, p_payment_method text, p_notes text, p_items jsonb) TO anon;
GRANT ALL ON FUNCTION public.submit_qr_order(p_branch_slug text, p_table_number text, p_customer_name text, p_customer_phone text, p_payment_method text, p_notes text, p_items jsonb) TO authenticated;


--
-- Name: FUNCTION update_reservation_status(p_reservation_id uuid, p_new_status text, p_table_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_reservation_status(p_reservation_id uuid, p_new_status text, p_table_id uuid) TO authenticated;


--
--



-- Bagian di atas (hasil pg_dump) sengaja mengeset search_path KOSONG di awal
-- file supaya setiap nama objek di dalamnya fully-qualified (public.xxx).
-- Statement di bawah ini BARU (ditulis manual, bukan dari pg_dump) dan
-- memakai nama tabel polos, jadi search_path perlu dikembalikan dulu.
SET search_path TO public, pg_temp;

-- =========================================================================
-- SEED / REFERENCE DATA
-- =========================================================================
-- Dijalankan TERAKHIR (setelah semua tabel/fungsi/RLS ada). Ini murni data
-- referensi statis (unit master + faktor konversi bawaan) -- BUKAN backfill
-- data transaksi/tenant lama (backfill semacam itu ada di migration_011/
-- migration_013/migration_16 asli untuk tenant yang SUDAH ADA sebelum
-- migrasi tsb dijalankan; pada database baru yang masih kosong, backfill
-- itu tidak menghasilkan baris apa pun -- jadi sengaja TIDAK disalin ke
-- sini, lihat DATABASE_CONSOLIDATION_REPORT.md bagian "Known Issues").

-- Dari migration_012: unit master resmi -- "bungkus" adalah unit resmi dan
-- TIDAK boleh dihapus/diganti jadi "pcs" oleh migrasi manapun.
INSERT INTO units (code, name) VALUES
  ('gram', 'Gram'),
  ('kilogram', 'Kilogram'),
  ('ml', 'Mililiter'),
  ('liter', 'Liter'),
  ('pcs', 'Pcs'),
  ('bungkus', 'Bungkus'),
  ('pack', 'Pack'),
  ('bottle', 'Bottle'),
  ('box', 'Box'),
  ('sachet', 'Sachet')
ON CONFLICT (code) DO NOTHING;

-- Dari migration_012: faktor konversi default global (tenant_id NULL).
-- Konversi pack/box -> pcs sengaja TIDAK diisi default (beda per supplier),
-- tenant mengisi sendiri lewat admin.
INSERT INTO unit_conversions (tenant_id, from_unit, to_unit, factor) VALUES
  (NULL, 'kilogram', 'gram', 1000),
  (NULL, 'gram', 'kilogram', 0.001),
  (NULL, 'liter', 'ml', 1000),
  (NULL, 'ml', 'liter', 0.001)
ON CONFLICT DO NOTHING;

-- =========================================================================
-- SUPABASE REALTIME PUBLICATION
-- =========================================================================
-- Supabase menyediakan publication `supabase_realtime` secara bawaan di
-- setiap project baru (sudah ada, kosong) -- jadi TIDAK di-CREATE PUBLICATION
-- di sini (akan gagal "already exists" di project asli). Tabel berikut
-- ditambahkan satu per satu (idempotent lewat pengecekan pg_publication_tables,
-- pola yang sama dipakai migration_012/013/014), supaya KDS/Kanban/tracking
-- pelanggan bisa subscribe INSERT/UPDATE-nya secara realtime.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'products'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE products;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE order_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'approval_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE approval_requests;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'customers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE customers;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'loyalty_points_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE loyalty_points_log;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'purchase_orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE purchase_orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'qr_orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE qr_orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'reservations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE reservations;
  END IF;
END $$;

-- =========================================================================
-- OTOMATISASI STATUS SUBSCRIPTION/BILLING (pg_cron) -- dari migration_16
-- =========================================================================
-- Disalin verbatim dari migration_16.sql bagian D3. Dibungkus DO block +
-- EXCEPTION WHEN OTHERS supaya schema.sql ini TETAP BERHASIL dijalankan
-- penuh walau pg_cron belum/tidak bisa diaktifkan di paket Supabase yang
-- bersangkutan (perlu diaktifkan manual lewat Dashboard > Database >
-- Extensions kalau baris CREATE EXTENSION di bawah gagal karena keterbatasan
-- izin, lalu jalankan ulang blok ini saja).
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron tidak bisa diaktifkan otomatis (%). Aktifkan manual lewat Supabase Dashboard > Database > Extensions, lalu jalankan ulang blok penjadwalan ini.', SQLERRM;
  END;

  BEGIN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'capos_refresh_subscription_statuses';
    PERFORM cron.schedule(
      'capos_refresh_subscription_statuses',
      '0 * * * *', -- setiap jam
      $cron$SELECT refresh_all_subscription_statuses();$cron$
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Gagal menjadwalkan job pg_cron (%). Fungsi refresh_all_subscription_statuses() tetap tersedia untuk dipanggil manual/lewat scheduler eksternal.', SQLERRM;
  END;
END $$;

-- =========================================================================
-- CATATAN VERSI SKEMA
-- =========================================================================
-- Menggantikan baris 'migration_16' yang sebelumnya menandai dirinya
-- is_final=true (lihat catatan di header file ini soal migration_017 yang
-- tetap dibuat sesudahnya). Baris di bawah mencerminkan realita: file
-- KONSOLIDASI ini, bukan migration_16, yang sekarang jadi titik referensi
-- "final" untuk instalasi baru.
INSERT INTO schema_migrations_log (version, description, is_final)
VALUES (
  'schema.sql (consolidated)',
  'Skema konsolidasi dari schema.sql sebelumnya + migration_001..017, dibuat via replay penuh ke PostgreSQL kosong + pg_dump (lihat DATABASE_CONSOLIDATION_REPORT.md). migration_16 sebelumnya menandai dirinya final dan secara eksplisit meminta migration_17.sql TIDAK dibuat, namun migration_017_enforce_active_profile.sql tetap dibuat setelahnya dan turut dikonsolidasi di sini -- lihat laporan konsolidasi untuk detail kontradiksi ini.',
  true
)
ON CONFLICT (version) DO UPDATE SET is_final = true, description = EXCLUDED.description;

UPDATE schema_migrations_log SET is_final = false WHERE version <> 'schema.sql (consolidated)';

COMMENT ON TABLE schema_migrations_log IS
  'Log versi skema. Baris is_final=true menunjuk ke titik referensi "fresh install" yang berlaku saat ini -- sejak konsolidasi ini, itu adalah schema.sql, BUKAN lagi migration_16.';
