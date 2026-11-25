# RENCANA PERBAIKAN caPOS & FITUR EXPORT PDF LENGKAP

**Proyek:** caPOS — Point of Sale Kafe
**Repo acuan:** `capos-patch-base` (branch `main`, remote `OrdinaryGUY25-2210/caPOS`)
**Tanggal:** 4 November 2026
**Sifat dokumen:** rencana kerja (roadmap) + spesifikasi fitur baru
**Dokumen terkait:** `TEST_REPORT.md`, `DOKUMEN_PEKERJAAN_SELESAI.md`

---

## 1. Ringkasan Eksekutif

Audit menemukan tiga akar masalah yang saling berkaitan dan memengaruhi angka laba yang ditampilkan aplikasi:

1. **HPP menu tidak per cabang.** Stok dan harga bahan sudah per cabang (`branch_ingredients_stock`), tetapi HPP menu disimpan di `products.cost_price` yang bersifat **satu untuk seluruh tenant**. Akibatnya laporan laba cabang memakai HPP cabang lain.
2. **Tidak ada snapshot HPP historis** di `transaction_items`. Semua laporan masa lalu menghitung ulang memakai `products.cost_price` **saat ini**, sehingga angka laba bulan lalu bisa berubah hari ini.
3. **Export belum konsisten mengikuti cabang.** Filter transaksi sudah mengikuti cabang terpilih, tetapi HPP di PDF tetap global, dan export CSV/Excel omzet tidak mencantumkan label cabang sehingga data antar cabang tercampur tanpa penanda.

Selain itu, diminta **fitur baru: Export PDF Lengkap** dengan dua mode tambahan — **"Hanya Keuntungan"** dan **"Semua Data"** — di samping mode **"Ringkasan"** yang sudah ada.

Rencana ini dibagi menjadi 3 alur kerja:

| Alur | Isi | Prioritas | Estimasi |
|---|---|---|---|
| **A. Perbaikan HPP per cabang** | Snapshot HPP, HPP menu per cabang, laporan historis akurat | P0 | 5–7 hari |
| **B. Perbaikan export & konsistensi cabang** | Label cabang, filter analitik, tier/limit | P1 | 3–4 hari |
| **C. Fitur Export PDF Lengkap** | 3 mode export, cakupan seluruh data caPOS | P1 | 7–10 hari |

Total estimasi: **15–21 hari kerja** (1 developer), dapat diparalelkan menjadi ±12 hari dengan 2 developer.

---

## 2. Status Pekerjaan Saat Ini

### 2.1 Sudah selesai dan sudah di-push

| # | Pekerjaan | Status |
|---|---|---|
| 1 | Perbaikan build `TS2339` pada `QrOrderPageData.branch` (`id?: string` di `lib/types.ts`) | ✅ Selesai |
| 2 | Migrasi `20251031_voucher_branch_scope.sql` (tabel `voucher_branches`, validasi cabang server-side) | ✅ Selesai (kode) |
| 3 | Migrasi `20251031_qr_order_page_branch_id.sql` (RPC `get_qr_order_page` mengembalikan `branch.id`) | ✅ Selesai (kode) |
| 4 | Verifikasi build Next.js 16.4.2 (compile + TypeScript + 20/20 static pages) | ✅ Selesai |
| 5 | Commit & push `2fd89f2` ke `origin/main` | ✅ Selesai |
| 6 | Audit read-only bahan/HPP per cabang dan export per cabang | ✅ Selesai |

### 2.2 Menunggu tindakan manual (di luar repo)

| # | Tindakan | Dampak bila belum dijalankan |
|---|---|---|
| 1 | Jalankan `supabase/20251031_voucher_branch_scope.sql` di Supabase SQL Editor | Validasi voucher per cabang tidak aktif; voucher tetap berlaku lintas cabang |
| 2 | Jalankan `supabase/20251031_qr_order_page_branch_id.sql` di Supabase SQL Editor | `branch.id` bernilai `undefined` di halaman order QR (gagal senyap, tanpa error) |

> Repo tidak memuat `service_role`, sehingga seluruh perubahan SQL **wajib dijalankan manual** oleh pemilik proyek.

### 2.3 Status implementasi final (revisi terakhir)

Seluruh work package dan fitur export sudah diimplementasikan di `capos-patch-base` dan lolos `next build` + TypeScript.

| Area | Hasil |
|---|---|
| HPP per item | `transaction_items.cost_price_snapshot` + trigger `fill_transaction_item_hpp` + backfill bertahap |
| HPP per cabang | Tabel `product_branch_cost`, RPC `get_product_cost`, resolver `lib/hpp.ts` |
| Single source metrik | `lib/metrics.ts` dipakai dashboard, PDF, dan Excel |
| Export lengkap | Halaman `/dashboard/laporan-pdf`: mode **Ringkasan**, **Hanya Keuntungan**, **Semua Data** (PDF + Excel) |
| Kerugian | Rincian kerugian (opname bahan, opname produk lama, waste produk, waste bahan) muncul di ketiga mode PDF |
| Pemisahan export | `/dashboard` (Laporan & Omzet) **hanya** mengekspor laporan keuangan + omzet; laporan lengkap ada di `/dashboard/laporan-pdf` |
| Filter cabang | Analitik, resep, stok, ingredients, menu engineering memakai cabang aktif |
| Audit | Tabel `export_logs` + insert dari UI (gagal senyap bila migrasi belum jalan) |
| Dokumentasi | `EXPORT_LAPORAN.md` di repo (urutan migrasi, definisi metrik, troubleshooting) |

