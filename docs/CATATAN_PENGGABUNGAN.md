> **⚠️ SUPERSEDED (Phase 2A.1, 2026-09):** dokumen ini menjelaskan
> penggabungan PERTAMA (migration_012/013/014 "GABUNGAN" + migration_015-021
> terpisah). Set migration itu sudah diaudit ulang, digabung lagi, dan
> beberapa bug nyata di dalamnya diperbaiki (lihat
> `docs/PHASE_2A1_CONSOLIDATION_REPORT.md`). File migration final sekarang
> HANYA `migration_012_capos_phase1_fnb_core.sql` s/d
> `migration_015_capos_phase5_financial_intelligence_final.sql`. Dokumen ini
> disimpan sebagai catatan historis, BUKAN acuan struktur file saat ini.

# Catatan Penggabungan (Merge Notes) — HISTORIS, lihat notice di atas

Dokumen ini menjelaskan **bagaimana** ke-4 fase dan 3 file ZIP yang
tumpang tindih digabung menjadi paket ini, keputusan desain yang diambil,
bug yang ditemukan & diperbaiki, dan hal yang sengaja belum dikerjakan.
Baca ini kalau kamu (atau developer lain) bingung kenapa struktur project
tidak 100% sama dengan salah satu ZIP asli.

---

## 1. File Sumber yang Digabung

| File | Isi |
|---|---|
| `capos-phase2.zip` | Aplikasi lengkap Fase 1 + Fase 2 (Kitchen/Shift/Kas) |
| `capos-updated.zip` | Hampir sama dengan phase2, tapi punya cabang fitur "Manajemen Meja" sendiri yang **berbeda desain** — lihat #2 di bawah |
| `capos-phase3.zip` | Paket tambahan (bukan aplikasi utuh) — Purchasing/CRM/Promosi/Analitik |
| `capos-phase4.zip` | Paket tambahan (bukan aplikasi utuh) — QR Meja/Reservasi/Multi-channel |
| `phase3_schema.sql`, `phase4_schema.sql`, `migration_012_phase2_kitchen_shift_cash.sql` | Sama persis dengan versi di dalam ZIP masing-masing — dipakai untuk verifikasi |

**Basis yang dipakai: `capos-phase2.zip`**, bukan `capos-updated.zip`.
Alasannya di bagian berikut.

---

## 2. Temuan Penting: Dua Desain Tabel `orders` yang Berbeda

`capos-updated.zip` punya `migration_012_fnb_tables_orders.sql` sendiri
yang membuat tabel `tables`/`orders`/`order_items` dengan struktur kolom
**berbeda total** dari `migration_012_phase2_kitchen_shift_cash.sql` (mis.
status pesanan `open/sent_to_kitchen/ready/waiting_payment/paid` vs
`NEW/ACCEPTED/PREPARING/READY/SERVED/COMPLETED`). Keduanya sama-sama
diberi nomor `migration_012` — jelas ini dua cabang pengembangan yang
divergen dan tidak pernah digabung sebelumnya.

Setelah ditelusuri, **Fase 3 dan Fase 4 (yang lebih baru & lebih lengkap)
ternyata dibangun di atas desain Fase 2** — terlihat jelas dari:
- `phase4_schema.sql` memakai `orders.order_number`, `orders.status`
  bernilai `'COMPLETED'`/`'CANCELLED'` (bukan `'paid'`/`'cancelled'`),
  dan `order_items.variant_notes` — semua field khas Fase 2.
- Fungsi `submit_qr_order()` di Fase 4 menyisipkan langsung ke struktur
  tabel Fase 2.
- `table_live_status` VIEW (Fase 4) memfilter `status NOT IN ('COMPLETED', 'CANCELLED')`.

