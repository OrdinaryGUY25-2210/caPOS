-- =========================================================
-- caPOS — Skema Database Supabase (PostgreSQL)
-- Jalankan file ini di Supabase SQL Editor secara berurutan.
-- =========================================================

CREATE TYPE user_role AS ENUM ('super_admin', 'owner', 'manager', 'cashier');
CREATE TYPE sub_status AS ENUM ('trial', 'active', 'past_due', 'expired');

CREATE SEQUENCE member_seq START 1;

-- 1. Tenants (Kafe/Bisnis)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  has_custom_website BOOLEAN DEFAULT false,
  custom_website_url TEXT,
  show_wifi_on_receipt BOOLEAN DEFAULT false,
  wifi_ssid TEXT,
  wifi_password TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Subscriptions
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  status sub_status DEFAULT 'trial',
  plan TEXT,  -- 'monthly' | 'yearly' | NULL (trial/belum pernah bayar) — dipakai untuk gating Laporan Dasar vs Lengkap
  trial_ends_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '28 days'),
  valid_until TIMESTAMPTZ DEFAULT (now() + INTERVAL '28 days'),
  referred_by_code TEXT,                    -- kode referral yang dipakai saat daftar (kalau ada)
  pending_signup_discount_pct NUMERIC DEFAULT 0, -- 2% pendaftar baru, dikonsumsi di pembayaran pertama
  super_trial_ends_at TIMESTAMPTZ,          -- diisi kalau daftar pakai kode Super Admin (now()+5 hari)
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Kode referral permanen 1:1 per tenant, plus log siapa memakai kode siapa.
CREATE TABLE referrals (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  accumulated_uses INT NOT NULL DEFAULT 0, -- 0-5, tiap +1 = +3% (maks 15%)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE referral_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  referrer_tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  referred_tenant_id UUID UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  reward_granted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  role user_role DEFAULT 'cashier',
  job_title TEXT,          -- label jabatan bebas (mis. "Barista", "Kasir Utama") — beda dari `role` yang menentukan hak akses sistem
  full_name TEXT,
  email TEXT,             -- disalin dari auth.users saat akun dibuat, biar
                           -- daftar karyawan bisa ditampilkan tanpa perlu admin API
  is_active BOOLEAN DEFAULT true, -- nonaktifkan akun karyawan tanpa menghapusnya
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Products
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  category TEXT,
  image_url TEXT,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Memberships
CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  -- Kode diberi akhiran acak (bukan hanya nomor urut 0001, 0002, ...) supaya
  -- tidak bisa ditebak/dienumerasi berurutan di kolom "Kode Member / Scan QR"
  -- pada /pos untuk mencuri diskon member orang lain.
  member_code TEXT UNIQUE DEFAULT (
    'MBR-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('member_seq')::text, 4, '0') || '-' ||
    upper(substr(md5(gen_random_uuid()::text), 1, 4))
  ),
  discount_percentage NUMERIC DEFAULT 10,
  valid_until TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6.5 Shifts — sesi kerja kasir, dipakai untuk mengaitkan tiap transaksi
-- ke "siapa yang jaga saat itu" (riwayat transaksi & laporan shift).
CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  cashier_id UUID REFERENCES profiles(id),
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' -- 'open' | 'closed'
);

-- 6.6 Attendance — pengajuan izin/sakit/cuti karyawan, ditinjau Manager/Owner.
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- 'izin' | 'sakit' | 'cuti'
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6.7 Approval Requests — antrean persetujuan untuk mencegah kecurangan:
-- kasir yang menambah menu baru atau mengubah harga TIDAK langsung
-- mengubah tabel `products`, melainkan masuk sini dulu sampai disetujui
-- Manager/Owner. `payload` menyimpan data yang diusulkan (fleksibel per
-- jenis permintaan), `target_id` dipakai kalau ini usulan ubah data yang
-- sudah ada (mis. price_change ke produk tertentu).
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES profiles(id),
  type TEXT NOT NULL,            -- 'new_menu' | 'price_change'
  target_id UUID,                -- product id kalau type = 'price_change'
  payload JSONB NOT NULL,        -- data yang diusulkan, mis. {"name":"Kopi Baru","price":20000,"category":"Kopi"}
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Transactions
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  cashier_id UUID REFERENCES profiles(id),
  shift_id UUID REFERENCES shifts(id),
  invoice_number TEXT NOT NULL,
  total_amount NUMERIC NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  member_id UUID REFERENCES memberships(id),
  is_offline_sync BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Transaction Items
