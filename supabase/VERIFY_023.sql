-- ============================================================
-- VERIFY_023.sql
--
-- Jalankan file pendek ini di Supabase -> SQL Editor untuk melihat apakah
-- migration_023_cash_integrity.sql SUDAH masuk. File ini HANYA membaca,
-- tidak mengubah apa pun, dan aman dijalankan kapan saja.
--
-- Target hasil:
--   kolom_transaksi     = 5
--   tabel_dedupe        = midtrans_webhook_events
--   jumlah_rpc          = 5
--   client_boleh_insert = false
--   ada_tabel_ledger    = true
-- ============================================================

SELECT
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
  has_table_privilege('authenticated','public.transactions','INSERT') AS client_boleh_insert,
  to_regclass('public.capos_migrations') IS NOT NULL AS ada_tabel_ledger;

-- Kalau ada_tabel_ledger = true, jalankan ini untuk melihat kapan 023
-- terakhir sukses (baris '023_cash_integrity'):
--
--   select * from capos_migrations order by applied_at;