Kesimpulan: cabang `capos-updated.zip` adalah **eksperimen yang tidak
berlanjut** — fitur "Manajemen Meja"-nya (`/dashboard/tables`,
`/pos/tables`) **tidak dipakai** dalam paket final ini karena:
1. Skemanya bentrok dengan fondasi yang dipakai Fase 3 & 4.
2. Fungsinya sudah digantikan (dan lebih lengkap) oleh fitur QR Meja +
   `TableStatusBoard` dari Fase 4 (`/dashboard/qr-tables`,
   `/dashboard/reservations`).

**Konsekuensi:** kalau ada data/kustomisasi yang pernah dibuat khusus di
`app/dashboard/tables/page.tsx` atau `app/pos/tables/page.tsx` versi
`capos-updated.zip`, itu **tidak ikut** ke paket final ini. Beri tahu
developer kalau ternyata ada logic penting di sana yang perlu
dipindahkan manual.

---

## 3. Penomoran Migration Final

| File | Isi |
|---|---|
| `schema.sql` + `migration_001` s/d `migration_011` | Identik di semua sumber, tidak diubah |
| `migration_012_phase2_kitchen_shift_cash.sql` | Fase 2 — dipakai apa adanya (bukan versi `capos-updated.zip`) |
| `migration_013_phase3_purchasing_crm_promosi_analitik.sql` | Diganti nama dari `phase3_schema.sql`, isi tidak diubah (sudah kompatibel) |
| `migration_014_phase4_qr_reservasi_multichannel_growth.sql` | Diganti nama dari `phase4_schema.sql`, isi tidak diubah (sudah kompatibel) |

---

## 4. Bug yang Ditemukan & Diperbaiki Saat Penggabungan

### 4a. Server Actions Fase 3 salah panggil helper client-side
`app/actions/purchasing-loyalty-actions.ts` (16 fungsi) memanggil
`getCurrentProfile()` dari `lib/getCurrentProfile.ts` — tapi file itu
`"use client"` dan pakai Supabase **browser** client, yang tidak
punya akses session kalau dipanggil dari **Server Action**. Akibatnya
semua fungsi ini akan **selalu gagal** dengan pesan "Tenant tidak
ditemukan", walau user sudah login.

**Perbaikan:** dibuat `lib/getServerProfile.ts` (versi server, pakai
`lib/supabase/server.ts`), semua 16 pemanggilan diganti ke fungsi ini.

### 4b. `PromotionBuilder` tidak benar-benar menyimpan promosi
Form "Buat Promosi Baru" di `components/crm/CustomerLoyaltyModal.tsx`
punya `handleSubmit` yang isinya cuma `// TODO: Call createPromotion from
actions` — menampilkan pesan "Promosi berhasil dibuat!" **palsu** tanpa
insert apa pun ke database.

**Perbaikan:** disambungkan ke `createPromotion()` (yang sebenarnya sudah
lengkap & benar implementasinya, cuma belum dipanggil).

### 4c. Komponen modal salah pakai API `<Modal>` proyek ini
4 tempat (`CustomerLoyaltyModal`, `PromotionBuilder`,
`PurchaseOrderDashboard` ×2, `SupplierManagement`) menulis
`<Modal isOpen={x} onClose={y}>`, padahal komponen `components/Modal.tsx`
proyek ini **tidak** punya prop `isOpen` (ia selalu tampil begitu
di-render — kontrol tampil/sembunyi dilakukan lewat conditional rendering
`{x && <Modal>...}` di pemanggilnya) dan **mewajibkan** prop `title`.
Ini akan gagal saat `next build` (TypeScript type-check).

**Perbaikan:** semua 5 lokasi diubah ke pola `{x && (<Modal title="...">...)}`.

### 4d. Import path salah di semua komponen Fase 3
`CustomerLoyaltyModal.tsx`, `PurchaseOrderDashboard.tsx`,
`SupplierManagement.tsx`, `AnalyticsComponents.tsx` semua meng-import dari
`@/app/actions-phase3`, path yang tidak sesuai dengan lokasi file aksi
yang sebenarnya (`app/actions/purchasing-loyalty-actions.ts`, sesuai
instruksi resmi di `docs/PHASE3_SUMMARY.md`).

