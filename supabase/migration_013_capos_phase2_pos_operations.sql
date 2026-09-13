-- 013_capos_phase2_pos_operations.sql

SET check_function_bodies = off;

-- =========================================================
-- MIGRASI 012 (GABUNGAN) — Kitchen/Shift/Cash + Purchasing/CRM/Promosi/Analitik (Phase 3) + QR/Reservasi/Multichannel/Growth (Phase 4)
-- File gabungan (concat apa adanya, urutan asli dipertahankan)
-- dari beberapa migration terpisah, supaya jumlah file yang
-- perlu dijalankan lebih sedikit. Tidak ada isi yang diubah,
-- hanya digabung berurutan.
-- =========================================================

-- ============================================================
-- >>> BERASAL DARI: migration_012_phase2_kitchen_shift_cash.sql
-- ============================================================
-- =========================================================
-- MIGRASI PHASE 2: Kitchen Display System (KDS), Kitchen
-- Stations & Printer Routing, Manajemen Kasir (Shift Cash
-- Management), dan Multi-Payment / Partial Payment.
--
-- Melanjutkan skema Phase 1 (schema.sql + migration_001..011).
-- Aman dijalankan berkali-kali (idempotent) di project yang SUDAH
-- ADA — jalankan di Supabase SQL Editor SETELAH migration_011.
--
-- Tidak ada tabel/fungsi Phase 1 yang dihapus atau di-BREAK:
-- checkout_transaction() (quick-sale tanpa dapur) tetap berfungsi
-- seperti sebelumnya. Phase 2 menambah ALUR BARU (order dapur ->
-- KDS -> bayar) sebagai tambahan, bukan pengganti.
-- =========================================================

-- =========================================================
-- 1. KITCHEN STATIONS — pengelompokan item menu per stasiun
--    penyiapan, per CABANG (Bar/Drinks, Kitchen/Food, Dessert, dst).
-- =========================================================
CREATE TABLE IF NOT EXISTS kitchen_stations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,              -- "Bar / Drinks", "Kitchen / Food", "Dessert"
  code TEXT NOT NULL,              -- slug pendek dipakai di UI/printer: 'bar' | 'kitchen' | 'dessert'
  printer_name TEXT,               -- nama/identifier printer thermal yang dipasangkan (Web Bluetooth)
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (branch_id, code)
);

CREATE INDEX IF NOT EXISTS idx_kitchen_stations_tenant_branch ON kitchen_stations (tenant_id, branch_id);

COMMENT ON TABLE kitchen_stations IS 'Stasiun dapur per cabang (Phase 2). Item menu di-assign ke satu stasiun lewat products.station_id supaya KDS & printer routing tahu tiket harus tampil/cetak di layar/printer mana.';

-- Assign menu ke stasiun dapur. Nullable — produk lama yang belum
-- di-assign tetap tampil (fallback: tampil di semua layar KDS/ tidak
-- dicetak otomatis sampai stasiun-nya diisi dari /dashboard/menu).
ALTER TABLE products ADD COLUMN IF NOT EXISTS station_id UUID REFERENCES kitchen_stations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_station ON products (station_id);

-- Seed stasiun default untuk cabang yang sudah ada, supaya tenant lama
-- langsung punya 3 stasiun standar begitu migrasi ini dijalankan
-- (mereka bebas ubah/hapus/tambah dari /dashboard/settings nanti).
INSERT INTO kitchen_stations (tenant_id, branch_id, name, code, sort_order)
SELECT b.tenant_id, b.id, v.name, v.code, v.sort_order
FROM branches b
CROSS JOIN (VALUES
  ('Bar / Drinks', 'bar', 1),
  ('Kitchen / Food', 'kitchen', 2),
  ('Dessert', 'dessert', 3)
) AS v(name, code, sort_order)
ON CONFLICT (branch_id, code) DO NOTHING;

-- =========================================================
-- 2. ORDER LIFECYCLE (KDS) — dipisah dari `transactions`.
--    `transactions` = bukti bayar (Phase 1). `orders` = alur dapur
--    SEBELUM dibayar: NEW -> ACCEPTED -> PREPARING -> READY -> SERVED
--    -> COMPLETED/PAID (atau CANCELLED kapan pun sebelum COMPLETED).
-- =========================================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  shift_id UUID REFERENCES shifts(id),
  cashier_id UUID REFERENCES profiles(id),
  order_number TEXT NOT NULL,             -- nomor pesanan tampil di KDS & struk (mis. "A-014")
  order_type TEXT NOT NULL DEFAULT 'dine_in'
    CHECK (order_type IN ('dine_in', 'takeaway', 'delivery')),
  table_number TEXT,                      -- nomor meja (dine-in), kosong untuk takeaway/delivery
  customer_name TEXT,
  status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED')),
  notes TEXT,
  accepted_at TIMESTAMPTZ,
  preparing_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  served_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  transaction_id UUID REFERENCES transactions(id), -- terisi begitu dibayar lunas (status -> COMPLETED)
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (branch_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_branch_status ON orders (tenant_id, branch_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_shift ON orders (shift_id);

COMMENT ON TABLE orders IS 'Order F&B untuk Kitchen Display System (Phase 2). Timestamp per status (accepted_at, preparing_at, dst) dipakai untuk menghitung durasi/timer penyiapan di KDS.';

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  station_id UUID REFERENCES kitchen_stations(id) ON DELETE SET NULL, -- snapshot stasiun saat order dibuat
  product_name TEXT NOT NULL,       -- snapshot nama (kalau produk diganti nama/dihapus setelahnya)
  variant_notes TEXT,               -- mis. "Oat Milk", "Less Sugar" — varian/modifier bebas teks
  qty INT NOT NULL CHECK (qty > 0),
  unit_price NUMERIC NOT NULL,
  subtotal NUMERIC NOT NULL,
  item_status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (item_status IN ('NEW', 'PREPARING', 'READY')), -- granularitas per-item, opsional dipakai UI
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

CREATE INDEX IF NOT EXISTS idx_order_items_station ON order_items (station_id);

-- Tautkan transaction ke order asalnya (kalau transaksi berasal dari
-- alur KDS, bukan quick-sale). Nullable — quick-sale tetap tidak punya order_id.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id);

CREATE INDEX IF NOT EXISTS idx_transactions_order ON transactions (order_id);

-- =========================================================
-- 3. MULTI-PAYMENT / PARTIAL PAYMENT — satu transaksi bisa dibayar
--    dengan lebih dari 1 metode (mis. Rp50rb Tunai + Rp100rb QRIS).
-- =========================================================
CREATE TABLE IF NOT EXISTS transaction_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  method TEXT NOT NULL
    CHECK (method IN ('cash', 'qris', 'debit', 'credit', 'ewallet', 'bank_transfer')),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  reference_number TEXT,      -- no. referensi EDC/QRIS dinamis/e-wallet (opsional)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transaction_payments_tx ON transaction_payments (transaction_id);

CREATE INDEX IF NOT EXISTS idx_transaction_payments_method ON transaction_payments (method);

COMMENT ON TABLE transaction_payments IS 'Rincian pembayaran per transaksi (Phase 2) — mendukung split/partial payment. SUM(amount) per transaction_id harus sama dengan transactions.total_amount, ditegakkan di dalam checkout_order_v2().';

-- =========================================================
-- 4. SHIFT: modal awal (opening cash) & rekonsiliasi penutupan.
-- =========================================================
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS opening_cash NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closing_cash_expected NUMERIC;

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closing_cash_actual NUMERIC;

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS cash_difference NUMERIC;

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closing_notes TEXT;

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS idx_shifts_branch ON shifts (branch_id);

-- =========================================================
-- 5. CASH MOVEMENTS — Cash In / Cash Out non-transaksi selama shift
--    berjalan (mis. beli es batu darurat, uang masuk dari pemilik, dll).
-- =========================================================
CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('cash_in', 'cash_out')),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,          -- "Beli Es Batu Darurat", "Setoran modal tambahan", dst
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON cash_movements (shift_id);

