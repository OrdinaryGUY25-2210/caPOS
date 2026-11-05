-- =====================================================================
-- Audit export — setiap unduhan laporan tercatat (siapa, kapan, mode,
-- periode, cabang). Jalankan MANUAL di Supabase SQL Editor, paling akhir.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.export_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  branch_id   uuid,
  user_id     uuid NOT NULL,
  mode        text NOT NULL CHECK (mode IN ('ringkasan','laba','semua_data','omzet_excel','omzet_csv')),
  period_from timestamptz NOT NULL,
  period_to   timestamptz NOT NULL,
  row_count   integer,
  file_name   text,
  unmasked    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_logs_tenant_created ON public.export_logs (tenant_id, created_at DESC);

ALTER TABLE public.export_logs ENABLE ROW LEVEL SECURITY;

-- Hanya owner/manager yang boleh MEMBACA log; penulisan hanya lewat log_export().
DROP POLICY IF EXISTS export_logs_select ON public.export_logs;
CREATE POLICY export_logs_select ON public.export_logs
  FOR SELECT USING (tenant_id = public.current_tenant_id() AND public.is_manager_or_owner());

-- Log export. SECURITY DEFINER agar klien tidak butuh hak INSERT langsung;
-- user_id & tenant_id SELALU diambil dari sesi, bukan dari argumen.
-- Free Trial tidak bisa mencatat export PDF (dan memang tidak bisa mengekspor).
CREATE OR REPLACE FUNCTION public.log_export(
  p_mode      text,
  p_branch_id uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_row_count integer DEFAULT NULL,
  p_file_name text    DEFAULT NULL,
  p_unmasked  boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_id     uuid;
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;
  IF p_mode NOT IN ('omzet_csv') AND COALESCE(tenant_tier(v_tenant), 'free') = 'free' AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'EXPORT_PDF_TIER: Free Trial tidak dapat mengekspor laporan PDF/Excel lengkap' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = p_branch_id AND b.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'BRANCH_NOT_IN_TENANT' USING ERRCODE = '42501';
  END IF;

  INSERT INTO export_logs (tenant_id, branch_id, user_id, mode, period_from, period_to, row_count, file_name, unmasked)
  VALUES (v_tenant, p_branch_id, auth.uid(), p_mode, p_from, p_to, p_row_count, left(p_file_name, 200),
          COALESCE(p_unmasked, false) AND (is_owner() OR is_super_admin()))
  RETURNING id INTO v_id;

  -- Jejak yang sama ke audit_log umum agar muncul di tampilan audit yang sudah ada.
  INSERT INTO audit_log (tenant_id, branch_id, user_id, action, entity_type, entity_id, new_value, reason)
  VALUES (v_tenant, p_branch_id, auth.uid(), 'EXPORT', 'export_logs', v_id,
          jsonb_build_object('mode', p_mode, 'from', p_from, 'to', p_to, 'rows', p_row_count, 'file', p_file_name),
          'Export laporan');

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_export(text, uuid, timestamptz, timestamptz, integer, text, boolean) TO authenticated;
