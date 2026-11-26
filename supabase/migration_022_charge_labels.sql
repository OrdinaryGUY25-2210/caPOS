-- =========================================================
-- migration_022 — Nama biaya service & pajak bisa diubah (mis. "PPN", "PB1")
-- Jalankan SEKALI di Supabase SQL Editor (setelah migration_021). Aman diulang.
-- Hanya menambah 2 kolom teks; tidak mengubah perhitungan.
-- =========================================================
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS service_label TEXT NOT NULL DEFAULT 'Service'
    CHECK (char_length(btrim(service_label)) BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS tax_label TEXT NOT NULL DEFAULT 'Pajak'
    CHECK (char_length(btrim(tax_label)) BETWEEN 1 AND 30);
