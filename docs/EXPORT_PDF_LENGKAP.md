# Export PDF Lengkap & Perbaikan HPP per Cabang (4 Nov 2026)

Implementasi dari `RENCANA_PERBAIKAN_CAPOS_DAN_EXPORT_PDF`.

## Aturan produk (keputusan pemilik)

| Halaman | Isi export | Free Trial | Pro | Supreme |
|---|---|---|---|---|
| **Laporan & Omzet** (`/dashboard`) | Hanya laporan keuangan + omzet (CSV, Excel, PDF keuangan). Tidak ada lagi sheet Jam Ramai / Menu Terlaris. | CSV saja. **Tanpa PDF.** | CSV, Excel, PDF keuangan | sama |
| **Laporan PDF** (`/dashboard/laporan-pdf`, sebelumnya "Laporan PDF Otomatis") | Ringkasan, Hanya Keuntungan, Semua Data (omzet, kerugian/susut, stok, purchasing, pelanggan, tim, analitik) | **Terkunci total** | Semua mode, riwayat 30 hari | Semua mode, riwayat tanpa batas |

Free Trial ditolak di dua lapis: UI (`PremiumFeatureLock` + tombol tersembunyi) **dan** server (`assert_export_allowed()` di database).

## Urutan menjalankan migrasi (manual, Supabase SQL Editor)

1. `supabase/20251104_product_branch_cost.sql`
2. `supabase/20251104_hpp_snapshot.sql`
3. `supabase/20251104_profit_report_rpc.sql`
4. `supabase/20251104_full_export_rpc.sql`
5. `supabase/20251104_export_audit.sql`

Plus dua migrasi lama yang masih menunggu: `20251031_voucher_branch_scope.sql` dan `20251031_qr_order_page_branch_id.sql`.
Tidak ada dependency baru — cukup `npm install` seperti biasa.

Kalau migrasi belum dijalankan, halaman menampilkan pesan jelas (bukan error mentah) dan halaman Stok memakai perilaku lama.

## Pekerjaan per Work Package

| WP | Status | Catatan |
|---|---|---|
| WP-01 snapshot HPP | Selesai | Trigger `BEFORE INSERT` di `transaction_items` — mencakup semua jalur checkout tanpa mengubah fungsi checkout. HPP per porsi = biaya resep / yield. Data lama tetap `NULL` → ditandai estimasi. |
| WP-02 HPP per cabang | Selesai | Tabel `product_branch_cost` + `get_product_cost()`. Halaman Stok menulis override cabang (HPP 0 = kembali ke default). |
| WP-03 preview & konsolidasi | Selesai | Resep kirim `p_branch_id`; Stok & Bahan menjumlahkan nilai per cabang. |
| WP-04 label cabang | Selesai | Kolom Cabang di CSV/Excel, nama file memuat cabang, sheet Rekap per Cabang. |
| WP-05 filter cabang analitik | Selesai | Profitabilitas, Jam Sibuk, Kerugian Barang, Menu Engineering. Catatan: view `product_profitability` masih memakai `products.cost_price`. |
| WP-06 tier & limit | Selesai untuk export | Satu sumber di `lib/tier.ts`; batas 30 hari Pro ditegakkan di RPC. Halaman Riwayat Transaksi belum diubah. |
| WP-07 metrik tunggal | Sebagian | `lib/metrics.ts` + `get_profit_report()` dipakai oleh semua export/PDF. Kartu KPI di layar `/dashboard` masih membaca view `daily_sales_analytics`. |
| WP-08 NewMenuWizard | Selesai | Mengirim `p_stock_mode`; fallback otomatis ke signature lama bila database memakai `p_image_url`. |
| WP-09 dataset besar | Selesai untuk export | Pagination lewat `get_export_table`; tidak ada `.limit(10000)` lagi. Data besar diunduh sebagai **PDF ringkas + satu file Excel** (satu sheet per tabel + sheet Manifest). Export async (>200.000 baris) **belum ada** — data dipotong di batas tier dan ditandai di sheet Manifest. |
| WP-10 label "Otomatis" | Selesai | Diganti "Laporan PDF" (sidebar, tur, halaman, tabel paket). Scheduler/email tetap belum ada. |

## Definisi metrik

- Omzet = Σ `transactions.total_amount`
- Laba Kotor = Omzet − Refund (status `COMPLETED`) − HPP
- Laba Bersih = Laba Kotor − Susut (opname + waste) − Komisi channel − OPEX (`expenses` status `APPROVED`)
- Refund dikurangkan sebagai baris tersendiri karena tabel `refunds` tidak mengubah `transactions`.

## Keamanan & PII

Tidak pernah diexport: `profiles.pin_hash`, `pin_updated_at`, kunci Midtrans, `payments.raw_response`, `auth.users`, `tenants.wifi_password`.
Dimask default: telepon, email pelanggan, rekening pemasok (Owner bisa membuka dengan konfirmasi, tercatat). Semua RPC `SECURITY INVOKER` + RLS; hanya Owner/Manager/Super Admin. Setiap export tercatat di `export_logs` dan `audit_log`.

## Yang sudah diuji

- Migrasi dijalankan di PostgreSQL 16 lokal di atas `supabase/schema.sql` repo (dengan stub `auth.uid()`): snapshot HPP beda per cabang, override cabang, HPP lama tidak berubah saat default diubah, laba per cabang, penolakan Free/Kasir/rentang >30 hari, penyamaran data, `pin_hash` tidak keluar, tabel di luar daftar ditolak, audit tercatat.
- `tsc --noEmit` dan `next build` lolos. Ketiga mode PDF dirender di Node dan diperiksa visual.
- **Belum diuji** terhadap Supabase asli (schema.sql di repo bisa lebih tua dari database produksi) dan pengunduhan Excel di browser.
