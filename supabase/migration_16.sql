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
-- F. SUBSCRIPTION SAAS — KUOTA CABANG/STAF & AUTO-CUTOFF
-- =========================================================
-- Revisi ditambahkan ke migration_16.sql yang sama (belum di-apply ke
-- production manapun) sesuai aturan FINAL LOCK di atas — TIDAK dibuat
-- migration_17.sql. Semua perubahan di bagian F & H ADDITIF (view/kolom/
-- tabel/trigger baru), tidak ada DROP atau perubahan pada fungsi
-- checkout_transaction()/enforce_branch_limit()/enforce_cashier_limit()
-- yang sudah stabil — bagian ini murni menambah lapisan monitoring +
-- pembatasan baru di atasnya.

-- F1. View kuota pemakaian per tenant — dipakai halaman
--     /dashboard/subscription untuk menampilkan "Kuota Cabang/Staf"
--     (jumlah terpakai vs batas paket) secara live, bukan cuma tabel
--     perbandingan statis. security_invoker = true supaya RLS tabel
--     subscriptions/branches/profiles yang mendasarinya tetap berlaku
--     (pola yang sama dipakai daily_sales_analytics di schema.sql).
--     Batas branch_limit/staff_limit di CASE bawah ini HARUS selalu sama
--     persis dengan enforce_branch_limit() (migration_011) dan
--     enforce_cashier_limit() (migration_16 bagian A2) — free: 1 cabang/
--     2 staf tambahan, pro: 3 cabang/unlimited staf, supreme: unlimited/
--     unlimited (NULL = unlimited di kolom *_limit).
CREATE OR REPLACE VIEW v_subscription_quota
WITH (security_invoker = true) AS
SELECT
  s.tenant_id,
  s.status,
  s.plan,
  tenant_tier(s.tenant_id) AS tier,
  s.trial_ends_at,
  s.valid_until,
  (SELECT COUNT(*) FROM branches b WHERE b.tenant_id = s.tenant_id) AS branch_count,
  CASE tenant_tier(s.tenant_id)
    WHEN 'free' THEN 1
    WHEN 'pro' THEN 3
    ELSE NULL
  END AS branch_limit,
  -- Staf tambahan = cashier + manager + kitchen (role Owner tidak
  -- dihitung), konsisten dengan enforce_cashier_limit().
  (SELECT COUNT(*) FROM profiles p
     WHERE p.tenant_id = s.tenant_id AND p.role IN ('cashier', 'manager', 'kitchen')) AS staff_count,
  CASE tenant_tier(s.tenant_id)
    WHEN 'free' THEN 2
    ELSE NULL
  END AS staff_limit
FROM subscriptions s;

COMMENT ON VIEW v_subscription_quota IS
  'migration_16 (bagian F). Sumber data kartu "Kuota Cabang/Staf" di /dashboard/subscription — '
  'branch_limit/staff_limit NULL berarti unlimited untuk tier tsb.';

-- F2. AUTO-CUTOFF — pembatasan akses fitur otomatis saat status
--     subscription = 'expired'. Diterapkan sebagai trigger BEFORE INSERT
--     langsung di tabel transactions (bukan mengubah checkout_transaction()
--     yang sudah stabil) supaya berlaku APA PUN jalur insertnya — baik
--     lewat RPC checkout_transaction, checkout_order_v2 (KDS/Open Bill),
--     maupun sinkronisasi transaksi offline (syncPendingTransactions) —
--     semuanya bermuara ke satu INSERT INTO transactions di akhir. Owner/
--     Manager tetap bisa login & membuka /dashboard/subscription untuk
--     bayar (auto-cutoff ini TIDAK memblokir SELECT, hanya transaksi
--     penjualan baru) — proteksi UI (blocking overlay) dikerjakan di
--     frontend (lihat components/SubscriptionCutoffGate.tsx), trigger ini
--     adalah lapis pertahanan kedua di level database (defense-in-depth),
--     sama seperti pola enforce_branch_limit/enforce_cashier_limit.
--     Status 'past_due' (masih dalam grace period 3 hari, lihat bagian D)
--     SENGAJA masih boleh transaksi supaya tenant yang telat bayar
--     beberapa jam tidak langsung berhenti total.
CREATE OR REPLACE FUNCTION enforce_subscription_cutoff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

