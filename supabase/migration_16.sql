-- =========================================================
-- Migration 16 — FINAL LOCK
-- Jalankan di Supabase SQL Editor SETELAH migration_015.
--
-- Ini adalah migration TERAKHIR di skema caPOS. Tidak ada
-- migration_17.sql dan seterusnya — semua penyesuaian skema berikutnya
-- WAJIB masuk sebagai revisi ke file ini (belum di-apply ke production)
-- atau sebagai patch data terpisah di luar folder migrations (sudah
-- di-apply), TIDAK sebagai file migration_17+.
--
-- Seperti migration sebelumnya, semua perubahan ADDITIF (CREATE TABLE/
-- COLUMN/POLICY IF NOT EXISTS, CREATE OR REPLACE FUNCTION) — tidak ada
-- DROP TABLE/COLUMN. Tabel/fungsi lama yang digantikan alurnya DIBEKUKAN
-- (RLS insert ditutup / fungsi di-REPLACE jadi RAISE EXCEPTION pengarah),
-- bukan dihapus, supaya data histori tetap bisa diaudit.
--
-- ISI MIGRATION INI:
--   A. Konsolidasi Manajemen User — Manajemen Karyawan jadi satu-satunya
--      Single Source of Truth untuk role Admin/Owner, Supervisor/Manager,
--      Kasir, dan Dapur (role baru). Manajemen Kasir dibekukan jadi
--      view-only (monitoring shift aktif) di sisi backend (RLS + fungsi);
--      penghapusan form-nya sendiri ada di kode frontend (lihat ringkasan).
--   B. Refactor Stok Opname — stock_opnames (header) & stock_opname_items
--      (detail) terikat ke ingredients (bahan baku), BUKAN products.
--      Jalur lama berbasis produk (stock_opname_logs / submit_stock_opname)
--      dibekukan.
--   C. Kemurnian Stok Produk Made-to-Order — products.stock_mode
--      ('manual' | 'recipe') dijaga otomatis oleh trigger dari tabel
--      recipes, dan mencegah track_stock manual dinyalakan untuk produk
--      olahan (recipe) supaya stoknya SELALU murni mengikuti
--      branch_ingredients_stock lewat resep.
--   D. Otomatisasi Status Subscription/Billing — trigger self-healing
--      di tabel subscriptions + job terjadwal (pg_cron) yang menutup
--      celah: status 'past_due'/'expired' selama ini TIDAK PERNAH
--      diset otomatis oleh siapa pun setelah trial_ends_at/valid_until
--      lewat.
-- =========================================================


-- =========================================================
-- A. KONSOLIDASI MANAJEMEN USER
-- =========================================================

-- A1. Tambah role 'kitchen' (Dapur) ke enum user_role. Role yang sudah
--     ada (owner, manager, cashier) TIDAK diganti nama di level enum
--     (biar tidak ada migrasi data/ubah semua baris profiles) — pemetaan
--     label UI "Admin / Supervisor / Kasir / Dapur" dilakukan di frontend
--     (lib/role.ts), lihat ringkasan kode.
--
-- CATATAN: ALTER TYPE ... ADD VALUE tidak boleh dipakai bersama query
-- yang mereferensikan value barunya DALAM transaksi yang sama — karena
-- itu baris ini harus jadi statement PALING AWAL & berdiri sendiri di
-- file ini (pola yang sama dipakai migration_007a_add_manager_role.sql).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'kitchen';

COMMENT ON COLUMN profiles.role IS
  'Role sistem. Pemetaan label UI Manajemen Karyawan (Single Source of Truth sejak migration_16): '
  'owner -> "Admin", manager -> "Supervisor", cashier -> "Kasir", kitchen -> "Dapur". '
  'super_admin khusus operator platform caPOS, tidak dibuat lewat Manajemen Karyawan tenant manapun.';

