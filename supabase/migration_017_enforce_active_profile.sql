-- =========================================================
-- MIGRASI 017 — Tegakkan `profiles.is_active` di level database
-- (2 bagian, digabung dalam 1 file supaya tidak terlalu banyak file
-- migrasi terpisah untuk perubahan yang saling terkait ini).
--
-- BAGIAN 1: current_tenant_id() & is_super_admin() ikut cek is_active.
-- BAGIAN 2: kuota Free Trial cuma hitung karyawan yang masih aktif.
-- =========================================================

-- =========================================================
-- BAGIAN 1 — Tegakkan `profiles.is_active` di level database.
--
-- LATAR BELAKANG (temuan audit): tombol "Nonaktifkan" karyawan sebelumnya
-- hanya mengubah UI (middleware.ts + app/pos/layout.tsx +
-- app/dashboard/layout.tsx menolak NAVIGASI HALAMAN untuk akun nonaktif).
-- Tapi middleware.ts sengaja mengecualikan path /api/* dari matcher-nya
-- (supaya API routes bisa mengelola auth-nya sendiri), dan HAMPIR SEMUA
-- row-level security policy di seluruh database (products, transactions,
-- shifts, memberships, dst) bergantung pada current_tenant_id() — yang
-- SEBELUM migrasi ini cuma mencocokkan tenant_id, TIDAK PERNAH mengecek
-- is_active. Akibatnya: selama token sesi browser milik akun yang
-- dinonaktifkan belum benar-benar kedaluwarsa/dihapus, akun itu masih
-- bisa memanggil /api/* atau Supabase REST/RPC langsung (lewat console
-- browser, script, atau tab lama yang belum di-reload) dan tetap lolos
-- RLS sepenuhnya.
--
-- PERBAIKAN: current_tenant_id() sekarang mengembalikan NULL untuk akun
-- yang is_active = false. Karena SEMUA policy di bawah ini berbentuk
-- `tenant_id = current_tenant_id()`, begitu fungsi ini balas NULL maka
-- TIDAK ADA baris yang bisa cocok (NULL = NULL tidak pernah TRUE di SQL) —
-- baik untuk SELECT/UPDATE/DELETE (USING) maupun INSERT (WITH CHECK).
-- Ini satu titik perubahan yang otomatis menutup akses di SEMUA tabel yang
-- memakai current_tenant_id(), tanpa perlu menulis ulang tiap policy satu
-- per satu.
--
-- is_super_admin() ikut dijaga dengan cara yang sama, supaya akun
-- super_admin yang (secara teori) dinonaktifkan juga tidak bisa memakai
-- hak bypass-nya lagi.
--
-- AMAN dijalankan berkali-kali (CREATE OR REPLACE).
-- =========================================================

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin' AND is_active = true
  );
$$;

-- Catatan verifikasi manual setelah migrasi ini di-apply:
--   1. Nonaktifkan akun test dari /dashboard/employees.
--   2. Tanpa logout, coba panggil endpoint apa pun (mis. lewat DevTools
--      Network tab, ulangi request checkout/tambah-menu yang sebelumnya
--      berhasil) — sekarang harus gagal dengan error RLS/permission,
--      bukan lagi berhasil diam-diam.
--   3. Aktifkan kembali akun itu, pastikan akses normal pulih seperti
--      semula (memastikan migrasi ini tidak mengunci akun aktif biasa).

-- =========================================================
-- BAGIAN 2 — Karyawan nonaktif tidak lagi memakan kuota Free Trial.
--
-- LATAR BELAKANG: trigger enforce_cashier_limit() menghitung SEMUA baris
-- profiles dengan role cashier/manager, termasuk yang sudah is_active =
-- false. Akibatnya Owner paket Free Trial yang sudah pernah punya 2
-- karyawan — walau salah satunya sudah dinonaktifkan (mis. resign) —
-- tidak pernah bisa menambah karyawan baru lagi tanpa upgrade paket,
-- padahal karyawan nonaktif itu sudah tidak "memakai slot" sama sekali
-- (sejak Bagian 1 di atas, akun nonaktif kehilangan akses total).
--
-- PERBAIKAN: hitung cuma baris yang is_active = true. Konsisten dengan
-- perubahan tampilan "X/2 karyawan aktif" di app/dashboard/employees/page.tsx.
--
-- AMAN dijalankan berkali-kali (CREATE OR REPLACE), tidak mengubah data
-- apa pun — cuma logika pengecekan di trigger.
-- =========================================================

CREATE OR REPLACE FUNCTION enforce_cashier_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Limit "2 karyawan tambahan" berlaku untuk role cashier MAUPUN manager
  -- — keduanya dihitung sebagai "karyawan tambahan" di luar owner.
  IF NEW.role NOT IN ('cashier', 'manager') THEN
    RETURN NEW;
  END IF;

  IF tenant_tier(NEW.tenant_id) = 'free' THEN
    SELECT COUNT(*) INTO v_count FROM profiles
      WHERE tenant_id = NEW.tenant_id AND role IN ('cashier', 'manager') AND is_active = true;
    IF v_count >= 2 THEN
      RAISE EXCEPTION 'FREE_TIER_CASHIER_LIMIT: Paket Free Trial maksimal 2 akun karyawan aktif (kasir/manager). Nonaktifkan karyawan lama atau upgrade ke Pro untuk tambah karyawan.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
