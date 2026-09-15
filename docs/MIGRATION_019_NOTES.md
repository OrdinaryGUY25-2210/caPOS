# Migrasi 019 — Ringkasan Implementasi

Fitur: **Supervisor PIN Authorization**, **Stock Reversal on Void/Refund**,
**Table Lifecycle & Actions**, **Split Bill**.

## 1. Cara deploy

1. Jalankan `supabase/migration_019_pin_stockreversal_tables_splitbill.sql`
   di SQL Editor Supabase (atau `supabase db push` kalau pakai CLI) —
   **setelah** migration_018. File ini 100% additif (`ALTER TABLE ... ADD
   COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION/VIEW`), aman
   dijalankan di database yang sudah berisi data produksi.
2. Deploy ulang aplikasi Next.js seperti biasa (tidak ada perubahan env
   var baru).
3. Setiap Manager/Owner/Super Admin **wajib set PIN mereka sendiri**
   sebelum fitur otorisasi berfungsi untuk kasir di bawahnya — belum ada
   halaman UI untuk ini di scope pekerjaan ini, set manual lewat SQL
   editor atau panggil RPC dari console:
   ```sql
   select set_supervisor_pin('123456'); -- dijalankan sebagai user manager/owner yang login
   ```
   (Idealnya ditambahkan tombol "Set PIN Supervisor" di halaman profil —
   lihat bagian "Belum dikerjakan" di bawah.)

## 2. Objek database baru/berubah

Lihat komentar penutup di `migration_019_pin_stockreversal_tables_splitbill.sql`
untuk daftar lengkap. Ringkasnya:

- **PIN**: `profiles.pin_hash`, `set_supervisor_pin()`, `verify_supervisor_pin()`,
  `require_supervisor_authorization()` (gerbang internal, dipanggil dari
  `void_order_item`, `cancel_order`, `apply_manual_discount`, `override_item_price`).
- **Stock reversal**: `revert_recipe_stock()`, `transaction_items.restored_qty`,
  `refunds.stock_restored*`.
- **Table lifecycle**: `branch_tables.bill_printed_at`, `mark_bill_printed()`,
  `merge_table_orders()`, view `table_live_status` (+status `BILL_PRINTED`).
- **Split Bill**: `order_items.split_billed_qty`, `checkout_order_split_by_item()`,
  `transactions.split_group_label`, `transaction_payments.split_group_label`.

## 3. Komponen & halaman yang diubah/ditambah

| File | Perubahan |
|---|---|
| `components/SupervisorPinModal.tsx` | **Baru.** Modal PIN reusable, verifikasi instan + alasan. |
| `components/pos/SplitBillModal.tsx` | **Baru.** Split by Amount & Split by Item. |
| `components/pos/RefundModal.tsx` | Toggle "Restore Stock to Inventory" (submit & saat approve manager), tombol restore manual di riwayat refund. |
| `components/pos/OpenBillPanel.tsx` | Void/Cancel/Diskon Manual/Price Override lewat gerbang PIN; tombol Cetak Bill, Pindah Meja, Gabung Meja, Split Bill. |
| `components/tables/TableStatusBoard.tsx` | Dari papan status read-only jadi actionable: tap meja untuk Cetak Bill/Pindah/Gabung/Selesai Bersih. |
| `components/pos/TablePicker.tsx` | Dukungan status `BILL_PRINTED` (style, label, klik). |
| `app/api/tables/move/route.ts` | **Baru.** Wrapper HTTP untuk `move_table_order`. |
| `app/api/tables/merge/route.ts` | **Baru.** Wrapper HTTP untuk `merge_table_orders`. |
| `lib/types.ts` | Tipe baru: `SensitiveAction`, `SupervisorAuthResult`, `SplitByItemGroup`, field baru di `OrderItem`/`Order`/`Refund`/`TableLiveStatus`. |
| `app/pos/page.tsx` | Meneruskan prop `role` ke `OpenBillPanel`. |

## 4. Keputusan desain penting

- **PIN tidak bisa dilewati dari client.** `require_supervisor_authorization()`
  ditanam di DALAM RPC void/cancel/discount/override itu sendiri (bukan cuma
  dicek di UI) — memanggil RPC langsung tanpa PIN tetap ditolak untuk role
  kasir.
- **Manager/Owner/Super Admin tidak perlu PIN** untuk tindakan mereka sendiri
  (mereka sudah py wewenang itu) — modal PIN otomatis dilewati di
  `OpenBillPanel`, cukup isi alasan.
- **Split by Amount** memakai ulang `checkout_order_v2` yang sudah ada
  (banyak baris `p_payments`) — tidak perlu RPC baru, cuma UI pembagi +
  label kosmetik struk. **Split by Item** perlu RPC baru
  (`checkout_order_split_by_item`) karena tiap sub-bill adalah transaksi
  terpisah untuk sebagian item order yang sama.
- **Stock reversal mendukung 2 model stok sekaligus** (resep/`branch_ingredients_stock`
  dan produk sederhana/`branch_stock`) karena `consume_recipe()` yang sudah
  ada di migration_015 belum disambungkan ke `checkout_order_v2` — begitu
  disambungkan nanti, reversal-nya sudah siap tanpa migrasi susulan.

## 5. Belum dikerjakan (di luar scope brief, disebutkan untuk transparansi)

- Halaman UI "Set PIN Supervisor" di Pengaturan/Profil (RPC-nya sudah ada:
  `set_supervisor_pin`).
- Riwayat/laporan Audit Log khusus (tabel `audit_log` sudah menampung semua
  kejadian PIN/void/cancel/discount/override/merge/split, tinggal dibuatkan
  halaman baca di Dashboard kalau dibutuhkan).
