-- =========================================================
-- MIGRASI 7b — jalankan SETELAH migration_007a_add_manager_role.sql
-- sukses dijalankan (perlu commit terpisah). Aman dijalankan berkali-kali.
-- =========================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS job_title TEXT;

CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES profiles(id),
  type TEXT NOT NULL,
  target_id UUID,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_manager_or_owner()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'manager')
  );
$$;

DROP POLICY IF EXISTS "Attendance: view own tenant" ON attendance;
CREATE POLICY "Attendance: view own tenant" ON attendance
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "Attendance: create own request" ON attendance;
CREATE POLICY "Attendance: create own request" ON attendance
  FOR INSERT WITH CHECK (
    tenant_id = current_tenant_id()
    AND (employee_id = auth.uid() OR is_manager_or_owner())
  );

DROP POLICY IF EXISTS "Attendance: manager/owner review" ON attendance;
CREATE POLICY "Attendance: manager/owner review" ON attendance
  FOR UPDATE USING (is_super_admin() OR (tenant_id = current_tenant_id() AND is_manager_or_owner()));

CREATE INDEX IF NOT EXISTS idx_attendance_tenant_status ON attendance (tenant_id, status);

DROP POLICY IF EXISTS "Approval requests: view own tenant" ON approval_requests;
CREATE POLICY "Approval requests: view own tenant" ON approval_requests
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "Approval requests: create own request" ON approval_requests;
CREATE POLICY "Approval requests: create own request" ON approval_requests
  FOR INSERT WITH CHECK (tenant_id = current_tenant_id() AND requested_by = auth.uid());

DROP POLICY IF EXISTS "Approval requests: manager/owner review" ON approval_requests;
CREATE POLICY "Approval requests: manager/owner review" ON approval_requests
  FOR UPDATE USING (is_super_admin() OR (tenant_id = current_tenant_id() AND is_manager_or_owner()));

CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant_status ON approval_requests (tenant_id, status);

-- Daftarkan tabel ini ke publication realtime Supabase — tanpa ini,
-- NotificationBell.tsx tidak akan menerima event apa pun walau
-- subscribe-nya sukses (silent, tidak ada error yang kelihatan).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'approval_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE approval_requests;
  END IF;
END $$;

-- Perbarui enforce_cashier_limit supaya menghitung role manager JUGA
-- (bukan cuma cashier) untuk limit "2 karyawan tambahan" tier Free.
CREATE OR REPLACE FUNCTION enforce_cashier_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  IF NEW.role NOT IN ('cashier', 'manager') THEN
    RETURN NEW;
  END IF;

  IF tenant_tier(NEW.tenant_id) = 'free' THEN
    SELECT COUNT(*) INTO v_count FROM profiles
      WHERE tenant_id = NEW.tenant_id AND role IN ('cashier', 'manager');
    IF v_count >= 2 THEN
      RAISE EXCEPTION 'FREE_TIER_CASHIER_LIMIT: Paket Free Trial maksimal 2 akun karyawan tambahan (kasir/manager). Upgrade ke Pro untuk tambah karyawan.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION review_approval_request(p_request_id UUID, p_approve BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
