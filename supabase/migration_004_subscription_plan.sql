-- =========================================================
-- MIGRASI: tambah kolom `plan` di subscriptions
-- Dipakai untuk membedakan fitur "Laporan Dasar" (trial/paket Bulanan)
-- vs "Laporan Lengkap" (paket Tahunan) di halaman /dashboard.
-- Aman dijalankan berkali-kali.
-- =========================================================

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan TEXT;

-- plan diisi otomatis oleh webhook Midtrans (app/api/midtrans/notification)
-- begitu pembayaran 'paid' — nilainya 'monthly' atau 'yearly', sesuai kunci
-- di lib/midtransPlans.ts. NULL berarti masih trial / belum pernah bayar.
