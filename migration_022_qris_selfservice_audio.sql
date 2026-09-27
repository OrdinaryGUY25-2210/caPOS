-- =========================================================
-- MIGRATION 022 — QRIS Self-Service (mode Dinamis/Statis) & Storage Audio
-- Notifikasi, sesuai PRD "Pengaturan QRIS Self-Service & Storage Audio
-- Notifikasi CaPOS".
--
-- CATATAN PENTING sebelum menjalankan ini: separuh isi migrasi ini bukan
-- fitur baru dari PRD, tapi MEMPERBAIKI fitur "QRIS Dinamis (Kasir)" yang
-- sudah ada di kode (app/dashboard/qris-dinamis, app/pos/page.tsx,
-- app/api/midtrans/notification, app/api/pos/qris-status) tapi ternyata
-- tidak pernah bisa jalan sama sekali karena:
--   1. Tabel `pos_qris_payments` yang dipakai semua file itu TIDAK ADA
--      di migrasi manapun.
--   2. Kolom `branches.midtrans_server_key` / `midtrans_client_key` /
--      `midtrans_is_production` yang dibaca webhook & halaman kasir juga
--      TIDAK ADA.
--   3. Endpoint yang membuat kode QRIS-nya sendiri, app/api/pos/qris-charge,
--      belum pernah dibuat (dicek: tidak ada file route.ts-nya) — jadi
--      tombol "Buat Kode QRIS Dinamis" di kasir pasti gagal (404). Ini
--      dibuatkan filenya terpisah (lihat app/api/pos/qris-charge/route.ts).
-- Tanpa bagian 1 & 2 migrasi ini, fitur baru dari PRD (yang justru
-- MEMBUTUHKAN pos_qris_payments & branches.midtrans_*) tidak akan bisa
-- disimpan sama sekali. Aman dijalankan berkali-kali.
-- =========================================================

-- ---------------------------------------------------------
-- BAGIAN 1 — kolom baru di `branches` (PRD menyebutnya "per store", dan
-- di caPOS satu "store" = satu baris `branches`, karena Midtrans key
-- SUDAH didesain per-cabang di kode yang ada, bukan per-tenant: tiap
-- cabang bisa punya akun Midtrans sendiri-sendiri).
-- ---------------------------------------------------------
ALTER TABLE branches
  -- Kredensial Midtrans BYOK (Bring Your Own Key) milik owner — bagian
  -- INI yang sebelumnya dibaca kode tapi tidak pernah ada tempat
  -- menyimpannya sama sekali.
  ADD COLUMN IF NOT EXISTS midtrans_server_key TEXT,
  ADD COLUMN IF NOT EXISTS midtrans_client_key TEXT,
  ADD COLUMN IF NOT EXISTS midtrans_is_production BOOLEAN NOT NULL DEFAULT false,
  -- PRD §4A — toggle mutually-exclusive. DEFAULT 'DYNAMIC' supaya tenant
  -- yang sudah pakai QRIS Dinamis lewat kode lama (sebelum toggle ini
  -- ada) tidak tiba-tiba berubah perilaku begitu migrasi ini jalan.
  ADD COLUMN IF NOT EXISTS qris_mode TEXT NOT NULL DEFAULT 'DYNAMIC' CHECK (qris_mode IN ('DYNAMIC', 'STATIC')),
  -- URL publik gambar QRIS statis toko. Disimpan sebagai URL (bukan path
  -- mentah) supaya konsisten dengan `tenants` tidak punya kolom gambar
  -- lain yang mentah juga — file-nya sendiri diunggah ke bucket Storage
  -- "menu-images" yang SUDAH ADA & dipakai untuk logo kafe (lihat
  -- components/menu/ProductForm.tsx), path `${tenant_id}/qris-code.jpg`,
  -- supaya tidak perlu bikin bucket baru sama sekali.
  ADD COLUMN IF NOT EXISTS static_qris_image_url TEXT,
  -- PRD §4C — pengaturan Storage Audio Notifikasi.
  ADD COLUMN IF NOT EXISTS sound_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sound_tone TEXT NOT NULL DEFAULT 'bell_chime',
  ADD COLUMN IF NOT EXISTS sound_volume NUMERIC(3, 2) NOT NULL DEFAULT 0.8 CHECK (sound_volume >= 0 AND sound_volume <= 1);

COMMENT ON COLUMN branches.midtrans_server_key IS 'Secret key Midtrans Core API milik cabang ini (BYOK). Kolom ini SENGAJA tidak diberi GRANT SELECT ke authenticated/anon di bawah — hanya service-role (API routes) yang bisa membacanya. Client hanya boleh tahu SUDAH/BELUM diisi lewat app/api/branches/[id]/qris-settings (GET), tidak pernah membaca nilainya.';
COMMENT ON COLUMN branches.qris_mode IS 'PRD: DYNAMIC = QRIS Midtrans otomatis (butuh midtrans_server_key & client_key terisi). STATIC = gambar QRIS toko (butuh static_qris_image_url terisi). Mutually exclusive — divalidasi di app/dashboard/settings/payment, bukan di DB, supaya pesan errornya bisa ramah (bukan constraint violation mentah).';