CREATE TABLE transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  qty INT NOT NULL,
  subtotal NUMERIC NOT NULL
);

-- VIEW ANALYTICS GRAFIK
-- security_invoker = true (butuh Postgres 15+ / Supabase terbaru) memastikan
-- view ini berjalan dengan hak akses PEMANGGIL (bukan pemilik view), sehingga
-- RLS pada tabel `transactions` tetap berlaku dan tidak membocorkan omzet
-- tenant lain. Tanpa opsi ini, view Postgres berjalan sebagai owner dan
-- BYPASS RLS secara default — ini celah data-leak yang mudah terlewat.
CREATE OR REPLACE VIEW daily_sales_analytics
WITH (security_invoker = true) AS
SELECT
  tenant_id,
  DATE(created_at) as sale_date,
  COUNT(id) as total_orders,
  SUM(total_amount) as total_revenue
FROM transactions
GROUP BY tenant_id, DATE(created_at);

-- =========================================================
-- FUNGSI: Buka Shift Kasir (kalau belum ada yang 'open' untuk kasir ini)
-- =========================================================
CREATE OR REPLACE FUNCTION open_shift(p_tenant_id UUID, p_cashier_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shift_id UUID;
BEGIN
  SELECT id INTO v_shift_id FROM shifts
    WHERE tenant_id = p_tenant_id AND cashier_id = p_cashier_id AND status = 'open'
    LIMIT 1;

  IF v_shift_id IS NULL THEN
    INSERT INTO shifts (tenant_id, cashier_id, status)
      VALUES (p_tenant_id, p_cashier_id, 'open')
      RETURNING id INTO v_shift_id;
  END IF;

  RETURN v_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION checkout_transaction(
  p_tenant_id UUID,
  p_cashier_id UUID,
  p_invoice_number TEXT,
  p_payment_method TEXT,
  p_member_code TEXT,
  p_items JSONB -- [{ "product_id": "...", "qty": 2 }, ...]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_product products%ROWTYPE;
  v_qty INT;
  v_subtotal NUMERIC := 0;
  v_discount_pct NUMERIC := 0;
  v_member_id UUID := NULL;
  v_total NUMERIC;
  v_tx_id UUID;
  v_shift_id UUID;
BEGIN
  -- Kasir yang memanggil harus benar-benar tergabung di tenant tsb.
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Akses ditolak: bukan anggota tenant ini';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang kosong';
  END IF;

  -- Setiap transaksi otomatis dikaitkan ke shift yang sedang berjalan
  -- untuk kasir ini (dibuka otomatis kalau belum ada) — supaya riwayat
  -- transaksi bisa ditelusuri "terjadi di shift siapa".
  v_shift_id := open_shift(p_tenant_id, p_cashier_id);

  -- Validasi ulang member & diskon di server (jangan percaya diskon dari client)
  IF p_member_code IS NOT NULL AND p_member_code <> '' THEN
    SELECT id, discount_percentage INTO v_member_id, v_discount_pct
    FROM memberships
    WHERE tenant_id = p_tenant_id
      AND member_code = p_member_code
      AND is_active = true
      AND valid_until > now();
    IF v_member_id IS NULL THEN
      RAISE EXCEPTION 'Kode member tidak valid atau kedaluwarsa';
    END IF;
  END IF;

  v_tx_id := gen_random_uuid();

  -- Hitung subtotal dari harga PRODUK DI DATABASE, bukan dari payload client
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::INT;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 500 THEN
      RAISE EXCEPTION 'Qty item tidak valid';
    END IF;

    SELECT * INTO v_product FROM products
      WHERE id = (v_item->>'product_id')::UUID
        AND tenant_id = p_tenant_id
        AND is_available = true;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Produk tidak ditemukan atau tidak tersedia';
    END IF;

    v_subtotal := v_subtotal + (v_product.price * v_qty);

    INSERT INTO transaction_items (transaction_id, product_id, qty, subtotal)
      VALUES (v_tx_id, v_product.id, v_qty, v_product.price * v_qty);
  END LOOP;

  v_total := round(v_subtotal * (1 - v_discount_pct / 100));

  INSERT INTO transactions (
    id, tenant_id, cashier_id, invoice_number, total_amount,
    payment_method, member_id, is_offline_sync, shift_id
  ) VALUES (
    v_tx_id, p_tenant_id, p_cashier_id, p_invoice_number, v_total,
    p_payment_method, v_member_id, false, v_shift_id
  );

  RETURN v_tx_id;
END;
$$;

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

-- Helper: super_admin bypasses every policy below (Content Bypass requirement)
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'
  );
$$;

-- Helper: manager DIPERLAKUKAN SAMA seperti owner untuk hampir semua akses
-- dashboard — bedanya cuma manager tidak bisa akses /admin (itu murni
-- super_admin) dan tidak bisa hapus tenant-nya sendiri dari pengaturan.
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

-- Helper: ambil tenant_id milik user yang sedang login.
--
-- PENTING — kenapa ini harus jadi fungsi SECURITY DEFINER, bukan sub-query
-- biasa: sebelumnya setiap policy (termasuk policy tabel `profiles` SENDIRI)
-- ditulis dengan sub-query langsung ke tabel profiles, contoh:
--   tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())
-- Ketika Postgres mengevaluasi policy tabel `profiles`, sub-query di atas
-- ikut menyentuh tabel `profiles` lagi — yang berarti RLS `profiles` harus
-- dievaluasi ulang untuk mengevaluasi dirinya sendiri. Ini memicu error
-- "infinite recursion detected in policy for relation profiles" di
-- Postgres, yang membuat SETIAP query ke profiles (termasuk saat login
-- untuk mengecek role) gagal total dan diam-diam mengembalikan error
-- (bukan data) — akibatnya app selalu fallback ke role default (`cashier`
-- → /pos) walau akun yang login sebenarnya owner/super_admin.
--
-- Fungsi SECURITY DEFINER berjalan dengan hak akses pemilik fungsi
-- (bypass RLS sepenuhnya, sama seperti is_super_admin() di atas), jadi
-- tidak ada rekursi — query di dalam fungsi ini tidak pernah mengevaluasi
-- ulang policy manapun.
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid();
$$;