CREATE INDEX IF NOT EXISTS idx_cash_movements_tenant_branch ON cash_movements (tenant_id, branch_id, created_at DESC);

-- =========================================================
-- 6. RLS — kitchen_stations, orders, order_items, transaction_payments,
--    cash_movements. Mengikuti pola branch-scope migration_011:
--    owner akses semua cabang tenant, manager/cashier hanya cabang
--    penugasannya (current_branch_id()).
-- =========================================================
ALTER TABLE kitchen_stations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Kitchen stations: branch-scoped" ON kitchen_stations;

DROP POLICY IF EXISTS "Kitchen stations: branch-scoped" ON kitchen_stations;
CREATE POLICY "Kitchen stations: branch-scoped" ON kitchen_stations
  FOR ALL USING (
    is_super_admin()
    OR (tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id()))
  );

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Orders: branch-scoped" ON orders;

DROP POLICY IF EXISTS "Orders: branch-scoped" ON orders;
CREATE POLICY "Orders: branch-scoped" ON orders
  FOR ALL USING (
    is_super_admin()
    OR (tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id()))
  );

-- order_items tidak punya tenant_id/branch_id langsung — dicek lewat
-- parent order-nya (mengikuti pola transaction_items di schema.sql,
-- yang juga hanya diakses via transaction_id join).
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Order items: via parent order" ON order_items;

DROP POLICY IF EXISTS "Order items: via parent order" ON order_items;
CREATE POLICY "Order items: via parent order" ON order_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND (is_super_admin() OR (o.tenant_id = current_tenant_id() AND (is_owner() OR o.branch_id = current_branch_id())))
    )
  );

ALTER TABLE transaction_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Transaction payments: via parent transaction" ON transaction_payments;

DROP POLICY IF EXISTS "Transaction payments: via parent transaction" ON transaction_payments;
CREATE POLICY "Transaction payments: via parent transaction" ON transaction_payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.id = transaction_payments.transaction_id
        AND (is_super_admin() OR t.tenant_id = current_tenant_id())
    )
  );

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cash movements: branch-scoped" ON cash_movements;

DROP POLICY IF EXISTS "Cash movements: branch-scoped" ON cash_movements;
CREATE POLICY "Cash movements: branch-scoped" ON cash_movements
  FOR ALL USING (
    is_super_admin()
    OR (tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id()))
  );

-- =========================================================
-- 7. FUNGSI: open_shift_v2 — buka shift dengan modal awal (opening cash).
--    Kalau kasir ini SUDAH punya shift 'open', shift lama itu tetap
--    dipakai (opening_cash tidak ditimpa) — mencegah modal awal
--    "ter-reset" kalau halaman POS di-refresh di tengah shift.
-- =========================================================
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

-- =========================================================
-- 8. FUNGSI: record_cash_movement — Cash In / Cash Out dari laci kasir
--    selama shift berjalan.
-- =========================================================
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

