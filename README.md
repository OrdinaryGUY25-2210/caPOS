# caPOS — Point of Sale Kafe/Restoran by Studio D13

Aplikasi web SaaS POS untuk kafe/restoran berbasis Next.js (App Router),
Tailwind CSS, Dexie.js (IndexedDB, offline-first), dan Supabase
(Auth + Postgres + Storage + Realtime).

**Revisi terakhir:** 7 November 2026 — integritas kas & transaksi
(migration_023). Build **tidak di-upgrade**: tetap Next.js 16.4.2,
React 19.3.1, TypeScript 5.9.3, Tailwind CSS 3.4.19.

**Paket ini adalah hasil PENGGABUNGAN 4 fase pengembangan** menjadi satu
basis kode yang konsisten. Kalau ini pertama kalinya kamu membuka proyek
ini, baca urutan berikut:

1. **`docs/PANDUAN_INSTALASI_WEB.md`** — cara deploy dari nol **lewat
   dashboard web saja** (GitHub, Vercel, Supabase) — tidak perlu install
   apa pun di komputer/laptop kamu.
2. **`docs/PANDUAN_RESET_SUPABASE.md`** — simpan ini untuk jaga-jaga.
   Langkah-langkah mengosongkan & mengulang dari nol project Supabase
   kalau suatu saat perlu (data rusak, mau mulai bersih, dsb).
3. **`docs/CATATAN_PENGGABUNGAN.md`** — penting dibaca kalau kamu (atau
   developer lain) akan melanjutkan coding di proyek ini. Berisi
   keputusan desain, bug yang diperbaiki saat penggabungan, dan hal-hal
   yang sengaja BELUM dikerjakan (technical debt yang disadari).
4. **`docs/EXPORT_PDF_LENGKAP.md`** — detail fitur export PDF/Excel,
   urutan migrasi HPP per cabang, definisi metrik, dan status work
   package.

---

## 1. Empat Fase Fitur

### Fase 1 — Inti POS & SaaS
- Registrasi tenant, 4 role (`super_admin`/`owner`/`manager`/`cashier`),
  kasir offline-first (Dexie), member/loyalti dasar, langganan
  Free Trial/Pro/Supreme via Midtrans, Program Referral, multi-cabang,
  stok opname, Laporan PDF, Target Bulanan, Evaluasi Kasir.

### Fase 2 — Dapur, Shift & Kas
- **Kitchen Display System** (`/kitchen`) — pesanan masuk real-time,
  dikelompokkan per stasiun (Barista/Dapur/dll), status
  Baru→Diterima→Disiapkan→Siap→Disajikan.
- **Shift & Kas** — buka/tutup shift dengan modal awal & rekonsiliasi
  kas fisik, catat kas masuk/keluar di luar transaksi.
- **Pembayaran Split** — satu transaksi dibayar dengan lebih dari satu
  metode (mis. sebagian tunai, sebagian QRIS).

### Fase 3 — Purchasing, CRM & Analitik Lanjutan
- **Pemasok & Purchase Order** (`/dashboard/purchasing/*`) — PO ke
  supplier, penerimaan barang (GRN), stok & HPP (rata-rata tertimbang)
  ter-update otomatis.
- **CRM & Loyalitas** (`/dashboard/crm/customers`) — profil pelanggan,
  riwayat kunjungan & belanja, tingkatan/tier member.
- **Promosi & Voucher** (`/dashboard/promotions`) — diskon %/nominal,
  BOGO, bundle, dengan aturan (minimum belanja, khusus member, jam
  tertentu).
- **Analitik Lanjutan** — profitabilitas per produk, jam sibuk, laporan
  waste/loss.

### Fase 4 — QR Self-Order, Reservasi & Multi-channel
- **QR Meja & Self-Order** (`/dashboard/qr-tables`) — generate QR per
  meja, pelanggan pesan sendiri lewat HP tanpa login
  (`/order/[cabang]/[meja]`), bayar QRIS langsung (Midtrans) atau ke kasir.
- **Reservasi Meja** (`/dashboard/reservations`, publik di
  `/reserve/[cabang]`) — kalender reservasi, status meja real-time.
- **Online Order Hub** (`/dashboard/online-orders`) — catat pesanan dari
  GoFood/GrabFood/ShopeeFood/Website di satu tempat, dengan estimasi
  komisi platform.
- **Harga per Kanal** (`/dashboard/channel-pricing`) — harga berbeda per
  channel (mis. markup untuk kompensasi komisi platform online).
- **Analitik Pertumbuhan** (`/dashboard/analytics/growth`) — statistik
  kunjungan pelanggan, pelanggan tidak aktif; **Menu Engineering**
  (`/dashboard/analytics/menu-engineering`) — klasifikasi menu
  Star/Puzzle/Plowhorse/Dog berdasar popularitas & margin.

