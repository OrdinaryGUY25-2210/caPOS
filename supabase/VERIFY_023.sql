-- ============================================================
-- VERIFY_023.sql
--
-- Jalankan file pendek ini di Supabase -> SQL Editor untuk melihat apakah
-- migration_023_cash_integrity.sql SUDAH masuk. File ini hanya membaca,
-- tidak mengubah apa pun.
--
-- Target hasil:
--   ledger_023          = 1
--   kolom_transaksi     = 5
--   tabel_dedupe        = midtrans_webhook_events
--   jumlah_rpc          = 5
--   client_boleh_insert = false
-- ============================================================

SELECT
  (SELECT count(*) FROM capos_migrations WHERE version = '023_cash_integrity') AS ledger_023,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions'
      AND column_name IN ('cash_received','change_amount','change_status',
                          'change_due_at','idempotency_key')) AS kolom_transaksi,
  to_regclass('public.midtrans_webhook_events') AS tabel_dedupe,
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('checkout_transaction','shift_cash_summary',
                        'confirm_change','write_off_change',
                        'record_cash_tender')) AS jumlah_rpc,
  has_table_privilege('authenticated','public.transactions','INSERT') AS client_boleh_insert;

-- Kalau `capos_migrations` belum ada, query di atas akan error
-- "relation capos_migrations does not exist" -> artinya 023 belum pernah
-- sukses dijalankan. Pakai query cadangan berikut (tanpa ledger):
--
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='transactions'
--       and column_name in ('cash_received','change_amount','change_status',
--                           'change_due_at','idempotency_key')) as kolom_transaksi,
--   to_regclass('public.midtrans_webhook_events') as tabel_dedupe,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname in
--       ('checkout_transaction','shift_cash_summary','confirm_change',
--        'write_off_change','record_cash_tender')) as jumlah_rpc,
--   has_table_privilege('authenticated','public.transactions','INSERT') as client_boleh_insert;