DROP TRIGGER IF EXISTS trg_enforce_subscription_cutoff ON transactions;
CREATE TRIGGER trg_enforce_subscription_cutoff
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION enforce_subscription_cutoff();

COMMENT ON FUNCTION enforce_subscription_cutoff IS
  'migration_16 (bagian F, Auto-Cutoff). Menolak transaksi penjualan baru begitu status '
  'subscriptions tenant = expired. Dipasang di tabel transactions (bukan mengubah fungsi '
  'checkout_transaction) supaya berlaku untuk semua jalur checkout tanpa menyentuh RPC yang sudah ada.';


-- =========================================================
-- G. SELF-SERVICE ONBOARDING & REGISTRATION — CATATAN (TIDAK ADA
--    PERUBAHAN SKEMA)
-- =========================================================
-- Alur /register (app/api/register/route.ts) SUDAH memenuhi spesifikasi
-- ini sejak sebelum migration_16: setiap pendaftaran baru otomatis (1)
-- membuat baris tenants, (2) membuat baris subscriptions dengan status
-- DEFAULT 'trial' dan trial_ends_at DEFAULT now()+28 hari (lihat kolom
-- DEFAULT di schema.sql, tidak perlu input manual), (3) membuat kode
-- referral permanen milik tenant baru, dan (4) membuat profile Owner —
-- semuanya dalam satu request, tanpa campur tangan admin/manual setup.
-- Bagian ini sengaja TIDAK menambah/mengubah skema apa pun — hanya
-- didokumentasikan di sini supaya jelas bahwa requirement #2 sudah
-- terpenuhi oleh kode yang sudah stabil, tidak disentuh oleh migration_16.


-- =========================================================
-- H. MEMBERSHIP CRM — TIER, SALDO POIN (customer_points), & KARTU
--    MEMBER DIGITAL
-- =========================================================
-- Catatan desain: caPOS sudah punya DUA sistem "member" yang berjalan
-- paralel sejak sebelum migration_16 ini:
--   (1) memberships (schema.sql) — kartu diskon sederhana berbasis
--       member_code, dipakai jalur scan cepat "Kode Member / Scan QR" di
--       /pos (CartPanel) untuk potongan % instan. TIDAK disentuh di sini.
--   (2) customers + customer_tiers + loyalty_config + loyalty_points_log
--       (migration_014, Phase 3 CRM) — database pelanggan lengkap dengan
--       tier & poin loyalitas, sudah tersambung ke checkout_transaction()
--       (parameter p_customer_id) dan modal CustomerLoyaltyModal di /pos,
--       TAPI saldo poin selama ini SELALU dihitung ulang dengan SUM() ke
--       loyalty_points_log setiap kali dibaca (tidak ada tabel saldo),
--       dan RPC redeem_loyalty_points() sudah ada di database tapi belum
--       pernah dipanggil dari UI manapun.
-- Task ini minta tabel "memberships" (sudah ada, dipertahankan apa
-- adanya) dan "customer_points" (BARU) — customer_points dibuat di sini
-- sebagai tabel SALDO (cache) yang mengikuti sistem (2) di atas (customers/
-- loyalty_points_log), karena itulah mesin poin yang sesungguhnya dipakai
-- caPOS; ia disinkronkan otomatis oleh trigger dari loyalty_points_log,
-- BUKAN sumber kebenaran baru yang terpisah (loyalty_points_log tetap
-- jadi audit trail utama, customer_points murni percepat pembacaan saldo
-- untuk Kartu Member Digital & POS).

-- H1. RLS untuk customer_tiers/loyalty_config/loyalty_points_log — ketiga
--     tabel ini dibuat di migration_014 TANPA RLS sama sekali (celah
--     kebocoran data lintas tenant, siapa pun yang authenticated bisa
--     baca tier/poin/config tenant lain). Diperbaiki di sini sebagai
--     bagian dari fondasi Membership CRM — murni ENABLE + POLICY baru,
--     tidak ada perubahan pada query yang sudah ada (semua query yang
--     sudah ada di app/actions/purchasing-loyalty-actions.ts sudah
--     memfilter tenant_id sendiri, jadi hasilnya tidak berubah untuk
--     pemakaian normal, hanya menutup celah aksesnya).
ALTER TABLE customer_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_customer_tiers" ON customer_tiers;
CREATE POLICY "rls_customer_tiers" ON customer_tiers
  FOR SELECT USING (tenant_id = current_tenant_id() OR is_super_admin());