CREATE POLICY "Tenants: own tenant or super_admin" ON tenants
  FOR ALL USING (
    is_super_admin() OR id = current_tenant_id()
  );

CREATE POLICY "Subscriptions: own tenant or super_admin" ON subscriptions
  FOR ALL USING (
    is_super_admin() OR tenant_id = current_tenant_id()
  );

-- `id = auth.uid()` ditambahkan sebagai jalur langsung (tanpa fungsi/
-- sub-query apa pun) supaya seorang user SELALU bisa baca baris profilnya
-- sendiri walau ada masalah lain — ini jalur paling sederhana dan aman
-- yang tidak mungkin memicu rekursi.
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

-- =========================================================
-- INDEKS PERFORMA
-- Query utama di aplikasi selalu difilter per tenant_id atau per tanggal
-- (laporan omzet). Tanpa indeks ini, Postgres melakukan sequential scan
-- pada tabel transactions/products begitu data bertambah banyak.
-- =========================================================
CREATE INDEX idx_products_tenant_category ON products (tenant_id, category) WHERE is_available = true;
CREATE INDEX idx_transactions_tenant_created ON transactions (tenant_id, created_at DESC);
CREATE INDEX idx_transaction_items_tx ON transaction_items (transaction_id);
CREATE INDEX idx_memberships_tenant_code ON memberships (tenant_id, member_code) WHERE is_active = true;
CREATE INDEX idx_profiles_tenant ON profiles (tenant_id);

-- =========================================================
-- PAYMENTS — riwayat transaksi Midtrans untuk perpanjangan langganan
-- =========================================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  order_id TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  discount_pct NUMERIC DEFAULT 0, -- diskon referral yang dipakai di transaksi ini
  status TEXT NOT NULL DEFAULT 'pending',
  raw_response JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Hanya boleh dibaca (bukan ditulis) dari client — status pembayaran cuma
-- boleh berubah lewat webhook /api/midtrans/notification pakai service
-- role setelah verifikasi signature, supaya tidak ada yang bisa "bayar"
-- cuma dengan UPDATE langsung dari browser.
CREATE POLICY "Payments: read own tenant" ON payments
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

CREATE INDEX idx_payments_tenant ON payments (tenant_id, created_at DESC);
CREATE INDEX idx_payments_order_id ON payments (order_id);

-- =========================================================
-- SHIFTS — RLS
-- =========================================================
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Shifts: own tenant or super_admin" ON shifts
  FOR ALL USING (is_super_admin() OR tenant_id = current_tenant_id());