**Perbaikan:** semua import path diarahkan ulang.

### 4e. Import path salah di semua komponen Fase 4
12 file meng-import tipe dari `@/lib/types-phase4` — path ini valid di
paket Fase 4 yang berdiri sendiri (ada file `lib/types-phase4.ts`
terpisah), tapi paket final ini **menggabungkan** isi file itu ke akhir
`lib/types.ts` (sesuai instruksi resmi di `docs/PATCH_INSTRUCTIONS.md`),
jadi file `types-phase4.ts` terpisah **tidak ada** di paket ini.

**Perbaikan:** semua import diarahkan ke `@/lib/types`.

---

## 5. Fitur yang Ditambahkan Saat Penggabungan (Melengkapi yang Kurang)

Paket Fase 3 asli hanya menyediakan komponen & server actions siap pakai,
tapi **belum ada halaman dashboard** yang memakainya (sesuai catatan
"Deliverables" di `docs/PHASE3_SUMMARY.md` — dokumen itu memang cuma
kerangka acuan implementasi, bukan halaman jadi). Yang ditambahkan:

- `app/dashboard/purchasing/suppliers/page.tsx`
- `app/dashboard/purchasing/purchase-orders/page.tsx`
- `app/dashboard/crm/customers/page.tsx` — **dibangun dari nol**, karena
  Fase 3 cuma sediakan modal pencarian pelanggan (untuk dipakai di POS),
  belum ada direktori/daftar pelanggan penuh untuk dashboard. Server
  action pendukung baru: `getCustomers()`, `toggleCustomerActive()`.
- `app/dashboard/promotions/page.tsx` — **dibangun dari nol** (daftar
  promosi + tombol buka `PromotionBuilder`). Server action pendukung
  baru: `getPromotions()`, `togglePromotionActive()`.
- `app/dashboard/analytics/profitability/page.tsx`,
  `.../peak-hours/page.tsx`, `.../waste-loss/page.tsx`
- Entri navigasi Fase 3 & Fase 4 di `components/DashboardSidebar.tsx`
  (paket Fase 3 tidak menyediakan potongan kode sidebar sama sekali;
  Fase 4 menyediakan tapi belum termasuk Fase 3).
- `QrOrderAlert` (notifikasi real-time pesanan QR/online) dipasang juga
  di layar Kitchen Display (`/kitchen`), sebagai tambahan dari yang
  disebutkan di `PATCH_INSTRUCTIONS.md` (yang hanya menyebut PosNavbar).

---

## 6. Yang SENGAJA Belum Dikerjakan (Technical Debt yang Disadari)

- **Aturan promosi lanjutan** (`promotion_rules` dengan tipe `CATEGORY`,
  `HAPPY_HOUR`, dst) — kolomnya sudah ada & bisa diisi lewat
  `PromotionBuilder`, tapi **logika penerapan otomatis saat checkout**
  (mis. otomatis nonaktif di luar jam happy hour) belum diverifikasi
  terhubung ke `checkout_transaction()`. Cek `migration_013` bagian
  `validateAndApplyVoucher` sebelum mengandalkan ini di produksi.
- **Integrasi harga per kanal ke self-order QR** — `channel_pricing`
  (Fase 4) tersedia sebagai tabel & halaman kelola, tapi perlu
  diverifikasi manual apakah `submit_qr_order()` sudah membaca harga dari
  situ atau masih dari harga dasar produk.
- **Tidak ada test otomatis** — penggabungan ini diverifikasi lewat
  pembacaan kode & pencocokan skema/fungsi/tipe secara manual, bukan
  lewat `npm run build` atau test suite sungguhan (lingkungan penggabungan
  ini tidak menjalankan Next.js). **Sangat disarankan** jalankan
  `npm install && npm run build` di lingkungan development sebelum
  deploy ke produksi, untuk menangkap kemungkinan kesalahan tipe/sintaks
  yang lolos dari pemeriksaan manual.
