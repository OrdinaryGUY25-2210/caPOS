# caPOS — Point of Sale Kafe/Restoran by Studio D13

Aplikasi web SaaS POS untuk kafe/restoran berbasis Next.js (App Router),
Tailwind CSS, Dexie.js (IndexedDB, offline-first), dan Supabase
(Auth + Postgres + Storage + Realtime).

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

---

## 1. Empat Fase Fitur

### Fase 1 — Inti POS & SaaS
- Registrasi tenant, 4 role (`super_admin`/`owner`/`manager`/`cashier`),
  kasir offline-first (Dexie), member/loyalti dasar, langganan
  Free Trial/Pro/Supreme via Midtrans, Program Referral, multi-cabang,
  stok opname, Laporan PDF Otomatis, Target Bulanan, Evaluasi Kasir.

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

## 2. Struktur Proyek (ringkas)

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
│       ├── purchasing/, crm/, promotions/   # Fase 3
│       └── qr-tables/, reservations/, online-orders/,
│           channel-pricing/, analytics/growth/,
│           analytics/menu-engineering/      # Fase 4
├── components/
│   ├── kitchen/, ShiftModal.tsx, MultiPaymentModal.tsx,
│   │   SendToKitchenModal.tsx               # Fase 2
│   ├── crm/, purchasing/, analytics/        # Fase 3
│   ├── tables/, reservations/, order/, pos/QrOrderAlert.tsx  # Fase 4
│   └── ...
├── lib/
│   ├── types.ts              # SEMUA tipe (Fase 1-4 digabung satu file)
│   ├── getCurrentProfile.ts  # versi CLIENT (dipakai di Client Component)
│   ├── getServerProfile.ts   # versi SERVER (dipakai di Server Action)
│   └── kitchenPrinter.ts, webBluetooth.d.ts  # cetak tiket dapur (Fase 2)
└── supabase/
    ├── schema.sql                                              # Fondasi Fase 1
    ├── migration_001 .. migration_011                          # Fase 1 lanjutan
    ├── migration_012_phase2_kitchen_shift_cash.sql              # Fase 2
    ├── migration_013_phase3_purchasing_crm_promosi_analitik.sql # Fase 3
    ├── migration_014_phase4_qr_reservasi_multichannel_growth.sql# Fase 4
    └── reset_all.sql                                            # Reset total (jaga-jaga)
```

---

## 3. Instalasi

**Baca `docs/PANDUAN_INSTALASI_WEB.md` untuk langkah lengkap tanpa
terminal/komputer lokal.** Ringkasannya:

1. Buat project Supabase baru → jalankan `supabase/schema.sql`, lalu
   `migration_001` s/d `migration_014` **berurutan** dari SQL Editor
   (web, tidak perlu Supabase CLI).
2. Upload folder ini ke repo GitHub baru (lewat web GitHub, drag & drop).
3. Import repo itu ke Vercel, isi Environment Variables (lihat
   `.env.local.example`), Deploy.
4. Buka domain Vercel-nya → daftar akun Owner pertama lewat `/register`.

## 4. Kalau Perlu Reset Total

Baca **`docs/PANDUAN_RESET_SUPABASE.md`**. Jangan jalankan
`supabase/reset_all.sql` kalau belum baca dokumen itu — file itu
**menghapus semua data tanpa bisa dibatalkan**.

---

## 5. Sistem Tier — Free Trial / Pro / Supreme

| | Free Trial | Pro (Bulanan) | Supreme (Tahunan) |
|---|---|---|---|
| Akun karyawan tambahan | Maks 2 | Unlimited | Unlimited |
| Jumlah menu | Maks 10 | Unlimited | Unlimited |
| Riwayat transaksi | 14 hari terakhir | s.d. 30 hari | Unlimited |
| Kesehatan Penjualan | Tidak | Ya | Ya |
| Jam Ramai, Menu Terlaris, Export | Tidak | Tidak | Ya |

Ditegakkan lewat trigger database, bukan cuma UI.

---

## 6. Dukungan

Hubungi Studio D13 lewat tombol WhatsApp di halaman FAQ dashboard, atau
atur nomornya di `NEXT_PUBLIC_STUDIO_D13_WHATSAPP` (`.env.local`).