DROP POLICY IF EXISTS "rls_customer_tiers_write" ON customer_tiers;
CREATE POLICY "rls_customer_tiers_write" ON customer_tiers
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() AND is_manager_or_owner());
DROP POLICY IF EXISTS "rls_customer_tiers_update" ON customer_tiers;
CREATE POLICY "rls_customer_tiers_update" ON customer_tiers
  FOR UPDATE USING (tenant_id = current_tenant_id() AND is_manager_or_owner())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE loyalty_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_loyalty_config" ON loyalty_config;
CREATE POLICY "rls_loyalty_config" ON loyalty_config
  FOR SELECT USING (tenant_id = current_tenant_id() OR is_super_admin());
DROP POLICY IF EXISTS "rls_loyalty_config_write" ON loyalty_config;
CREATE POLICY "rls_loyalty_config_write" ON loyalty_config
  FOR ALL USING (tenant_id = current_tenant_id() AND is_manager_or_owner())
  WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE loyalty_points_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_loyalty_points_log" ON loyalty_points_log;
CREATE POLICY "rls_loyalty_points_log" ON loyalty_points_log
  FOR SELECT USING (tenant_id = current_tenant_id() OR is_super_admin());
-- Tidak ada policy INSERT langsung untuk client — loyalty_points_log
-- HANYA ditulis lewat earn_loyalty_points()/redeem_loyalty_points()
-- (SECURITY DEFINER, bypass RLS), persis seperti pola stock_opnames.

-- H2. customer_points — tabel saldo poin per pelanggan (BARU, terikat
--     tenant_id sesuai spesifikasi). UNIQUE (customer_id) supaya 1
--     pelanggan = 1 baris saldo yang di-upsert oleh trigger H3.
CREATE TABLE IF NOT EXISTS customer_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  points_balance INT NOT NULL DEFAULT 0,
  lifetime_earned INT NOT NULL DEFAULT 0,
  lifetime_redeemed INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_points_tenant ON customer_points (tenant_id);

COMMENT ON TABLE customer_points IS
  'migration_16 (bagian H2). Cache saldo poin per pelanggan, disinkronkan otomatis oleh trigger '
  'trg_sync_customer_points dari loyalty_points_log — JANGAN diupdate manual dari client, saldo '
  'sebenarnya tetap loyalty_points_log (audit trail).';

ALTER TABLE customer_points ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rls_customer_points" ON customer_points;
CREATE POLICY "rls_customer_points" ON customer_points
  FOR SELECT USING (tenant_id = current_tenant_id() OR is_super_admin());
-- Tidak ada policy INSERT/UPDATE untuk client — hanya trigger H3
-- (SECURITY DEFINER) yang menulis ke tabel ini.

-- H3. Trigger sinkronisasi — setiap kali ada baris baru di
--     loyalty_points_log (ditulis oleh earn_loyalty_points() atau
--     redeem_loyalty_points(), keduanya fungsi lama yang TIDAK diubah),
--     saldo cache di customer_points ikut ter-upsert otomatis.
CREATE OR REPLACE FUNCTION sync_customer_points_from_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

DROP TRIGGER IF EXISTS trg_sync_customer_points ON loyalty_points_log;
CREATE TRIGGER trg_sync_customer_points
  AFTER INSERT ON loyalty_points_log
  FOR EACH ROW EXECUTE FUNCTION sync_customer_points_from_log();

COMMENT ON FUNCTION sync_customer_points_from_log IS
  'migration_16 (bagian H3). Jaga customer_points tetap sinkron setiap kali earn_loyalty_points() '
  'atau redeem_loyalty_points() menulis baris baru ke loyalty_points_log. Fungsi lama itu sendiri '
  'TIDAK diubah — trigger ini murni observer tambahan di tabel log-nya.';