---

## 2. Export Laporan & HPP per Cabang

Halaman **`/dashboard/laporan-pdf`** menyediakan tiga mode export:

| Mode | Isi | Format |
|---|---|---|
| **Ringkasan** | Omzet, HPP, laba, omzet harian, menu terlaris, metode bayar | PDF |
| **Hanya Keuntungan** | Laba rugi, margin per kategori, menu penyumbang laba, tren laba, perbandingan cabang | PDF |
| **Semua Data** | Seluruh data caPOS (bagian A–G): penjualan, produk & resep, inventori, purchasing, pelanggan, operasional, analitik | PDF + Excel |

Catatan perilaku export:

- File PDF selalu mengikuti **cabang aktif** dan periode yang dipilih.
- Data besar (> 5.000 baris) menghasilkan **PDF ringkas**; data lengkap
  diunduh terpisah sebagai **satu file Excel**.
- File Excel berisi **satu sheet per tabel** + sheet analitik + sheet
  **Manifest** (jumlah baris, hash data, status pemotongan).
- **Tidak memakai ZIP** dan tidak ada dependency tambahan (`jszip`
  tidak diperlukan).
- Data pribadi (telepon, email pelanggan, rekening pemasok) disamarkan
  secara default. Owner/Super Admin bisa membukanya dengan konfirmasi.
  PIN, kunci pembayaran, dan kredensial tidak pernah diekspor.
- Setiap export dicatat di `export_logs` dan `audit_log`.

### Sumber HPP (fallback berjenjang)

1. `transaction_items.cost_price_snapshot` — diisi saat checkout
   (paling akurat).
2. `recipe_consumption_logs.cost_snapshot` — rekonstruksi data lama.
3. `calculate_recipe_cost(recipe_id, branch_id)` — bila resep masih ada.
4. Rata-rata tertimbang `branch_ingredients_stock` — bila tanpa resep.
5. `products.cost_price` — fallback terakhir, ditandai **estimasi**.

HPP menu bisa berbeda per cabang lewat tabel `product_branch_cost`
(override per `branch_id`). Mengubah HPP hari ini **tidak** mengubah laba
transaksi lama karena HPP disimpan sebagai snapshot.

Definisi metrik (omzet, HPP, laba kotor/bersih, susut, komisi, OPEX)
disatukan di `lib/metrics.ts` dan RPC `get_profit_report()`, sehingga
angka di halaman Laporan & Omzet, PDF, dan Excel konsisten.

---

## 3. Integritas Kas & Transaksi (migration_023)

Lima penguatan pada alur kas/transaksi:

### a. Rekonsiliasi shift

- `transaction_payments.amount` = **total transaksi** (pendapatan neto),
  sedangkan `transactions.cash_received` mencatat **uang fisik** yang
  diterima. Kembalian tidak dihitung sebagai penjualan.
- `shift_cash_summary()` menghitung kas seharusnya dari mutasi kas fisik
  (kas awal + penjualan tunai + kas masuk − kas keluar), bukan dari total
  penjualan.
- **Blind closing**: kasir tidak bisa melihat ringkasan sebelum shift
  ditutup. `close_shift()` menolak penutupan bila masih ada kembalian
  tertunda; penutupan paksa hanya bisa dengan PIN supervisor
  (`p_force_close`, `p_supervisor_pin`).
- Peringatan petty cash (`shift_cash_alert`) hanya mengembalikan status
  `is_low` + `threshold`, tanpa membocorkan saldo ke kasir.

### b. Kembalian dihitung server

- `checkout_transaction()` menghitung ulang harga, total, dan kembalian
  di server — nominal dari klien tidak dipercaya.
- Status kembalian: `NONE`, `PENDING`, `SETTLED`, `WRITTEN_OFF`.
- Bila uang kembalian belum diserahkan, kasir mengirim `p_change_pending`;
  transaksi muncul di banner POS dan halaman Transaksi untuk ditindak
  lanjuti lewat `confirm_change()` atau `write_off_change()`.
- `record_cash_tender()` mencatat uang tunai + kembalian untuk pembayaran
  split/open bill (`checkout_order_v2`).

### c. Idempotency

- `transactions.idempotency_key` unik per tenant: permintaan checkout
  berulang dengan key yang sama mengembalikan transaksi yang sama, tidak
  membuat transaksi ganda.
- Key dibuat sekali per percobaan checkout, disimpan di antrean offline
  Dexie, dan dipakai ulang saat sinkronisasi (`lib/offlineSync.ts`).

### d. Webhook Midtrans

- Tabel `midtrans_webhook_events` menyimpan dedupe per kombinasi
  `(order_id, transaction_status, status_code, fraud_status,
  gross_amount)`.