-- =========================================================
-- 9. FUNGSI: shift_cash_summary — hitung Expected Cash saat ini
--    (dipanggil live di modal Tutup Shift, SEBELUM kasir input Actual
--    Cash) = Modal Awal + Total Transaksi Tunai (dari transaction_payments
--    method='cash') + Cash In - Cash Out.
-- =========================================================
CREATE OR REPLACE FUNCTION shift_cash_summary(p_shift_id UUID)
RETURNS TABLE (
  opening_cash NUMERIC,
  total_cash_sales NUMERIC,
  total_cash_in NUMERIC,
  total_cash_out NUMERIC,
  expected_cash NUMERIC,
  total_transactions NUMERIC,
  total_transactions_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- =========================================================
-- 10. FUNGSI: close_shift — kasir input Actual Cash (hasil hitung fisik
--     laci), sistem mencatat Selisih (Difference/Variance) otomatis dan
--     mengunci shift ('closed') sebagai laporan Shift Closing Summary.
-- =========================================================
CREATE OR REPLACE FUNCTION close_shift(
  p_shift_id UUID,
  p_actual_cash NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  shift_id UUID,
  opening_cash NUMERIC,
  expected_cash NUMERIC,
  actual_cash NUMERIC,
  difference NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- =========================================================
-- 12. FUNGSI: update_order_status — dipanggil dari tombol KDS
--     [TERIMA] [MULAI PENYIAPAN] [SIAP DISAJIKAN] [SERVED] [BATALKAN].
--     Menegakkan urutan alur (tidak bisa lompat status secara acak,
--     kecuali ke CANCELLED yang boleh dari status mana pun sebelum
--     COMPLETED), dan mengisi kolom timestamp yang sesuai.
-- =========================================================
CREATE OR REPLACE FUNCTION update_order_status(p_order_id UUID, p_new_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- =========================================================
-- 14. REALTIME — pastikan orders & order_items masuk publication
--     supabase_realtime supaya KDS bisa subscribe INSERT/UPDATE.
--     (Aman dijalankan berkali-kali; abaikan kalau sudah ada.)
-- =========================================================
DO $$
BEGIN
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
END $$;

-- ============================================================
-- >>> BERASAL DARI: migration_014_phase4_qr_reservasi_multichannel_growth.sql
-- ============================================================
-- =========================================================
-- caPOS — PHASE 4: QR Self-Order, Reservasi Meja, Online Order
-- Hub, dan Advanced Growth Analytics.
--
-- Melanjutkan skema Phase 1 (schema.sql), Phase 2/3
-- (migration_001..012), dan Multi-Cabang (migration_011).
-- Jalankan di Supabase SQL Editor SETELAH migration_012.
--
-- Sama seperti migration sebelumnya, semua perubahan di sini
-- ADDITIF & idempotent (aman dijalankan berkali-kali):
--  - Tidak ada DROP tabel/kolom lama.
--  - Alur POS/KDS/Kasir Phase 1-2 (checkout_transaction,
--    create_kitchen_order, checkout_order_v2, dst) TIDAK diubah
--    perilakunya — Phase 4 murni menambah alur baru di atasnya.
--
-- Prinsip keamanan yang dipakai konsisten dengan schema sebelumnya:
--  - Pelanggan yang scan QR (meja / reservasi publik) TIDAK PERNAH
--    login (anon key Supabase) dan TIDAK PERNAH diberi akses baca/
--    tulis langsung ke tabel manapun lewat RLS. Semua interaksi
--    pelanggan lewat FUNGSI SECURITY DEFINER yang divalidasi ketat
--    (harga selalu dari database, bukan dari client) — persis pola
--    checkout_transaction()/submit_stock_opname() di schema lama.
--  - Fungsi yang HANYA boleh dipanggil server (webhook Midtrans
--    pakai service role) SENGAJA TIDAK diberi GRANT EXECUTE ke
--    anon/authenticated, supaya browser tidak bisa memanggilnya
--    langsung walau tahu nama fungsinya.
-- =========================================================


-- =========================================================
-- 0. BRANCHES: slug publik (dipakai di URL QR & form reservasi)
--    /order/[branch_slug]/[table_number] dan /reserve/[branch_slug]
-- =========================================================
ALTER TABLE branches ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

CREATE OR REPLACE FUNCTION slugify(p_text TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT trim(both '-' FROM regexp_replace(lower(trim(p_text)), '[^a-z0-9]+', '-', 'g'));
$$;

-- Buat slug unik untuk sebuah cabang: dasar dari nama cabang, ditambah
-- akhiran acak 4 karakter kalau ternyata sudah dipakai cabang lain
-- (slug harus unik GLOBAL lintas tenant karena URL publik tidak
-- menyertakan tenant_id sama sekali).
CREATE OR REPLACE FUNCTION generate_branch_slug(p_name TEXT, p_branch_id UUID DEFAULT NULL)
RETURNS TEXT
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

CREATE OR REPLACE FUNCTION trg_set_branch_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.slug IS NULL OR trim(NEW.slug) = '' THEN
    NEW.slug := generate_branch_slug(NEW.name, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branches_set_slug ON branches;

CREATE TRIGGER trg_branches_set_slug
  BEFORE INSERT OR UPDATE OF name ON branches
  FOR EACH ROW EXECUTE FUNCTION trg_set_branch_slug();

-- Backfill cabang yang sudah ada sebelum kolom slug ini ditambahkan.
UPDATE branches SET slug = generate_branch_slug(name, id) WHERE slug IS NULL;

ALTER TABLE branches ALTER COLUMN slug SET NOT NULL;

-- Cabang publik hanya boleh ditemukan lewat slug kalau masih aktif —
-- tidak perlu policy RLS SELECT baru untuk anon karena semua akses
-- publik ke `branches` lewat fungsi SECURITY DEFINER di bawah, bukan
-- query langsung ke tabel.


-- =========================================================
-- 1. QR SELF-ORDER ENGINE
-- =========================================================

-- 1a. Master meja per cabang — sumber QR Code & status meja live.
CREATE TABLE IF NOT EXISTS branch_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  table_number TEXT NOT NULL,
  capacity INT NOT NULL DEFAULT 4,
  -- Token acak tambahan (belum dipakai di URL publik saat ini karena
  -- spesifikasi URL memakai table_number polos), disiapkan untuk
  -- perluasan keamanan di masa depan (mis. QR generasi ulang).
  qr_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (branch_id, table_number)
);

CREATE INDEX IF NOT EXISTS idx_branch_tables_branch ON branch_tables (tenant_id, branch_id, is_active);

ALTER TABLE branch_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Branch tables: branch-scoped" ON branch_tables;

DROP POLICY IF EXISTS "Branch tables: branch-scoped" ON branch_tables;
CREATE POLICY "Branch tables: branch-scoped" ON branch_tables
  FOR ALL USING (
    is_super_admin() OR (tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id()))
  );

-- 1b. Perluas `orders` (Phase 2 KDS) dengan asal-usul pesanan (channel)
--     dan tautan ke meja fisik — dipakai bersama oleh QR Self-Order,
--     Reservasi, dan Online Order Hub (poin 2 & 3 di bawah).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_id UUID REFERENCES branch_tables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_table ON orders (table_id);

-- =========================================================
-- 2. SISTEM RESERVASI MEJA
-- =========================================================
CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  table_id UUID REFERENCES branch_tables(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  party_size INT NOT NULL CHECK (party_size > 0),
  reservation_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 90,
  -- Jendela sebelum kedatangan supaya meja tampil "RESERVED" di POS —
  -- default 60 menit, sesuai spesifikasi rentang 30-60 menit.
  reminder_window_minutes INT NOT NULL DEFAULT 60,
  deposit_amount NUMERIC NOT NULL DEFAULT 0,
  deposit_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (deposit_status IN ('unpaid', 'paid', 'refunded', 'forfeited')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show')),
  notes TEXT,
  order_id UUID REFERENCES orders(id),   -- terisi begitu dikonversi jadi pesanan aktif (seat_reservation)
  created_by UUID REFERENCES profiles(id),  -- NULL kalau dibuat lewat form publik pelanggan
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservations_branch_time ON reservations (tenant_id, branch_id, reservation_at);

CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations (tenant_id, branch_id, status);

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- Sama seperti qr_orders: staff hanya baca lewat RLS biasa. SEMUA
-- penulisan (create/confirm/seat/cancel) lewat fungsi SECURITY DEFINER
-- di bawah, supaya validasi 1 tenant/1 cabang konsisten baik dipanggil
-- dari form publik pelanggan (anon) maupun dashboard staff.
DROP POLICY IF EXISTS "Reservations: branch-scoped view" ON reservations;

DROP POLICY IF EXISTS "Reservations: branch-scoped view" ON reservations;
CREATE POLICY "Reservations: branch-scoped view" ON reservations
  FOR SELECT USING (
    is_super_admin() OR (tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id()))
  );

-- =========================================================
-- MIGRASI 013 (GABUNGAN) — Table Foundation (Phase 2 Update 1) + Void/Refund (Phase 2 Update 3)
-- File gabungan (concat apa adanya, urutan asli dipertahankan)
-- dari beberapa migration terpisah, supaya jumlah file yang
-- perlu dijalankan lebih sedikit. Tidak ada isi yang diubah,
-- hanya digabung berurutan.
-- =========================================================

-- ============================================================
-- >>> BERASAL DARI: migration_015_phase2_table_foundation.sql
-- ============================================================
-- =========================================================
-- MIGRASI PHASE 2 — UPDATE 1: TABLE FOUNDATION
--
-- Konteks: audit menemukan `/pos` (layar kasir) TIDAK PERNAH memakai
-- alur KDS yang sudah dibangun di migration_012 (create_kitchen_order,
-- checkout_order_v2) — ia masih memanggil checkout_transaction() lama
-- (cart -> bayar -> selesai, tanpa dapur/meja). Akibatnya:
--   - orders.table_id (ditambah migration_014 untuk QR/Reservasi) TIDAK
--     PERNAH diisi dari kasir — hanya diisi lewat QR Self-Order.
--   - table_live_status HANYA pernah mencerminkan meja QR/reservasi,
--     tidak pernah meja yang dipakai order manual dari kasir.
--   - SendToKitchenModal.tsx & MultiPaymentModal.tsx (siap pakai sejak
--     migration_012) adalah dead code — tidak diimpor di mana pun.
--
-- Update ini TIDAK membuat sistem baru — ia menyambungkan alur kasir ke
-- fondasi Fase 2 yang sudah ada, dan melengkapi 2 hal yang memang belum
-- ada di fondasi itu:
--   1. Status CLEANING (belum bisa diturunkan dari data lain — perlu
--      kolom tersimpan).
--   2. Penguncian baris meja saat assignment (mencegah 2 kasir
--      meng-OCCUPIED-kan meja yang sama secara bersamaan — poin 53).
--
-- Aman dijalankan berkali-kali. Tidak menghapus/mengubah data lama.
-- Jalankan SETELAH migration_014.
-- =========================================================

-- =========================================================
-- 1. STATUS CLEANING pada branch_tables
-- =========================================================
ALTER TABLE branch_tables ADD COLUMN IF NOT EXISTS needs_cleaning BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE branch_tables ADD COLUMN IF NOT EXISTS cleaning_started_at TIMESTAMPTZ;

COMMENT ON COLUMN branch_tables.needs_cleaning IS
  'Phase 2 Update 1: diset true otomatis oleh checkout_order_v2() begitu order dine-in di meja ini lunas. Kasir/manager membersihkan lalu set false lewat tombol "Selesai Dibersihkan" (update langsung, RLS branch-scoped sudah menegakkan izin).';

-- =========================================================
-- 2. AUDIT LOG — generik, dipakai oleh move_table_order() di bawah dan
--    akan dipakai lagi oleh fitur Void/Refund/Merge/Split (Update
--    berikutnya) supaya TIDAK ada sistem log kedua yang dibuat nanti.
-- =========================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_branch ON audit_log (tenant_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);

COMMENT ON TABLE audit_log IS 'Log audit generik lintas fitur (Phase 2). Append-only lewat desain: tidak ada policy UPDATE/DELETE, jadi kasir/manager tidak bisa mengedit histori lewat client mana pun.';

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Audit log: read branch-scoped" ON audit_log;

DROP POLICY IF EXISTS "Audit log: read branch-scoped" ON audit_log;
CREATE POLICY "Audit log: read branch-scoped" ON audit_log
  FOR SELECT USING (
    is_super_admin()
    OR (tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id()))
  );

DROP POLICY IF EXISTS "Audit log: insert tenant members" ON audit_log;

DROP POLICY IF EXISTS "Audit log: insert tenant members" ON audit_log;
CREATE POLICY "Audit log: insert tenant members" ON audit_log
  FOR INSERT WITH CHECK (
    is_super_admin() OR tenant_id = current_tenant_id()
  );

-- =========================================================
-- 6. move_table_order — pindah order dine-in aktif ke meja lain
--    (poin 17). Ditulis sekarang (bukan Update terpisah) karena butuh
--    audit_log yang baru dibuat di atas & pola row-lock yang sama
--    dengan create_kitchen_order — supaya tidak menulis ulang pola
--    yang sama 2x. Tetap dilaporkan terpisah dari Table Foundation
--    di ringkasan (poin 94: jangan klaim gabungan sebagai 1 hal selesai).
-- =========================================================
CREATE OR REPLACE FUNCTION move_table_order(
  p_order_id UUID,
  p_new_table_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION move_table_order IS 'Phase 2: pindah order dine-in aktif ke meja lain. Order tetap sama (bukan transaksi baru) — hanya table_id yang berubah, dicatat di audit_log.';

-- ============================================================
-- >>> BERASAL DARI: migration_016_phase2_void_refund.sql
-- ============================================================
-- =========================================================
-- MIGRASI PHASE 2 — UPDATE 3: VOID & REFUND
--
-- Void = pembatalan item/order SEBELUM lunas (belum ada transactions
-- row). Refund = uang kembali SETELAH lunas (transactions row sudah
-- ada). Keduanya finansial-sensitif jadi keduanya:
--   - tidak pernah menghapus baris (poin 33/34: data asli tetap ada)
--   - tidak pernah menyentuh inventory otomatis (poin 38: itu penyesuaian
--     finansial, bukan pengembalian stok — refund TIDAK reverse recipe)
--   - dicatat ke audit_log yang sama dari Update 1 (bukan sistem log
--     kedua)
--   - kasir hanya bisa self-approve di bawah ambang batas kecil; di atas
--     itu wajib manager/owner (poin 31/37)
--
-- AMBANG_BATAS_SELF_APPROVE = Rp50.000, mengikuti angka contoh di brief
-- (poin 27/37). Ini di-hardcode di 2 fungsi di bawah — kalau nanti mau
-- dibuat bisa diatur per cabang, jadikan kolom branch_settings dan ganti
-- konstanta ini dengan lookup, TANPA mengubah alur/permission lainnya.
-- =========================================================

-- =========================================================
-- 1. VOID ITEM — order_items dapat di-void sebagian/seluruhnya SEBELUM
--    order dibayar. Baris TIDAK dihapus; voided_qty menyimpan berapa
--    dari qty asli yang dibatalkan (poin 33).
-- =========================================================
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS voided_qty INT NOT NULL DEFAULT 0;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES profiles(id);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

COMMENT ON COLUMN order_items.voided_qty IS 'Phase 2 Update 3: qty yang dibatalkan dari qty asli. Baris item TIDAK pernah dihapus/diubah qty aslinya — sisa yang ditagih dihitung (qty - voided_qty) di checkout_order_v2().';

-- =========================================================
-- 4. REFUND — SETELAH lunas. Baris `transactions`/`transaction_items`
--    ASLI TIDAK PERNAH diubah (poin 34) — refund adalah record baru.
--    TIDAK menyentuh inventory (poin 38: penyesuaian finansial murni).
-- =========================================================
CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  refund_type TEXT NOT NULL CHECK (refund_type IN ('FULL', 'PARTIAL', 'ITEM')),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  items JSONB, -- rincian item yang direfund untuk tipe ITEM/PARTIAL: [{transaction_item_id, product_name, qty, amount}]
  reason_category TEXT NOT NULL CHECK (reason_category IN (
    'CUSTOMER_REQUEST', 'WRONG_ORDER', 'DUPLICATE_PAYMENT', 'PRODUCT_UNAVAILABLE', 'DAMAGED', 'QUALITY_ISSUE', 'OTHER'
  )),
  reason_note TEXT,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING_APPROVAL', 'COMPLETED', 'REJECTED')),
  requested_by UUID REFERENCES profiles(id),
  approved_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_refunds_transaction ON refunds (transaction_id);

CREATE INDEX IF NOT EXISTS idx_refunds_tenant_branch ON refunds (tenant_id, branch_id, created_at DESC);

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Refunds: branch-scoped" ON refunds;

DROP POLICY IF EXISTS "Refunds: branch-scoped" ON refunds;
CREATE POLICY "Refunds: branch-scoped" ON refunds
  FOR ALL USING (
    is_super_admin()
    OR (tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id()))
  )
  WITH CHECK (
    is_super_admin()
    OR (tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id()))
  );

CREATE OR REPLACE FUNCTION request_refund(
  p_transaction_id UUID,
  p_refund_type TEXT,
  p_amount NUMERIC,
  p_items JSONB,
  p_reason_category TEXT,
  p_reason_note TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION request_refund IS
  'Phase 2: kasir bisa self-approve refund <= Rp50.000 (status langsung COMPLETED); di atas itu wajib manager/owner (status PENDING_APPROVAL sampai approve_refund dipanggil). Tidak pernah mengubah baris transactions/transaction_items asli, tidak menyentuh inventory.';

CREATE OR REPLACE FUNCTION approve_refund(
  p_refund_id UUID,
  p_decision TEXT -- 'APPROVED' atau 'REJECTED'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- =========================================================
-- 8. SNAPSHOT KOLOM DI ORDER ITEM — cart/transaksi tidak berubah
--    walau menu/recipe berubah kemudian. Semua nullable, default aman,
--    jadi checkout_transaction()/checkout_order_v2()/create_kitchen_order()
--    yang sudah ada TIDAK perlu diubah untuk tetap berjalan.
-- =========================================================
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id),
  ADD COLUMN IF NOT EXISTS variant_name TEXT,
  ADD COLUMN IF NOT EXISTS modifier_selections JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{"modifier_id":..,"name":..,"price_adjustment":..}]
  ADD COLUMN IF NOT EXISTS recipe_id UUID REFERENCES recipes(id),
  ADD COLUMN IF NOT EXISTS recipe_version INT;

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id),
  ADD COLUMN IF NOT EXISTS variant_name TEXT,
  ADD COLUMN IF NOT EXISTS modifier_selections JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recipe_id UUID REFERENCES recipes(id),
  ADD COLUMN IF NOT EXISTS recipe_version INT,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC;

-- sebelumnya tidak tersimpan per-item, hanya subtotal

CREATE INDEX IF NOT EXISTS idx_order_items_variant ON order_items (variant_id);

CREATE INDEX IF NOT EXISTS idx_order_items_recipe ON order_items (recipe_id);

CREATE INDEX IF NOT EXISTS idx_transaction_items_variant ON transaction_items (variant_id);

CREATE INDEX IF NOT EXISTS idx_transaction_items_recipe ON transaction_items (recipe_id);

-- ============================================================
-- >>> BERASAL DARI: /home/claude/out/migration_019_recipe_bom_deduction_wiring.sql
-- ============================================================
-- =========================================================
-- MIGRASI 019 — WIRING: Recipe (BOM) & Modifier Groups ke alur
-- checkout sungguhan (create_kitchen_order / checkout_order_v2 /
-- checkout_transaction), + tabel order_item_modifiers ternormalisasi.
--
-- KONTEKS PENTING — BACA DULU SEBELUM APPLY:
-- Skema Ingredient Inventory, Recipe/BOM, dan Modifier Groups yang
-- diminta SUDAH DIBUAT sebelumnya di `migration_015_phase1_fnb_core.sql`
-- (ingredients, branch_ingredients_stock, product_variants,
-- modifier_groups, modifiers, product_modifier_groups,
-- modifier_ingredient_impacts, recipes, recipe_items,
-- recipe_consumption_logs, ingredient_stock_movements, ingredient_waste_logs,
-- ingredient_stock_opname_logs, fungsi consume_recipe() dkk). Migrasi itu
-- SENGAJA TIDAK mengaitkan diri ke checkout_transaction()/checkout_order_v2()/
-- create_kitchen_order() (lihat catatan "SELESAI" di akhir filenya) — itulah
-- yang dikerjakan migrasi ini.
--
-- CATATAN PENOMORAN: file `migration_015_phase1_fnb_core.sql` di repo ini
-- SECARA KRONOLOGIS dibuat SETELAH migration_016/017 (lihat timestamp file),
-- walau namanya "015". Isinya hanya bergantung pada migration_001-014
-- (tidak menyentuh apa pun dari 016/017/018), jadi aman dijalankan di posisi
-- manapun setelah 014 dan SEBELUM migrasi ini (019). Supaya tooling migrasi
-- Supabase (yang mengurutkan berdasar nama file) tidak keliru urutan,
-- disarankan me-rename file itu menjadi sesuatu seperti
-- `migration_018b_phase1_fnb_core.sql` — TIDAK dilakukan otomatis di sini
-- supaya tidak mengubah riwayat migrasi yang mungkin sudah pernah di-apply.
--
-- YANG DITAMBAHKAN DI SINI (semua ADDITIF, tidak ada DROP tabel/kolom):
--   1. Tabel `order_item_modifiers` — versi ternormalisasi dari
--      order_items.modifier_selections (JSONB) yang sudah ada, supaya bisa
--      di-query/di-join langsung tanpa parsing JSONB (mis. laporan modifier
--      terlaris). modifier_selections JSONB TETAP diisi & tetap jadi sumber
--      yang dibaca kode existing (struk/KDS) — tabel baru ini adalah mirror
--      ternormalisasi, bukan pengganti.
--   2. `deduct_recipe_stock(p_order_id)` — idempotent, dipanggil otomatis
--      oleh checkout_order_v2() begitu order berstatus COMPLETED (lunas).
--   3. `deduct_recipe_stock_for_transaction(p_transaction_id)` — padanannya
--      untuk alur kasir cepat checkout_transaction() (tanpa tiket dapur).
--   4. create_kitchen_order() diperluas: tiap item di p_items sekarang BOLEH
--      (opsional) menambahkan "variant_id" dan "modifier_ids": [...]. Kalau
--      tidak dikirim (kode lama), perilaku 100% sama seperti sebelumnya —
--      inilah "backward compatibility" yang diminta (poin 3).
--   5. checkout_order_v2() & checkout_transaction() di-CREATE OR REPLACE
--      penuh (pola yang sama dipakai migration_015/016/017 di repo ini)
--      HANYA untuk menambah 1 baris PERFORM deduct_recipe_stock*() di akhir,
--      setelah transaksi tercatat & sebelum RETURN. Tidak ada logika lama
--      yang diubah/dihapus.
--
-- SYARAT: jalankan SETELAH migration_015_phase1_fnb_core.sql (yang membuat
-- ingredients/recipes/modifiers/consume_recipe dkk) dan setelah migration_018.
-- Aman dijalankan berkali-kali (idempotent).
-- =========================================================

-- =========================================================
-- 1. ORDER ITEM MODIFIERS — mirror ternormalisasi dari
--    order_items.modifier_selections (JSONB, sudah ada sejak Phase 1 F&B
--    Core). Baris di sini adalah SNAPSHOT (name & price_adjustment disalin
--    saat order dibuat) — persis seperti transaction_items/order_items
--    tidak pernah retroaktif berubah kalau modifier di master diedit
--    belakangan (poin 34 master prompt: histori transaksi tidak berubah).
-- =========================================================
CREATE TABLE IF NOT EXISTS order_item_modifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_id UUID REFERENCES modifiers(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  price_adjustment NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oim_order_item ON order_item_modifiers (order_item_id);

CREATE INDEX IF NOT EXISTS idx_oim_modifier ON order_item_modifiers (modifier_id);

COMMENT ON TABLE order_item_modifiers IS 'Versi ternormalisasi dari order_items.modifier_selections (Migrasi 019). Diisi otomatis oleh create_kitchen_order(). Dipakai deduct_recipe_stock() untuk resolusi modifier & untuk laporan modifier terlaris tanpa parsing JSONB.';

ALTER TABLE order_item_modifiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Order item modifiers: via parent order" ON order_item_modifiers;

DROP POLICY IF EXISTS "Order item modifiers: via parent order" ON order_item_modifiers;
CREATE POLICY "Order item modifiers: via parent order" ON order_item_modifiers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.id = order_item_modifiers.order_item_id
        AND (is_super_admin() OR (o.tenant_id = current_tenant_id() AND (is_owner() OR o.branch_id = current_branch_id())))
    )
  );