-- H3b. Backfill satu kali — isi customer_points untuk data lama (kalau
--      ada tenant yang sudah pernah pakai loyalty_points_log SEBELUM
--      migration_16 ini di-apply), supaya saldo cache langsung akurat
--      sejak awal, bukan menunggu transaksi poin berikutnya.
INSERT INTO customer_points (tenant_id, customer_id, points_balance, lifetime_earned, lifetime_redeemed)
SELECT
  c.tenant_id,
  l.customer_id,
  GREATEST(SUM(CASE WHEN l.transaction_type IN ('EARN', 'ADJUST') THEN l.points_amount ELSE -l.points_amount END), 0),
  SUM(CASE WHEN l.transaction_type IN ('EARN', 'ADJUST') AND l.points_amount > 0 THEN l.points_amount ELSE 0 END),
  SUM(CASE WHEN l.transaction_type = 'REDEEM' THEN l.points_amount ELSE 0 END)
FROM loyalty_points_log l
JOIN customers c ON c.id = l.customer_id
GROUP BY c.tenant_id, l.customer_id
ON CONFLICT (customer_id) DO UPDATE SET
  points_balance = EXCLUDED.points_balance,
  lifetime_earned = EXCLUDED.lifetime_earned,
  lifetime_redeemed = EXCLUDED.lifetime_redeemed,
  updated_at = now();

-- H4. Nilai tukar poin -> Rupiah untuk redeem_loyalty_points() (RPC lama
--     yang sudah ada tapi butuh angka Rupiah dari CALLER — sebelumnya
--     tidak ada kolom konfigurasi untuk itu di loyalty_config). Default
--     Rp 100/poin, bisa diatur per tenant lewat halaman CRM Pelanggan.
ALTER TABLE loyalty_config
  ADD COLUMN IF NOT EXISTS redeem_rupiah_per_point NUMERIC NOT NULL DEFAULT 100;

COMMENT ON COLUMN loyalty_config.redeem_rupiah_per_point IS
  'migration_16. Nilai 1 poin saat ditukar jadi potongan Rupiah di kasir — dipakai frontend (POS) '
  'untuk menghitung p_discount_amount sebelum memanggil redeem_loyalty_points(). Tidak divalidasi '
  'ulang oleh redeem_loyalty_points() (fungsi lama, tidak diubah) — potongan tetap dibatasi wajar '
  'oleh UI (lihat components/crm/MemberCardModal.tsx & app/pos/page.tsx).';

-- H5. tier_id di customers SUDAH ADA sejak migration_014 (schema lama)
--     tapi belum pernah punya UI untuk mengelola tier ATAU meng-assign
--     pelanggan ke tier tertentu — itu dikerjakan di frontend
--     (app/actions/customer-membership-actions.ts), tidak butuh
--     perubahan skema tambahan di sini.

-- H6. Seed tier default untuk tenant yang belum punya tier SAMA SEKALI
--     (termasuk semua tenant lama sebelum migration_16 ini) — supaya
--     Kartu Member Digital langsung punya sesuatu untuk ditampilkan
--     tanpa Owner harus setup manual dulu. Dibuat idempotent lewat
--     UNIQUE (tenant_id, tier_name) yang sudah ada di CREATE TABLE
--     customer_tiers (migration_014).
INSERT INTO customer_tiers (tenant_id, tier_name, min_spend_monthly, discount_percentage, points_multiplier, benefits)
SELECT t.id, v.tier_name, v.min_spend, v.discount_pct, v.multiplier, v.benefits
FROM tenants t
CROSS JOIN (VALUES
  ('Reguler', 0, 0, 1, ARRAY['Kumpulkan poin di setiap transaksi']),
  ('Silver', 500000, 5, 1.2, ARRAY['Diskon 5%', 'Poin 1.2x']),
  ('Gold', 2000000, 10, 1.5, ARRAY['Diskon 10%', 'Poin 1.5x', 'Prioritas info promo'])
) AS v(tier_name, min_spend, discount_pct, multiplier, benefits)
WHERE NOT EXISTS (SELECT 1 FROM customer_tiers ct WHERE ct.tenant_id = t.id)
ON CONFLICT (tenant_id, tier_name) DO NOTHING;

