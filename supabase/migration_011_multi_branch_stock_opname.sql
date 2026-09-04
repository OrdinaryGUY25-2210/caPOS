-- =========================================================
-- Migration 011 — Multi-Cabang (Multi-Branch) & Stok Opname + HPP
-- Jalankan di Supabase SQL Editor SETELAH migration_010.
--
-- Sama seperti migration sebelumnya, semua perubahan di sini ADDITIF:
--  - Tabel/kolom baru saja, tidak ada DROP kolom/tabel lama.
--  - `branches` dibuat otomatis (1 "Cabang Utama") untuk SETIAP tenant lewat
--    trigger + backfill di bawah, jadi tenant lama yang belum pernah
--    dengar soal cabang tetap langsung "punya 1 cabang" tanpa setup
--    manual apa pun — checkout_transaction()/adjust_stock() lama yang
--    tidak mengirim p_branch_id otomatis di-resolve ke cabang ini.
--  - products.stock_qty / products.cost_price TETAP ada (tidak dihapus)
--    supaya data existing tidak hilang, tapi mulai migration ini sumber
--    kebenaran stok adalah tabel BARU `branch_stock` (per cabang).
--    cost_price (HPP) tetap 1 nilai per produk (dipakai bersama semua
--    cabang) — kalau nanti dibutuhkan HPP berbeda per cabang, itu
--    perluasan terpisah dari migration ini.
-- =========================================================

-- =========================================================
-- 1. TABEL branches
-- =========================================================
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  is_main BOOLEAN NOT NULL DEFAULT false, -- cabang yang otomatis dibuat saat tenant daftar; tidak bisa dihapus
  is_active BOOLEAN NOT NULL DEFAULT true, -- nonaktifkan cabang (tutup) tanpa menghapus histori transaksinya
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches (tenant_id, is_active);

COMMENT ON COLUMN branches.is_main IS 'Cabang pertama tenant, dibuat otomatis lewat trigger create_main_branch_for_tenant(). Dipakai sebagai fallback saat sebuah request tidak menyertakan branch_id secara eksplisit.';

-- =========================================================
-- 2. RELASI branch_id DI TABEL YANG SUDAH ADA
--    (profiles = "users", stock_movements = pergerakan "stok", transactions)
-- =========================================================

-- 2a. profiles — cabang tempat karyawan (manager/cashier) ditugaskan.
--     NULL untuk owner/super_admin (mereka tidak terikat 1 cabang, akses
--     semua cabang lewat BranchSwitcher di dashboard).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

COMMENT ON COLUMN profiles.branch_id IS 'Cabang penugasan karyawan (manager/cashier). NULL = owner/super_admin (akses semua cabang tenant).';

-- 2b. transactions — cabang tempat penjualan terjadi.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_branch ON transactions (tenant_id, branch_id, created_at DESC);

-- 2c. stock_movements (tabel pergerakan stok dari migration_009) — cabang
--     tempat pergerakan stok itu terjadi.
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_branch ON stock_movements (tenant_id, branch_id, created_at DESC);

-- 2d. shifts — supaya riwayat "siapa jaga di cabang mana" ikut tercatat.
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