-- =========================================================
-- 4. create_kitchen_order() — CREATE OR REPLACE penuh (signature TIDAK
--    berubah, jadi tidak perlu DROP FUNCTION dulu). Tambahan dari versi
--    migration_015_phase2_table_foundation.sql:
--      - tiap elemen p_items BOLEH menyertakan "variant_id" (UUID) dan
--        "modifier_ids" (array UUID). Kalau tidak ada -> perilaku persis
--        seperti sebelumnya (backward compatible, poin 3).
--      - unit_price dihitung dari harga varian (kalau dipilih) + total
--        price_adjustment modifier terpilih, alih-alih selalu products.price.
--      - snapshot variant_id/variant_name/modifier_selections/recipe_id/
--        recipe_version disimpan ke order_items (kolom-kolom ini sudah ada
--        sejak migration_015_phase1_fnb_core.sql, sebelumnya selalu NULL).
--      - baris order_item_modifiers dibuat untuk tiap modifier terpilih.
-- =========================================================
CREATE OR REPLACE FUNCTION create_kitchen_order(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_shift_id UUID,
  p_cashier_id UUID,
  p_order_type TEXT,
  p_table_number TEXT,
  p_customer_name TEXT,
  p_notes TEXT,
  p_items JSONB,
  p_table_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION create_kitchen_order IS
  'Phase 2 Update 1 + Migrasi 019: menerima p_table_id untuk assignment meja (row-lock, cek occupied/cleaning), DAN sekarang tiap item di p_items boleh menyertakan "variant_id"/"modifier_ids" opsional untuk mengaitkan order_items ke product_variants/modifiers/recipes secara terstruktur. Item tanpa kedua field itu berperilaku identik dengan sebelum Migrasi 019 (backward compatible).';

-- =========================================================
-- MIGRASI 019 — Supervisor PIN Authorization, Stock Reversal on
-- Void/Refund, Table Lifecycle (BILL_PRINTED + Merge), Split Bill.
--
-- Konteks: brief "Perkuat Kontrol Transaksi Kasir" (4 action items).
-- Semua perubahan ADDITIF (kolom baru nullable/default, fungsi
-- CREATE OR REPLACE) — aman dijalankan berkali-kali, tidak ada
-- data lama yang diubah/dihapus. Jalankan SETELAH migration_018.
--
-- Pola yang DIPERTAHANKAN dari migrasi sebelumnya (sengaja tidak
-- membuat sistem paralel):
--   - audit_log generik (migration_015) tetap satu-satunya log lintas
--     fitur — void, cancel, discount, price override, PIN auth, move,
--     merge, split bill semua menulis ke sini.
--   - Ambang self-approve Rp50.000 (migration_016) TIDAK diubah — PIN
--     supervisor adalah lapisan tambahan yang berlaku untuk SEMUA
--     kasir (bukan hanya di atas ambang nominal), supaya kasir tidak
--     bisa membatalkan/void/diskon sendiri tanpa sepengetahuan atasan
--     sama sekali, berapa pun nominalnya.
--   - Refund TIDAK menyentuh baris transactions/transaction_items asli
--     (poin 34 brief lama) — reversal stok dicatat sebagai pergerakan
--     baru, bukan mengubah histori.
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- BAGIAN 1 — SUPERVISOR PIN AUTHORIZATION
--
-- PIN disimpan SEBAGAI HASH (bcrypt via pgcrypto crypt/gen_salt),
-- tidak pernah plaintext, tidak pernah dikembalikan ke client.
-- Hanya manager/owner/super_admin yang boleh punya PIN aktif —
-- merekalah "supervisor" yang dicari saat verifikasi.
-- =========================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_hash TEXT;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pin_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.pin_hash IS
  'Migrasi 019: hash bcrypt PIN supervisor (4-6 digit). NULL = belum diset. Hanya diisi lewat set_supervisor_pin() oleh manager/owner/super_admin untuk akun mereka SENDIRI — tidak ada jalur untuk mengeset PIN akun orang lain.';

CREATE OR REPLACE FUNCTION set_supervisor_pin(p_pin TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

COMMENT ON FUNCTION set_supervisor_pin IS
  'Migrasi 019: Manager/Owner/Super Admin mengeset PIN otorisasi mereka sendiri. Dipanggil dari halaman profil/pengaturan.';

-- Cari supervisor (manager/owner/super_admin) di tenant (+ cabang untuk
-- manager) yang PIN-nya cocok dengan p_pin. TIDAK membocorkan hash atau
-- daftar supervisor ke client — hanya mengembalikan identitas siapa yang
-- match (untuk dicatat sebagai penyetuju), atau tidak ada baris kalau
-- tidak ada yang cocok.
CREATE OR REPLACE FUNCTION verify_supervisor_pin(p_pin TEXT, p_branch_id UUID DEFAULT NULL)
RETURNS TABLE (supervisor_id UUID, supervisor_name TEXT, supervisor_role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION verify_supervisor_pin IS
  'Migrasi 019: dipakai SupervisorPinModal untuk validasi PIN sebelum tindakan sensitif. Tidak pernah mengembalikan pin_hash. Kosong (0 baris) berarti PIN salah/tidak ada supervisor cocok.';

-- Gerbang tunggal dipakai dari DALAM fungsi lain (void_order_item,
-- cancel_order, apply_manual_discount, override_item_price) supaya
-- pengecekan PIN TIDAK bisa dilewati dengan memanggil fungsi asli
-- langsung dari client — server yang menegakkan, bukan hanya UI modal.
-- Manager/Owner/Super Admin yang bertindak SENDIRI tidak perlu PIN
-- (mereka sudah punya wewenang itu).
CREATE OR REPLACE FUNCTION require_supervisor_authorization(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_tenant_id UUID,
  p_branch_id UUID,
  p_reason TEXT,
  p_supervisor_pin TEXT,
  p_metadata JSONB DEFAULT NULL
)
RETURNS UUID -- id supervisor yang menyetujui, atau auth.uid() kalau pemanggil sendiri sudah manager+
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION require_supervisor_authorization IS
  'Migrasi 019: helper internal dipanggil dari void_order_item/cancel_order/apply_manual_discount/override_item_price. Kasir WAJIB PIN valid; manager/owner/super_admin lolos otomatis. Selalu tercatat ke audit_log, termasuk percobaan PIN gagal.';

-- =========================================================
-- BAGIAN 2 — VOID ITEM & CANCEL ORDER: tambah gerbang PIN
-- (CREATE OR REPLACE penuh mengikuti pola migration_016 — definisi
-- lama tetap sama, hanya menambah parameter & 1 pemanggilan gerbang).
-- =========================================================
CREATE OR REPLACE FUNCTION void_order_item(
  p_order_item_id UUID,
  p_void_qty INT,
  p_reason TEXT,
  p_supervisor_pin TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

CREATE OR REPLACE FUNCTION cancel_order(
  p_order_id UUID,
  p_reason TEXT,
  p_supervisor_pin TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- =========================================================
-- BAGIAN 3 — MANUAL DISCOUNT & PRICE OVERRIDE (baru, belum ada di
-- migrasi sebelumnya). Keduanya sensitif -> selalu lewat gerbang PIN.
-- =========================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS manual_discount_amount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS manual_discount_reason TEXT;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS manual_discount_by UUID REFERENCES profiles(id);

COMMENT ON COLUMN orders.manual_discount_amount IS
  'Migrasi 019: potongan manual (Rupiah, bukan persen member) yang diberikan kasir dengan otorisasi PIN supervisor. Ditambahkan ke checkout_order_v2() di atas diskon member yang sudah ada.';

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS original_unit_price NUMERIC;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price_override_reason TEXT;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price_overridden_by UUID REFERENCES profiles(id);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price_overridden_at TIMESTAMPTZ;

COMMENT ON COLUMN order_items.original_unit_price IS
  'Migrasi 019: harga asli SEBELUM override_item_price() dipanggil (NULL = belum pernah di-override). unit_price yang dipakai checkout tetap kolom unit_price yang sudah ada — ini murni jejak audit.';

CREATE OR REPLACE FUNCTION apply_manual_discount(
  p_order_id UUID,
  p_discount_amount NUMERIC,
  p_reason TEXT,
  p_supervisor_pin TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

CREATE OR REPLACE FUNCTION override_item_price(
  p_order_item_id UUID,
  p_new_unit_price NUMERIC,
  p_reason TEXT,
  p_supervisor_pin TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION apply_manual_discount IS 'Migrasi 019: diskon manual Rupiah pada 1 order, wajib PIN supervisor untuk kasir. Diterapkan di checkout_order_v2 di atas diskon member.';

COMMENT ON FUNCTION override_item_price IS 'Migrasi 019: ubah harga 1 order_item, wajib PIN supervisor untuk kasir. Menyimpan original_unit_price untuk jejak audit.';

-- =========================================================
-- BAGIAN 4 — STOCK REVERSAL saat Void/Refund
--
-- Mendukung 2 model stok yang hidup berdampingan di codebase ini:
--  (a) branch_stock — stok produk sederhana (products.track_stock),
--      dipakai checkout_order_v2() sekarang.
--  (b) branch_ingredients_stock + recipe_consumption_logs — stok
--      bahan baku berbasis resep (Phase 1 FnB Core). consume_recipe()
--      sudah ada tapi belum dipanggil dari checkout_order_v2 di
--      migrasi manapun — revert_recipe_stock() tetap disiapkan untuk
--      kedua jalur supaya begitu consume_recipe() disambungkan
--      (langkah lanjutan terpisah, lihat catatan migration_015_phase1),
--      reversal-nya sudah siap tanpa migrasi susulan.
--
-- Idempotent lewat transaction_items.restored_qty — tidak bisa
-- mengembalikan stok 2x untuk qty yang sama.
-- =========================================================
ALTER TABLE transaction_items ADD COLUMN IF NOT EXISTS restored_qty INT NOT NULL DEFAULT 0;

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS stock_restored BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS stock_restored_at TIMESTAMPTZ;

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS stock_restored_by UUID REFERENCES profiles(id);

COMMENT ON COLUMN transaction_items.restored_qty IS
  'Migrasi 019: qty dari item ini yang stoknya SUDAH dikembalikan lewat revert_recipe_stock() (dipanggil dari toggle "Restore Stock to Inventory" di RefundModal). Mencegah pengembalian stok dobel kalau 1 transaksi direfund bertahap.';

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

COMMENT ON FUNCTION revert_recipe_stock IS
  'Migrasi 019: dipanggil dari toggle "Restore Stock to Inventory" di RefundModal.tsx setelah refund COMPLETED. Mengembalikan stok resep (branch_ingredients_stock, kalau recipe_consumption_logs ada) atau stok produk sederhana (branch_stock, fallback). Idempotent lewat transaction_items.restored_qty.';

-- =========================================================
-- BAGIAN 5 — TABLE LIFECYCLE: status BILL_PRINTED
-- AVAILABLE -> OCCUPIED -> BILL_PRINTED -> CLEANING -> AVAILABLE
-- =========================================================
ALTER TABLE branch_tables ADD COLUMN IF NOT EXISTS bill_printed_at TIMESTAMPTZ;

-- Kolom Split Bill (BAGIAN 7) diset di sini, LEBIH AWAL dari bagiannya
-- sendiri, karena checkout_order_v2() di bawah (BAGIAN 5) sudah menulis
-- ke transaction_payments.split_group_label untuk mode "Split by Amount".
ALTER TABLE transaction_payments ADD COLUMN IF NOT EXISTS split_group_label TEXT;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS split_group_label TEXT;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS split_billed_qty INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN order_items.split_billed_qty IS
  'Migrasi 019: qty dari item ini yang SUDAH masuk salah satu sub-bill Split by Item. Sisa yang belum tertagih = qty - voided_qty - split_billed_qty. Order baru COMPLETED setelah semua item habis tertagih (lewat split ATAU checkout_order_v2 biasa).';

COMMENT ON COLUMN branch_tables.bill_printed_at IS
  'Migrasi 019: diset lewat mark_bill_printed() saat kasir mencetak bill (pra-bayar) untuk order aktif di meja ini. table_live_status membaca ini untuk status BILL_PRINTED (di antara OCCUPIED dan CLEANING). Dibersihkan otomatis saat order lunas/batal.';

CREATE OR REPLACE FUNCTION mark_bill_printed(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION mark_bill_printed IS 'Migrasi 019: dipanggil saat kasir menekan "Cetak Bill" sebelum pembayaran — memajukan meja ke status BILL_PRINTED tanpa mengubah status order KDS.';

-- table_live_status — CREATE OR REPLACE penuh (pola sama dengan
-- migration_015) supaya file ini tetap bisa dibaca berdiri sendiri.
CREATE OR REPLACE VIEW table_live_status
WITH (security_invoker = true) AS
SELECT
  bt.id AS table_id,
  bt.tenant_id,
  bt.branch_id,
  bt.table_number,
  bt.capacity,
  bt.is_active,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM orders o WHERE o.table_id = bt.id AND o.status NOT IN ('COMPLETED', 'CANCELLED')
    ) AND bt.bill_printed_at IS NOT NULL THEN 'BILL_PRINTED'
    WHEN EXISTS (
      SELECT 1 FROM orders o WHERE o.table_id = bt.id AND o.status NOT IN ('COMPLETED', 'CANCELLED')
    ) THEN 'OCCUPIED'
    WHEN bt.needs_cleaning THEN 'CLEANING'
    WHEN EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.table_id = bt.id AND r.status = 'confirmed'
        AND r.reservation_at BETWEEN now() AND now() + (r.reminder_window_minutes || ' minutes')::interval
    ) THEN 'RESERVED'
    ELSE 'AVAILABLE'
  END AS status,
  (
    SELECT o.id FROM orders o
    WHERE o.table_id = bt.id AND o.status NOT IN ('COMPLETED', 'CANCELLED')
    ORDER BY o.created_at DESC LIMIT 1
  ) AS active_order_id,
  (
    SELECT o.order_number FROM orders o
    WHERE o.table_id = bt.id AND o.status NOT IN ('COMPLETED', 'CANCELLED')
    ORDER BY o.created_at DESC LIMIT 1
  ) AS active_order_number,
  (
    SELECT o.status FROM orders o
    WHERE o.table_id = bt.id AND o.status NOT IN ('COMPLETED', 'CANCELLED')
    ORDER BY o.created_at DESC LIMIT 1
  ) AS active_order_status,
  (
    -- BUG FIX (Phase 2A.1 audit): original query mixed SUM() with an
    -- un-grouped ORDER BY, which Postgres rejects. Sum items only for the
    -- single most recent active order on this table (same order picked by
    -- active_order_id above), instead of aggregating across all of them.
    SELECT COALESCE(SUM(oi.unit_price * (oi.qty - oi.voided_qty)), 0)
    FROM order_items oi
    WHERE oi.order_id = (
      SELECT o.id FROM orders o
      WHERE o.table_id = bt.id AND o.status NOT IN ('COMPLETED', 'CANCELLED')
      ORDER BY o.created_at DESC LIMIT 1
    )
  ) AS active_order_total,
  (
    SELECT o.created_at FROM orders o
    WHERE o.table_id = bt.id AND o.status NOT IN ('COMPLETED', 'CANCELLED')
    ORDER BY o.created_at DESC LIMIT 1
  ) AS occupied_at,
  bt.cleaning_started_at,
  bt.bill_printed_at,
  (
    SELECT r.id FROM reservations r
    WHERE r.table_id = bt.id AND r.status = 'confirmed'
      AND r.reservation_at BETWEEN now() AND now() + (r.reminder_window_minutes || ' minutes')::interval
    ORDER BY r.reservation_at ASC LIMIT 1
  ) AS upcoming_reservation_id
FROM branch_tables bt
WHERE bt.is_active = true;

COMMENT ON VIEW table_live_status IS
  'Migrasi 019: menambah status BILL_PRINTED (dari branch_tables.bill_printed_at) di antara OCCUPIED dan CLEANING. active_order_total sekarang menghitung (qty - voided_qty) supaya konsisten dengan total yang benar-benar ditagih.';

-- checkout_order_v2 — CREATE OR REPLACE penuh: (1) terapkan
-- manual_discount_amount di atas diskon member, (2) bersihkan
-- bill_printed_at begitu lunas (meja lanjut ke CLEANING).
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

-- =========================================================
-- BAGIAN 6 — MERGE TABLE (gabung meja): pindahkan seluruh order_items
-- dari order sumber ke order tujuan (1 tagihan gabungan), lalu
-- batalkan order sumber & bebaskan mejanya. Dipasangkan dengan
-- move_table_order() (migration_015) yang MEMINDAH 1 order — merge
-- MENGGABUNGKAN 2 order dine-in aktif jadi 1.
-- =========================================================
CREATE OR REPLACE FUNCTION merge_table_orders(
  p_source_order_id UUID,
  p_target_order_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION merge_table_orders IS
  'Migrasi 019: gabungkan 2 order dine-in aktif jadi 1 tagihan (order_items sumber dipindah ke order tujuan, order sumber CANCELLED, meja sumber dibebaskan). Dipakai tombol "Gabung Meja" di TableStatusBoard.tsx / /api/tables/merge.';

-- =========================================================
-- BAGIAN 7 — SPLIT BILL
--  - Split by Amount: TIDAK butuh fungsi baru — cukup panggil
--    checkout_order_v2() yang sudah ada dengan >1 baris p_payments
--    (mekanisme ini sudah dipakai MultiPaymentModal.tsx). Kolom
--    split_group_label di bawah murni label kosmetik struk per orang.
--  - Split by Item: butuh checkout PARSIAL per sub-bill (bisa >1
--    transaksi untuk 1 order) — checkout_order_split_by_item() di
--    bawah ini.
-- =========================================================
CREATE OR REPLACE FUNCTION checkout_order_split_by_item(
  p_order_id UUID,
  p_invoice_number TEXT,
  p_item_allocations JSONB, -- [{order_item_id, qty}, ...] — bagian order_items yang masuk sub-bill INI
  p_payments JSONB,         -- [{method, amount}, ...] — harus pas dengan subtotal alokasi
  p_split_label TEXT DEFAULT NULL,
  p_member_code TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION checkout_order_split_by_item IS
  'Migrasi 019: Split Bill mode "Split by Item" — 1 sub-bill = 1 transaksi terpisah untuk sebagian order_items. Dipanggil sekali per sub-bill dari SplitBillModal.tsx. Order baru berstatus COMPLETED setelah seluruh item habis dialokasikan ke sub-bill manapun.';

-- =========================================================
-- SELESAI — Ringkasan objek baru migrasi ini:
--  Fungsi baru : set_supervisor_pin, verify_supervisor_pin,
--                require_supervisor_authorization, apply_manual_discount,
--                override_item_price, revert_recipe_stock,
--                mark_bill_printed, merge_table_orders,
--                checkout_order_split_by_item
--  Fungsi diubah (CREATE OR REPLACE, perilaku lama tetap sama +
--  tambahan): void_order_item, cancel_order, checkout_order_v2
--  View diubah : table_live_status (+ BILL_PRINTED, + bill_printed_at)
--  Tabel/kolom baru: profiles.pin_hash, orders.manual_discount_*,
--                    order_items.original_unit_price/price_override_*/
--                    split_billed_qty, transaction_items.restored_qty,
--                    refunds.stock_restored*, branch_tables.bill_printed_at,
--                    transactions.split_group_label,
--                    transaction_payments.split_group_label
-- =========================================================


SET check_function_bodies = on;
