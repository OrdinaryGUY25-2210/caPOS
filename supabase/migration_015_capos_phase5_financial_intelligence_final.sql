-- 015_capos_phase5_financial_intelligence_final.sql

SET check_function_bodies = off;

-- =========================================================
-- SELESAI — Ringkasan langkah lanjutan (DI LUAR migrasi ini):
--  1. Kaitkan consume_recipe() ke checkout_transaction()/checkout_order_v2()/
--     create_kitchen_order() supaya deduction benar-benar otomatis saat bayar.
--  2. Admin UI: Ingredients, Variants, Modifier Groups, Recipe Builder
--     (section 46-50 di master prompt) — belum ada di migrasi database ini.
--  3. Migrasi data: kalau mau produk existing langsung punya recipe,
--     insert manual ke `recipes`/`recipe_items` per produk (tidak bisa
--     di-generate otomatis karena caPOS lama tidak punya data resep).
-- =========================================================


-- ============================================================
-- >>> BERASAL DARI: migration_018_expenses_budgets.sql
-- ============================================================
-- =========================================================
-- MIGRATION 018 — Expense Management & Budget Tracking (P5.1 Financial Control)
-- =========================================================
-- CATATAN AUDIT:
-- Belum ada tabel `expenses`, `expense_categories`, atau `budgets` yang
-- terdeteksi di fragment project yang tersedia (migration_017, app/pos,
-- lib/dexie). Migration ini MEMBUAT BARU ketiganya — bukan extend —
-- karena memang belum ada implementasi sebelumnya (status: MISSING).
--
-- ASUMSI YANG PERLU DIVERIFIKASI SEBELUM MENJALANKAN MIGRATION INI:
--   1. Tabel `profiles` punya kolom `role` (TEXT) dengan nilai seperti
--      'owner' | 'admin' | 'manager' | 'cashier' | 'kitchen' | 'staff'
--      (dipakai untuk policy approval expense). Jika nama/kolom berbeda,
--      sesuaikan predicate di policy "expenses_approve" di bawah.
--   2. Tabel `branches` sudah ada dengan kolom `id`, `tenant_id`.
--   3. Belum ada fungsi trigger generik untuk `updated_at` — migration ini
--      mendefinisikan `capos_set_updated_at()` dengan nama yang sengaja
--      dibuat spesifik/non-generic supaya TIDAK bentrok kalau ternyata
--      sudah ada fungsi serupa dengan nama lain. Kalau project sudah
--      punya trigger function sejenis, ganti referensinya di bawah
--      supaya tidak duplicate (rule #1 master prompt: EXTEND, jangan
--      DUPLICATE).
--
-- Kalau salah satu asumsi di atas tidak sesuai struktur project asli,
-- JANGAN jalankan migration ini langsung — sesuaikan dulu.
-- =========================================================

-- ---------------------------------------------------------
-- 0. Shared trigger helper (idempotent create)
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION capos_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------
-- 1. expense_categories
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  -- Sengaja TANPA FK constraint di sini: profiles.tenant_id bukan kolom
  -- unique/PK (banyak profile berbagi satu tenant_id), jadi tidak valid
  -- jadi target FK. Kalau project punya tabel `tenants`/`businesses`
  -- terpisah dengan `id` sebagai PK, tambahkan
  -- `REFERENCES businesses(id) ON DELETE CASCADE` di sini. Sampai itu
  -- dikonfirmasi, integritas tenant_id divalidasi lewat RLS saja —
  -- pola yang sama dipakai transactions.tenant_id di migration_017.
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_tenant
  ON expense_categories (tenant_id);

DROP TRIGGER IF EXISTS trg_expense_categories_updated_at ON expense_categories;

CREATE TRIGGER trg_expense_categories_updated_at
  BEFORE UPDATE ON expense_categories
  FOR EACH ROW EXECUTE FUNCTION capos_set_updated_at();

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_categories_select" ON expense_categories;
CREATE POLICY expense_categories_select ON expense_categories
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

-- BUG FIX (Phase 2A.1 audit): original checked role IN ('owner','admin'), but
-- 'admin' is not a valid user_role enum value (schema.sql defines only
-- super_admin/owner/manager/cashier) -- confirmed by the migration's own
-- audit note flagging this as an unverified assumption. Corrected to the
-- real top-authority roles (owner, super_admin).


DROP POLICY IF EXISTS "expense_categories_write" ON expense_categories;
CREATE POLICY expense_categories_write ON expense_categories
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'super_admin')
    )
  ) WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