**Urutan migrasi baru (manual, wajib):**

1. `20251031_voucher_branch_scope.sql`
2. `20251104_product_branch_cost.sql`
3. `20251104_hpp_snapshot.sql`
4. `20251104_profit_report_rpc.sql`
5. `20251104_export_audit.sql`
6. `20251104_full_export_rpc.sql`

> Catatan build: `next build` memerlukan `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Tanpa env tersebut, prerender `/kitchen` gagal — ini kondisi lama, bukan akibat perubahan export.

---

## 3. Hasil Audit: Bahan & HPP per Cabang

### 3.1 Verdict

**Stok dan harga bahan baku SUDAH per cabang. HPP menu BELUM per cabang.**

| Lapisan | Per cabang? | Sumber data | Catatan |
|---|---|---|---|
| Stok bahan | ✅ Ya | `branch_ingredients_stock` | qty + `cost_price` (weighted average) per `branch_id` |
| Harga bahan (WAC) | ✅ Ya | `branch_ingredients_stock.cost_price` | Diperbarui `process_goods_receipt` saat penerimaan barang |
| HPP resep | ✅ Ya (jika `branch_id` dikirim) | `calculate_recipe_cost(p_recipe_id, p_branch_id)` | Parameter `p_branch_id` sudah ada dan berfungsi |
| HPP menu tersimpan | ❌ Tidak | `products.cost_price` | Satu nilai untuk seluruh tenant, di-seed dari cabang pembuat menu |
| Riwayat HPP transaksi | ❌ Tidak | tidak ada kolom snapshot di `transaction_items` | Laporan historis memakai harga hari ini |

### 3.2 Temuan detail

| ID | Temuan | Bukti | Dampak | Prioritas |
|---|---|---|---|---|
| **F-01** | HPP menu bersifat tenant-wide | `products.cost_price` tanpa `branch_id`; halaman `/dashboard/laporan-pdf` menghitung HPP dari `products.cost_price` | Laba per cabang salah bila harga bahan antar cabang berbeda | **P0** |
| **F-02** | Tidak ada snapshot HPP di item transaksi | `transaction_items` tidak punya `cost_price`/`hpp_amount` | Laporan bulan lalu berubah bila `cost_price` diedit hari ini | **P0** |
| **F-03** | HPP menu hanya di-seed sekali dari cabang pembuat | `NewMenuWizard` membuat menu dengan `products.cost_price` dari konteks cabang aktif | Menu yang dipakai di 2 cabang memakai HPP cabang pertama | **P0** |
| **F-04** | Preview HPP resep memakai cabang utama | `/dashboard/recipes` memanggil `calculate_recipe_cost` tanpa `p_branch_id` | Angka preview tidak sesuai cabang yang dipilih | P1 |
| **F-05** | Halaman stok consolidated memakai fallback cabang utama | `/dashboard/stock` saat `ALL_BRANCHES` memakai HPP cabang utama untuk produk tanpa resep | Nilai inventori gabungan tidak akurat | P1 |
| **F-06** | Nilai inventori consolidated memakai rata-rata × total stok | `/dashboard/ingredients` | Mendekati benar, tetapi bukan penjumlahan nilai per cabang | P2 |
| **F-07** | HPP historis hanya bisa direkonstruksi sebagian | `recipe_consumption_logs.cost_snapshot` ada, tetapi tidak semua penjualan punya log | Sebagian laporan harus ditandai "estimasi" | P1 |
| **F-08** | `NewMenuWizard` berpotensi tidak cocok dengan signature RPC | Mengirim `p_image_url`, tidak mengirim `p_stock_mode` | Menu bisa tersimpan tanpa mode stok yang dimaksud | P1 |

### 3.3 Rekomendasi arsitektur HPP

Urutan sumber HPP yang dipakai untuk laporan (fallback berjenjang):

1. **`transaction_items.cost_price_snapshot`** (baru) — paling akurat, diisi saat checkout.
2. **`recipe_consumption_logs.cost_snapshot`** — rekonstruksi untuk data lama.
3. **`calculate_recipe_cost(recipe_id, branch_id)`** — bila resep masih ada.
4. **`branch_ingredients_stock` → rata-rata tertimbang** — bila tidak ada resep.
5. **`products.cost_price`** — fallback terakhir, **ditandai "estimasi"** di laporan.

Setiap laporan wajib menampilkan badge **"HPP Aktual"** atau **"HPP Estimasi"** agar pemilik tahu kualitas angkanya.

---

## 4. Hasil Audit: Export & Konsistensi Cabang

| ID | Temuan | Bukti | Dampak | Prioritas |
|---|---|---|---|---|
| **F-09** | CSV/Excel omzet tidak punya kolom cabang | `/dashboard` `exportCSV()` dan `exportExcel()` | Saat "Semua Cabang" dipilih, data tercampur tanpa penanda | P1 |
| **F-10** | HPP di PDF global meski transaksi difilter cabang | `laporan-pdf` mengambil `products.cost_price` | Laba kotor PDF tidak mencerminkan cabang | **P0** |
| **F-11** | Profitabilitas Produk & Menu Engineering tenant-wide | Caller tidak mengirim `p_branch_id` | Analisis menu tidak bisa per cabang | P1 |
| **F-12** | Jam Sibuk & Kerugian Barang mengabaikan cabang | `AnalyticsComponents.tsx` memanggil `getPeakHoursAnalytics()` dan `getWasteLossReport(undefined, 30)` | Grafik mencampur semua cabang | P1 |
| **F-13** | "Laporan PDF Otomatis" bukan otomatis | Tidak ada scheduler, email, atau WhatsApp | Nama fitur menyesatkan; masih klik manual | P2 |
| **F-14** | Batas free tier tidak konsisten | PDF memakai `minDate` 14 hari, tetapi preset "Bulan Ini" bisa melewatinya | Free user bisa mengakses data >14 hari | P1 |
| **F-15** | Laba bersih belum memasukkan OPEX | Tabel `expenses`, `budgets`, `cash_movements`, `purchase_invoices` ada tetapi tidak dipakai aplikasi | "Laba bersih" sebenarnya laba kotor − susut stok | P1 |
| **F-16** | Export omzet dibatasi 10.000 baris tanpa peringatan | `.limit(10000)` di beberapa query | Data terpotong diam-diam pada tenant besar | P2 |

### 4.1 Mengapa laporan omzet dan PDF bisa berbeda

Pertanyaan yang sering muncul: *"Kenapa angka di Laporan & Omzet beda dengan PDF?"*

| Penyebab | Penjelasan |
|---|---|
| **Rentang tanggal berbeda** | Laporan omzet default 7 hari; PDF default 7 hari tetapi bisa "Bulan Ini" |
| **Batas free tier** | PDF punya `minDate` 14 hari; "Bulan Ini" dapat melewati batas tersebut |
| **HPP berbeda** | Omzet hanya menjumlah `total_amount`; PDF mengurangi HPP dari `products.cost_price` (global) |
| **Susut stok** | PDF mengurangi `stock_opname_logs.loss_value`; halaman omzet tidak |
| **Data demo** | Bila tenant belum punya aktivitas, PDF menampilkan data demo (`DEMO_REPORT_*`) |
| **Void/refund** | Omzet memuat semua baris `transactions`; PDF juga, tetapi refund tidak dikurangkan |

**Kesimpulan:** perbedaan bukan bug tunggal, melainkan akibat **definisi metrik yang belum disatukan**. Perbaikan ada di **WP-07 (Single Source of Truth metrik)**.

> Catatan penting: **PDF free tier saat ini TIDAK dinonaktifkan.** Yang berlaku hanya pembatasan `minDate` 14 hari. Bila kelak fitur PDF dijadikan premium, perlu flag terpisah di `lib/tier.ts` dan pengecekan server-side.

---

## 5. Rencana Perbaikan (Work Packages)

### WP-01 — Snapshot HPP di item transaksi `P0`

**Masalah:** F-02, F-07

**Perubahan:**
- Tambah kolom di `transaction_items`:
  - `cost_price_snapshot numeric(14,2)`
  - `hpp_source text` (`recipe` | `wac` | `product` | `estimate`)
  - `recipe_id` sudah ada, dipakai untuk audit.
- Isi nilai di RPC checkout (`checkout_order_v2`) saat item dibuat, memakai `calculate_recipe_cost(recipe_id, branch_id)`.
- Untuk transaksi lama: backfill dari `recipe_consumption_logs.cost_snapshot`, sisanya `NULL` + `hpp_source='estimate'`.

**File:** `supabase/migration_XXX_hpp_snapshot.sql`, RPC checkout, `lib/types.ts`

**Acceptance criteria:**
- Transaksi baru selalu punya `cost_price_snapshot > 0` untuk menu berresep.
- Mengubah `products.cost_price` **tidak** mengubah HPP transaksi lama.
- Laporan menampilkan badge "HPP Aktual/Estimasi".

---

### WP-02 — HPP menu per cabang `P0`

**Masalah:** F-01, F-03

**Perubahan:**
- Tabel baru `product_branch_cost` (`tenant_id`, `branch_id`, `product_id`, `cost_price`, `updated_at`, PK gabungan).
- `products.cost_price` tetap ada sebagai **default/fallback** (backward compatible).
- Helper `get_product_cost(product_id, branch_id)` dengan urutan: `product_branch_cost` → `calculate_recipe_cost` → `products.cost_price`.
- Halaman `/dashboard/menu` dan `/dashboard/stock` menulis ke `product_branch_cost` sesuai cabang aktif.

**File:** migrasi baru, `app/dashboard/menu/page.tsx`, `app/dashboard/stock/page.tsx`, `lib/hpp.ts` (baru)

**Acceptance criteria:**
- Dua cabang dapat memiliki HPP berbeda untuk menu yang sama.
- Menghapus override cabang mengembalikan ke default tenant.

---

### WP-03 — Perbaiki preview & consolidated HPP `P1`

**Masalah:** F-04, F-05, F-06

**Perubahan:**
- `/dashboard/recipes`: kirim `p_branch_id` dari `useBranch()`.
- `/dashboard/stock`: saat consolidated, jumlahkan nilai per cabang (bukan fallback cabang utama).
- `/dashboard/ingredients`: nilai inventori = Σ(`branch_ingredients_stock.qty × cost_price`) per cabang.

**Acceptance criteria:**
- Angka consolidated = penjumlahan angka per cabang (selisih < Rp1 karena pembulatan).
- Preview resep berubah saat cabang diganti.

---

### WP-04 — Label cabang di semua export `P1`

**Masalah:** F-09

**Perubahan:**
- Tambah kolom **Cabang** di CSV dan Excel omzet.
- Nama file menyertakan cabang: `laporan-capos-<cabang>-<tanggal>.xlsx`.
- Saat "Semua Cabang", tambahkan sheet **Rekap per Cabang**.

**Acceptance criteria:**
- Setiap baris export dapat dilacak ke cabangnya.
- Rekap per cabang = total keseluruhan.

---

### WP-05 — Filter cabang di analitik `P1`

**Masalah:** F-11, F-12

**Perubahan:**
- `AnalyticsComponents.tsx`: kirim `selectedBranchId` ke `getPeakHoursAnalytics` dan `getWasteLossReport`.
- `/dashboard/analytics/profitability` dan `menu-engineering`: kirim `p_branch_id`.
- Tampilkan label cabang di judul grafik.

**Acceptance criteria:**
- Mengganti cabang mengubah seluruh grafik analitik.
- Mode "Semua Cabang" menampilkan agregat dan label yang jelas.

---

### WP-06 — Konsistensi tier & limit `P1`

**Masalah:** F-14

**Perubahan:**
- Satukan aturan di `lib/tier.ts`:
  - `FREE_TIER_LIMITS.historyDays = 14`
  - `HISTORY_DAYS_LIMIT.free = 14`, `pro = 30`, `supreme = null`
- Terapkan batas **server-side** (RPC/route), bukan hanya `minDate` di UI.
- Preset "Bulan Ini" untuk free otomatis dipotong ke 14 hari + info banner.
- Tambah flag `PDF_EXPORT_PREMIUM` (default `false`) agar kelak mudah diaktifkan.

**Acceptance criteria:**
- Free user tidak bisa mengambil data >14 hari lewat manipulasi query.
- Pesan batas tampil jelas, bukan error mentah.

---

### WP-07 — Single Source of Truth metrik `P1`

**Masalah:** F-10, F-15, perbedaan omzet vs PDF

**Perubahan:**
- Buat `lib/metrics.ts` berisi definisi tunggal:
  - `omzet`, `diskon`, `hpp`, `labaKotor`, `susutStok`, `biayaOperasional`, `labaBersih`, `marginKotor`
- Semua halaman (omzet, PDF, analitik) memakai fungsi yang sama.
- OPEX hanya dihitung bila modul `expenses` aktif; jika tidak, tampilkan "belum termasuk OPEX".

**Acceptance criteria:**
- Angka omzet di Dashboard = angka omzet di PDF untuk periode & cabang yang sama.
- Perbedaan hanya boleh berasal dari metrik yang memang berbeda (mis. laba bersih vs omzet).

---

### WP-08 — Perbaiki `NewMenuWizard` `P1`

**Masalah:** F-08

**Perubahan:**
- Samakan parameter RPC: kirim `p_stock_mode`, hapus/ sesuaikan `p_image_url` bila tidak ada di signature.
- Tambah test manual: buat menu baru dengan mode stok `track` dan `untrack`.

**Acceptance criteria:**
- Menu tersimpan dengan `stock_mode` sesuai pilihan.
- Tidak ada error senyap di console.

---

### WP-09 — Penanganan dataset besar `P2`

**Masalah:** F-16

**Perubahan:**
- Ganti `.limit(10000)` dengan pagination berulang (`range`) sampai habis.
- Tampilkan peringatan bila baris >50.000 dan tawarkan export Excel/ZIP.

**Acceptance criteria:**
- Export 100.000 baris tidak terpotong.
- Waktu proses wajar (<60 detik) atau dialihkan ke job async.

---

### WP-10 — Kejujuran label "Otomatis" `P2`

**Masalah:** F-13

**Perubahan:**
- Ganti label menjadi **"Laporan PDF"** sampai scheduler benar-benar ada.
- Bila scheduler diinginkan: tambah cron + email (butuh infrastruktur di luar repo).

**Acceptance criteria:**
- Tidak ada klaim "otomatis" tanpa mekanisme penjadwalan.

---

## 6. Fitur Baru: Export PDF Lengkap

### 6.1 Tujuan

Menyediakan **satu tombol export** yang dapat menghasilkan:

1. **Ringkasan** — format yang sudah ada (omzet, HPP, laba, omzet harian, menu terlaris).
2. **Hanya Keuntungan** — laporan laba rugi ringkas, fokus pada angka finansial.
3. **Semua Data** — seluruh data caPOS pada periode & cabang terpilih, terstruktur per domain.

### 6.2 Perbandingan mode

| Aspek | Ringkasan | Hanya Keuntungan | Semua Data |
|---|---|---|---|
| Tujuan | Laporan harian cepat | Analisis laba | Arsip / audit / migrasi |
| Halaman (estimasi) | 2–4 | 3–6 | 20–150+ |
| Omzet & HPP | ✅ | ✅ | ✅ |
| Laba kotor & bersih | ✅ | ✅ | ✅ |
| Rincian transaksi | ❌ | ❌ | ✅ |
| Rincian menu & resep | Ringkas | ❌ | ✅ |
| Stok & opname | ❌ | Ringkas (susut) | ✅ |
| Purchasing | ❌ | ❌ | ✅ |
| Pelanggan & loyalty | ❌ | ❌ | ✅ (PII dimask) |
| Karyawan & shift | ❌ | ❌ | ✅ |
| Analitik | ❌ | ✅ (margin per menu) | ✅ |
| Format | PDF | PDF | PDF + Excel/ZIP |

### 6.3 Alur teknis

```
UI (pilih mode, cabang, periode)
        │
        ▼
