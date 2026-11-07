-- ============================================================
-- migration_023_cash_integrity.sql
--
-- Integritas kas & transaksi (5 prioritas audit):
--   1. Rekonsiliasi kas shift: checkout_transaction WAJIB mencatat
--      transaction_payments (sebelumnya transaksi tunai "Bayar Langsung"
--      tidak pernah masuk expected cash).
--   2. Kembalian ditangani server-side: cash_received, change_amount,
--      change_status (NONE/PENDING/SETTLED/WRITTEN_OFF), jatuh tempo,
--      konfirmasi, dan write-off dengan otorisasi supervisor.
--   3. Idempotency: idempotency_key unik per tenant + invoice_number unik.
--   4. Transaksi immutable: RLS hanya SELECT + INSERT, UPDATE/DELETE
--      diblokir trigger (kecuali RPC tepercaya yang membuka gerbang lokal).
--   5. Audit: perubahan harga produk, cash movement, no-sale, force close.
--
-- Aman dijalankan berkali-kali (idempotent).
-- ============================================================

SET check_function_bodies = off;

-- ------------------------------------------------------------
-- JEJAK PENERAPAN (ledger)
-- ------------------------------------------------------------
-- Baris '023_cash_integrity' HANYA muncul kalau seluruh isi file ini
-- berhasil dieksekusi. Kalau satu statement gagal, PostgreSQL membatalkan
-- seluruh batch, jadi tabel ini tetap kosong dan kamu bisa tahu bahwa
-- migrasi BELUM masuk (tidak perlu menebak dari kolom yang ada).
CREATE TABLE IF NOT EXISTS capos_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT
);
REVOKE ALL ON TABLE capos_migrations FROM anon, authenticated;

-- ============================================================
-- 0a. KOMPATIBILITAS: BERSIHKAN SISA PATCH ALTERNATIF
-- ============================================================
-- Sebagian instalasi pernah menjalankan patch "capos-cash-integrity"
-- (implementasi lain yang TIDAK dipakai repo ini). Patch itu membuat
-- constraint change_status dengan nilai WAITING/GIVEN/OWED serta trigger
-- audit ganda. Kalau dibiarkan, transaksi baru dengan PENDING/SETTLED/
-- WRITTEN_OFF akan ditolak dan audit harga produk tercatat dua kali.
-- Bagian ini hanya menyentuh objek milik patch tersebut; instalasi bersih
-- tidak terpengaruh (semua DROP IF EXISTS / UPDATE tanpa baris cocok).
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_change_status_chk;

DO $$
BEGIN
  -- Kolom change_status belum tentu ada saat migrasi ini jalan pertama kali.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name = 'change_status'
  ) THEN
    -- Buka gerbang immutability bila 023 lama sempat terpasang sebagian.
    PERFORM set_config('capos.allow_transaction_mutation', 'on', true);
    UPDATE transactions
       SET change_status = CASE change_status
             WHEN 'WAITING' THEN 'PENDING'
             WHEN 'GIVEN'   THEN 'SETTLED'
             WHEN 'OWED'    THEN 'PENDING'
             ELSE change_status
           END
     WHERE change_status IN ('WAITING', 'GIVEN', 'OWED');
    PERFORM set_config('capos.allow_transaction_mutation', 'off', true);
  END IF;
END $$;

DROP TRIGGER IF EXISTS transactions_lock ON transactions;
DROP FUNCTION IF EXISTS trg_transactions_lock();
DROP TRIGGER IF EXISTS products_price_audit ON products;
DROP FUNCTION IF EXISTS trg_products_price_audit();

-- ============================================================
-- 0. KOLOM KONFIGURASI CABANG
-- ============================================================
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS petty_cash_threshold NUMERIC NOT NULL DEFAULT 100000;

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS change_due_minutes INT NOT NULL DEFAULT 1440;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'branches_petty_cash_threshold_check'
  ) THEN
    ALTER TABLE branches
      ADD CONSTRAINT branches_petty_cash_threshold_check CHECK (petty_cash_threshold >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'branches_change_due_minutes_check'
  ) THEN
    ALTER TABLE branches
      ADD CONSTRAINT branches_change_due_minutes_check CHECK (change_due_minutes BETWEEN 1 AND 43200);
  END IF;
END $$;

COMMENT ON COLUMN branches.petty_cash_threshold IS
  'migration_023: batas minimum kas laci. Dipakai shift_cash_alert() untuk memperingatkan kasir agar melakukan setoran/penukaran uang, TANPA membocorkan omzet ke kasir (blind closing).';
COMMENT ON COLUMN branches.change_due_minutes IS
  'migration_023: berapa menit kembalian yang belum diserahkan boleh menggantung sebelum ditandai lewat/eskalasi. Default 1440 (24 jam).';