-- A2. enforce_cashier_limit() — perluas hitungan "karyawan tambahan"
--     paket Free supaya ikut menghitung role kitchen juga (sebelumnya
--     hanya cashier & manager), konsisten dengan status role kitchen
--     sebagai karyawan tambahan di luar Owner.
CREATE OR REPLACE FUNCTION enforce_cashier_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NEW.role NOT IN ('cashier', 'manager', 'kitchen') THEN
    RETURN NEW;
  END IF;

  IF tenant_tier(NEW.tenant_id) = 'free' THEN
    SELECT COUNT(*) INTO v_count FROM profiles
      WHERE tenant_id = NEW.tenant_id AND role IN ('cashier', 'manager', 'kitchen');
    IF v_count >= 2 THEN
      RAISE EXCEPTION 'FREE_TIER_CASHIER_LIMIT: Paket Free Trial maksimal 2 akun karyawan tambahan (kasir/supervisor/dapur). Upgrade ke Pro untuk tambah karyawan.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- A3. Bekukan jalur pembuatan akun lewat "Manajemen Kasir" di level
--     backend juga (defense-in-depth — perubahan utama tetap di
--     app/api/cashiers/route.ts, lihat ringkasan kode). RPC ini dulunya
--     tidak ada (pembuatan akun kasir lewat service-role langsung di API
--     route, bukan RPC client), jadi tidak ada fungsi lama untuk
--     dibekukan di sini — bagian ini murni dokumentasi kontrak baru:
--     Manajemen Kasir HANYA boleh melakukan SELECT & baca status shift.
COMMENT ON TABLE shifts IS
  'Sesi kerja kasir. Sejak migration_16, halaman "Manajemen Kasir" (/dashboard/cashiers) '
  'HANYA membaca tabel profiles (role=cashier) + shifts (status=open) untuk menampilkan '
  'monitoring kasir yang sedang bertugas. Pembuatan/pengeditan akun kasir TIDAK LAGI '
  'dilakukan dari halaman itu — satu-satunya jalur resmi adalah /dashboard/employees '
  '(Manajemen Karyawan) via /api/employees.';

-- View ringkas untuk monitoring shift aktif — dipakai halaman Manajemen
-- Kasir yang baru (view-only). Menggabungkan profiles (identitas kasir)
-- dengan shift yang sedang open, per cabang.
CREATE OR REPLACE VIEW v_active_cashier_shifts AS
SELECT
  p.id AS cashier_id,
  p.tenant_id,
  p.full_name,
  p.email,
  p.branch_id,
  b.name AS branch_name,
  p.is_active AS account_active,
  s.id AS shift_id,
  s.opened_at,
  (s.id IS NOT NULL) AS is_on_shift
FROM profiles p
LEFT JOIN branches b ON b.id = p.branch_id
LEFT JOIN LATERAL (
  SELECT id, opened_at FROM shifts
  WHERE cashier_id = p.id AND status = 'open'
  ORDER BY opened_at DESC LIMIT 1
) s ON true
WHERE p.role = 'cashier';

COMMENT ON VIEW v_active_cashier_shifts IS
  'Sumber data untuk halaman monitoring Manajemen Kasir (view-only, migration_16). '
  'RLS mengikuti tabel profiles/shifts yang mendasarinya (postgres menerapkan security_invoker '
  'secara default untuk view biasa, jadi kebijakan tenant/branch scoping tetap berlaku).';


-- =========================================================
-- B. REFACTOR STOK OPNAME -> BAHAN BAKU (INGREDIENTS)
-- =========================================================

-- B1. HEADER — 1 baris = 1 sesi opname (per cabang, per hari, per
--     pencatat). Item-item bahan baku yang dihitung di sesi yang sama
--     dikumpulkan di stock_opname_items.
CREATE TABLE IF NOT EXISTS stock_opnames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted')),
  note TEXT,
  total_loss_value NUMERIC NOT NULL DEFAULT 0,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  submitted_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_opnames_tenant_branch_date
  ON stock_opnames (tenant_id, branch_id, created_at DESC);