-- H7. Trigger — tenant BARU (daftar lewat /register setelah migration_16
--     ini di-apply) langsung dapat 3 tier default yang sama, konsisten
--     dengan semangat requirement #2 (self-service, tanpa setup manual).
CREATE OR REPLACE FUNCTION seed_default_customer_tiers()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

DROP TRIGGER IF EXISTS trg_seed_default_customer_tiers ON tenants;
CREATE TRIGGER trg_seed_default_customer_tiers
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION seed_default_customer_tiers();

COMMENT ON FUNCTION seed_default_customer_tiers IS
  'migration_16 (bagian H7). Tenant baru otomatis dapat 3 tier member default (Reguler/Silver/Gold) '
  'begitu tenants di-insert (dipicu /api/register) — melengkapi alur self-service #2 supaya Kartu '
  'Member Digital & tier langsung siap pakai tanpa setup manual Owner.';

-- H8. View kartu member digital — satu baris per pelanggan, gabungan
--     customers + customer_tiers (status tier) + customer_points (saldo
--     poin). member_code memakai customers.customer_code yang sudah ada
--     (dipakai sebagai isi QR/Barcode di kartu). security_invoker = true
--     supaya RLS customers/customer_tiers/customer_points tetap berlaku.
CREATE OR REPLACE VIEW v_member_card
WITH (security_invoker = true) AS
SELECT
  c.id AS customer_id,
  c.tenant_id,
  c.customer_code AS member_code,
  c.customer_name,
  c.phone_number,
  c.email,
  c.is_active,
  c.lifetime_spend,
  c.visit_count,
  ct.id AS tier_id,
  COALESCE(ct.tier_name, 'Reguler') AS tier_name,
  COALESCE(ct.discount_percentage, 0) AS tier_discount_percentage,
  COALESCE(ct.benefits, '{}') AS tier_benefits,
  COALESCE(cp.points_balance, 0) AS points_balance,
  COALESCE(cp.lifetime_earned, 0) AS lifetime_earned,
  COALESCE(cp.lifetime_redeemed, 0) AS lifetime_redeemed
FROM customers c
LEFT JOIN customer_tiers ct ON ct.id = c.tier_id
LEFT JOIN customer_points cp ON cp.customer_id = c.id;

COMMENT ON VIEW v_member_card IS
  'migration_16 (bagian H8). Sumber data Kartu Member Digital (/dashboard/crm/customers) — Nama, '
  'Status Tier, member_code (dirender jadi QR/Barcode di frontend lewat lib qrcode), dan Saldo Poin.';

-- H9. RPC — assign/ubah tier seorang pelanggan. Dipisah dari
--     createCustomer/updateCustomer (server actions lama) supaya tidak
--     perlu mengubah signature fungsi yang sudah dipakai di produksi;
--     ini murni RPC baru untuk fitur baru (dropdown "Ubah Tier" di kartu
--     member digital).
CREATE OR REPLACE FUNCTION assign_customer_tier(p_customer_id UUID, p_tier_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION assign_customer_tier IS
  'migration_16 (bagian H9). RPC baru untuk fitur Kartu Member Digital — assign pelanggan ke tier '
  'tertentu. Tidak menggantikan/mengubah createCustomer/updateCustomer yang sudah ada.';


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
  'Final lock: ingredient-based stock opname, made-to-order stock purity, konsolidasi role Manajemen Karyawan, otomatisasi status subscription/billing. Revisi tambahan (bagian F & H): kuota cabang/staf + auto-cutoff subscription expired, customer_points + kartu member digital (tier & saldo poin) untuk Membership CRM.',
  true
)
ON CONFLICT (version) DO UPDATE SET is_final = true, description = EXCLUDED.description;

COMMENT ON TABLE schema_migrations_log IS
  'migration_16 adalah migration TERAKHIR (is_final=true). Jangan buat migration_17.sql — revisi '
  'skema selanjutnya masuk sebagai perubahan pada migration_16.sql ini (kalau belum di-apply ke '
  'production manapun) atau patch data terpisah di luar folder migrations.';