-- =========================================================
-- 3. TABEL branch_stock — stok per cabang (menggantikan products.stock_qty
--    sebagai sumber kebenaran begitu tenant mulai pakai multi-cabang).
-- =========================================================
CREATE TABLE IF NOT EXISTS branch_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  stock_qty NUMERIC NOT NULL DEFAULT 0,
  low_stock_threshold NUMERIC NOT NULL DEFAULT 5,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (branch_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_stock_tenant_branch ON branch_stock (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_stock_product ON branch_stock (product_id);

-- =========================================================
-- 4. TABEL stock_opname_logs — audit trail stok opname per cabang.
-- =========================================================
CREATE TABLE IF NOT EXISTS stock_opname_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  system_qty NUMERIC NOT NULL,           -- stok menurut sistem SEBELUM opname
  physical_qty NUMERIC NOT NULL,         -- hasil hitung fisik
  difference_qty NUMERIC NOT NULL,       -- physical_qty - system_qty (negatif = kurang/loss)
  cost_price_snapshot NUMERIC NOT NULL,  -- HPP saat opname dilakukan (disimpan terpisah dari products.cost_price
                                          -- supaya histori tetap akurat walau HPP produk berubah belakangan)
  loss_value NUMERIC NOT NULL DEFAULT 0, -- nilai kerugian Rupiah = abs(difference_qty) * cost_price_snapshot, HANYA kalau difference_qty < 0
  reason TEXT,                           -- 'expired' | 'damaged' | 'cashier_discrepancy' | 'input_correction' | NULL (kalau tidak ada selisih)
  note TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_opname_tenant_branch_date ON stock_opname_logs (tenant_id, branch_id, created_at DESC);

COMMENT ON COLUMN stock_opname_logs.reason IS 'Alasan selisih: expired (bahan basi/expired), damaged (rusak/tumpah), cashier_discrepancy (selisih transaksi kasir), input_correction (koreksi input). Wajib diisi kalau difference_qty <> 0.';

-- =========================================================
-- 5. AUTO-CREATE "Cabang Utama" untuk setiap tenant baru, + backfill
--    tenant yang sudah ada supaya semuanya langsung punya minimal 1 cabang.
-- =========================================================
CREATE OR REPLACE FUNCTION create_main_branch_for_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO branches (tenant_id, name, is_main, is_active)
    VALUES (NEW.id, 'Cabang Utama', true, true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_main_branch ON tenants;
CREATE TRIGGER trg_create_main_branch
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION create_main_branch_for_tenant();

-- Backfill tenant lama yang belum punya cabang sama sekali.
INSERT INTO branches (tenant_id, name, is_main, is_active)
SELECT t.id, 'Cabang Utama', true, true
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM branches b WHERE b.tenant_id = t.id);

-- Tugaskan karyawan (manager/cashier) yang belum punya branch_id ke
-- Cabang Utama tenant-nya, supaya tidak ada karyawan "mengambang" tanpa
-- cabang begitu migration ini selesai.
UPDATE profiles p
SET branch_id = b.id
FROM branches b
WHERE b.tenant_id = p.tenant_id AND b.is_main = true
  AND p.role IN ('cashier', 'manager') AND p.branch_id IS NULL;

-- Salin stok produk yang sudah dilacak (track_stock) ke branch_stock milik
-- Cabang Utama, supaya angka stok yang sudah diinput sebelumnya tidak
-- hilang/reset ke 0 begitu halaman Stok & HPP mulai baca dari branch_stock.
INSERT INTO branch_stock (tenant_id, branch_id, product_id, stock_qty, low_stock_threshold)
SELECT p.tenant_id, b.id, p.id, p.stock_qty, p.low_stock_threshold
FROM products p
JOIN branches b ON b.tenant_id = p.tenant_id AND b.is_main = true
WHERE p.track_stock = true
ON CONFLICT (branch_id, product_id) DO NOTHING;

-- Tandai transaksi & pergerakan stok LAMA (sebelum migration ini) sebagai
-- milik Cabang Utama juga, supaya laporan "per cabang" tidak menampilkan
-- histori lama sebagai "tanpa cabang".
UPDATE transactions t
SET branch_id = b.id
FROM branches b
WHERE b.tenant_id = t.tenant_id AND b.is_main = true AND t.branch_id IS NULL;

UPDATE stock_movements m
SET branch_id = b.id
FROM branches b
WHERE b.tenant_id = m.tenant_id AND b.is_main = true AND m.branch_id IS NULL;

-- =========================================================
-- 6. HELPER RLS: is_owner() & current_branch_id()
--    (mengikuti pola is_super_admin()/current_tenant_id() di schema.sql —
--    SECURITY DEFINER supaya tidak memicu rekursi policy profiles.)
-- =========================================================
CREATE OR REPLACE FUNCTION is_owner()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner');
$$;

CREATE OR REPLACE FUNCTION current_branch_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT branch_id FROM profiles WHERE id = auth.uid();
$$;

-- Cabang utama tenant — dipakai sebagai fallback di dalam fungsi RPC
-- ketika p_branch_id tidak dikirim oleh client (backward-compat).
CREATE OR REPLACE FUNCTION main_branch_id(p_tenant_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM branches WHERE tenant_id = p_tenant_id AND is_main = true LIMIT 1;
$$;

-- =========================================================
-- 7. RLS — branches, branch_stock, stock_opname_logs
-- =========================================================
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Branches: view own tenant" ON branches;
CREATE POLICY "Branches: view own tenant" ON branches
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

-- Hanya Owner yang boleh membuat/mengubah cabang — tagihan & batas paket
-- ada di tangan Owner, Manager tidak boleh menambah cabang baru sendiri.
DROP POLICY IF EXISTS "Branches: owner insert" ON branches;
CREATE POLICY "Branches: owner insert" ON branches
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() AND is_owner());

DROP POLICY IF EXISTS "Branches: owner update" ON branches;
CREATE POLICY "Branches: owner update" ON branches
  FOR UPDATE USING (tenant_id = current_tenant_id() AND is_owner());

ALTER TABLE branch_stock ENABLE ROW LEVEL SECURITY;

-- Owner/super_admin lihat semua cabang; manager/cashier cuma cabang sendiri.
DROP POLICY IF EXISTS "Branch stock: scoped view" ON branch_stock;
CREATE POLICY "Branch stock: scoped view" ON branch_stock
  FOR SELECT USING (
    is_super_admin() OR (
      tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id())
    )
  );

DROP POLICY IF EXISTS "Branch stock: manager/owner scoped write" ON branch_stock;
CREATE POLICY "Branch stock: manager/owner scoped write" ON branch_stock
  FOR UPDATE USING (
    tenant_id = current_tenant_id() AND is_manager_or_owner() AND (is_owner() OR branch_id = current_branch_id())
  );

DROP POLICY IF EXISTS "Branch stock: manager/owner scoped insert" ON branch_stock;
CREATE POLICY "Branch stock: manager/owner scoped insert" ON branch_stock
  FOR INSERT WITH CHECK (
    tenant_id = current_tenant_id() AND is_manager_or_owner() AND (is_owner() OR branch_id = current_branch_id())
  );

ALTER TABLE stock_opname_logs ENABLE ROW LEVEL SECURITY;

-- Akses khusus Manager & Owner (sesuai spesifikasi) — kasir tidak pernah
-- melihat/insert log opname sama sekali.
DROP POLICY IF EXISTS "Stock opname: manager/owner view" ON stock_opname_logs;
CREATE POLICY "Stock opname: manager/owner view" ON stock_opname_logs
  FOR SELECT USING (
    is_super_admin() OR (
      tenant_id = current_tenant_id() AND is_manager_or_owner() AND (is_owner() OR branch_id = current_branch_id())
    )
  );

DROP POLICY IF EXISTS "Stock opname: manager/owner insert" ON stock_opname_logs;
CREATE POLICY "Stock opname: manager/owner insert" ON stock_opname_logs
  FOR INSERT WITH CHECK (
    tenant_id = current_tenant_id() AND is_manager_or_owner() AND created_by = auth.uid()
    AND (is_owner() OR branch_id = current_branch_id())
  );

-- Perluas policy stock_movements (dibuat di migration_009) supaya manager
-- cabang B tidak ikut melihat pergerakan stok cabang A milik tenant sama.
DROP POLICY IF EXISTS "Stock movements: view own tenant" ON stock_movements;
DROP POLICY IF EXISTS "Stock movements: view own tenant and branch" ON stock_movements;
CREATE POLICY "Stock movements: view own tenant and branch" ON stock_movements
  FOR SELECT USING (
    is_super_admin() OR (
      tenant_id = current_tenant_id() AND (is_owner() OR branch_id IS NULL OR branch_id = current_branch_id())
    )
  );

-- Perluas policy transactions (dibuat di schema.sql) — Owner tetap lihat
-- SEMUA cabang (untuk Laporan Konsolidasi), Manager/Kasir dibatasi ke
-- cabang penugasannya saja. `branch_id IS NULL` tetap diizinkan supaya
-- transaksi lama (sebelum migration ini, kalau ada yang lolos backfill)
-- tidak mendadak hilang dari riwayat siapa pun.
DROP POLICY IF EXISTS "Access transactions by tenant_id" ON transactions;
DROP POLICY IF EXISTS "Access transactions by tenant_id and branch" ON transactions;
CREATE POLICY "Access transactions by tenant_id and branch" ON transactions
  FOR ALL USING (
    is_super_admin() OR (
      tenant_id = current_tenant_id() AND (is_owner() OR branch_id IS NULL OR branch_id = current_branch_id())
    )
  );

-- =========================================================
-- 8. ENFORCE LIMIT CABANG PER PAKET (Free=1, Pro=3, Supreme=unlimited)
-- =========================================================
CREATE OR REPLACE FUNCTION enforce_branch_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

DROP TRIGGER IF EXISTS trg_enforce_branch_limit ON branches;
CREATE TRIGGER trg_enforce_branch_limit
  BEFORE INSERT ON branches
  FOR EACH ROW EXECUTE FUNCTION enforce_branch_limit();

-- =========================================================
-- 9. RPC: create_branch — dipanggil dari /dashboard/branches (Owner only,
--    RLS "Branches: owner insert" di atas jadi lapis pertama; trigger limit
--    di atas jadi lapis kedua yang berlaku APA PUN jalur insertnya).
-- =========================================================
CREATE OR REPLACE FUNCTION create_branch(p_name TEXT, p_address TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- =========================================================
-- 10. RPC: set_employee_branch — Owner/Manager menugaskan karyawan ke
--     cabang tertentu (dipakai dari halaman Manajemen Karyawan). Dibuat
--     sebagai RPC (bukan UPDATE langsung dari client) supaya tervalidasi
--     satu tempat: employee & branch harus 1 tenant yang sama.
-- =========================================================
CREATE OR REPLACE FUNCTION set_employee_branch(p_employee_id UUID, p_branch_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- =========================================================
-- 11. checkout_transaction() — CREATE OR REPLACE, tambah p_branch_id
--     (DEFAULT NULL supaya caller lama yang belum kirim parameter ini
--     tetap jalan seperti biasa, di-resolve ke cabang penugasan kasir
--     atau Cabang Utama tenant). Logika lama (hitung subtotal, validasi
--     member, insert transaksi) TIDAK berubah — hanya menambah resolusi
--     cabang + validasi/pengurangan stok lewat branch_stock (bukan lagi
--     products.stock_qty), termasuk MENOLAK checkout kalau qty melebihi
--     stok yang tersedia di cabang tsb (perbaikan kasus "kasir bisa
--     checkout melebihi stok").
-- =========================================================
-- PENTING: menambah parameter baru dengan DEFAULT lewat CREATE OR REPLACE
-- TIDAK menimpa fungsi lama kalau jumlah parameternya berbeda — Postgres
-- memperlakukannya sebagai OVERLOAD baru, sehingga jadi ADA DUA fungsi
-- checkout_transaction() sekaligus dan setiap panggilan (termasuk dari
-- supabase.rpc() yang pakai parameter bernama) berubah jadi error
-- "function ... is not unique". Signature lama HARUS di-drop eksplisit
-- dulu sebelum versi baru dibuat.
DROP FUNCTION IF EXISTS checkout_transaction(UUID, UUID, TEXT, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION checkout_transaction(
  p_tenant_id UUID,
  p_cashier_id UUID,
  p_invoice_number TEXT,
  p_payment_method TEXT,
  p_member_code TEXT,
  p_items JSONB, -- [{ "product_id": "...", "qty": 2 }, ...]
  p_branch_id UUID DEFAULT NULL
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
  v_total NUMERIC;
  v_tx_id UUID;
  v_shift_id UUID;
  v_branch_id UUID;
  v_stock_qty NUMERIC;
  -- Item-item yang sudah tervalidasi ditampung di sini DULU, baru di-INSERT
  -- ke transaction_items SETELAH baris transactions induknya ada. Urutan
  -- lama (INSERT transaction_items di dalam loop, INSERT transactions
  -- baru sesudahnya) melanggar foreign key transaction_items.transaction_id
  -- -> transactions.id, karena baris induknya belum ada saat baris anak
  -- coba disisipkan (constraint FK di Postgres divalidasi seketika, tidak
  -- ditunda otomatis). Diperbaiki di sini sekalian karena fungsi ini
  -- memang sedang ditulis ulang untuk dukungan multi-cabang.
  v_pending_product_ids UUID[] := '{}';
  v_pending_qtys INT[] := '{}';
  v_pending_subtotals NUMERIC[] := '{}';
  v_i INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: bukan anggota tenant ini';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang kosong';
  END IF;

  -- Resolusi cabang: pakai yang dikirim client kalau ada, kalau tidak
  -- pakai cabang penugasan kasir, kalau kasir juga tidak punya (mis. owner
  -- yang login langsung ke /pos) fallback ke Cabang Utama tenant.
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

    -- Validasi & kurangi stok PER CABANG kalau produk ini dilacak stoknya.
    -- FOR UPDATE mengunci baris supaya dua checkout bersamaan di cabang
    -- yang sama tidak bisa sama-sama lolos melebihi stok (race condition).
    IF v_product.track_stock THEN
      SELECT stock_qty INTO v_stock_qty FROM branch_stock
        WHERE branch_id = v_branch_id AND product_id = v_product.id
        FOR UPDATE;

      IF v_stock_qty IS NULL THEN
        -- Belum ada baris branch_stock untuk kombinasi ini -> anggap 0,
        -- supaya produk yang track_stock=true tapi belum diisi stok di
        -- cabang tsb TIDAK bisa dijual (bukan malah lolos tanpa batas).
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

  v_total := round(v_subtotal * (1 - v_discount_pct / 100));

  INSERT INTO transactions (
    id, tenant_id, cashier_id, invoice_number, total_amount,
    payment_method, member_id, is_offline_sync, shift_id, branch_id
  ) VALUES (
    v_tx_id, p_tenant_id, p_cashier_id, p_invoice_number, v_total,
    p_payment_method, v_member_id, false, v_shift_id, v_branch_id
  );

  -- Baris transactions sudah ada -> aman insert transaction_items sekarang.
  FOR v_i IN 1..array_length(v_pending_product_ids, 1) LOOP
    INSERT INTO transaction_items (transaction_id, product_id, qty, subtotal)
      VALUES (v_tx_id, v_pending_product_ids[v_i], v_pending_qtys[v_i], v_pending_subtotals[v_i]);
  END LOOP;

  RETURN v_tx_id;
END;
$$;

-- =========================================================
-- 12. adjust_stock() — CREATE OR REPLACE, tambah p_branch_id (resolusi
--     sama seperti checkout_transaction: kirim eksplisit, atau fallback
--     ke cabang penugasan pemanggil, atau Cabang Utama tenant).
-- =========================================================
-- Sama seperti checkout_transaction() di atas — signature 4-parameter
-- lama harus di-drop eksplisit supaya tidak jadi overload ganda.
DROP FUNCTION IF EXISTS adjust_stock(UUID, NUMERIC, TEXT, TEXT);

CREATE OR REPLACE FUNCTION adjust_stock(
  p_product_id UUID,
  p_qty_change NUMERIC,
  p_type TEXT, -- 'restock' | 'adjustment' | 'waste'
  p_note TEXT,
  p_branch_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- =========================================================
-- 13. RPC: submit_stock_opname — inti Modul Stok Opname.
--     Menghitung selisih (fisik vs sistem), nilai kerugian berdasar HPP,
--     menulis stock_opname_logs + stock_movements, dan MENGOREKSI
--     branch_stock.stock_qty ke hasil hitung fisik yang baru.
-- =========================================================
CREATE OR REPLACE FUNCTION submit_stock_opname(
  p_branch_id UUID,
  p_product_id UUID,
  p_physical_qty NUMERIC,
  p_reason TEXT DEFAULT NULL,  -- 'expired' | 'damaged' | 'cashier_discrepancy' | 'input_correction'
  p_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id UUID;
  v_branch_tenant UUID;
  v_system_qty NUMERIC;
  v_cost_price NUMERIC;
  v_difference NUMERIC;
  v_loss_value NUMERIC;
  v_log_id UUID;
BEGIN
  IF NOT is_manager_or_owner() THEN
    RAISE EXCEPTION 'Akses ditolak: Stok Opname hanya untuk Manager/Owner.';
  END IF;
  IF p_physical_qty IS NULL OR p_physical_qty < 0 THEN
    RAISE EXCEPTION 'Jumlah hitung fisik tidak valid.';
  END IF;

  v_tenant_id := current_tenant_id();

  SELECT tenant_id INTO v_branch_tenant FROM branches WHERE id = p_branch_id;
  IF v_branch_tenant IS NULL OR v_branch_tenant <> v_tenant_id THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan di tenant Anda.';
  END IF;

  -- Manager dibatasi ke cabang penugasannya sendiri; Owner boleh opname
  -- cabang mana pun (lewat BranchSwitcher di dashboard).
  IF NOT is_owner() AND p_branch_id <> current_branch_id() THEN
    RAISE EXCEPTION 'Akses ditolak: Anda hanya bisa opname stok cabang tempat Anda bertugas.';
  END IF;

  SELECT cost_price INTO v_cost_price FROM products
    WHERE id = p_product_id AND tenant_id = v_tenant_id;
  IF v_cost_price IS NULL THEN
    RAISE EXCEPTION 'Produk tidak ditemukan di tenant Anda.';
  END IF;

  -- Ambil (atau buat) baris stok cabang ini, dikunci supaya tidak ada
  -- opname/penjualan lain menimpa di tengah proses ini.
  SELECT stock_qty INTO v_system_qty FROM branch_stock
    WHERE branch_id = p_branch_id AND product_id = p_product_id
    FOR UPDATE;

  IF v_system_qty IS NULL THEN
    v_system_qty := 0;
    INSERT INTO branch_stock (tenant_id, branch_id, product_id, stock_qty)
      VALUES (v_tenant_id, p_branch_id, p_product_id, 0)
      ON CONFLICT (branch_id, product_id) DO NOTHING;
  END IF;

  v_difference := p_physical_qty - v_system_qty;

  IF v_difference <> 0 AND (p_reason IS NULL OR trim(p_reason) = '') THEN
    RAISE EXCEPTION 'Alasan selisih wajib diisi kalau stok fisik berbeda dari stok sistem.';
  END IF;

  -- Kerugian dihitung HANYA untuk selisih negatif (stok fisik < sistem).
  -- Selisih positif (stok fisik lebih banyak dari sistem) tetap dicatat
  -- untuk audit, tapi tidak dianggap "kerugian".
  v_loss_value := CASE WHEN v_difference < 0 THEN abs(v_difference) * v_cost_price ELSE 0 END;

  UPDATE branch_stock SET stock_qty = p_physical_qty, updated_at = now()
    WHERE branch_id = p_branch_id AND product_id = p_product_id;

  IF v_difference <> 0 THEN
    INSERT INTO stock_movements (tenant_id, branch_id, product_id, type, qty_change, note, created_by)
      VALUES (
        v_tenant_id, p_branch_id, p_product_id, 'adjustment', v_difference,
        'Stok opname' || CASE WHEN p_note IS NOT NULL AND p_note <> '' THEN ': ' || p_note ELSE '' END,
        auth.uid()
      );
  END IF;

  INSERT INTO stock_opname_logs (
    tenant_id, branch_id, product_id, system_qty, physical_qty,
    difference_qty, cost_price_snapshot, loss_value, reason, note, created_by
  ) VALUES (
    v_tenant_id, p_branch_id, p_product_id, v_system_qty, p_physical_qty,
    v_difference, v_cost_price, v_loss_value, NULLIF(p_reason, ''), NULLIF(p_note, ''), auth.uid()
  ) RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- =========================================================
-- 14. Views analitik (schema.sql/migration_005) — CREATE OR REPLACE untuk
--     menyertakan branch_id, supaya dashboard bisa filter per cabang atau
--     tampilkan gabungan (Laporan Konsolidasi) tanpa query terpisah.
-- =========================================================
-- CREATE OR REPLACE VIEW tidak bisa menyisipkan kolom baru (branch_id) di
-- TENGAH daftar kolom lama — Postgres cuma izinkan menambah kolom di
-- PALING BELAKANG lewat CREATE OR REPLACE. Karena kolom-kolom di sini
-- dirujuk dengan NAMA (bukan urutan) di semua query client, DROP + CREATE
-- ulang aman dilakukan.
DROP VIEW IF EXISTS daily_sales_analytics;
CREATE VIEW daily_sales_analytics
WITH (security_invoker = true) AS
SELECT
  tenant_id,
  branch_id,
  DATE(created_at) as sale_date,
  COUNT(id) as total_orders,
  SUM(total_amount) as total_revenue
FROM transactions
GROUP BY tenant_id, branch_id, DATE(created_at);

DROP VIEW IF EXISTS peak_hours_analytics;
CREATE VIEW peak_hours_analytics
WITH (security_invoker = true) AS
SELECT tenant_id, branch_id, EXTRACT(HOUR FROM created_at)::INT AS hour_of_day, COUNT(*) AS total_orders
FROM transactions
GROUP BY tenant_id, branch_id, EXTRACT(HOUR FROM created_at);

DROP VIEW IF EXISTS best_seller_analytics;
CREATE VIEW best_seller_analytics
WITH (security_invoker = true) AS
SELECT t.tenant_id, t.branch_id, p.name AS product_name, SUM(ti.qty) AS total_qty
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
JOIN products p ON p.id = ti.product_id
GROUP BY t.tenant_id, t.branch_id, p.name;

-- =========================================================
-- Selesai. Setelah migrasi ini jalan tanpa error:
--  1. Setiap tenant otomatis punya 1 "Cabang Utama" (cek /dashboard/branches).
--  2. Owner bisa tambah cabang baru sesuai batas paketnya (Free=1, Pro=3,
--     Supreme=unlimited) dari /dashboard/branches.
--  3. Saat menambah/mengedit karyawan di /dashboard/employees, tetapkan
--     cabang tugasnya — kasir & manager otomatis terkunci ke cabang itu.
--  4. /dashboard/stock-opname langsung bisa dipakai Manager/Owner untuk
--     input stok opname per cabang.
-- =========================================================
