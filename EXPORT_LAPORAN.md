# Laporan & Export caPOS — Panduan Lengkap

Dokumen ini menjelaskan dua jalur export yang **sengaja dipisah** agar tidak tumpang tindih:

| Halaman | Menu sidebar | Isi export |
|---|---|---|
| `/dashboard` | **Laporan & Omzet** | Hanya **laporan keuangan + omzet** (ringkasan, laba/rugi, omzet harian, rekap per cabang). |
| `/dashboard/laporan-pdf` | **Laporan & Export** | Laporan **lengkap**: omzet, HPP, laba, **kerugian**, menu, stok, purchasing, pelanggan, tim, analitik. |

---

## 1. Laporan & Omzet (`/dashboard`)

Export di halaman ini **tidak** memuat data menu, stok, purchasing, atau analitik.
Tujuannya: pemilik kafe bisa mengunduh angka keuangan tanpa file besar.

- **Export CSV** — rekap omzet harian (semua paket).
- **Export Excel** — untuk paket Pro/Supreme:
  - `Ringkasan` — omzet, transaksi, AOV, dan (bila RPC laporan laba tersedia) HPP, laba kotor, kerugian, komisi, laba bersih.
  - `Laporan Keuangan` — rincian laba/rugi periode 7 hari.
  - `Omzet Harian` — per tanggal; pada mode konsolidasi ada kolom cabang.
  - `Rekap per Cabang` — hanya muncul saat "Semua Cabang" dipilih.
- **PDF** — memakai dialog print browser (cetak halaman).

> Bila migrasi `20251104_profit_report_rpc.sql` belum dijalankan, sheet `Laporan Keuangan` dilewati dan export tetap berjalan dengan data omzet saja.

---

## 2. Laporan & Export (`/dashboard/laporan-pdf`)

### Mode laporan

| Mode | Paket | Isi |
|---|---|---|
| **Ringkasan** | Free, Pro, Supreme | Omzet, HPP, laba kotor/bersih, **rincian kerugian**, omzet & laba harian, menu terlaris, pembayaran, kasir, metodologi HPP. |
| **Hanya Keuntungan** | Free, Pro, Supreme | Laporan laba rugi, margin per kategori, kontribusi laba menu, tren laba harian, **detail kerugian**, kinerja per cabang, metodologi HPP. |
| **Semua Data** | Pro/Supreme + role Owner/Manager/Super Admin | Seluruh domain caPOS + PDF ringkas + **satu workbook Excel** berisi semua baris. |

### Batas riwayat

| Paket | Maksimal periode |
|---|---|
| Free Trial | 14 hari terakhir |
| Pro | 30 hari terakhir |
| Supreme | Tanpa batas |

Periode yang melewati batas otomatis dipotong (clamp) di UI dan diberi peringatan pada hasil export.

### Isi mode "Semua Data"

PDF memuat ringkasan + sampel baris (maksimal 100 baris/bagian untuk mode penuh, 300 untuk mode lain).
Excel memuat **seluruh baris** dalam sheet terpisah:

1. `Info` — identitas laporan + metrik + peringatan.
2. Ringkasan & kerugian.
3. Omzet/laba harian, menu, pembayaran, kasir.
4. Margin kategori, perbandingan cabang, metodologi.
5. Rincian transaksi, item transaksi (dengan HPP/unit + sumber HPP), pembayaran, order/channel, refund, QR order.
6. Produk, HPP per cabang, varian, modifier, resep, item resep, bahan baku, stok bahan.
7. Stok opname, log kerugian opname, waste produk, waste bahan, konsumsi resep.
8. Pemasok, purchase order, item PO, goods receipt, item GRN.
9. Pelanggan, membership, voucher, cakupan cabang voucher, pemakaian voucher, promosi, referral.
10. Cabang, karyawan, shift, kehadiran, pergerakan kas, reservasi.
11. Analitik: penjualan harian, menu terlaris, profitabilitas, jam sibuk, komisi channel, menu engineering.

### Data yang TIDAK pernah diekspor

- `profiles.pin_hash` dan seluruh hash PIN.
- `branches.midtrans_server_key` dan kredensial pembayaran.
- `payments.raw_response` / respons mentah gateway.
- Telepon & email pelanggan/pemasok **dimask** (contoh: `0812****345`, `ba***@mail.com`).
- Nomor rekening pemasok dimask menjadi 4 digit terakhir.

Query memakai RLS pengguna (tanpa `service_role`), sehingga pengguna hanya bisa mengunduh data tenant/cabang yang boleh diakses.

### Audit export

Setiap export mode PDF menulis satu baris ke `public.export_logs` (tenant, cabang, user, mode, periode, jumlah baris, status). Bila tabel belum dimigrasikan, kegagalan insert diabaikan dan export tetap berjalan.

---

## 3. Definisi metrik (satu sumber: `lib/metrics.ts`)

