-- =========================================================
-- migration_020 — Watermark struk khusus Supreme + Menu per cabang
-- Jalankan SEKALI di Supabase SQL Editor. Aman diulang (IF NOT EXISTS).
-- Tidak mengubah fungsi checkout yang sudah ada.
-- =========================================================

-- ---------- A. Hilangkan watermark "powered by caPOS" (khusus Supreme) ----------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS receipt_hide_branding BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.receipt_hide_branding IS
  'true = sembunyikan baris "powered by caPOS — Studio D13" di struk. Hanya boleh diaktifkan tenant Supreme (ditegakkan trigger enforce_hide_branding_supreme).';

CREATE OR REPLACE FUNCTION enforce_hide_branding_supreme()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.receipt_hide_branding IS TRUE
     AND (TG_OP = 'INSERT' OR OLD.receipt_hide_branding IS DISTINCT FROM NEW.receipt_hide_branding) THEN
    -- super_admin boleh; selain itu tenant harus Supreme.
    IF NOT is_super_admin() AND COALESCE(tenant_tier(NEW.id), 'free') <> 'supreme' THEN
      RAISE EXCEPTION 'Menghilangkan watermark caPOS hanya tersedia untuk paket Supreme.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_hide_branding_supreme ON tenants;
CREATE TRIGGER trg_enforce_hide_branding_supreme
  BEFORE INSERT OR UPDATE OF receipt_hide_branding ON tenants
  FOR EACH ROW EXECUTE FUNCTION enforce_hide_branding_supreme();

-- ---------- B. Menu per cabang (cabang tertentu tidak menjual menu tertentu) ----------
-- Aturan: TIDAK ada baris = menu dijual di cabang itu (perilaku lama tidak berubah).
-- Baris dengan is_available = false = menu TIDAK dijual di cabang itu.
CREATE TABLE IF NOT EXISTS branch_product_availability (
  tenant_id    UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  branch_id    UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  is_available BOOLEAN NOT NULL DEFAULT true,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_bpa_tenant_branch ON branch_product_availability (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_bpa_product ON branch_product_availability (product_id);

ALTER TABLE branch_product_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "BPA: tenant view" ON branch_product_availability;
CREATE POLICY "BPA: tenant view" ON branch_product_availability
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "BPA: manager/owner scoped write" ON branch_product_availability;
CREATE POLICY "BPA: manager/owner scoped write" ON branch_product_availability
  USING (
    tenant_id = current_tenant_id()
    AND is_manager_or_owner()
    AND (is_owner() OR branch_id = current_branch_id())
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND is_manager_or_owner()
    AND (is_owner() OR branch_id = current_branch_id())
  );

-- Jaring pengaman server: transaksi/order untuk menu yang dimatikan di cabang
-- itu ditolak, walau layar kasir lama masih menyimpan menunya.
CREATE OR REPLACE FUNCTION enforce_branch_product_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch UUID;
  v_name   TEXT;
BEGIN
  IF TG_TABLE_NAME = 'transaction_items' THEN
    SELECT branch_id INTO v_branch FROM transactions WHERE id = NEW.transaction_id;
  ELSE
    SELECT branch_id INTO v_branch FROM orders WHERE id = NEW.order_id;
  END IF;

  IF v_branch IS NOT NULL AND NEW.product_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM branch_product_availability a
    WHERE a.branch_id = v_branch AND a.product_id = NEW.product_id AND a.is_available = false
  ) THEN
    SELECT name INTO v_name FROM products WHERE id = NEW.product_id;
    RAISE EXCEPTION 'Menu "%" tidak dijual di cabang ini.', COALESCE(v_name, 'ini');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bpa_transaction_items ON transaction_items;
CREATE TRIGGER trg_bpa_transaction_items
  BEFORE INSERT ON transaction_items
  FOR EACH ROW EXECUTE FUNCTION enforce_branch_product_availability();

DROP TRIGGER IF EXISTS trg_bpa_order_items ON order_items;
CREATE TRIGGER trg_bpa_order_items
  BEFORE INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION enforce_branch_product_availability();