-- ---------------------------------------------------------
-- BAGIAN 2 — tabel pos_qris_payments (REKONSTRUKSI, bukan fitur baru).
-- Kolom & tipe diturunkan dari cara tabel ini dipakai di:
--   app/dashboard/qris-dinamis/page.tsx   (SELECT id, order_id,
--     gross_amount, status, created_at, branches(name))
--   app/api/midtrans/notification/route.ts (SELECT/UPDATE id, branch_id,
--     status, raw_response)
--   app/api/pos/qris-status/[orderId]/route.ts (SELECT status, branch_id,
--     tenant_id, order_id, created_at; UPDATE status, raw_response)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_qris_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  order_id TEXT UNIQUE NOT NULL,        -- "POS-<uuid>" (lib/midtransCore.ts POS_QRIS_ORDER_PREFIX), order_id yang dikirim ke Midtrans
  gross_amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  raw_response JSONB,                   -- payload notifikasi/status terakhir dari Midtrans (audit/debug)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_qris_payments_tenant_branch ON pos_qris_payments (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_qris_payments_order_id ON pos_qris_payments (order_id);

ALTER TABLE pos_qris_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PosQrisPayments: read scoped" ON pos_qris_payments;
-- Sama seperti pola yang sudah dipakai di seluruh app: owner/super_admin
-- lihat semua cabang, manager/kasir cuma cabang penugasannya sendiri.
-- TIDAK ada policy INSERT/UPDATE/DELETE untuk authenticated/anon sama
-- sekali — satu-satunya jalur tulis adalah service-role (webhook Midtrans
-- & endpoint qris-charge/qris-status), sama persis seperti tabel
-- `payments` (migration_003) untuk alasan yang sama: kalau user biasa
-- bisa UPDATE status='paid' sendiri, itu artinya bisa "bayar" tanpa
-- transfer uang beneran.
CREATE POLICY "PosQrisPayments: read scoped" ON pos_qris_payments
  FOR SELECT USING (
    is_super_admin()
    OR (tenant_id = current_tenant_id() AND (is_owner() OR branch_id = current_branch_id()))
  );

-- ---------------------------------------------------------
-- BAGIAN 3 — tutup celah yang sama seperti migration_021 (profiles):
-- kolom rahasia tidak boleh terbaca lewat REST API langsung meski baris-
-- nya "boleh disentuh" secara RLS, karena RLS itu row-level bukan
-- column-level. `branches` sebelumnya principal-nya "semua anggota
-- tenant boleh SELECT baris cabangnya" (lihat migration_011) — itu tetap
-- benar untuk kolom biasa (nama, alamat, dst.), tapi TIDAK untuk secret
-- key Midtrans: kasir tidak perlu, dan tidak boleh, bisa membaca server
-- key toko lewat panggilan REST biasa.
-- ---------------------------------------------------------
REVOKE SELECT (midtrans_server_key) ON branches FROM authenticated, anon;

-- ---------------------------------------------------------
-- BAGIAN 4 — get_qr_order_page (dipakai halaman publik self-order
-- /order/[branch]/[table]) diperbarui supaya mengirim `qris_mode`
-- eksplisit ke client, MENGGANTIKAN heuristik lama "kalau ada file
-- statis di Storage berarti mode statis" di app/order/[branch]/[table]/
-- page.tsx. Kolom lain & isi function tetap sama seperti migration_014,
-- cuma menambah satu field di object 'branch'.
-- ---------------------------------------------------------
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
      'name', v_branch.name, 'slug', v_branch.slug, 'address', v_branch.address,
      'tenant_id', v_branch.tenant_id,
      -- BARU (migration_022) — lihat komentar di atas function ini.
      'qris_mode', v_branch.qris_mode,
      -- BARU (migration_022) juga — sumber kebenaran tunggal untuk URL
      -- gambar QRIS statis, ditulis oleh /dashboard/settings/payment.
      -- Menggantikan pengecekan storage.list() di page.tsx yang punya bug
      -- laten: hardcode ".jpg" walau ProductForm & halaman upload QRIS
      -- statis yang baru sama-sama bisa menyimpan ".png" juga.
      'static_qris_image_url', v_branch.static_qris_image_url,
      -- Bukan rahasia (beda dari midtrans_server_key) — aman dikirim ke
      -- anon, dipakai SelfOrderClient.tsx untuk bunyi notifikasi PRD §4C
      -- begitu QRIS Dinamis pelanggan sendiri terkonfirmasi lunas.
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
  'migration_022: sama seperti migration_014 + field branch.qris_mode, dipakai app/order/[branch]/[table]/page.tsx untuk memilih mode QRIS statis/dinamis secara eksplisit (menggantikan heuristik lama berbasis ada/tidaknya file di Storage).';