| Metrik | Rumus |
|---|---|
| Omzet | Σ `transactions.total_amount` |
| Subtotal | Σ `transactions.subtotal_amount` (fallback `total_amount`) |
| Diskon | Σ `transactions.discount_amount` |
| HPP | Σ (`qty` × HPP per unit) |
| Laba Kotor | Omzet − HPP |
| Kerugian / Susut Stok | Σ opname bahan + Σ opname produk lama + Σ waste produk + Σ waste bahan |
| Komisi Channel | Σ `orders.channel_commission_amount` |
| Biaya Operasional | Σ `expenses.amount` berstatus APPROVED (hanya mode Semua Data) |
| Laba Bersih | Laba Kotor − Kerugian − Komisi − Biaya Operasional |
| Margin Kotor | Laba Kotor ÷ Omzet × 100 |
| AOV | Omzet ÷ jumlah transaksi |

### Urutan resolusi HPP per item

1. `transaction_items.cost_price_snapshot` — diisi trigger saat transaksi dibuat.
2. `product_branch_cost.cost_price` — HPP khusus cabang.
3. `products.cost_price` — HPP default tenant.
4. `0` — ditandai **estimasi**.

Status HPP pada laporan:
- **Aktual** — semua item punya snapshot.
- **Estimasi** — sebagian item memakai fallback (jumlah item ditampilkan).

---

## 4. Urutan migrasi SQL (WAJIB)

Jalankan manual di **Supabase SQL Editor** dengan urutan berikut:

1. `supabase/20251031_voucher_branch_scope.sql` (bila belum)
2. `supabase/20251104_product_branch_cost.sql`
3. `supabase/20251104_hpp_snapshot.sql`
4. `supabase/20251104_profit_report_rpc.sql`
5. `supabase/20251104_export_audit.sql`
6. `supabase/20251104_full_export_rpc.sql`

Catatan:

- Semua file idempoten (aman dijalankan ulang).
- `product_branch_cost` harus lebih dulu karena membuat `pick_active_recipe()` dan `get_product_cost()` yang dipakai trigger snapshot.
- `hpp_snapshot` mengisi snapshot untuk transaksi lama secara bertahap:
  1. dari `recipe_consumption_logs` (paling akurat),
  2. dari HPP khusus cabang,
  3. dari HPP default produk,
  4. sisanya ditandai `estimate`.
- Tidak ada `service_role` di repo. Jangan menaruh service key di file migrasi.

### Verifikasi setelah migrasi

```sql
-- 1. Kolom snapshot ada
select column_name from information_schema.columns
where table_name = 'transaction_items'
  and column_name in ('cost_price_snapshot','hpp_source');

-- 2. Trigger aktif
select tgname from pg_trigger where tgname = 'trg_fill_transaction_item_hpp';

-- 3. RPC bisa dipanggil
select * from public.get_profit_report(
  (select tenant_id from public.profiles limit 1),
  null, now() - interval '7 days', now()
);

-- 4. Audit table siap
select count(*) from public.export_logs;
```

---

## 5. Struktur kode

```
lib/
  hpp.ts                 # resolusi HPP per item (murni, tanpa network)
  metrics.ts             # definisi resmi semua metrik
  export/
    types.ts             # tipe ReportData/ReportSection/ExportMode
    data.ts              # pengambilan data (RLS, filter cabang, batas baris)
    sections.ts          # penyusunan seluruh bagian laporan
    pdf.ts               # renderer PDF 3 mode (jsPDF + autotable)
    excel.ts             # workbook Excel multi-sheet
app/dashboard/laporan-pdf/page.tsx   # UI export lengkap
app/dashboard/page.tsx               # Laporan & Omzet (keuangan + omzet)
supabase/20251104_*.sql              # migrasi
```

---

## 6. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| Sheet `Laporan Keuangan` tidak muncul di dashboard | RPC `get_profit_report` belum ada | Jalankan `20251104_profit_report_rpc.sql`. |
| HPP terbaca 0 / status Estimasi | Item belum punya snapshot & HPP cabang/produk kosong | Isi `products.cost_price` atau `product_branch_cost`, lalu jalankan backfill di `20251104_hpp_snapshot.sql`. |
| HPP berbeda antar halaman | Data berubah setelah export / fallback berbeda | Semua halaman memakai `lib/hpp.ts` + `lib/metrics.ts`; pastikan migrasi sudah dijalankan agar snapshot konsisten. |
| Export gagal "column ... does not exist" | Migrasi belum lengkap | Jalankan migrasi sesuai urutan di atas. |
| Baris PDF terpotong | PDF sengaja membatasi sampel | Gunakan Excel (mode Semua Data) untuk seluruh baris. |
| Export lambat / dibatasi 20.000 transaksi | Periode terlalu panjang | Persempit periode atau pilih satu cabang. |