-- =========================================================
-- ATTENDANCE (Kehadiran/Izin) — RLS
-- Karyawan (siapa saja di tenant) boleh baca & buat pengajuan miliknya
-- sendiri; hanya Manager/Owner yang boleh UPDATE (approve/reject).
-- =========================================================
CREATE POLICY "Attendance: view own tenant" ON attendance
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

CREATE POLICY "Attendance: create own request" ON attendance
  FOR INSERT WITH CHECK (
    tenant_id = current_tenant_id()
    AND (employee_id = auth.uid() OR is_manager_or_owner())
  );

CREATE POLICY "Attendance: manager/owner review" ON attendance
  FOR UPDATE USING (
    is_super_admin() OR (tenant_id = current_tenant_id() AND is_manager_or_owner())
  );

CREATE INDEX idx_attendance_tenant_status ON attendance (tenant_id, status);

-- =========================================================
-- APPROVAL REQUESTS — RLS
-- Siapa saja di tenant boleh buat pengajuan & lihat daftar pengajuan
-- tenant-nya (supaya kasir bisa lihat status pengajuannya sendiri), tapi
-- hanya Manager/Owner yang boleh UPDATE (approve/reject).
-- =========================================================
CREATE POLICY "Approval requests: view own tenant" ON approval_requests
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

CREATE POLICY "Approval requests: create own request" ON approval_requests
  FOR INSERT WITH CHECK (
    tenant_id = current_tenant_id() AND requested_by = auth.uid()
  );

CREATE POLICY "Approval requests: manager/owner review" ON approval_requests
  FOR UPDATE USING (
    is_super_admin() OR (tenant_id = current_tenant_id() AND is_manager_or_owner())
  );

CREATE INDEX idx_approval_requests_tenant_status ON approval_requests (tenant_id, status);

-- Daftarkan ke publication realtime supaya NotificationBell.tsx bisa
-- menerima event perubahan tanpa polling.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'approval_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE approval_requests;
  END IF;
END $$;

CREATE INDEX idx_shifts_tenant_status ON shifts (tenant_id, cashier_id, status);
CREATE INDEX idx_transactions_shift ON transactions (shift_id);