- `gross_amount` diverifikasi terhadap `payments.amount`,
  `qr_orders.total_amount`, dan `pos_qris_payments.gross_amount`. Bila
  tidak cocok, status tidak diubah dan event ditandai `AMOUNT_MISMATCH`.
- Perpanjangan langganan idempoten (`payments.subscription_granted_at`).
- Status `paid` bersifat **final**: notifikasi `pending`/`failed`/
  `expired` yang datang terlambat tidak menurunkan pembayaran yang sudah
  lunas.

### e. Transaksi immutable + audit

- `transactions`, `transaction_items`, `transaction_payments`, `shifts`,
  `cash_movements`, dan `audit_log` hanya bisa **dibaca** klien; semua
  penulisan lewat RPC `SECURITY DEFINER`.
- Trigger `BEFORE UPDATE OR DELETE` pada `transactions` menolak
  perubahan (`IMMUTABLE_TRANSACTION`). Hanya RPC internal
  (`confirm_change`, `write_off_change`, `record_cash_tender`) yang
  membuka gerbang itu secara terbatas.
- Perubahan harga produk dan mutasi kas tercatat di `audit_log`.
- RPC tambahan: `record_cash_exchange` (tukar uang, neto 0), `log_no_sale`
  (buka laci tanpa transaksi), `record_cash_tender`.
- Pengaturan per cabang: `petty_cash_threshold` (default Rp100.000) dan
  `change_due_minutes` (default 1.440 menit / 24 jam) di halaman
  **Pengaturan → Pembayaran**.

**Penerapan:** jalankan `supabase/migration_023_cash_integrity.sql`
setelah `migration_022_qris_selfservice_audio.sql`. File ini idempoten
(aman dijalankan ulang) dan sekaligus membersihkan sisa patch kas
alternatif yang sempat terpasang. Deploy aplikasi bersamaan dengan
migrasi — pemanggil lama `checkout_transaction` tetap kompatibel karena
empat parameter baru memakai nilai default.

---

## 4. Struktur Proyek (ringkas)

```
capos/
├── app/
│   ├── (auth)/login, register, forgot-password
│   ├── pos/                     # Kasir (offline-first)
│   ├── kitchen/                 # Kitchen Display System (Fase 2)
│   ├── order/[branch]/[table]/  # Self-order publik via QR (Fase 4, TANPA login)
│   ├── reserve/[branch]/        # Form reservasi publik (Fase 4, TANPA login)
│   ├── admin/                   # Super Admin
│   ├── actions/                 # Server Actions (Fase 3: purchasing/CRM/promosi)
│   ├── api/
│   │   ├── midtrans/notification/route.ts   # Webhook GABUNGAN: langganan + QRIS pesanan
│   │   └── orders/qris-charge/route.ts      # Generate QRIS dinamis utk pesanan QR
│   └── dashboard/
│       ├── laporan-pdf/                     # Export Ringkasan / Laba / Semua Data
│       ├── transactions/                    # Riwayat + confirm/write-off kembalian
│       ├── settings/payment/                # Petty cash & batas waktu kembalian
│       ├── purchasing/, crm/, promotions/   # Fase 3
│       └── qr-tables/, reservations/, online-orders/,
│           channel-pricing/, analytics/growth/,
│           analytics/menu-engineering/      # Fase 4
├── components/
│   ├── kitchen/, ShiftModal.tsx, MultiPaymentModal.tsx,
│   │   SendToKitchenModal.tsx               # Fase 2
│   ├── pos/PendingChangeBanner.tsx, SupervisorPinModal.tsx  # Integritas kas
│   ├── crm/, purchasing/, analytics/        # Fase 3
│   ├── tables/, reservations/, order/, pos/QrOrderAlert.tsx  # Fase 4
│   └── ...
├── lib/
│   ├── types.ts              # SEMUA tipe (Fase 1-4 digabung satu file)
│   ├── hpp.ts                # resolver HPP per cabang
│   ├── metrics.ts            # definisi metrik tunggal (omzet, HPP, laba)
│   ├── tier.ts               # aturan tier, batas riwayat & baris export
│   ├── exportApi.ts          # RPC export + audit
│   ├── export/fullExport.ts  # mode "Semua Data" (PDF / Excel)
│   ├── pdf/                  # renderer PDF (common, summary, profit)
│   ├── getCurrentProfile.ts  # versi CLIENT (dipakai di Client Component)
│   ├── getServerProfile.ts   # versi SERVER (dipakai di Server Action)
│   └── kitchenPrinter.ts, webBluetooth.d.ts  # cetak tiket dapur (Fase 2)
└── supabase/
    ├── schema.sql                              # Fondasi Fase 1
    ├── migration_001 .. migration_023          # Migrasi Fase 1-4, hardening & integritas kas
    ├── migration_023_cash_integrity.sql         # Shift, kembalian, idempotency, webhook, audit
    ├── 20251031_voucher_branch_scope.sql       # Voucher per cabang
    ├── 20251031_qr_order_page_branch_id.sql    # branch.id di halaman order QR
    ├── 20251104_product_branch_cost.sql        # HPP menu per cabang
    ├── 20251104_hpp_snapshot.sql               # Snapshot HPP di item transaksi
    ├── 20251104_profit_report_rpc.sql          # RPC laba rugi + tier
    ├── 20251104_full_export_rpc.sql            # RPC export semua data
    ├── 20251104_export_audit.sql               # Tabel export_logs
    └── reset_all.sql                           # Reset total (jaga-jaga)
```