-- ============================================================
-- 1. KOLOM TRANSAKSI: STATUS, TUNAI, KEMBALIAN, IDEMPOTENCY
-- ============================================================
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'COMPLETED';

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS cash_received NUMERIC;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS change_amount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS change_status TEXT NOT NULL DEFAULT 'NONE';

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS change_due_at TIMESTAMPTZ;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS change_confirmed_at TIMESTAMPTZ;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS change_confirmed_by UUID REFERENCES profiles(id);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS change_writeoff_at TIMESTAMPTZ;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS change_writeoff_by UUID REFERENCES profiles(id);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS change_writeoff_reason TEXT;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_status_check'
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_status_check
      CHECK (status IN ('COMPLETED', 'VOIDED', 'REFUNDED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_change_status_check'
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_change_status_check
      CHECK (change_status IN ('NONE', 'PENDING', 'SETTLED', 'WRITTEN_OFF'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_cash_received_check'
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_cash_received_check
      CHECK (cash_received IS NULL OR cash_received >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_change_amount_check'
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_change_amount_check CHECK (change_amount >= 0);
  END IF;
END $$;

COMMENT ON COLUMN transactions.status IS
  'migration_023: status siklus hidup transaksi. Baris transaksi TIDAK PERNAH dihapus/diubah bebas; void/refund dicatat di tabel refunds + audit_log.';
COMMENT ON COLUMN transactions.cash_received IS
  'migration_023: uang tunai fisik yang diterima dari pelanggan (khusus bagian tunai). NULL untuk transaksi non-tunai / jalur lama.';
COMMENT ON COLUMN transactions.change_amount IS
  'migration_023: kembalian yang menjadi kewajiban kasir ke pelanggan. BUKAN diskon dan BUKAN pengurang omzet.';
COMMENT ON COLUMN transactions.change_status IS
  'migration_023: NONE = tidak ada kembalian; PENDING = belum diserahkan; SETTLED = sudah diserahkan; WRITTEN_OFF = dihapuskan (pelanggan tidak kembali) dan diakui sebagai kas masuk.';
COMMENT ON COLUMN transactions.idempotency_key IS
  'migration_023: kunci idempotensi dari klien (UUID per percobaan checkout). Unik per tenant, sehingga retry/ double-submit tidak membuat transaksi ganda.';

-- Dedupe invoice lama SEBELUM unique index dibuat. Transaksi duplikat
-- (invoice_number sama dalam satu tenant) diberi sufiks -DUP<n> supaya
-- histori tidak hilang, tetapi index unik bisa ditegakkan.
--
-- Trigger immutability mungkin SUDAH ada dari run sebelumnya, jadi buka
-- gerbang mutasi sementara di sekitar UPDATE ini (kalau tidak, migrasi
-- gagal saat dijalankan ulang pada DB yang masih punya duplikat).
-- Dibungkus DO supaya set_config lokal dan UPDATE berada di transaksi
-- yang sama, bahkan kalau file dijalankan statement-per-statement.
DO $$
BEGIN
  PERFORM set_config('capos.allow_transaction_mutation', 'on', true);
  UPDATE transactions t
  SET invoice_number = t.invoice_number || '-DUP' || d.rn
  FROM (
    SELECT id,
           row_number() OVER (
             PARTITION BY tenant_id, invoice_number
             ORDER BY created_at, id
           ) AS rn
    FROM transactions
  ) d
  WHERE t.id = d.id AND d.rn > 1;
  PERFORM set_config('capos.allow_transaction_mutation', 'off', true);
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_transactions_tenant_invoice
  ON transactions (tenant_id, invoice_number);

CREATE UNIQUE INDEX IF NOT EXISTS ux_transactions_tenant_idempotency
  ON transactions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_change_pending
  ON transactions (tenant_id, branch_id, change_status, change_due_at)
  WHERE change_status = 'PENDING';

-- ============================================================
-- 2. CASH MOVEMENTS: PENUKARAN UANG (NET ZERO)
-- ============================================================
ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS is_exchange BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE cash_movements
  ADD COLUMN IF NOT EXISTS exchange_group_id UUID;

CREATE INDEX IF NOT EXISTS idx_cash_movements_exchange_group
  ON cash_movements (exchange_group_id)
  WHERE exchange_group_id IS NOT NULL;

COMMENT ON COLUMN cash_movements.is_exchange IS
  'migration_023: true = baris penukaran uang (pecahan besar <-> kecil). Selalu dibuat BERPASANGAN cash_out + cash_in dengan nominal sama, sehingga net kas laci = 0.';
COMMENT ON COLUMN cash_movements.exchange_group_id IS
  'migration_023: id grup yang sama untuk pasangan cash_out/cash_in hasil satu penukaran uang.';

-- ============================================================
-- 3. TABEL EVENT WEBHOOK MIDTRANS (DEDUPE)
-- ============================================================
CREATE TABLE IF NOT EXISTS midtrans_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT,
  order_id TEXT,
  transaction_status TEXT,
  status_code TEXT,
  gross_amount NUMERIC,
  payload JSONB,
  processed BOOLEAN NOT NULL DEFAULT false,
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_midtrans_webhook_events_order
  ON midtrans_webhook_events (order_id, created_at DESC);

ALTER TABLE midtrans_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE midtrans_webhook_events FROM anon, authenticated;

COMMENT ON TABLE midtrans_webhook_events IS
  'migration_023: dedupe notifikasi Midtrans. event_key unik = order_id + status + status_code + fraud_status + gross_amount. Hanya webhook (service role) yang boleh menulis; tidak ada policy RLS untuk client.';

-- Penanda idempoten perpanjangan langganan. Notifikasi Midtrans bisa
-- di-retry berkali-kali; kolom ini memastikan masa aktif HANYA ditambah
-- sekali per baris `payments`, bahkan kalau percobaan pertama gagal di
-- tengah jalan setelah status pembayaran sudah menjadi 'paid'.
DO $$
BEGIN
  IF to_regclass('public.payments') IS NOT NULL THEN
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS subscription_granted_at TIMESTAMPTZ;
  END IF;
END $$;

-- ============================================================
-- 4. IMMUTABILITAS TRANSAKSI
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_transaction_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('capos.allow_transaction_mutation', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'IMMUTABLE_TRANSACTION: transaksi yang sudah tersimpan tidak boleh diubah/dihapus. Gunakan void/refund yang tercatat di audit_log.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_immutable ON transactions;
CREATE TRIGGER trg_transactions_immutable
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_transaction_mutation();

-- RLS: hapus FOR ALL (yang diam-diam mengizinkan UPDATE/DELETE), ganti
-- SELECT + INSERT. UPDATE/DELETE tidak punya policy sama sekali, jadi
-- ditolak untuk semua client (service role tetap bypass).
DROP POLICY IF EXISTS "Access transactions by tenant_id" ON transactions;
DROP POLICY IF EXISTS "Access transactions by tenant_id and branch" ON transactions;
DROP POLICY IF EXISTS "Transactions: read" ON transactions;
DROP POLICY IF EXISTS "Transactions: insert" ON transactions;

CREATE POLICY "Transactions: read" ON transactions
  FOR SELECT USING (
    is_super_admin() OR (
      tenant_id = current_tenant_id()
      AND (is_owner() OR branch_id IS NULL OR branch_id = current_branch_id())
    )
  );

-- Tidak ada policy INSERT: satu-satunya jalur pembuatan transaksi adalah
-- checkout_transaction()/checkout_order_v2() (SECURITY DEFINER) yang
-- menghitung ulang harga & total di server. Sebelumnya client bisa
-- INSERT baris transactions langsung lewat REST dengan total karangan.
DROP POLICY IF EXISTS "Transactions: insert" ON transactions;
DROP POLICY IF EXISTS "Transactions: read" ON transactions;
CREATE POLICY "Transactions: read" ON transactions
  FOR SELECT USING (
    is_super_admin() OR (
      tenant_id = current_tenant_id()
      AND (is_owner() OR branch_id IS NULL OR branch_id = current_branch_id())
    )
  );

-- ============================================================
-- 4b. SHIFTS, CASH MOVEMENTS & ITEMS: APPEND-ONLY
-- ============================================================
-- Policy lama memakai FOR ALL, sehingga setiap anggota tenant bisa
-- meng-UPDATE/DELETE baris lewat REST API langsung — melewati RPC, audit,
-- dan otorisasi supervisor. Contoh nyata: kasir menghapus cash_out atau
-- menurunkan opening_cash sebelum tutup shift. Semua penulisan sah sudah
-- lewat RPC SECURITY DEFINER, jadi cukup sisakan policy SELECT.
DROP POLICY IF EXISTS "Shifts: own tenant or super_admin" ON shifts;
DROP POLICY IF EXISTS "Shifts: read" ON shifts;
CREATE POLICY "Shifts: read" ON shifts
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "Cash movements: branch-scoped" ON cash_movements;
DROP POLICY IF EXISTS "Cash movements: read" ON cash_movements;
CREATE POLICY "Cash movements: read" ON cash_movements
  FOR SELECT USING (
    is_super_admin() OR (
      tenant_id = current_tenant_id()
      AND (is_owner() OR branch_id = current_branch_id())
    )
  );

DROP POLICY IF EXISTS "Access transaction_items by parent tenant" ON transaction_items;
DROP POLICY IF EXISTS "Transaction items: read" ON transaction_items;
CREATE POLICY "Transaction items: read" ON transaction_items
  FOR SELECT USING (
    is_super_admin() OR transaction_id IN (
      SELECT id FROM transactions WHERE tenant_id = current_tenant_id()
    )
  );

-- transaksi tidak bisa diubah lewat update/delete, tapi item & payment
-- tetap bisa dibaca; keduanya append-only dari RPC tepercaya.

-- audit_log hanya ditulis oleh trigger/RPC SECURITY DEFINER. Policy INSERT
-- lama mengizinkan setiap anggota tenant menyisipkan baris audit palsu,
-- jadi dicabut juga di level policy (privilege INSERT-nya sudah dicabut
-- di bagian 15).
DROP POLICY IF EXISTS "Audit log: insert tenant members" ON audit_log;

-- ============================================================
-- 5. AUDIT: HARGA PRODUK, CASH MOVEMENT, NO-SALE, FORCE CLOSE
-- ============================================================
CREATE OR REPLACE FUNCTION log_product_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.price IS DISTINCT FROM OLD.price THEN
    INSERT INTO audit_log (
      tenant_id, branch_id, user_id, action, entity_type, entity_id,
      old_value, new_value, reason
    ) VALUES (
      NEW.tenant_id, NULL, auth.uid(), 'PRODUCT_PRICE_CHANGE', 'product', NEW.id,
      jsonb_build_object('name', OLD.name, 'price', OLD.price),
      jsonb_build_object('name', NEW.name, 'price', NEW.price),
      'Perubahan harga produk'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_price_audit ON products;
CREATE TRIGGER trg_products_price_audit
  AFTER UPDATE OF price ON products
  FOR EACH ROW EXECUTE FUNCTION log_product_price_change();

CREATE OR REPLACE FUNCTION log_cash_movement_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO audit_log (
    tenant_id, branch_id, user_id, action, entity_type, entity_id,
    old_value, new_value, reason
  ) VALUES (
    NEW.tenant_id,
    NEW.branch_id,
    NEW.created_by,
    CASE
      WHEN NEW.is_exchange THEN 'CASH_EXCHANGE'
      WHEN NEW.type = 'cash_in' THEN 'CASH_IN'
      ELSE 'CASH_OUT'
    END,
    'cash_movement',
    NEW.id,
    NULL,
    jsonb_build_object(
      'type', NEW.type,
      'amount', NEW.amount,
      'is_exchange', NEW.is_exchange,
      'exchange_group_id', NEW.exchange_group_id,
      'shift_id', NEW.shift_id
    ),
    NEW.reason
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_movements_audit ON cash_movements;
CREATE TRIGGER trg_cash_movements_audit
  AFTER INSERT ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION log_cash_movement_audit();

-- ============================================================
-- 6. HELPER: IZIN MUTASI TRANSAKSI UNTUK RPC TERPercAYA
-- ============================================================
CREATE OR REPLACE FUNCTION allow_transaction_mutation()
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('capos.allow_transaction_mutation', 'on', true);
END;
$$;

-- Shift hanya boleh dioperasikan oleh kasir pemiliknya, manager cabang
-- yang sama, owner, atau super_admin. Tanpa ini, kasir cabang A bisa
-- menutup/menukar uang shift kasir cabang B dalam tenant yang sama.
CREATE OR REPLACE FUNCTION assert_shift_operator(p_shift shifts)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF is_super_admin() OR is_owner() THEN
    RETURN;
  END IF;

  -- Kasir pemilik shift TETAP harus berada di cabang shift tersebut.
  -- Tanpa cek cabang, kasir bisa membuka shift di cabang lain lalu
  -- mencatat kas masuk/keluar di sana (menggeser laci cabang itu).
  IF p_shift.cashier_id = auth.uid()
     AND (p_shift.branch_id IS NULL OR p_shift.branch_id = current_branch_id()) THEN
    RETURN;
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role = 'manager'
     AND p_shift.branch_id IS NOT NULL
     AND p_shift.branch_id = current_branch_id() THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Akses ditolak: shift ini bukan milik Anda';
END;
$$;

-- open_shift_v2 (migration_013) hanya memeriksa keanggotaan tenant dan
-- mencari shift terbuka tanpa melihat cabang. Akibatnya kasir cabang A
-- bisa membuka shift di cabang B, dan checkout lama bisa "menempel" ke
-- shift cabang lain yang kebetulan masih terbuka. Versi ini mengikat
-- shift ke cabang operator dan hanya mengizinkan manager membuka shift
-- untuk kasir di cabangnya sendiri.
CREATE OR REPLACE FUNCTION open_shift_v2(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_cashier_id UUID,
  p_opening_cash NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift_id UUID;
  v_role TEXT;
BEGIN
  IF NOT is_super_admin() THEN
    SELECT role INTO v_role FROM profiles
      WHERE id = auth.uid() AND tenant_id = p_tenant_id AND is_active = true;
    IF v_role IS NULL THEN
      RAISE EXCEPTION 'Akses ditolak: bukan anggota aktif tenant ini';
    END IF;

    IF NOT is_owner() THEN
      IF p_branch_id IS DISTINCT FROM current_branch_id() THEN
        RAISE EXCEPTION 'Akses ditolak: cabang shift bukan cabang Anda';
      END IF;
      IF v_role = 'cashier' AND p_cashier_id <> auth.uid() THEN
        RAISE EXCEPTION 'Akses ditolak: kasir hanya boleh membuka shift sendiri';
      END IF;
    END IF;
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM branches WHERE id = p_branch_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Cabang tidak valid untuk tenant ini';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = p_cashier_id AND tenant_id = p_tenant_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Kasir tidak valid atau tidak aktif untuk tenant ini';
  END IF;

  IF p_opening_cash IS NULL OR p_opening_cash < 0 THEN
    RAISE EXCEPTION 'Modal awal kas tidak valid';
  END IF;

  -- Cari shift terbuka MILIK KASIR DI CABANG INI. Sebelumnya branch_id
  -- tidak ikut dicocokkan, sehingga checkout di cabang B bisa memakai
  -- shift cabang A yang masih terbuka.
  SELECT id INTO v_shift_id FROM shifts
    WHERE tenant_id = p_tenant_id
      AND cashier_id = p_cashier_id
      AND branch_id IS NOT DISTINCT FROM p_branch_id
      AND status = 'open'
    LIMIT 1;

  IF v_shift_id IS NULL THEN
    INSERT INTO shifts (tenant_id, branch_id, cashier_id, status, opening_cash)
      VALUES (p_tenant_id, p_branch_id, p_cashier_id, 'open', p_opening_cash)
      RETURNING id INTO v_shift_id;
  END IF;

  RETURN v_shift_id;
END;
$$;

COMMENT ON FUNCTION open_shift_v2(UUID, UUID, UUID, NUMERIC) IS
  'migration_023: shift diikat ke cabang operator. Kasir hanya bisa membuka shift sendiri di cabangnya; manager boleh membuka untuk kasir di cabang yang sama; owner/super_admin bebas.';

-- ============================================================
-- 7. CHECKOUT_TRANSACTION (BARU)
-- ============================================================
-- Drop semua overload lama supaya panggilan 10-argumen tidak jatuh ke
-- versi lama yang tidak mencatat transaction_payments.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'checkout_transaction'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION checkout_transaction(
  p_tenant_id UUID,
  p_cashier_id UUID,
  p_invoice_number TEXT,
  p_payment_method TEXT,
  p_member_code TEXT,
  p_items JSONB,
  p_branch_id UUID DEFAULT NULL,
  p_customer_id UUID DEFAULT NULL,
  p_voucher_code TEXT DEFAULT NULL,
  p_promotion_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_cash_received NUMERIC DEFAULT NULL,
  p_change_pending BOOLEAN DEFAULT false,
  p_change_due_minutes INT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  v_existing_tx UUID;
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

  v_idempotency_key TEXT := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_cash_received NUMERIC := NULL;
  v_change_amount NUMERIC := 0;
  v_change_status TEXT := 'NONE';
  v_change_due_at TIMESTAMPTZ := NULL;
  v_change_confirmed_at TIMESTAMPTZ := NULL;
  v_change_confirmed_by UUID := NULL;
  v_change_due_minutes INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: bukan anggota tenant ini';
  END IF;

  IF p_payment_method NOT IN ('cash', 'qris', 'debit', 'credit', 'ewallet', 'bank_transfer', 'online_platform') THEN
    RAISE EXCEPTION 'Metode pembayaran tidak valid: %', p_payment_method;
  END IF;

  IF p_invoice_number IS NULL OR trim(p_invoice_number) = '' THEN
    RAISE EXCEPTION 'INVALID_INVOICE: Nomor invoice wajib diisi';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang kosong';
  END IF;

  -- Kasir & cabang WAJIB milik tenant yang sama. Tanpa validasi ini,
  -- pemanggil bisa mengarang UUID kasir/cabang dari tenant lain (RPC ini
  -- SECURITY DEFINER, jadi pengecekan RLS di dalamnya tidak otomatis).
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_cashier_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Kasir tidak valid untuk tenant ini';
  END IF;

  v_branch_id := COALESCE(
    p_branch_id,
    (SELECT branch_id FROM profiles WHERE id = p_cashier_id),
    main_branch_id(p_tenant_id)
  );

  IF v_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM branches WHERE id = v_branch_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Cabang tidak valid untuk tenant ini';
  END IF;

  -- Selain tenant, CABANG juga harus cocok. Tanpa ini kasir cabang A bisa
  -- mengirim p_branch_id cabang B: stok cabang B berkurang, shift terbuka
  -- di cabang B, dan kas masuk tercatat di laci cabang B — semuanya atas
  -- nama kasir cabang A. Owner/super_admin tetap boleh lintas cabang.
  IF NOT is_owner() AND NOT is_super_admin() THEN
    IF v_branch_id IS NOT NULL AND v_branch_id <> current_branch_id() THEN
      RAISE EXCEPTION 'Akses ditolak: cabang transaksi bukan cabang Anda';
    END IF;
    IF p_cashier_id <> auth.uid() THEN
      RAISE EXCEPTION 'Akses ditolak: transaksi hanya boleh dibuat atas nama Anda sendiri';
    END IF;
  END IF;

  -- Idempotensi: kalau kunci yang sama sudah pernah diproses, kembalikan
  -- transaksi yang sudah ada. Ini yang membuat retry jaringan / tap ganda
  -- tidak pernah membuat 2 transaksi.
  IF v_idempotency_key IS NOT NULL THEN
    -- Kunci advisory per (tenant, idempotency_key) men-serialisasi dua
    -- request yang benar-benar bersamaan, sehingga keduanya tidak lolos
    -- SELECT di bawah lalu bertabrakan di unique index (yang akan membuat
    -- salah satu request gagal alih-alih mengembalikan transaksi yang sama).
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_tenant_id::TEXT || '|idem|' || v_idempotency_key, 0)
    );

    SELECT id INTO v_existing_tx
    FROM transactions
    WHERE tenant_id = p_tenant_id AND idempotency_key = v_idempotency_key
    LIMIT 1;
    IF v_existing_tx IS NOT NULL THEN
      RETURN v_existing_tx;
    END IF;
  END IF;

  -- Serialisasi nomor invoice juga: dua request dengan invoice sama tidak
  -- boleh sama-sama lolos pengecekan lalu bertabrakan di unique index.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::TEXT || '|inv|' || p_invoice_number, 0)
  );

  SELECT id INTO v_existing_tx
  FROM transactions
  WHERE tenant_id = p_tenant_id AND invoice_number = p_invoice_number
  LIMIT 1;
  IF v_existing_tx IS NOT NULL THEN
    RAISE EXCEPTION 'DUPLICATE_INVOICE: Nomor invoice "%" sudah pernah dipakai.', p_invoice_number;
  END IF;

  v_shift_id := open_shift_v2(p_tenant_id, v_branch_id, p_cashier_id, 0);

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

  -- Tunai: server yang menghitung kembalian. Klien hanya boleh mengirim
  -- uang fisik yang diterima; tidak boleh mengarang total/kembalian.
  IF p_payment_method = 'cash' AND v_total > 0 THEN
    v_cash_received := COALESCE(p_cash_received, v_total);

    IF v_cash_received < v_total THEN
      RAISE EXCEPTION 'CASH_INSUFFICIENT: Uang tunai diterima (%) kurang dari total tagihan (%).',
        v_cash_received, v_total;
    END IF;

    v_change_amount := v_cash_received - v_total;

    IF v_change_amount > 0 THEN
      SELECT change_due_minutes INTO v_change_due_minutes
      FROM branches WHERE id = v_branch_id;
      v_change_due_minutes := COALESCE(
        NULLIF(p_change_due_minutes, 0),
        v_change_due_minutes,
        1440
      );
      IF v_change_due_minutes < 1 OR v_change_due_minutes > 43200 THEN
        RAISE EXCEPTION 'Batas waktu kembalian tidak valid';
      END IF;

      IF COALESCE(p_change_pending, false) THEN
        v_change_status := 'PENDING';
        v_change_due_at := now() + make_interval(mins => v_change_due_minutes);
      ELSE
        v_change_status := 'SETTLED';
        v_change_confirmed_at := now();
        v_change_confirmed_by := p_cashier_id;
      END IF;
    END IF;
  END IF;

  IF p_customer_id IS NOT NULL THEN
    v_loyalty_points := COALESCE(calculate_loyalty_points(p_tenant_id, v_total), 0);
  END IF;

  INSERT INTO transactions (
    id, tenant_id, cashier_id, invoice_number, total_amount,
    payment_method, member_id, is_offline_sync, shift_id, branch_id,
    customer_id, voucher_id, promotion_id, subtotal_amount, discount_amount,
    loyalty_points_earned, status,
    cash_received, change_amount, change_status, change_due_at,
    change_confirmed_at, change_confirmed_by, idempotency_key
  ) VALUES (
    v_tx_id, p_tenant_id, p_cashier_id, p_invoice_number, v_total,
    p_payment_method, v_member_id, false, v_shift_id, v_branch_id,
    p_customer_id,
    CASE WHEN v_voucher.id IS NOT NULL THEN v_voucher.id ELSE NULL END,
    CASE WHEN v_voucher.id IS NULL AND p_promotion_id IS NOT NULL THEN p_promotion_id ELSE NULL END,
    v_subtotal, v_member_discount + v_promo_voucher_discount,
    v_loyalty_points, 'COMPLETED',
    v_cash_received, v_change_amount, v_change_status, v_change_due_at,
    v_change_confirmed_at, v_change_confirmed_by, v_idempotency_key
  );

  -- WAJIB: catat rincian pembayaran. Tanpa baris ini, transaksi tunai
  -- "Bayar Langsung" tidak pernah muncul di expected cash shift.
  IF v_total > 0 THEN
    INSERT INTO transaction_payments (transaction_id, method, amount)
      VALUES (v_tx_id, p_payment_method, v_total);
  END IF;

  FOR v_i IN 1..array_length(v_pending_product_ids, 1) LOOP
    INSERT INTO transaction_items (transaction_id, product_id, qty, subtotal)
      VALUES (v_tx_id, v_pending_product_ids[v_i], v_pending_qtys[v_i], v_pending_subtotals[v_i]);
  END LOOP;

  IF v_voucher.id IS NOT NULL THEN
    INSERT INTO voucher_redemptions (voucher_id, transaction_id, customer_id, discount_given)
      VALUES (v_voucher.id, v_tx_id, p_customer_id, v_promo_voucher_discount);
  END IF;

  IF p_customer_id IS NOT NULL THEN
    IF v_loyalty_points > 0 THEN
      PERFORM earn_loyalty_points(v_tx_id, p_customer_id, v_loyalty_points);
    END IF;

    UPDATE customers
      SET visit_count = visit_count + 1,
          lifetime_spend = lifetime_spend + v_total,
          last_visit_date = now(),
          updated_at = now()
      WHERE id = p_customer_id;
  END IF;

  PERFORM deduct_recipe_stock_for_transaction(v_tx_id);

  RETURN v_tx_id;
END;
$$;

COMMENT ON FUNCTION checkout_transaction(
  UUID, UUID, TEXT, TEXT, TEXT, JSONB, UUID, UUID, TEXT, UUID, TEXT, NUMERIC, BOOLEAN, INT
) IS
  'migration_023: checkout otoritatif. Server menghitung total, mencatat transaction_payments (termasuk tunai), mengelola uang diterima + kembalian (PENDING/SETTLED), dan idempotency via idempotency_key. Klien tidak pernah mengirim harga/total.';

-- ============================================================
-- 8. SHIFT_CASH_SUMMARY + SHIFT_CASH_ALERT
-- ============================================================
DROP FUNCTION IF EXISTS shift_cash_summary(uuid);

CREATE OR REPLACE FUNCTION shift_cash_summary(p_shift_id UUID)
RETURNS TABLE (
  opening_cash NUMERIC,
  total_cash_sales NUMERIC,
  total_cash_in NUMERIC,
  total_cash_out NUMERIC,
  expected_cash NUMERIC,
  total_transactions NUMERIC,
  total_transactions_count BIGINT,
  total_cash_received NUMERIC,
  total_change_owed NUMERIC,
  pending_change_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift shifts%ROWTYPE;
  v_role TEXT;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'Shift tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_shift.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  PERFORM assert_shift_operator(v_shift);

  -- BLIND CLOSING: kasir tidak boleh melihat omzet/expected cash selama
  -- shift masih berjalan. Manager/owner/super_admin tetap boleh (untuk
  -- monitoring), dan `close_shift` membuka gerbang lokal
  -- `capos.allow_open_shift_summary` karena fungsi itu WAJIB menghitung
  -- expected cash sebelum menutup shift.
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_shift.status <> 'closed'
     AND COALESCE(current_setting('capos.allow_open_shift_summary', true), 'off') <> 'on'
     AND COALESCE(v_role, '') NOT IN ('manager', 'owner', 'super_admin') THEN
    RAISE EXCEPTION 'SHIFT_OPEN: Ringkasan kas baru bisa dilihat setelah shift ditutup (blind closing).';
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
    COALESCE((SELECT COUNT(*) FROM transactions WHERE shift_id = p_shift_id), 0) AS total_transactions_count,
    COALESCE((SELECT SUM(cash_received) FROM transactions WHERE shift_id = p_shift_id AND cash_received IS NOT NULL), 0) AS total_cash_received,
    COALESCE((
      SELECT SUM(change_amount) FROM transactions
      WHERE shift_id = p_shift_id AND change_status = 'PENDING'
    ), 0) AS total_change_owed,
    COALESCE((
      SELECT COUNT(*) FROM transactions
      WHERE shift_id = p_shift_id AND change_status = 'PENDING'
    ), 0) AS pending_change_count;
END;
$$;

DROP FUNCTION IF EXISTS shift_cash_alert(uuid);

CREATE OR REPLACE FUNCTION shift_cash_alert(p_shift_id UUID)
RETURNS TABLE (is_low BOOLEAN, threshold NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift shifts%ROWTYPE;
  v_threshold NUMERIC;
  v_expected NUMERIC;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'Shift tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_shift.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak';
  END IF;
  PERFORM assert_shift_operator(v_shift);

  SELECT COALESCE(petty_cash_threshold, 100000) INTO v_threshold
  FROM branches WHERE id = v_shift.branch_id;
  v_threshold := COALESCE(v_threshold, 100000);

  -- Dihitung LANGSUNG di sini (bukan lewat shift_cash_summary) karena
  -- fungsi publik itu sengaja menolak kasir yang membuka ringkasan saat
  -- shift masih open. Hasil akhirnya hanya boolean + threshold, jadi
  -- omzet/expected cash tetap tidak bocor ke client.
  SELECT
    v_shift.opening_cash
      + COALESCE((
          SELECT SUM(tp.amount) FROM transaction_payments tp
          JOIN transactions t ON t.id = tp.transaction_id
          WHERE t.shift_id = p_shift_id AND tp.method = 'cash'
        ), 0)
      + COALESCE((SELECT SUM(amount) FROM cash_movements WHERE shift_id = p_shift_id AND type = 'cash_in'), 0)
      - COALESCE((SELECT SUM(amount) FROM cash_movements WHERE shift_id = p_shift_id AND type = 'cash_out'), 0)
  INTO v_expected;

  -- HANYA boolean + threshold. Omzet/expected cash tidak pernah dikirim
  -- ke kasir supaya blind closing tetap terjaga.
  RETURN QUERY SELECT (COALESCE(v_expected, 0) < v_threshold), v_threshold;
END;
$$;

-- ============================================================
-- 9. CLOSE_SHIFT (PENDING CHANGE GUARD + FORCE CLOSE)
-- ============================================================
DROP FUNCTION IF EXISTS close_shift(uuid, numeric, text);

CREATE OR REPLACE FUNCTION close_shift(
  p_shift_id UUID,
  p_actual_cash NUMERIC,
  p_notes TEXT DEFAULT NULL,
  p_force_close BOOLEAN DEFAULT false,
  p_supervisor_pin TEXT DEFAULT NULL
)
RETURNS TABLE (
  shift_id UUID,
  opening_cash NUMERIC,
  expected_cash NUMERIC,
  actual_cash NUMERIC,
  difference NUMERIC,
  pending_change_amount NUMERIC,
  pending_change_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift shifts%ROWTYPE;
  v_summary RECORD;
  v_supervisor_id UUID;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'Shift tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_shift.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan shift tenant Anda';
  END IF;
  PERFORM assert_shift_operator(v_shift);
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'Shift ini sudah ditutup sebelumnya';
  END IF;
  IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
    RAISE EXCEPTION 'Actual Cash tidak valid';
  END IF;

  -- `shift_cash_summary` menolak ringkasan shift yang masih open untuk
  -- kasir (blind closing). close_shift justru WAJIB menghitungnya sebelum
  -- menutup, jadi buka gerbang lokal sebentar lalu tutup lagi.
  PERFORM set_config('capos.allow_open_shift_summary', 'on', true);
  SELECT * INTO v_summary FROM shift_cash_summary(p_shift_id);
  PERFORM set_config('capos.allow_open_shift_summary', 'off', true);

  IF COALESCE(v_summary.pending_change_count, 0) > 0 THEN
    IF NOT COALESCE(p_force_close, false) THEN
      RAISE EXCEPTION 'PENDING_CHANGE: Masih ada % transaksi dengan kembalian belum diserahkan (total Rp%). Selesaikan kembalian dulu, atau tutup paksa dengan PIN supervisor.',
        v_summary.pending_change_count, v_summary.total_change_owed;
    END IF;

    v_supervisor_id := require_supervisor_authorization(
      'FORCE_CLOSE_SHIFT',
      'shift',
      p_shift_id,
      v_shift.tenant_id,
      v_shift.branch_id,
      COALESCE(NULLIF(trim(COALESCE(p_notes, '')), ''), 'Tutup shift paksa dengan kembalian tertunda'),
      p_supervisor_pin,
      jsonb_build_object(
        'pending_change_count', v_summary.pending_change_count,
        'pending_change_amount', v_summary.total_change_owed
      )
    );
  END IF;

  UPDATE shifts SET
    status = 'closed',
    closed_at = now(),
    closed_by = auth.uid(),
    closing_cash_expected = v_summary.expected_cash,
    closing_cash_actual = p_actual_cash,
    cash_difference = p_actual_cash - v_summary.expected_cash,
    closing_notes = p_notes
  WHERE id = p_shift_id;

  INSERT INTO audit_log (
    tenant_id, branch_id, user_id, action, entity_type, entity_id,
    old_value, new_value, reason
  ) VALUES (
    v_shift.tenant_id,
    v_shift.branch_id,
    auth.uid(),
    'SHIFT_CLOSE',
    'shift',
    p_shift_id,
    jsonb_build_object('status', 'open'),
    jsonb_build_object(
      'status', 'closed',
      'opening_cash', v_shift.opening_cash,
      'expected_cash', v_summary.expected_cash,
      'actual_cash', p_actual_cash,
      'difference', p_actual_cash - v_summary.expected_cash,
      'pending_change_count', v_summary.pending_change_count,
      'pending_change_amount', v_summary.total_change_owed,
      'forced', COALESCE(p_force_close, false),
      'supervisor_id', v_supervisor_id
    ),
    p_notes
  );

  RETURN QUERY
  SELECT
    v_shift.id,
    v_shift.opening_cash,
    v_summary.expected_cash,
    p_actual_cash,
    (p_actual_cash - v_summary.expected_cash),
    COALESCE(v_summary.total_change_owed, 0),
    COALESCE(v_summary.pending_change_count, 0);
END;
$$;

-- ============================================================
-- 10. RECORD_CASH_MOVEMENT (HARDENING OPERATOR SHIFT)
-- ============================================================
-- Versi migration_013 hanya memeriksa tenant, sehingga kasir cabang A bisa
-- mencatat kas masuk/keluar pada shift kasir cabang B dalam tenant yang sama
-- (menggeser expected cash shift orang lain). Redefinisi di sini memakai
-- assert_shift_operator() yang sama dengan RPC kas lainnya.
CREATE OR REPLACE FUNCTION record_cash_movement(
  p_shift_id UUID,
  p_type TEXT,
  p_amount NUMERIC,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  PERFORM assert_shift_operator(v_shift);
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

COMMENT ON FUNCTION record_cash_movement(UUID, TEXT, NUMERIC, TEXT) IS
  'migration_023: hanya kasir pemilik shift, manager cabang yang sama, owner, atau super_admin yang boleh mencatat kas masuk/keluar.';

-- ============================================================
-- 11. RECORD_CASH_EXCHANGE (TUKAR UANG, NET ZERO)
-- ============================================================
CREATE OR REPLACE FUNCTION record_cash_exchange(
  p_shift_id UUID,
  p_amount NUMERIC,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift shifts%ROWTYPE;
  v_group_id UUID := gen_random_uuid();
  v_reason TEXT;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'Shift tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_shift.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan shift tenant Anda';
  END IF;
  PERFORM assert_shift_operator(v_shift);
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'Shift sudah ditutup, tidak bisa menukar uang';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Nominal penukaran harus lebih dari 0';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Keterangan penukaran wajib diisi';
  END IF;

  v_reason := 'Tukar uang: ' || trim(p_reason);

  INSERT INTO cash_movements (
    tenant_id, branch_id, shift_id, type, amount, reason,
    created_by, is_exchange, exchange_group_id
  ) VALUES (
    v_shift.tenant_id, v_shift.branch_id, p_shift_id, 'cash_out', p_amount, v_reason,
    auth.uid(), true, v_group_id
  );

  INSERT INTO cash_movements (
    tenant_id, branch_id, shift_id, type, amount, reason,
    created_by, is_exchange, exchange_group_id
  ) VALUES (
    v_shift.tenant_id, v_shift.branch_id, p_shift_id, 'cash_in', p_amount, v_reason,
    auth.uid(), true, v_group_id
  );

  RETURN v_group_id;
END;
$$;

COMMENT ON FUNCTION record_cash_exchange(UUID, NUMERIC, TEXT) IS
  'migration_023: mencatat penukaran uang sebagai pasangan cash_out + cash_in dengan nominal sama dan exchange_group_id yang sama. Net kas laci = 0, tapi histori pecahan tetap terlihat di audit.';

-- ============================================================
-- 12. LOG_NO_SALE
-- ============================================================
CREATE OR REPLACE FUNCTION log_no_sale(
  p_shift_id UUID,
  p_reason TEXT,
  p_supervisor_pin TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift shifts%ROWTYPE;
  v_supervisor_id UUID;
  v_log_id UUID;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;
  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'Shift tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_shift.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan shift tenant Anda';
  END IF;
  PERFORM assert_shift_operator(v_shift);
  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'Shift sudah ditutup';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Alasan buka laci (no sale) wajib diisi';
  END IF;

  v_supervisor_id := require_supervisor_authorization(
    'NO_SALE',
    'shift',
    p_shift_id,
    v_shift.tenant_id,
    v_shift.branch_id,
    trim(p_reason),
    p_supervisor_pin
  );

  INSERT INTO audit_log (
    tenant_id, branch_id, user_id, action, entity_type, entity_id,
    old_value, new_value, reason
  ) VALUES (
    v_shift.tenant_id,
    v_shift.branch_id,
    auth.uid(),
    'NO_SALE',
    'shift',
    p_shift_id,
    NULL,
    jsonb_build_object('supervisor_id', v_supervisor_id),
    trim(p_reason)
  ) RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- ============================================================
-- 13. RECORD_CASH_TENDER (JALUR ORDER/OPEN BILL)
-- ============================================================
CREATE OR REPLACE FUNCTION record_cash_tender(
  p_transaction_id UUID,
  p_cash_received NUMERIC,
  p_change_pending BOOLEAN DEFAULT false,
  p_change_due_minutes INT DEFAULT NULL
)
RETURNS TABLE (
  transaction_id UUID,
  cash_received NUMERIC,
  change_amount NUMERIC,
  change_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx transactions%ROWTYPE;
  v_cash_portion NUMERIC;
  v_change NUMERIC;
  v_status TEXT;
  v_due_at TIMESTAMPTZ := NULL;
  v_due_minutes INT;
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_tx.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan transaksi tenant Anda';
  END IF;
  IF NOT is_owner() AND NOT is_super_admin() AND v_tx.branch_id IS NOT NULL
     AND v_tx.branch_id <> current_branch_id() THEN
    RAISE EXCEPTION 'Akses ditolak: transaksi milik cabang lain';
  END IF;

  -- Idempotent: kalau uang tunai sudah pernah dicatat, kembalikan nilai
  -- yang sudah ada (retry aman, tidak menimpa dengan angka baru).
  IF v_tx.cash_received IS NOT NULL OR v_tx.change_status <> 'NONE' THEN
    RETURN QUERY SELECT v_tx.id, v_tx.cash_received, v_tx.change_amount, v_tx.change_status;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(tp.amount), 0) INTO v_cash_portion
  FROM transaction_payments tp
  WHERE tp.transaction_id = p_transaction_id AND tp.method = 'cash';

  IF v_cash_portion <= 0 THEN
    RAISE EXCEPTION 'NO_CASH_PAYMENT: Transaksi ini tidak memiliki pembayaran tunai';
  END IF;

  IF p_cash_received IS NULL OR p_cash_received < v_cash_portion THEN
    RAISE EXCEPTION 'CASH_INSUFFICIENT: Uang tunai diterima (%) kurang dari porsi tunai tagihan (%).',
      COALESCE(p_cash_received, 0), v_cash_portion;
  END IF;

  v_change := p_cash_received - v_cash_portion;

  IF v_change > 0 THEN
    SELECT change_due_minutes INTO v_due_minutes FROM branches WHERE id = v_tx.branch_id;
    v_due_minutes := COALESCE(NULLIF(p_change_due_minutes, 0), v_due_minutes, 1440);
    IF v_due_minutes < 1 OR v_due_minutes > 43200 THEN
      RAISE EXCEPTION 'Batas waktu kembalian tidak valid';
    END IF;

    IF COALESCE(p_change_pending, false) THEN
      v_status := 'PENDING';
      v_due_at := now() + make_interval(mins => v_due_minutes);
    ELSE
      v_status := 'SETTLED';
    END IF;
  ELSE
    v_status := 'NONE';
  END IF;

  PERFORM allow_transaction_mutation();

  UPDATE transactions SET
    cash_received = p_cash_received,
    change_amount = v_change,
    change_status = v_status,
    change_due_at = v_due_at,
    change_confirmed_at = CASE WHEN v_status = 'SETTLED' THEN now() ELSE NULL END,
    change_confirmed_by = CASE WHEN v_status = 'SETTLED' THEN auth.uid() ELSE NULL END
  WHERE id = p_transaction_id;

  PERFORM set_config('capos.allow_transaction_mutation', 'off', true);

  INSERT INTO audit_log (
    tenant_id, branch_id, user_id, action, entity_type, entity_id,
    old_value, new_value, reason
  ) VALUES (
    v_tx.tenant_id,
    v_tx.branch_id,
    auth.uid(),
    'CASH_TENDER',
    'transaction',
    p_transaction_id,
    jsonb_build_object('cash_received', v_tx.cash_received, 'change_status', v_tx.change_status),
    jsonb_build_object(
      'cash_received', p_cash_received,
      'cash_portion', v_cash_portion,
      'change_amount', v_change,
      'change_status', v_status
    ),
    'Pencatatan uang tunai & kembalian'
  );

  RETURN QUERY SELECT p_transaction_id, p_cash_received, v_change, v_status;
END;
$$;

-- ============================================================
-- 14. CONFIRM_CHANGE + WRITE_OFF_CHANGE
-- ============================================================
CREATE OR REPLACE FUNCTION confirm_change(
  p_transaction_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  transaction_id UUID,
  change_amount NUMERIC,
  change_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_tx.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan transaksi tenant Anda';
  END IF;
  IF NOT is_owner() AND NOT is_super_admin() AND v_tx.branch_id IS NOT NULL
     AND v_tx.branch_id <> current_branch_id() THEN
    RAISE EXCEPTION 'Akses ditolak: transaksi milik cabang lain';
  END IF;
  IF v_tx.change_status <> 'PENDING' THEN
    RAISE EXCEPTION 'CHANGE_NOT_PENDING: Transaksi ini tidak sedang menunggu kembalian (status: %)', v_tx.change_status;
  END IF;

  PERFORM allow_transaction_mutation();

  UPDATE transactions SET
    change_status = 'SETTLED',
    change_confirmed_at = now(),
    change_confirmed_by = auth.uid()
  WHERE id = p_transaction_id;

  PERFORM set_config('capos.allow_transaction_mutation', 'off', true);

  INSERT INTO audit_log (
    tenant_id, branch_id, user_id, action, entity_type, entity_id,
    old_value, new_value, reason
  ) VALUES (
    v_tx.tenant_id,
    v_tx.branch_id,
    auth.uid(),
    'CHANGE_SETTLED',
    'transaction',
    p_transaction_id,
    jsonb_build_object('change_status', 'PENDING'),
    jsonb_build_object('change_status', 'SETTLED', 'change_amount', v_tx.change_amount),
    p_notes
  );

  RETURN QUERY SELECT p_transaction_id, v_tx.change_amount, 'SETTLED'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION write_off_change(
  p_transaction_id UUID,
  p_reason TEXT,
  p_supervisor_pin TEXT DEFAULT NULL
)
RETURNS TABLE (
  transaction_id UUID,
  change_amount NUMERIC,
  change_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx transactions%ROWTYPE;
  v_supervisor_id UUID;
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE id = p_transaction_id FOR UPDATE;
  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;
  IF NOT is_super_admin() AND v_tx.tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Akses ditolak: bukan transaksi tenant Anda';
  END IF;
  IF NOT is_owner() AND NOT is_super_admin() AND v_tx.branch_id IS NOT NULL
     AND v_tx.branch_id <> current_branch_id() THEN
    RAISE EXCEPTION 'Akses ditolak: transaksi milik cabang lain';
  END IF;
  IF v_tx.change_status <> 'PENDING' THEN
    RAISE EXCEPTION 'CHANGE_NOT_PENDING: Hanya kembalian berstatus PENDING yang bisa dihapuskan';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Alasan write-off wajib diisi';
  END IF;

  v_supervisor_id := require_supervisor_authorization(
    'WRITE_OFF_CHANGE',
    'transaction',
    p_transaction_id,
    v_tx.tenant_id,
    v_tx.branch_id,
    trim(p_reason),
    p_supervisor_pin,
    jsonb_build_object('change_amount', v_tx.change_amount)
  );

  PERFORM allow_transaction_mutation();

  UPDATE transactions SET
    change_status = 'WRITTEN_OFF',
    change_writeoff_at = now(),
    change_writeoff_by = auth.uid(),
    change_writeoff_reason = trim(p_reason)
  WHERE id = p_transaction_id;

  PERFORM set_config('capos.allow_transaction_mutation', 'off', true);

  -- Uang kembalian yang tidak diambil pelanggan tetap berada di laci.
  -- Catat sebagai kas masuk supaya expected cash shift ikut bertambah dan
  -- selisih tutup shift tidak muncul sebagai kelebihan misterius.
  IF v_tx.change_amount > 0 AND v_tx.shift_id IS NOT NULL THEN
    INSERT INTO cash_movements (
      tenant_id, branch_id, shift_id, type, amount, reason, created_by
    ) VALUES (
      v_tx.tenant_id,
      v_tx.branch_id,
      v_tx.shift_id,
      'cash_in',
      v_tx.change_amount,
      'Write-off kembalian #' || v_tx.invoice_number || ' — ' || trim(p_reason),
      auth.uid()
    );
  END IF;

  INSERT INTO audit_log (
    tenant_id, branch_id, user_id, action, entity_type, entity_id,
    old_value, new_value, reason
  ) VALUES (
    v_tx.tenant_id,
    v_tx.branch_id,
    auth.uid(),
    'CHANGE_WRITTEN_OFF',
    'transaction',
    p_transaction_id,
    jsonb_build_object('change_status', 'PENDING'),
    jsonb_build_object(
      'change_status', 'WRITTEN_OFF',
      'change_amount', v_tx.change_amount,
      'supervisor_id', v_supervisor_id
    ),
    trim(p_reason)
  );

  RETURN QUERY SELECT p_transaction_id, v_tx.change_amount, 'WRITTEN_OFF'::TEXT;
END;
$$;

-- ============================================================
-- 15. HAK AKSES: FUNGSI & TABEL KAS
-- ============================================================
-- PostgreSQL memberi EXECUTE ke PUBLIC secara default untuk fungsi baru,
-- DAN Supabase memberi GRANT ALL langsung ke anon/authenticated/service_role
-- lewat default privileges. Jadi mencabut dari PUBLIC saja TIDAK cukup:
-- anon masih bisa memanggil RPC, dan authenticated masih bisa memanggil
-- helper internal seperti allow_transaction_mutation() untuk membuka
-- gerbang trigger immutability. Cabut dari ketiganya dulu, lalu berikan
-- kembali hanya ke role yang memang membutuhkan.
--
-- Semua REVOKE/GRANT dibungkus pengecekan `to_regprocedure` supaya file ini
-- tidak gagal total (dan rollback) hanya karena database lama belum punya
-- salah satu fungsi legacy (mis. open_shift dari migration_005).
DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'allow_transaction_mutation()',
    'assert_shift_operator(shifts)',
    'open_shift(uuid,uuid)',
    'open_shift_v2(uuid,uuid,uuid,numeric)',
    'record_cash_movement(uuid,text,numeric,text)',
    'checkout_transaction(uuid,uuid,text,text,text,jsonb,uuid,uuid,text,uuid,text,numeric,boolean,int)',
    'shift_cash_summary(uuid)',
    'shift_cash_alert(uuid)',
    'close_shift(uuid,numeric,text,boolean,text)',
    'record_cash_exchange(uuid,numeric,text)',
    'log_no_sale(uuid,text,text)',
    'record_cash_tender(uuid,numeric,boolean,int)',
    'confirm_change(uuid,text)',
    'write_off_change(uuid,text,text)'
  ] LOOP
    IF to_regprocedure('public.' || f) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role',
        f
      );
    END IF;
  END LOOP;

  FOREACH f IN ARRAY ARRAY[
    'checkout_transaction(uuid,uuid,text,text,text,jsonb,uuid,uuid,text,uuid,text,numeric,boolean,int)',
    'shift_cash_summary(uuid)',
    'shift_cash_alert(uuid)',
    'open_shift_v2(uuid,uuid,uuid,numeric)',
    'record_cash_movement(uuid,text,numeric,text)',
    'close_shift(uuid,numeric,text,boolean,text)',
    'record_cash_exchange(uuid,numeric,text)',
    'log_no_sale(uuid,text,text)',
    'record_cash_tender(uuid,numeric,boolean,int)',
    'confirm_change(uuid,text)',
    'write_off_change(uuid,text,text)'
  ] LOOP
    IF to_regprocedure('public.' || f) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    END IF;
  END LOOP;

  -- open_shift legacy (migration_005) sengaja dibiarkan TERTUTUP TOTAL:
  -- SECURITY DEFINER tanpa validasi tenant/cabang/pemilik. Aplikasi memakai
  -- open_shift_v2. Pemanggilan internal dari fungsi SECURITY DEFINER tetap
  -- berjalan sebagai owner, jadi tidak butuh grant ini.
END $$;

-- Tabel kas/transaksi hanya boleh DIBACA client. Semua penulisan lewat RPC
-- SECURITY DEFINER. Ini juga mencabut TRUNCATE/REFERENCES/TRIGGER yang tidak
-- dilindungi RLS — tanpa ini siapa pun yang login bisa TRUNCATE transactions
-- meskipun policy-nya SELECT-only, dan bisa menghapus seluruh histori kas.
REVOKE ALL ON TABLE transactions, transaction_items, transaction_payments,
  shifts, cash_movements, audit_log FROM anon, authenticated;
GRANT SELECT ON TABLE transactions, transaction_items, transaction_payments,
  shifts, cash_movements, audit_log TO authenticated;

-- Tabel dedupe webhook Midtrans tidak untuk client sama sekali.
REVOKE ALL ON TABLE midtrans_webhook_events FROM anon, authenticated;

-- Kembalikan validasi function body ke default supaya sesi SQL editor
-- tidak "kebal" terhadap kesalahan referensi pada statement berikutnya.
SET check_function_bodies = on;

-- ============================================================
-- 16. CATAT & VERIFIKASI (tampil di panel Results)
-- ============================================================
-- Baris di capos_migrations adalah bukti bahwa SELURUH file ini sukses.
-- Kalau setelah menjalankan file ini `select * from capos_migrations`
-- kosong, berarti eksekusi gagal/rollback dan migrasi belum masuk.
INSERT INTO capos_migrations (version, note)
VALUES ('023_cash_integrity', 'kas shift, kembalian, idempotency, webhook, audit')
ON CONFLICT (version) DO UPDATE
  SET applied_at = now(),
      note = EXCLUDED.note;

-- Hasil query ini otomatis tampil di panel Results setelah file dijalankan.
-- Target: kolom_transaksi = 5, tabel_dedupe = midtrans_webhook_events,
--         jumlah_rpc = 5, client_boleh_insert = false.
SELECT
  'CAPOS 023 APPLIED' AS status,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name IN ('cash_received','change_amount','change_status',
                          'change_due_at','idempotency_key')) AS kolom_transaksi,
  to_regclass('public.midtrans_webhook_events') AS tabel_dedupe,
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('checkout_transaction','shift_cash_summary',
                        'confirm_change','write_off_change',
                        'record_cash_tender')) AS jumlah_rpc,
  has_table_privilege('authenticated','public.transactions','INSERT') AS client_boleh_insert;