-- =========================================================
-- FUNGSI TIER — sumber kebenaran tunggal "tenant ini di tier apa"
-- 'free'    = trial ATAU expired/past_due (belum/tidak lagi bayar)
-- 'pro'     = active + plan monthly
-- 'supreme' = active + plan yearly
-- =========================================================
CREATE OR REPLACE FUNCTION tenant_tier(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN super_trial_ends_at IS NOT NULL AND super_trial_ends_at > now() THEN 'supreme'
    WHEN status = 'active' AND plan = 'yearly' THEN 'supreme'
    WHEN status = 'active' AND plan = 'monthly' THEN 'pro'
    ELSE 'free'
  END
  FROM subscriptions WHERE tenant_id = p_tenant_id;
$$;

-- =========================================================
-- ENFORCE LIMIT TIER FREE — lewat trigger database, bukan cuma di
-- frontend. Trigger jalan APA PUN caranya insert dilakukan (browser,
-- /api/cashiers pakai service role, dll) — service role bypass RLS
-- tapi TIDAK bypass trigger.
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
      WHERE tenant_id = NEW.tenant_id AND role IN ('cashier', 'manager');
    IF v_count >= 2 THEN
      RAISE EXCEPTION 'FREE_TIER_CASHIER_LIMIT: Paket Free Trial maksimal 2 akun karyawan tambahan (kasir/manager). Upgrade ke Pro untuk tambah karyawan.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_cashier_limit
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_cashier_limit();

CREATE OR REPLACE FUNCTION enforce_menu_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  IF tenant_tier(NEW.tenant_id) = 'free' THEN
    SELECT COUNT(*) INTO v_count FROM products WHERE tenant_id = NEW.tenant_id;
    IF v_count >= 10 THEN
      RAISE EXCEPTION 'FREE_TIER_MENU_LIMIT: Paket Free Trial maksimal 10 menu. Upgrade ke Pro untuk menu unlimited.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_menu_limit
  BEFORE INSERT ON products
  FOR EACH ROW EXECUTE FUNCTION enforce_menu_limit();

-- =========================================================
-- VIEW ANALITIK DATA ASLI — dipakai halaman /dashboard menggantikan
-- data contoh (demo) yang sebelumnya hardcode. security_invoker = true
-- supaya RLS transactions/transaction_items tetap berlaku.
-- =========================================================
CREATE OR REPLACE VIEW peak_hours_analytics
WITH (security_invoker = true) AS
SELECT
  tenant_id,
  EXTRACT(HOUR FROM created_at)::INT AS hour_of_day,
  COUNT(*) AS total_orders
FROM transactions
GROUP BY tenant_id, EXTRACT(HOUR FROM created_at);

CREATE OR REPLACE VIEW best_seller_analytics
WITH (security_invoker = true) AS
SELECT
  t.tenant_id,
  p.name AS product_name,
  SUM(ti.qty) AS total_qty
FROM transaction_items ti
JOIN transactions t ON t.id = ti.transaction_id
JOIN products p ON p.id = ti.product_id
GROUP BY t.tenant_id, p.name;

-- =========================================================
-- FUNGSI: Setujui/Tolak Approval Request
--
-- Perubahan sesungguhnya ke tabel `products` HANYA terjadi lewat fungsi
-- ini setelah Manager/Owner approve — mencegah kasir langsung menulis ke
-- `products` sendiri (yang akan membuka celah kecurangan: kasir bisa
-- naikkan/turunkan harga seenaknya tanpa sepengetahuan atasan).
-- =========================================================
CREATE OR REPLACE FUNCTION review_approval_request(p_request_id UUID, p_approve BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req approval_requests%ROWTYPE;
BEGIN
  -- Hanya manager/owner (atau super_admin) tenant yang sama yang boleh
  -- memutuskan — dicek di sini juga (bukan cuma RLS) supaya fungsi ini
  -- tetap aman dipanggil dari mana pun.
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

-- =========================================================
-- REFERRALS — RLS
-- Semua PENULISAN hanya lewat service role (server) — tidak ada policy
-- INSERT/UPDATE untuk client biasa, supaya angka diskon tidak bisa
-- dimanipulasi langsung dari browser.
-- =========================================================
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Referrals: own tenant or super_admin" ON referrals
  FOR SELECT USING (is_super_admin() OR tenant_id = current_tenant_id());

CREATE POLICY "Referral redemptions: view own" ON referral_redemptions
  FOR SELECT USING (
    is_super_admin()
    OR referrer_tenant_id = current_tenant_id()
    OR referred_tenant_id = current_tenant_id()
  );

CREATE INDEX idx_referral_redemptions_referrer ON referral_redemptions (referrer_tenant_id, reward_granted);

-- =========================================================
-- FUNGSI: Redeem kode referral saat registrasi
-- =========================================================
CREATE OR REPLACE FUNCTION redeem_referral_code(p_code TEXT, p_new_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_referrer_tenant_id UUID;
BEGIN
  SELECT tenant_id INTO v_referrer_tenant_id FROM referrals WHERE code = p_code FOR UPDATE;

  IF v_referrer_tenant_id IS NULL THEN
    RETURN 'invalid';
  END IF;

  IF v_referrer_tenant_id = p_new_tenant_id THEN
    RETURN 'invalid';
  END IF;

  INSERT INTO referral_redemptions (code, referrer_tenant_id, referred_tenant_id)
    VALUES (p_code, v_referrer_tenant_id, p_new_tenant_id);

  RETURN 'referrer';
END;
$$;

-- =========================================================
-- FUNGSI: Proses reward referral setelah pembayaran pertama sukses.
-- Reset akumulasi diskon tenant TERJADI SETIAP KALI dia top up, berapa
-- pun akumulasinya saat itu — TIDAK perlu menunggu penuh 5/5.
-- =========================================================
CREATE OR REPLACE FUNCTION process_referral_on_payment(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE referrals r
  SET accumulated_uses = LEAST(r.accumulated_uses + 1, 5)
  FROM referral_redemptions rr
  WHERE rr.referred_tenant_id = p_tenant_id
    AND rr.reward_granted = false
    AND r.tenant_id = rr.referrer_tenant_id;

  UPDATE referral_redemptions
  SET reward_granted = true
  WHERE referred_tenant_id = p_tenant_id AND reward_granted = false;

  UPDATE referrals SET accumulated_uses = 0 WHERE tenant_id = p_tenant_id;

  UPDATE subscriptions SET pending_signup_discount_pct = 0 WHERE tenant_id = p_tenant_id;
END;
$$;
