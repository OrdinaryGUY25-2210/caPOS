-- =========================================================
-- MIGRASI 7a — WAJIB DIJALANKAN SENDIRI (klik Run untuk file ini SAJA,
-- jangan digabung dengan query lain dalam satu klik Run).
--
-- PostgreSQL tidak mengizinkan menambah nilai enum baru dan LANGSUNG
-- memakainya dalam transaksi/batch query yang sama — kalau digabung
-- dengan migrasi_007b, akan muncul error "unsafe use of new value of
-- enum type". Jalankan file ini dulu sampai sukses, BARU lanjut ke
-- migration_007b_manager_features.sql.
-- =========================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'manager';
