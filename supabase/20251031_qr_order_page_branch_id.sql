-- =====================================================
-- MIGRASI: get_qr_order_page mengirim branch.id
-- =====================================================
-- Halaman publik QR Self-Order (/order/[branch]/[table]) perlu tahu uuid
-- cabang supaya bisa meneruskan `branchId` ke SelfOrderClient — dipakai
-- untuk validasi voucher per cabang (lihat 20251031_voucher_branch_scope.sql).
--
-- Isi function identik dengan migration_022, hanya MENAMBAH satu field
-- `id` di object `branch`. Aman dijalankan berulang (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION get_qr_order_page(p_branch_slug TEXT, p_table_number TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_branch branches%ROWTYPE;
  v_table branch_tables%ROWTYPE;
  v_result JSONB;
BEGIN
  SELECT * INTO v_branch FROM branches WHERE slug = p_branch_slug AND is_active = true;
  IF v_branch.id IS NULL THEN
    RETURN jsonb_build_object('error', 'branch_not_found');
  END IF;

  SELECT * INTO v_table FROM branch_tables
    WHERE branch_id = v_branch.id AND table_number = p_table_number AND is_active = true;
  IF v_table.id IS NULL THEN
    RETURN jsonb_build_object('error', 'table_not_found');
  END IF;

  SELECT jsonb_build_object(
    'branch', jsonb_build_object(
      -- BARU (migration_023) — uuid cabang untuk validasi voucher per cabang.
      'id', v_branch.id,
      'name', v_branch.name, 'slug', v_branch.slug, 'address', v_branch.address,
      'tenant_id', v_branch.tenant_id,
      'qris_mode', v_branch.qris_mode,
      'static_qris_image_url', v_branch.static_qris_image_url,
      'sound_enabled', v_branch.sound_enabled,
      'sound_tone', v_branch.sound_tone,
      'sound_volume', v_branch.sound_volume
    ),
    'table', jsonb_build_object('id', v_table.id, 'table_number', v_table.table_number, 'capacity', v_table.capacity),
    'products', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', p.id, 'name', p.name, 'price', p.price,
          'category', COALESCE(p.category, 'Lainnya'), 'image_url', p.image_url
        )
        ORDER BY p.category NULLS LAST, p.name
      )
      FROM products p WHERE p.tenant_id = v_branch.tenant_id AND p.is_available = true
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_qr_order_page(TEXT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION get_qr_order_page IS
  'migration_023: sama seperti migration_022 + field branch.id, dipakai app/order/[branch]/[table]/page.tsx untuk meneruskan branchId ke SelfOrderClient (validasi voucher per cabang).';

NOTIFY pgrst, 'reload schema';