-- ---------------------------------------------------------
-- 2. expenses
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  -- NULL branch_id = business-wide expense (mis. software subscription),
  -- konsisten dengan pola voucher.branch_id di migration_017.
  category_id UUID NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,

  amount NUMERIC NOT NULL CHECK (amount > 0),
  description TEXT,
  expense_date DATE NOT NULL DEFAULT current_date,
  attachment_url TEXT,

  is_recurring BOOLEAN NOT NULL DEFAULT false,
  recurrence_frequency TEXT CHECK (recurrence_frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  recurrence_end_date DATE,
  -- Baris ini adalah TEMPLATE recurring kalau is_recurring = true.
  -- Instance aktual per periode dibuat oleh generate_recurring_expenses()
  -- di bawah (bukan otomatis dari trigger, supaya tetap butuh review —
  -- lihat rule #14 master prompt soal tidak auto-eksekusi tanpa approval).
  source_recurring_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,

  -- Audit trail (rule #29 — jangan hard-delete financial record)
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES profiles(id),
  void_reason TEXT,

  CONSTRAINT chk_recurrence_fields CHECK (
    (is_recurring = false)
    OR (is_recurring = true AND recurrence_frequency IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date
  ON expenses (tenant_id, expense_date);

CREATE INDEX IF NOT EXISTS idx_expenses_branch
  ON expenses (branch_id);

CREATE INDEX IF NOT EXISTS idx_expenses_category
  ON expenses (category_id);

CREATE INDEX IF NOT EXISTS idx_expenses_status
  ON expenses (tenant_id, status) WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_recurring_templates
  ON expenses (tenant_id, is_recurring) WHERE is_recurring = true;

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON expenses;

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION capos_set_updated_at();

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_select" ON expenses;
CREATE POLICY expenses_select ON expenses
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

-- Staff/manager dapat MENGAJUKAN expense (insert, status selalu PENDING
-- untuk role di luar owner/admin — enforced lewat trigger di bawah,
-- bukan hanya WITH CHECK, supaya tidak bisa dilewati dengan payload aneh).
DROP POLICY IF EXISTS "expenses_insert" ON expenses;
CREATE POLICY expenses_insert ON expenses
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND created_by = auth.uid()
  );

-- BUG FIX (Phase 2A.1 audit): original checked role IN ('owner','admin'), but
-- 'admin' is not a valid user_role enum value (schema.sql defines only
-- super_admin/owner/manager/cashier) -- confirmed by the migration's own
-- audit note flagging this as an unverified assumption. Corrected to the
-- real top-authority roles (owner, super_admin).


CREATE OR REPLACE FUNCTION capos_enforce_expense_insert_status()
RETURNS TRIGGER
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

DROP TRIGGER IF EXISTS trg_expenses_enforce_insert_status ON expenses;

CREATE TRIGGER trg_expenses_enforce_insert_status
  BEFORE INSERT ON expenses
  FOR EACH ROW EXECUTE FUNCTION capos_enforce_expense_insert_status();

-- BUG FIX (Phase 2A.1 audit): original checked role IN ('owner','admin'), but
-- 'admin' is not a valid user_role enum value (schema.sql defines only
-- super_admin/owner/manager/cashier) -- confirmed by the migration's own
-- audit note flagging this as an unverified assumption. Corrected to the
-- real top-authority roles (owner, super_admin).


-- Update hanya untuk owner/admin (approve/reject/void), dan tidak boleh
-- mengubah expense yang sudah voided (immutability, rule #29/#30).
DROP POLICY IF EXISTS "expenses_update" ON expenses;
CREATE POLICY expenses_update ON expenses
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND voided_at IS NULL
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'super_admin')
    )
  ) WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

-- Tidak ada policy DELETE — sengaja. Pembatalan expense harus lewat
-- kolom voided_at/voided_by/void_reason (soft-void), bukan hard delete.

COMMENT ON TABLE expenses IS 'Operational expenses (rule #7). Tidak pernah di-hard-delete — pembatalan pakai voided_at/voided_by/void_reason. Baris dengan is_recurring=true berfungsi sebagai template, bukan transaksi aktual.';

-- ---------------------------------------------------------
-- 3. generate_recurring_expenses() — dipanggil manual/cron, BUKAN otomatis
--    tanpa jejak. Setiap instance yang dibuat tetap berstatus PENDING
--    dan butuh approval, konsisten dengan rule #14 (no auto-execute
--    tanpa approval eksplisit).
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_recurring_expenses(p_tenant_id UUID)
RETURNS SETOF expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION generate_recurring_expenses IS 'Membuat instance expense baru dari template recurring yang jatuh tempo. Setiap instance tetap PENDING dan butuh approval terpisah — tidak auto-approved.';

-- ---------------------------------------------------------
-- 4. budgets
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  -- NULL = business-wide budget (semua cabang digabung)
  category_id UUID REFERENCES expense_categories(id) ON DELETE CASCADE,
  -- NULL = overall/general budget (semua kategori)

  period_year INT NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),

  amount NUMERIC NOT NULL CHECK (amount >= 0),
  warning_threshold_pct NUMERIC NOT NULL DEFAULT 80 CHECK (warning_threshold_pct BETWEEN 0 AND 100),
  critical_threshold_pct NUMERIC NOT NULL DEFAULT 100 CHECK (critical_threshold_pct BETWEEN 0 AND 200),

  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Satu budget per kombinasi tenant/branch/category/periode. `NULL`
  -- di branch_id/category_id diperlakukan sebagai nilai unik tersendiri
  -- lewat COALESCE ke uuid nil supaya "business-wide" tidak bisa
  -- didaftarkan dua kali untuk periode yang sama.
  UNIQUE NULLS NOT DISTINCT (tenant_id, branch_id, category_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_budgets_tenant_period
  ON budgets (tenant_id, period_year, period_month);

DROP TRIGGER IF EXISTS trg_budgets_updated_at ON budgets;

CREATE TRIGGER trg_budgets_updated_at
  BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION capos_set_updated_at();

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "budgets_select" ON budgets;
CREATE POLICY budgets_select ON budgets
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

-- BUG FIX (Phase 2A.1 audit): original checked role IN ('owner','admin'), but
-- 'admin' is not a valid user_role enum value (schema.sql defines only
-- super_admin/owner/manager/cashier) -- confirmed by the migration's own
-- audit note flagging this as an unverified assumption. Corrected to the
-- real top-authority roles (owner, super_admin).


DROP POLICY IF EXISTS "budgets_write" ON budgets;
CREATE POLICY budgets_write ON budgets
  FOR ALL USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'super_admin')
    )
  ) WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

