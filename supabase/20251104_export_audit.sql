-- ============================================================================
-- 20251104_export_audit.sql
-- Audit trail setiap export laporan (siapa, kapan, mode, periode, cabang).
-- Jalankan setelah migrasi HPP. Idempoten.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.export_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid,
  user_id uuid,
  mode text NOT NULL CHECK (mode IN ('ringkasan', 'profit', 'full')),
  period_start date,
  period_end date,
  row_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'FAILED')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_logs_tenant_created
  ON public.export_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_export_logs_branch
  ON public.export_logs (branch_id);

ALTER TABLE public.export_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "export_logs: insert own tenant" ON public.export_logs;
CREATE POLICY "export_logs: insert own tenant"
ON public.export_logs
FOR INSERT
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.is_manager_or_owner()
);

DROP POLICY IF EXISTS "export_logs: read own tenant" ON public.export_logs;
CREATE POLICY "export_logs: read own tenant"
ON public.export_logs
FOR SELECT
USING (
  public.is_super_admin()
  OR (
    tenant_id = public.current_tenant_id()
    AND public.is_manager_or_owner()
  )
);

GRANT SELECT, INSERT ON public.export_logs TO authenticated;

COMMENT ON TABLE public.export_logs IS
  'Jejak audit export laporan caPOS (mode ringkasan/profit/full). Tidak menyimpan isi laporan, hanya metadata.';