---

## 5. Instalasi

**Baca `docs/PANDUAN_INSTALASI_WEB.md` untuk langkah lengkap tanpa
terminal/komputer lokal.** Ringkasannya:

1. Buat project Supabase baru → jalankan `supabase/schema.sql`, lalu
   seluruh migrasi bernomor **berurutan** dari `migration_001` sampai
   `migration_023` lewat SQL Editor (web, tidak perlu Supabase CLI).
2. Jalankan migrasi bertanggal `2025xxxx` **setelah** migrasi bernomor,
   dengan urutan:
   `20251031_voucher_branch_scope.sql` →
   `20251031_qr_order_page_branch_id.sql` →
   `20251104_product_branch_cost.sql` →
   `20251104_hpp_snapshot.sql` →
   `20251104_profit_report_rpc.sql` →
   `20251104_full_export_rpc.sql` →
   `20251104_export_audit.sql`.
3. `migration_023_cash_integrity.sql` dijalankan setelah
   `migration_022_qris_selfservice_audio.sql`. File ini idempoten (aman
   dijalankan ulang) dan membersihkan sisa patch kas alternatif bila ada.
   Deploy aplikasi bersamaan — RPC `checkout_transaction` tetap
   kompatibel dengan pemanggil lama karena parameter baru punya nilai
   default.
4. Import repo ini ke Vercel, isi Environment Variables (lihat
   `.env.local.example`), Deploy.
5. Buka domain Vercel-nya → daftar akun Owner pertama lewat `/register`.

**Build tidak di-upgrade pada revisi ini.** Versi yang dipakai:
Next.js 16.4.2, React 19.3.1, TypeScript 5.9.3, Tailwind CSS 3.4.19,
Node.js 24.x. Jalankan `npm install` mengikuti `package-lock.json`;
jangan `npm update` / upgrade framework untuk revisi ini.

## 6. Kalau Perlu Reset Total

Baca **`docs/PANDUAN_RESET_SUPABASE.md`**. Jangan jalankan
`supabase/reset_all.sql` kalau belum baca dokumen itu — file itu
**menghapus semua data tanpa bisa dibatalkan**.

---

## 7. Sistem Tier — Free Trial / Pro / Supreme

| | Free Trial | Pro (Bulanan) | Supreme (Tahunan) |
|---|---|---|---|
| Akun karyawan tambahan | Maks 2 | Unlimited | Unlimited |
| Jumlah menu | Maks 10 | Unlimited | Unlimited |
| Jumlah cabang | 1 | 3 | Unlimited |
| Riwayat transaksi | 14 hari terakhir | s.d. 30 hari | Unlimited |
| Export di `/dashboard` | CSV saja | CSV, Excel, PDF keuangan | Sama |
| Laporan PDF (`/dashboard/laporan-pdf`) | Terkunci | Semua mode | Semua mode |
| Mode "Semua Data" | Tidak | Ya (maks 50.000 baris/tabel) | Ya (maks 200.000 baris/tabel) |
| Kesehatan Penjualan | Tidak | Ya | Ya |
| Jam Ramai & Menu Terlaris | Tidak | Tidak | Ya |

Ditegakkan lewat trigger/RPC database, bukan cuma UI. Batas riwayat dan
baris export juga dicek server-side (`assert_export_allowed()`), jadi
tidak bisa dilewati dengan memanipulasi query.

---

## 8. Dokumentasi Lain

| Dokumen | Isi |
|---|---|
| `docs/PANDUAN_INSTALASI_WEB.md` | Deploy dari nol lewat dashboard web |
| `docs/PANDUAN_RESET_SUPABASE.md` | Reset project Supabase |
| `docs/CATATAN_PENGGABUNGAN.md` | Keputusan desain & technical debt |
| `docs/EXPORT_PDF_LENGKAP.md` | Export PDF/Excel, HPP per cabang, migrasi |
| `EXPORT_LAPORAN.md` | Definisi metrik & troubleshooting export |

## 9. Dukungan

Hubungi Studio D13 lewat tombol WhatsApp di halaman FAQ dashboard, atau
atur nomornya di `NEXT_PUBLIC_STUDIO_D13_WHATSAPP` (`.env.local`).