Server Action / Route Handler  ──►  validasi tier + branch scope
        │
        ▼
RPC agregasi (SECURITY INVOKER)
  get_profit_report(tenant, branch, from, to)
  get_full_export(tenant, branch, from, to)  ← hanya role owner/manager
        │
        ▼
Renderer
  ├─ jsPDF + jspdf-autotable  → PDF (mode Ringkasan & Hanya Keuntungan)
  └─ ExcelJS/XLSX + ZIP        → mode Semua Data (dataset besar)
        │
        ▼
Unduh file + audit_log
```

**Prinsip:**
- Semua agregasi di database, bukan di browser (cepat & konsisten).
- Renderer PDF memakai `jsPDF` + `jspdf-autotable` yang sudah ada di `package.json`.
- Untuk dataset besar, PDF hanya memuat **ringkasan + sampel**, data penuh via Excel/ZIP dalam satu paket unduhan.

### 6.4 Definisi metrik resmi

| Metrik | Rumus | Sumber |
|---|---|---|
| **Omzet** | Σ `transactions.total_amount` | `transactions` |
| **Subtotal** | Σ `transactions.subtotal_amount` | `transactions` |
| **Diskon** | Σ `transactions.discount_amount` + diskon manual order | `transactions`, `orders` |
| **HPP** | Σ (`qty` × `cost_price_snapshot`) | `transaction_items` (WP-01) |
| **Laba Kotor** | Omzet − HPP | turunan |
| **Susut Stok** | Σ `stock_opname_logs.loss_value` + `waste_logs.total_loss_amount` | `stock_opname_logs`, `waste_logs` |
| **Komisi Channel** | Σ `orders.channel_commission_amount` | `orders` |
| **Biaya Operasional** | Σ `expenses.amount` (status approved) | `expenses` (bila aktif) |
| **Laba Bersih** | Laba Kotor − Susut − Komisi − OPEX | turunan |
| **Margin Kotor %** | Laba Kotor ÷ Omzet × 100 | turunan |
| **AOV** | Omzet ÷ jumlah transaksi | turunan |
| **Item Terjual** | Σ `transaction_items.qty` | `transaction_items` |

### 6.5 Pemetaan data lengkap — mode "Semua Data"

#### A. Penjualan

| Sumber | Kolom utama | Filter cabang |
|---|---|---|
| `transactions` | invoice, tanggal, total, subtotal, diskon, metode bayar, kasir | `branch_id` |
| `transaction_items` | produk, qty, harga, subtotal, HPP snapshot | via `transactions.branch_id` |
| `transaction_payments` | metode, jumlah, referensi, split group | via transaksi |
| `orders` | nomor order, tipe, channel, status, komisi | `branch_id` |
| `order_items` | produk, qty, harga, status item, void | via order |
| `qr_orders` | meja, metode bayar, status bayar, total | `branch_id` |
| `refunds` | tipe refund, jumlah, alasan, status | `branch_id` |

#### B. Produk, Resep & HPP

| Sumber | Kolom utama | Filter cabang |
|---|---|---|
| `products` | nama, kategori, harga, HPP default, track stok | tenant |
| `product_branch_cost` | HPP per cabang | `branch_id` |
| `product_variants` | nama varian, harga, HPP | tenant |
| `modifiers`, `modifier_groups` | nama, harga tambahan | tenant |
| `recipes`, `recipe_items` | versi, bahan, qty, unit | tenant |
| `ingredients` | nama, unit, stok minimum | tenant |
| `branch_ingredients_stock` | qty, WAC per cabang | `branch_id` |
| `unit_conversions` | konversi satuan | tenant |

#### C. Inventori

| Sumber | Kolom utama | Filter cabang |
|---|---|---|
| `branch_stock` | stok produk jadi per cabang | `branch_id` |
| `stock_movements` | tipe, qty, referensi, waktu | via cabang |
| `stock_opnames`, `stock_opname_items`, `stock_opname_logs` | periode, selisih, nilai kerugian | `branch_id` |
| `ingredient_stock_movements` | pergerakan bahan | `branch_id` |
| `ingredient_stock_opname_logs` | opname bahan | `branch_id` |
| `ingredient_waste_logs`, `waste_logs` | susut/rusak, nilai | `branch_id` |
| `recipe_consumption_logs` | konsumsi resep + `cost_snapshot` | `branch_id` |

#### D. Purchasing

| Sumber | Kolom utama | Filter cabang |
|---|---|---|
| `suppliers` | nama, kontak, bank (dimask) | tenant |
| `purchase_orders`, `po_items` | nomor PO, status, total, item | `branch_id` |
| `goods_receipts`, `grn_items` | nomor GRN, qty diterima, harga aktual | `branch_id` |
| `purchase_invoices` | nomor invoice, jumlah, status | `branch_id` |

#### E. Pelanggan & Loyalty

| Sumber | Kolom utama | Filter cabang |
|---|---|---|
| `customers` | kode, nama, kontak (dimask), tier, lifetime spend | `branch_id` |
| `memberships` | kode member, diskon, masa berlaku | tenant |
| `customer_points`, `loyalty_points_log`, `loyalty_config` | poin, mutasi | tenant |
| `customer_tiers` | nama tier, benefit | tenant |
| `vouchers`, `voucher_branches`, `voucher_redemptions` | kode, diskon, pemakaian | `branch_id` |
| `promotions`, `promotion_rules` | nama promo, aturan | `branch_id` |
| `referrals`, `referral_redemptions` | kode referral, reward | tenant |

#### F. Operasional & Tim

| Sumber | Kolom utama | Filter cabang |
|---|---|---|
| `branches` | nama, alamat, status | `id` |
| `profiles` | nama, role, job title (tanpa `pin_hash`) | `branch_id` |
| `shifts` | buka/tutup, kas awal/akhir, selisih | `branch_id` |
| `attendance` | tanggal, tipe, status | via karyawan |
| `cash_movements` | tipe, jumlah, alasan | `branch_id` |
| `reservations` | nama, meja, waktu, deposit | `branch_id` |
| `branch_tables` | nomor meja, status | `branch_id` |
| `audit_log` | aksi, entitas, perubahan | `branch_id` |

#### G. Analitik (view/RPC)

| Sumber | Isi |
|---|---|
| `daily_sales_analytics` | omzet & order harian |
| `best_seller_analytics` | menu terlaris |
| `product_profitability` | margin per produk |
| `menu_engineering_report()` | klasifikasi Stars/Plowhorses/Puzzles/Dogs |
| `peak_hours_analytics` | distribusi jam sibuk |
| `channel_commission_report` | komisi per channel |
| `customer_visit_stats` | kunjungan & lifetime value |
| `inactive_customers` | pelanggan pasif |
| `budget_vs_actual` | realisasi vs anggaran |
| `v_stock_opname_history` | riwayat opname |
| `v_subscription_quota` | pemakaian kuota tier |

### 6.6 Struktur halaman PDF per mode

#### Mode "Ringkasan" (existing, disempurnakan)

1. Kop laporan: nama kafe, cabang, periode, waktu cetak
2. Ringkasan angka: omzet, transaksi, AOV, HPP, laba kotor, susut, laba bersih
3. Omzet harian (tabel + grafik batang)
4. Menu terlaris top 10
5. Metode pembayaran
6. Footer: badge kualitas HPP + nama file

#### Mode "Hanya Keuntungan"

1. Kop laporan
2. **Laba Rugi Ringkas**
   - Omzet
   - (−) Diskon
   - (−) HPP
   - **= Laba Kotor**
   - (−) Susut stok
   - (−) Komisi channel
   - (−) Biaya operasional (opsional)
   - **= Laba Bersih**
3. **Margin per Kategori Menu**
4. **Top 10 Menu Penyumbang Laba**
5. **Tren Laba Harian**
6. **Perbandingan antar Cabang** (hanya mode "Semua Cabang")
7. Catatan metodologi & sumber HPP

#### Mode "Semua Data"

1. **Cover** — identitas laporan, hash data, versi skema
2. **Daftar Isi**
3. **Ringkasan Eksekutif** — semua metrik kunci
4. **Bagian A — Penjualan** (transaksi, item, pembayaran, refund)
5. **Bagian B — Produk & HPP** (menu, varian, modifier, resep, HPP per cabang)
6. **Bagian C — Inventori** (stok, opname, susut, konsumsi resep)
7. **Bagian D — Purchasing** (PO, GRN, invoice)
8. **Bagian E — Pelanggan & Loyalty** (dimask)
9. **Bagian F — Operasional & Tim** (shift, kehadiran, kas)
10. **Bagian G — Analitik** (semua view/RPC)
11. **Lampiran** — daftar tabel & jumlah baris, glosarium metrik

> Untuk dataset besar, PDF memuat **ringkasan + maksimal 500 baris per tabel**. Data penuh disertakan dalam file Excel terpisah di dalam ZIP.

### 6.7 Batas ukuran & fallback

| Kondisi | Perilaku |
|---|---|
| ≤5.000 baris total | PDF penuh |
| 5.001–50.000 | PDF ringkasan + Excel per domain |
| >50.000 | ZIP: PDF ringkasan + Excel per domain + `manifest.json` |
| >200.000 | Tawarkan export async (job) + notifikasi saat siap |

Nama file:
- `capos-ringkasan-<cabang>-<yyyyMMdd>.pdf`
- `capos-laba-<cabang>-<yyyyMMdd>.pdf`
- `capos-semua-data-<cabang>-<yyyyMMdd>.zip`

### 6.8 Filter cabang & periode

- **Cabang:** mengikuti `useBranch()` — `ALL_BRANCHES` atau `branch_id` tertentu.
- **Periode:** Hari Ini, 7 Hari, 30 Hari, Bulan Ini, Custom.
- **Validasi:** `end >= start`, rentang maksimum sesuai tier.
- **Konsistensi:** seluruh query memakai `branch_id` yang sama; mode "Semua Cabang" menambahkan kolom cabang di setiap tabel.

### 6.9 Tier & limit

| Tier | Riwayat | Mode PDF | Batas baris |
|---|---|---|---|
| Free | 14 hari | Ringkasan + Hanya Keuntungan | 5.000 |
| Pro | 30 hari | Semua mode | 50.000 |
| Supreme | Unlimited | Semua mode + async | 200.000+ |

### 6.10 Keamanan & PII

**Wajib dikecualikan dari semua export:**

| Data | Alasan |
|---|---|
| `profiles.pin_hash`, `pin_updated_at` | Kredensial |
| `branches.midtrans_server_key` (bila ada) | Secret pembayaran |
| `payments.raw_response` | Dapat memuat data sensitif gateway |
| Metadata auth (`auth.users`) | Di luar domain tenant |
| `tenants.wifi_password` | Opsional, default tidak diexport |

**Dimask secara default (bisa dibuka owner dengan konfirmasi):**

| Data | Perlakuan |
|---|---|
| `customers.phone_number`, `whatsapp_number` | `08xx****1234` |
| `customers.email` | `ab***@domain.com` |
| `suppliers.bank_account` | 4 digit terakhir |
| `memberships.customer_phone` | dimask |

**Kontrol akses:**
- Mode "Semua Data" hanya untuk role `owner`, `manager`, `super_admin`.
- Kasir tidak boleh mengunduh data pelanggan.
- Setiap export dicatat di `audit_log` (siapa, kapan, mode, periode, cabang).
- RPC memakai `SECURITY INVOKER` + RLS, bukan `service_role`.

### 6.11 Komponen UI

Halaman `/dashboard/laporan-pdf` diubah menjadi:

```
┌──────────────────────────────────────────────┐
│ Laporan & Export                             │
│ Cabang: [Semua Cabang ▾]  Periode: [7 Hari ▾]│
│                                              │
│ ( ) Ringkasan                                │
│     Omzet, HPP, laba, menu terlaris          │
│                                              │
│ ( ) Hanya Keuntungan                         │
│     Laba rugi, margin, tren laba             │
│                                              │
│ (•) Semua Data                               │
│     Seluruh data caPOS + Excel/ZIP           │
│                                              │
│ [ Preview ]            [ Unduh PDF ]         │
└──────────────────────────────────────────────┘
```

Elemen tambahan:
- Badge kualitas HPP: **Aktual** / **Estimasi**
- Info ukuran estimasi file sebelum unduh
- Progress bar saat generate
- Tombol "Unduh Excel" muncul untuk mode Semua Data

---

## 7. Perubahan Database

Semua migrasi **dijalankan manual** di Supabase SQL Editor.

### 7.1 Daftar migrasi baru

| File | Isi |
|---|---|
| `supabase/20251104_hpp_snapshot.sql` | Kolom `cost_price_snapshot`, `hpp_source` di `transaction_items` + backfill |
| `supabase/20251104_product_branch_cost.sql` | Tabel `product_branch_cost` + RLS + helper `get_product_cost()` |
| `supabase/20251104_profit_report_rpc.sql` | RPC `get_profit_report(tenant, branch, from, to)` |
| `supabase/20251104_full_export_rpc.sql` | RPC `get_full_export(...)` per domain |
| `supabase/20251104_export_audit.sql` | Tabel `export_logs` + trigger audit |

### 7.2 Sketsa SQL

```sql
-- 1) Snapshot HPP
ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS cost_price_snapshot numeric(14,2),
  ADD COLUMN IF NOT EXISTS hpp_source text
    CHECK (hpp_source IN ('recipe','wac','product','estimate'));

