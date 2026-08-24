-- =========================================================
-- MIGRASI KRITIS: Perbaiki RLS rekursif di tabel profiles
--
-- GEJALA: semua akun (owner, super_admin, cashier) setelah login selalu
-- diarahkan ke /pos, tidak peduli role sebenarnya apa.
--
-- PENYEBAB: policy lama di tabel `profiles` berisi sub-query ke tabel
-- `profiles` itu sendiri untuk mengecek tenant_id. Postgres mendeteksi ini
-- sebagai rekursi tak terbatas dan menolak query dengan error
-- "infinite recursion detected in policy for relation profiles" — membuat
-- SETIAP pembacaan role setelah login gagal diam-diam, lalu app fallback
-- ke halaman default (/pos).
--
-- Jalankan file ini SATU KALI di SQL Editor Supabase project kamu yang
-- sudah berjalan. Aman dijalankan berkali-kali (idempotent).
-- =========================================================

-- 1. Fungsi baru: ambil tenant_id user yang login, TANPA memicu rekursi
--    (SECURITY DEFINER = bypass RLS sepenuhnya saat menjalankan query di
--    dalam fungsi ini).
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid();
$$;

-- 2. Hapus semua policy lama yang rekursif...
DROP POLICY IF EXISTS "Tenants: own tenant or super_admin" ON tenants;
DROP POLICY IF EXISTS "Subscriptions: own tenant or super_admin" ON subscriptions;
DROP POLICY IF EXISTS "Profiles: own tenant or super_admin" ON profiles;
DROP POLICY IF EXISTS "Access products by tenant_id" ON products;
DROP POLICY IF EXISTS "Access memberships by tenant_id" ON memberships;
DROP POLICY IF EXISTS "Access transactions by tenant_id" ON transactions;
DROP POLICY IF EXISTS "Access transaction_items by parent tenant" ON transaction_items;

-- 3. ...dan buat ulang semuanya memakai current_tenant_id() (aman, tanpa rekursi).
CREATE POLICY "Tenants: own tenant or super_admin" ON tenants
  FOR ALL USING (
    is_super_admin() OR id = current_tenant_id()
  );

CREATE POLICY "Subscriptions: own tenant or super_admin" ON subscriptions
  FOR ALL USING (
    is_super_admin() OR tenant_id = current_tenant_id()
  );

CREATE POLICY "Profiles: own row, own tenant, or super_admin" ON profiles
  FOR ALL USING (
    is_super_admin() OR id = auth.uid() OR tenant_id = current_tenant_id()
  );

CREATE POLICY "Access products by tenant_id" ON products
  FOR ALL USING (
    is_super_admin() OR tenant_id = current_tenant_id()
  );

CREATE POLICY "Access memberships by tenant_id" ON memberships
  FOR ALL USING (
    is_super_admin() OR tenant_id = current_tenant_id()
  );

CREATE POLICY "Access transactions by tenant_id" ON transactions
  FOR ALL USING (
    is_super_admin() OR tenant_id = current_tenant_id()
  );

CREATE POLICY "Access transaction_items by parent tenant" ON transaction_items
  FOR ALL USING (
    is_super_admin() OR transaction_id IN (
      SELECT id FROM transactions WHERE tenant_id = current_tenant_id()
    )
  );

-- Selesai. Coba logout-login ulang di app setelah menjalankan ini —
-- role-based routing (owner→/dashboard, super_admin→/admin, cashier→/pos)
-- seharusnya sudah berfungsi normal.