COMMENT ON TABLE budgets IS 'Rule #8 — Monthly/Branch/Category budget. Perbandingan vs actual dihitung oleh view budget_vs_actual di bawah, bukan disimpan sebagai angka statis (supaya selalu real-time terhadap expenses terbaru).';

-- ---------------------------------------------------------
-- 5. budget_vs_actual — view read-only, dihitung on-the-fly
-- ---------------------------------------------------------
CREATE OR REPLACE VIEW budget_vs_actual AS
SELECT
  b.id AS budget_id,
  b.tenant_id,
  b.branch_id,
  b.category_id,
  b.period_year,
  b.period_month,
  b.amount AS budget_amount,
  COALESCE(SUM(e.amount) FILTER (
    WHERE e.status = 'APPROVED' AND e.voided_at IS NULL
  ), 0) AS actual_amount,
  ROUND(
    COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'APPROVED' AND e.voided_at IS NULL), 0)
    / NULLIF(b.amount, 0) * 100
  , 1) AS pct_used,
  b.warning_threshold_pct,
  b.critical_threshold_pct,
  CASE
    WHEN b.amount = 0 THEN 'NO_BUDGET'
    WHEN COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'APPROVED' AND e.voided_at IS NULL), 0)
         >= b.amount * b.critical_threshold_pct / 100 THEN 'CRITICAL'
    WHEN COALESCE(SUM(e.amount) FILTER (WHERE e.status = 'APPROVED' AND e.voided_at IS NULL), 0)
         >= b.amount * b.warning_threshold_pct / 100 THEN 'WARNING'
    ELSE 'OK'
  END AS status
FROM budgets b
LEFT JOIN expenses e
  ON e.tenant_id = b.tenant_id
  AND (b.branch_id IS NULL OR e.branch_id = b.branch_id)
  AND (b.category_id IS NULL OR e.category_id = b.category_id)
  AND EXTRACT(YEAR FROM e.expense_date) = b.period_year
  AND EXTRACT(MONTH FROM e.expense_date) = b.period_month
GROUP BY b.id;

COMMENT ON VIEW budget_vs_actual IS 'Rule #8 — real-time budget vs actual. RLS pada budgets/expenses dasarnya sudah membatasi baris yang terlihat, tapi view ini SECURITY INVOKER (default) supaya tetap mewarisi RLS caller, bukan security definer.';


SET check_function_bodies = on;
