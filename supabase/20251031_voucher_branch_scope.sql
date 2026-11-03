-- =====================================================
-- MIGRASI: Branch-scoped Vouchers (Many-to-Many)
-- =====================================================

-- 1) Buat tabel relasi voucher <-> cabang
CREATE TABLE IF NOT EXISTS public.voucher_branches (
  voucher_id UUID NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  branch_id  UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (voucher_id, branch_id)
);

-- 2) Index biar validasi per cabang lebih cepat
CREATE INDEX IF NOT EXISTS idx_voucher_branches_voucher_id ON public.voucher_branches(voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_branches_branch_id  ON public.voucher_branches(branch_id);

-- 3) RLS
ALTER TABLE public.voucher_branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS \"voucher_branches_select_tenant_scoped\" ON public.voucher_branches;
DROP POLICY IF EXISTS \"voucher_branches_manage_owner_manager\" ON public.voucher_branches;

CREATE POLICY \"voucher_branches_select_tenant_scoped\" ON public.voucher_branches
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.vouchers v
      JOIN public.profiles p ON p.tenant_id = v.tenant_id
      WHERE v.id = voucher_branches.voucher_id
        AND p.id = auth.uid()
    )
  );

CREATE POLICY \"voucher_branches_manage_owner_manager\" ON public.voucher_branches
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.vouchers v
      JOIN public.profiles p ON p.tenant_id = v.tenant_id
      WHERE v.id = voucher_branches.voucher_id
        AND p.id = auth.uid()
        AND p.role IN ('owner','manager','super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vouchers v
      JOIN public.profiles p ON p.tenant_id = v.tenant_id
      WHERE v.id = voucher_branches.voucher_id
        AND p.id = auth.uid()
        AND p.role IN ('owner','manager','super_admin')
    )
  );

-- 4) Helper function buat cek berlaku di cabang tertentu
CREATE OR REPLACE FUNCTION public.is_voucher_valid_for_branch(p_voucher_id UUID, p_branch_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.voucher_branches WHERE voucher_id = p_voucher_id) THEN
    RETURN TRUE;
  END IF;

  IF EXISTS (SELECT 1 FROM public.voucher_branches WHERE voucher_id = p_voucher_id AND branch_id = p_branch_id) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
\$\$;

GRANT EXECUTE ON FUNCTION public.is_voucher_valid_for_branch(UUID, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
