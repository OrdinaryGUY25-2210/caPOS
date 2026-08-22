-- =========================================================
-- caPOS — Skema Database Supabase (PostgreSQL)
-- Jalankan file ini di Supabase SQL Editor secara berurutan.
-- =========================================================

CREATE TYPE user_role AS ENUM ('super_admin', 'owner', 'cashier');
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
  trial_ends_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '28 days'),
  valid_until TIMESTAMPTZ DEFAULT (now() + INTERVAL '28 days'),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  role user_role DEFAULT 'cashier',
  full_name TEXT,
  email TEXT,             -- disalin dari auth.users saat akun dibuat, biar
                           -- daftar kasir bisa ditampilkan tanpa perlu admin API
  is_active BOOLEAN DEFAULT true, -- nonaktifkan akun kasir tanpa menghapusnya
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Invite Codes (Sistem Pembatasan Registrasi Max 100)
CREATE TABLE invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  max_uses INT DEFAULT 1,       -- Set 100 untuk Promo Konten Trial
  used_count INT DEFAULT 0,     -- Auto-increment setiap ada registrasi
  is_active BOOLEAN DEFAULT true,
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

-- 7. Transactions
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  cashier_id UUID REFERENCES profiles(id),
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
-- FUNGSI: Redeem Invite Code (Atomic, Anti Race-Condition)
-- Dipanggil dari /app/api/register/route.ts via supabase.rpc()
-- Return: 'OK' jika berhasil, 'QUOTA_FULL' jika kuota penuh,
--         NULL jika kode tidak ditemukan / tidak aktif.
--
-- SET search_path = '' mencegah "search_path hijacking": tanpa baris ini,
-- fungsi SECURITY DEFINER bisa dikelabui memanggil fungsi/tabel bernama
-- sama yang sengaja dibuat di schema lain oleh pengguna jahat, lalu
-- dieksekusi dengan hak akses pemilik fungsi (superuser-like).
-- =========================================================
CREATE OR REPLACE FUNCTION redeem_invite_code(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row invite_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM invite_codes
    WHERE code = p_code AND is_active = true
    FOR UPDATE; -- row lock mencegah race condition saat trafik tinggi

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_row.used_count >= v_row.max_uses THEN
    RETURN 'QUOTA_FULL';
  END IF;

  UPDATE invite_codes
    SET used_count = used_count + 1,
        is_active = (used_count + 1) < max_uses
    WHERE id = v_row.id;

  RETURN 'OK';
END;
$$;

-- =========================================================
-- FUNGSI: Checkout Transaksi (Total dihitung di SERVER, bukan client)
-- Klien HANYA mengirim daftar product_id + qty. Harga diambil ulang dari
-- tabel `products` dan diskon member divalidasi ulang di sini, sehingga
-- request yang dimodifikasi (mis. lewat DevTools/Burp Suite untuk mengubah
-- total_amount) tidak bisa mengubah nilai transaksi yang tersimpan.
-- =========================================================
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
    payment_method, member_id, is_offline_sync
  ) VALUES (
    v_tx_id, p_tenant_id, p_cashier_id, p_invoice_number, v_total,
    p_payment_method, v_member_id, false
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

-- invite_codes: TIDAK BOLEH terbaca oleh anon/authenticated biasa — kode ini
-- adalah "kunci" pendaftaran. Sebelumnya tabel ini TIDAK diberi RLS sama
-- sekali, artinya siapa pun yang punya anon key bisa SELECT * FROM
-- invite_codes langsung lewat REST API Supabase dan melihat/menebak semua
-- kode aktif. Redeem tetap lewat redeem_invite_code() (service role di
-- server), sementara hanya super_admin yang boleh melihat/mengelola lewat
-- dashboard admin.
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Invite codes: super_admin only" ON invite_codes
  FOR ALL USING (is_super_admin());

CREATE POLICY "Tenants: own tenant or super_admin" ON tenants
  FOR ALL USING (
    is_super_admin() OR id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Subscriptions: own tenant or super_admin" ON subscriptions
  FOR ALL USING (
    is_super_admin() OR tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Profiles: own tenant or super_admin" ON profiles
  FOR ALL USING (
    is_super_admin() OR tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Access products by tenant_id" ON products
  FOR ALL USING (
    is_super_admin() OR tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Access memberships by tenant_id" ON memberships
  FOR ALL USING (
    is_super_admin() OR tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Access transactions by tenant_id" ON transactions
  FOR ALL USING (
    is_super_admin() OR tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Access transaction_items by parent tenant" ON transaction_items
  FOR ALL USING (
    is_super_admin() OR transaction_id IN (
      SELECT id FROM transactions WHERE tenant_id IN (
        SELECT tenant_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

-- =========================================================
-- SEED: Kode akses awal untuk demo/testing
-- =========================================================
INSERT INTO invite_codes (code, max_uses) VALUES ('CAPOSVIRAL', 100);
INSERT INTO invite_codes (code, max_uses) VALUES ('DEMOSTUDIOD13', 1);

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