-- 2) HPP per cabang
CREATE TABLE IF NOT EXISTS public.product_branch_cost (
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  product_id uuid NOT NULL,
  cost_price numeric(14,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, product_id)
);
ALTER TABLE public.product_branch_cost ENABLE ROW LEVEL SECURITY;
-- policy: tenant isolation + branch scope

-- 3) Helper fallback berjenjang
CREATE OR REPLACE FUNCTION public.get_product_cost(
  p_product_id uuid, p_branch_id uuid
) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT cost_price FROM product_branch_cost
      WHERE product_id = p_product_id AND branch_id = p_branch_id),
    (SELECT cost_price FROM products WHERE id = p_product_id),
    0
  );
$$;
```

### 7.3 Catatan kompatibilitas

- `products.cost_price` **tidak dihapus** agar kode lama tetap jalan.
- `product_branch_cost` kosong = pakai default tenant (backward compatible).
- `cost_price_snapshot` `NULL` = data lama; laporan menandai "estimasi".
- Semua RPC baru memakai `SECURITY INVOKER` agar RLS tetap berlaku.

---

## 8. Rencana Pengujian

| # | Skenario | Ekspektasi |
|---|---|---|
| T-01 | Buat menu di Cabang A, jual di Cabang B | HPP Cabang B memakai harga bahan Cabang B |
| T-02 | Ubah `products.cost_price` setelah transaksi | Laba transaksi lama tidak berubah |
| T-03 | Export PDF cabang A | Semua angka hanya cabang A |
| T-04 | Export "Semua Cabang" | Ada kolom cabang + rekap per cabang |
| T-05 | Mode Hanya Keuntungan | Laba kotor = omzet − HPP; laba bersih = laba kotor − susut − komisi |
| T-06 | Mode Semua Data | Semua bagian A–G muncul; PII dimask |
| T-07 | Free tier pilih 30 hari | Ditolak / dipotong ke 14 hari + pesan |
| T-08 | Dataset 20.000 baris | ZIP berisi PDF + Excel, tidak terpotong |
| T-09 | Kasir buka halaman export | Tidak bisa akses mode Semua Data |
| T-10 | Audit log setelah export | Tercatat user, mode, periode, cabang |
| T-11 | Consolidated stok | Total = jumlah per cabang |
| T-12 | Analitik ganti cabang | Semua grafik ikut berubah |
| T-13 | Menu baru via wizard | `stock_mode` tersimpan benar |
| T-14 | Voucher lintas cabang | Ditolak server-side |

**Definition of Done:**
- Build `npm.cmd run build` lulus tanpa error TypeScript.
- Semua test manual di atas lulus.
- Tidak ada query yang memakai `service_role`.
- Dokumentasi diperbarui.

---

## 9. Timeline & Estimasi

| Minggu | Pekerjaan | Output |
|---|---|---|
| **Minggu 1** | WP-01, WP-02 | Snapshot HPP + HPP per cabang |
| **Minggu 2** | WP-03, WP-04, WP-05 | Konsistensi cabang di UI & export |
| **Minggu 3** | WP-07, WP-06, WP-08 | Metrik tunggal + tier + wizard |
| **Minggu 4** | Fitur PDF mode Ringkasan & Hanya Keuntungan | 2 mode siap |
| **Minggu 5** | Fitur PDF mode Semua Data + fallback ZIP | 3 mode siap |
| **Minggu 6** | WP-09, WP-10, QA, dokumentasi | Rilis |

**Milestone:**
- **M1 (akhir Minggu 2):** angka laba per cabang sudah akurat.
- **M2 (akhir Minggu 3):** semua export konsisten.
- **M3 (akhir Minggu 5):** tiga mode PDF tersedia.
- **M4 (akhir Minggu 6):** siap produksi.

---

## 10. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Backfill HPP lama tidak lengkap | Laporan historis tetap estimasi | Tandai jelas; sediakan tool re-kalkulasi manual |
| Data lama tanpa `branch_id` | Tidak bisa difilter | Masukkan ke grup "Tanpa Cabang" di laporan |
| PDF terlalu besar | Browser hang | Batas baris + fallback ZIP |
| Perubahan RPC memutus kode lama | Regresi checkout | Pertahankan parameter default; uji checkout end-to-end |
| RLS salah konfigurasi | Kebocoran data antar tenant | Review policy + test negatif |
| Migrasi manual terlewat | Fitur senyap tidak aktif | Checklist rilis + banner di UI bila kolom belum ada |
| Timezone `created_at` | Tanggal bergeser | Gunakan timezone tenant, bukan UTC mentah |

---

## 11. Keputusan yang Perlu Disetujui

| # | Pertanyaan | Opsi | Rekomendasi |
|---|---|---|---|
| D-01 | HPP menu per cabang disimpan di mana? | (a) tabel baru `product_branch_cost`; (b) kolom JSONB di `products` | **(a)** — query & RLS lebih rapi |
| D-02 | Apakah PDF tetap gratis? | (a) gratis dengan batas 14 hari; (b) premium mulai Pro | **(a)** untuk sekarang; siapkan flag |
| D-03 | Mode "Semua Data" untuk siapa? | (a) semua role; (b) owner/manager saja | **(b)** — data pelanggan sensitif |
| D-04 | OPEX dihitung di laba bersih? | (a) ya bila modul aktif; (b) belum | **(a)** dengan label jelas |
| D-05 | Format "Semua Data" | (a) PDF saja; (b) PDF + Excel/ZIP | **(b)** — PDF tidak praktis untuk ribuan baris |
| D-06 | Retensi file export | (a) tidak disimpan; (b) disimpan 7 hari | **(a)** — kurangi risiko PII |

---

## 12. Checklist Penerimaan

- [ ] Migrasi HPP snapshot dijalankan & terverifikasi
- [ ] Tabel `product_branch_cost` aktif dengan RLS
- [ ] HPP transaksi baru tidak berubah saat harga diubah
- [ ] Laporan per cabang memakai HPP cabang yang benar
- [ ] Semua export punya label cabang
- [ ] Analitik mengikuti cabang terpilih
- [ ] Batas tier ditegakkan server-side
- [ ] Mode Ringkasan, Hanya Keuntungan, Semua Data berfungsi
- [ ] PII dimask; secret tidak pernah masuk export
- [ ] Export tercatat di `audit_log`
- [ ] Dataset besar tidak terpotong (fallback ZIP)
- [ ] Build & TypeScript lulus
- [ ] Dokumentasi pengguna diperbarui

---

## 13. Lampiran: Ringkasan File yang Disentuh

| Area | File |
|---|---|
| Tipe | `lib/types.ts` |
| Metrik | `lib/metrics.ts` (baru), `lib/hpp.ts` (baru) |
| Tier | `lib/tier.ts` |
| PDF | `app/dashboard/laporan-pdf/page.tsx`, `lib/pdf/*` (baru) |
| Omzet | `app/dashboard/page.tsx` |
| Menu & stok | `app/dashboard/menu/page.tsx`, `app/dashboard/stock/page.tsx`, `app/dashboard/ingredients/page.tsx` |
| Resep | `app/dashboard/recipes/page.tsx` |
| Analitik | `components/analytics/AnalyticsComponents.tsx`, `app/dashboard/analytics/*` |
| Wizard menu | `components/menu/NewMenuWizard.tsx` |
| Aksi server | `app/actions/purchasing-loyalty-actions.ts` |
| Database | `supabase/20251104_*.sql` (5 file baru) |

---

**Akhir dokumen.**