COMMENT ON TABLE stock_opnames IS
  'Header sesi stok opname bahan baku (migration_16). Menggantikan pola lama 1-baris-per-produk '
  'di stock_opname_logs — sekarang 1 sesi bisa mencakup banyak bahan baku sekaligus lewat '
  'stock_opname_items. Dibuat otomatis oleh submit_stock_opname_item() (1 sesi terbuka per '
  'tenant+branch+hari+pencatat), TIDAK diinsert langsung oleh client.';

-- B2. DETAIL — 1 baris = 1 bahan baku yang dihitung dalam sesi opname
--     tsb. Terikat LANGSUNG ke ingredients, bukan products.
CREATE TABLE IF NOT EXISTS stock_opname_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opname_id UUID REFERENCES stock_opnames(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id) ON DELETE RESTRICT,
  unit TEXT REFERENCES units(code),
  system_qty NUMERIC NOT NULL,
  physical_qty NUMERIC NOT NULL,
  difference_qty NUMERIC NOT NULL,
  cost_price_snapshot NUMERIC NOT NULL DEFAULT 0,
  loss_value NUMERIC NOT NULL DEFAULT 0,
  reason TEXT, -- 'expired' | 'damaged' | 'cashier_discrepancy' | 'input_correction' | NULL
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (opname_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_opname_items_opname ON stock_opname_items (opname_id);
CREATE INDEX IF NOT EXISTS idx_stock_opname_items_ingredient ON stock_opname_items (ingredient_id);

COMMENT ON TABLE stock_opname_items IS
  'Baris detail stok opname PER BAHAN BAKU (migration_16). ingredient_id adalah satu-satunya '
  'relasi produk/komponen resep di tabel ini — TIDAK ADA kolom product_id, sesuai keputusan '
  'bahwa opname mengukur bahan baku fisik, bukan produk jadi olahan.';

ALTER TABLE stock_opnames ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_opname_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Stock opnames: manager/owner scoped view" ON stock_opnames;
CREATE POLICY "Stock opnames: manager/owner scoped view" ON stock_opnames
  FOR SELECT USING (
    is_super_admin() OR (
      tenant_id = current_tenant_id() AND is_manager_or_owner() AND (is_owner() OR branch_id = current_branch_id())
    )
  );

-- INSERT/UPDATE header HANYA lewat submit_stock_opname_item() (SECURITY
-- DEFINER, bypass RLS) — tidak ada policy INSERT/UPDATE langsung untuk
-- client, supaya total_loss_value & status tidak bisa dimanipulasi dari
-- browser.

DROP POLICY IF EXISTS "Stock opname items: manager/owner scoped view" ON stock_opname_items;
CREATE POLICY "Stock opname items: manager/owner scoped view" ON stock_opname_items
  FOR SELECT USING (
    is_super_admin() OR opname_id IN (
      SELECT id FROM stock_opnames
      WHERE tenant_id = current_tenant_id() AND is_manager_or_owner() AND (is_owner() OR branch_id = current_branch_id())
    )
  );

-- B3. RPC utama — submit 1 baris hasil hitung fisik 1 bahan baku.
--     Otomatis membuat/menggunakan kembali header stock_opnames "hari
--     ini" untuk (tenant, branch, pencatat) yang sama, supaya banyak
--     baris yang disimpan berurutan dari halaman Stok Opname (tombol
--     "Simpan" per baris, seperti UX yang sudah ada) tetap terkumpul
--     jadi SATU sesi opname, bukan 1 sesi per baris.
--
--     Efek samping (SAMA seperti submit_ingredient_stock_opname yang
--     sudah ada dari migration_012, dipertahankan supaya laporan lama
--     yang membaca ingredient_stock_opname_logs tetap terisi):
--       1. branch_ingredients_stock.stock_qty dikoreksi ke hasil fisik.
--       2. ingredient_stock_movements dicatat (type STOCK_OPNAME).
--       3. ingredient_stock_opname_logs tetap ditulis (mirror, additif).
--     branch_ingredients_stock.cost_price TIDAK diubah opname (opname
--     mengoreksi KUANTITAS, bukan harga) — HPP resep & kalkulasi COGS
--     (calculate_recipe_cost, calculate_product_cogs) otomatis ikut
--     berubah pada request berikutnya karena keduanya SELALU membaca
--     stock_qty & cost_price branch_ingredients_stock secara live, tidak
--     ada nilai yang di-cache.
CREATE OR REPLACE FUNCTION submit_stock_opname_item(
  p_branch_id UUID,
  p_ingredient_id UUID,
  p_physical_qty NUMERIC,
  p_reason TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION submit_stock_opname_item IS
  'Migration_16 — RPC utama Stok Opname (bahan baku). Menggantikan submit_stock_opname() lama '
  '(berbasis products, kini dibekukan) sebagai satu-satunya jalur input opname dari frontend.';

-- View gabungan untuk tab Riwayat halaman Stok Opname — menggantikan
-- query lama ke stock_opname_logs (products(name)) dengan ingredients(name).
CREATE OR REPLACE VIEW v_stock_opname_history AS
SELECT
  i.id, i.created_at, i.system_qty, i.physical_qty, i.difference_qty, i.loss_value,
  i.reason, i.note, i.unit,
  ing.name AS ingredient_name,
  o.tenant_id, o.branch_id,
  br.name AS branch_name,
  p.full_name AS created_by_name
FROM stock_opname_items i
JOIN stock_opnames o ON o.id = i.opname_id
JOIN ingredients ing ON ing.id = i.ingredient_id
LEFT JOIN branches br ON br.id = o.branch_id
LEFT JOIN profiles p ON p.id = o.created_by;

COMMENT ON VIEW v_stock_opname_history IS
  'Sumber data tab Riwayat /dashboard/stock-opname (migration_16, ingredient-based).';

-- B4. BEKUKAN jalur lama (produk). Tabel & fungsi TIDAK dihapus (data
--     histori sebelum migration_16 tetap bisa dibaca/diaudit), tapi:
--       - tidak bisa lagi di-INSERT (RLS WITH CHECK false)
--       - RPC lama me-raise exception yang mengarahkan ke fungsi baru
DROP POLICY IF EXISTS "Stock opname: manager/owner insert" ON stock_opname_logs;
CREATE POLICY "Stock opname: manager/owner insert" ON stock_opname_logs
  FOR INSERT WITH CHECK (false);

COMMENT ON TABLE stock_opname_logs IS
  'DIBEKUKAN sejak migration_16 (INSERT ditutup lewat RLS) — data lama (opname berbasis products, '
  'migration_011) dipertahankan hanya untuk histori/audit. Fitur Stok Opname aktif sekarang '
  'sepenuhnya berbasis bahan baku: lihat stock_opnames / stock_opname_items / submit_stock_opname_item().';

CREATE OR REPLACE FUNCTION submit_stock_opname(
  p_branch_id UUID,
  p_product_id UUID,
  p_physical_qty NUMERIC,
  p_reason TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'DEPRECATED_PRODUCT_STOCK_OPNAME: Stok opname berbasis produk sudah tidak didukung sejak migration_16. '
    'Gunakan submit_stock_opname_item(p_branch_id, p_ingredient_id, p_physical_qty, p_reason, p_note) — '
    'opname sekarang dilakukan per bahan baku (ingredient), bukan per produk jadi.';
END;
$$;

COMMENT ON FUNCTION submit_stock_opname IS
  'DIBEKUKAN sejak migration_16 — selalu RAISE EXCEPTION. Dipertahankan (bukan di-DROP) hanya '
  'supaya signature lama tidak error "function does not exist" kalau ada caller lama yang lupa '
  'diperbarui. Ganti ke submit_stock_opname_item().';


-- =========================================================
-- C. KEMURNIAN STOK PRODUK MADE-TO-ORDER (OLAHAN)
-- =========================================================

-- C1. Kolom penanda mode stok produk. 'recipe' = produk olahan/made-to-
--     order, stoknya HARUS murni mengikuti ketersediaan bahan baku lewat
--     resep aktif (branch_ingredients_stock), tidak boleh dilacak manual
--     lewat products.track_stock/branch_stock lagi. 'manual' = perilaku
--     lama (barang jadi/retail tanpa resep, stok diinput manual seperti
--     sebelum Phase 1 F&B Core ada).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_mode TEXT NOT NULL DEFAULT 'manual' CHECK (stock_mode IN ('manual', 'recipe'));

COMMENT ON COLUMN products.stock_mode IS
  'migration_16. "recipe" = made-to-order, stok murni dari branch_ingredients_stock via resep aktif '
  '(diset otomatis oleh trigger sync_product_stock_mode, JANGAN diubah manual dari client). '
  '"manual" = stok dilacak langsung di products/branch_stock seperti sebelum Phase 1 F&B Core.';

-- Backfill: produk yang sudah punya resep aktif (dari migration_012)
-- langsung ditandai 'recipe' dan track_stock manual-nya dimatikan,
-- supaya tidak ada lagi produk yang stoknya dihitung dobel (branch_stock
-- manual DAN branch_ingredients_stock via resep sekaligus).
UPDATE products p SET stock_mode = 'recipe', track_stock = false
WHERE EXISTS (
  SELECT 1 FROM recipes r WHERE r.product_id = p.id AND r.is_active = true
) AND p.stock_mode <> 'recipe';

-- C2. Trigger — jaga stock_mode tetap sinkron setiap kali resep produk
--     dibuat/diaktifkan/dinonaktifkan, tanpa perlu Owner mengubahnya manual.
CREATE OR REPLACE FUNCTION sync_product_stock_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

DROP TRIGGER IF EXISTS trg_sync_product_stock_mode ON recipes;
CREATE TRIGGER trg_sync_product_stock_mode
  AFTER INSERT OR UPDATE OF is_active, product_id ON recipes
  FOR EACH ROW EXECUTE FUNCTION sync_product_stock_mode();

-- C3. Guard — cegah track_stock manual dinyalakan lagi untuk produk
--     'recipe' (mis. lewat halaman /dashboard/stock yang masih ada untuk
--     produk non-resep). Ini mengunci niat "stok murni ikut ingredients"
--     supaya tidak bisa dilanggar dari jalur mana pun, bukan cuma dari
--     satu halaman frontend.
CREATE OR REPLACE FUNCTION enforce_recipe_product_stock_purity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

DROP TRIGGER IF EXISTS trg_enforce_recipe_product_stock_purity ON products;
CREATE TRIGGER trg_enforce_recipe_product_stock_purity
  BEFORE UPDATE OF track_stock, stock_mode ON products
  FOR EACH ROW EXECUTE FUNCTION enforce_recipe_product_stock_purity();

-- C4. Helper — stok efektif produk untuk ditampilkan di POS/menu/kitchen
--     availability, dihitung LANGSUNG dari resep+bahan baku untuk produk
--     'recipe' (bukan dari kolom stok manapun yang bisa basi/tidak sinkron).
CREATE OR REPLACE FUNCTION product_effective_stock(p_product_id UUID, p_branch_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION product_effective_stock IS
  'migration_16. Stok tampil untuk 1 produk di 1 cabang — untuk produk made-to-order (stock_mode = recipe), '
  'dihitung murni dari porsi maksimum yang bisa dibuat dari branch_ingredients_stock saat ini '
  '(bukan angka stok yang di-cache di kolom manapun).';


-- =========================================================
-- D. OTOMATISASI STATUS SUBSCRIPTION/BILLING
-- =========================================================

-- D1. Fungsi murni — hitung status yang SEHARUSNYA berlaku dari
--     tanggal-tanggal subscription saat ini. Dipakai baik oleh trigger
--     (D2, real-time saat baris disentuh) maupun job terjadwal (D3,
--     untuk baris yang TIDAK disentuh siapa pun tapi tanggalnya sudah lewat).
--     Grace period 3 hari sebelum 'active' yang valid_until-nya lewat
--     dianggap 'expired' penuh — selama grace period statusnya 'past_due'
--     (dipakai dashboard Super Admin untuk daftar "tenant berisiko").
CREATE OR REPLACE FUNCTION compute_subscription_status(
  p_current_status sub_status,
  p_trial_ends_at TIMESTAMPTZ,
  p_valid_until TIMESTAMPTZ,
  p_super_trial_ends_at TIMESTAMPTZ
) RETURNS sub_status
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

-- D2. TRIGGER self-healing — setiap kali baris subscriptions di-INSERT
--     atau di-UPDATE (mis. oleh webhook Midtrans), status ikut
--     dikoreksi otomatis kalau ternyata sudah tidak sesuai tanggalnya.
--     Ini trigger yang diminta secara eksplisit di spesifikasi migration
--     ini ("trigger baru untuk otomatisasi status subscription/billing").
CREATE OR REPLACE FUNCTION trg_subscriptions_auto_status_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.status := compute_subscription_status(NEW.status, NEW.trial_ends_at, NEW.valid_until, NEW.super_trial_ends_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscriptions_auto_status ON subscriptions;
CREATE TRIGGER trg_subscriptions_auto_status
  BEFORE INSERT OR UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION trg_subscriptions_auto_status_fn();

-- D3. JOB TERJADWAL — subscription yang TIDAK PERNAH disentuh lagi
--     setelah trial/valid_until lewat (kasus paling umum: tenant trial
--     yang tidak pernah bayar) tidak akan pernah kena trigger D2 di atas
--     karena tidak ada UPDATE yang terjadi. pg_cron menutup celah ini
--     dengan menjalankan UPDATE (yang otomatis memicu trigger D2 di
--     atas) terhadap SEMUA baris subscriptions setiap jam.
CREATE OR REPLACE FUNCTION refresh_all_subscription_statuses()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE subscriptions SET updated_at = updated_at
  WHERE status IN ('trial', 'active', 'past_due')
    AND (
      (status = 'trial' AND trial_ends_at < now())
      OR (status IN ('active', 'past_due') AND valid_until < now())
    )
    AND (super_trial_ends_at IS NULL OR super_trial_ends_at < now());
$$;

COMMENT ON FUNCTION refresh_all_subscription_statuses IS
  'migration_16. Dipanggil pg_cron setiap jam. UPDATE "kosong" (updated_at=updated_at) ini sengaja '
  'dipakai hanya untuk memicu trigger trg_subscriptions_auto_status di atas pada baris yang sudah '
  'lewat tanggal tapi tidak pernah di-UPDATE siapa pun (mis. trial yang tidak pernah bayar sama sekali).';

-- Aktifkan pg_cron & jadwalkan — dibungkus DO block supaya migration ini
-- TETAP BERHASIL dijalankan walau pg_cron belum diaktifkan di project
-- Supabase yang bersangkutan (perlu diaktifkan manual sekali lewat
-- Dashboard > Database > Extensions kalau CREATE EXTENSION di bawah
-- gagal karena keterbatasan izin di sebagian paket Supabase).
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron tidak bisa diaktifkan otomatis (%). Aktifkan manual lewat Supabase Dashboard > Database > Extensions, lalu jalankan ulang blok penjadwalan di bagian D3 migration_16.sql.', SQLERRM;
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


-- =========================================================
-- E. FINAL LOCK — catatan versi skema
-- =========================================================
CREATE TABLE IF NOT EXISTS schema_migrations_log (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  description TEXT,
  is_final BOOLEAN NOT NULL DEFAULT false,
  applied_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO schema_migrations_log (version, description, is_final)
VALUES (
  'migration_16',
  'Final lock: ingredient-based stock opname, made-to-order stock purity, konsolidasi role Manajemen Karyawan, otomatisasi status subscription/billing.',
  true
)
ON CONFLICT (version) DO UPDATE SET is_final = true, description = EXCLUDED.description;

COMMENT ON TABLE schema_migrations_log IS
  'migration_16 adalah migration TERAKHIR (is_final=true). Jangan buat migration_17.sql — revisi '
  'skema selanjutnya masuk sebagai perubahan pada migration_16.sql ini (kalau belum di-apply ke '
  'production manapun) atau patch data terpisah di luar folder migrations.';
