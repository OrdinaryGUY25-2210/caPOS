# caPOS — Point of Sale Kafe by Studio D13

Aplikasi Web App SaaS POS Kafe berbasis Next.js (App Router), Tailwind CSS,
Lucide Icons, Dexie.js (IndexedDB, offline-first), dan Supabase (Auth +
Postgres + Storage + Realtime) — PWA, integrasi pembayaran Midtrans, sistem
tier Free Trial / Pro / Supreme, role Owner/Manager/Kasir dengan alur
persetujuan, dan Program Referral.

---

## 1. Fitur Utama

### Akun & Akses
- Registrasi terbuka (`/register`) tanpa kode wajib, verifikasi via kode OTP.
  Kolom Kode Referral bersifat opsional.
- 4 Role: `super_admin`, `owner`, `manager` (akses dashboard setara owner +
  kelola kehadiran karyawan), `cashier` (akses `/pos` saja).
- Manajemen Karyawan (`/dashboard/employees`) — Owner buat akun Manager/Kasir
  dengan password asli + konfirmasi (bukan password sementara), plus label
  jabatan bebas (mis. "Barista").

### Sistem Persetujuan (Anti-Kecurangan Harga)
- Kasir bisa usulkan menu baru langsung dari `/pos` — masuk antrean, tidak
  langsung tayang di kasir manapun.
- Manager/Owner dapat notifikasi lonceng real-time (Supabase Realtime) di
  navbar dashboard, approve/reject dari situ.
- Perubahan ke tabel products hanya terjadi lewat fungsi database
  `review_approval_request()` setelah disetujui — tidak bisa dilewati dari client.

### Kasir (`/pos`)
- Cari & pilih menu, keranjang, diskon member, cetak struk, shift kasir
  otomatis, checkout dihitung ulang di server, tetap jalan offline.

### Dashboard Owner/Manager
- Laporan & Omzet dari data transaksi asli + Kesehatan Penjualan (Pro+).
- Riwayat Transaksi, Kelola Menu (kompresi gambar otomatis, kategori bebas,
  harga bisa dikosongkan/ditulis manual — bukan terkunci di "0").
- Kehadiran Karyawan — catat/tinjau izin, sakit, cuti.
- Program Referral (`/dashboard/referral`) — lihat kode unik & progress.

### Sistem Tier — Free Trial / Pro / Supreme

| | Free Trial | Pro (Bulanan) | Supreme (Tahunan) |
|---|---|---|---|
| Akun karyawan tambahan (kasir+manager) | Maks 2 | Unlimited | Unlimited |
| Jumlah menu | Maks 10 | Unlimited | Unlimited |
| Riwayat transaksi | 14 hari terakhir | s.d. 30 hari | Unlimited |
| Kesehatan Penjualan | Tidak | Ya | Ya |
| Jam Ramai & Menu Terlaris, Export Excel/PDF | Tidak | Tidak | Ya |

Ditegakkan lewat trigger database (`enforce_cashier_limit()`,
`enforce_menu_limit()`), bukan cuma UI — tidak bisa dilewati lewat panggilan
API langsung.

### Program Referral
- Tiap tenant otomatis dapat 1 kode unik permanen saat daftar.
- Orang lain daftar pakai kode itu → begitu mereka top up pertama kali,
  pemilik kode dapat +3% (akumulasi, maks 5 orang = 15%).
- Pendaftar yang pakai kode referral apa pun dapat diskon 2% untuk
  pembayaran pertamanya sendiri.
- Reset terjadi setiap kali pemilik kode top up — memakai berapa pun
  akumulasi yang terkumpul saat itu (tidak perlu menunggu penuh 5/5).
  Kombinasi maksimal dalam satu transaksi: 2% + 15% = 17%.
- Kode khusus Super Admin (`SUPER_ADMIN_REFERRAL_CODE` di env): pendaftar
  dapat 5 hari akses Supreme penuh tanpa bayar, lalu otomatis turun ke sisa
  23 hari trial standar (total tetap 28 hari) — plus tetap dapat diskon 2%.

### Lainnya
- Pembayaran Midtrans (Snap) dengan diskon otomatis terhitung & webhook
  terverifikasi signature.
- Super Admin (`/admin`) — statistik tenant, perpanjang/aktifkan langganan.
- PWA — install ke home screen, jalan offline.
- Responsif di semua ukuran layar.

---

## 2. Struktur Proyek (ringkas)

```
capos/
├── app/
│   ├── register/page.tsx            # Kode referral OPSIONAL + konfirmasi password
│   ├── api/
│   │   ├── register/route.ts        # Handle kode referral, generate kode unik tenant baru
│   │   ├── employees/route.ts       # Ganti dari /api/cashiers — role Manager/Kasir, password asli
│   │   └── midtrans/
│   │       ├── create-transaction/route.ts  # Hitung diskon referral sebelum kirim ke Midtrans
│   │       └── notification/route.ts        # Proses reward + reset akumulasi referral
│   ├── pos/page.tsx                 # + CashierQuickActions (usulkan menu)
│   └── dashboard/
│       ├── employees/page.tsx       # Manajemen Karyawan (dulu "cashiers")
│       ├── attendance/page.tsx      # Kehadiran Karyawan
│       ├── referral/page.tsx        # Program Referral
│       └── ... (menu, transactions, subscription, dst)
├── components/
│   ├── NotificationBell.tsx         # Lonceng approval real-time
│   ├── CashierQuickActions.tsx      # Tombol "Usulkan Menu" di POS
│   └── ...
├── lib/
│   ├── role.ts                      # Helper role (Manager, dst)
│   ├── generateReferralCode.ts
│   └── tier.ts
└── supabase/
    ├── schema.sql                   # Setup baru — sudah termasuk SEMUA fitur
    ├── migration_007a_add_manager_role.sql   # WAJIB dijalankan SENDIRI (enum)
    ├── migration_007b_manager_features.sql   # Approval, attendance, dst
    ├── migration_008_referral_system.sql     # Sistem referral
    └── reset_all.sql
```

---

## 3. Instalasi

### Setup Supabase baru (dari nol)
Jalankan `supabase/schema.sql` satu file saja — semua fitur di atas sudah termasuk.

### Project Supabase yang sudah ada
Jalankan berurutan, skip yang sudah pernah dijalankan (semua idempotent):
1. migration_001, 2. migration_002 (kritis), 3. migration_003 (Midtrans),
4. migration_004 (kolom plan), 5. migration_005 (tier/shift/analitik),
6. migration_007a_add_manager_role.sql — WAJIB DIJALANKAN SENDIRI
(nambah enum, tidak boleh digabung query lain dalam satu klik Run),
7. migration_007b_manager_features.sql, 8. migration_008_referral_system.sql.

Setelah migrasi 007b, cek Database → Replication di Supabase Dashboard,
pastikan tabel approval_requests tercentang aktif di publication
supabase_realtime (untuk notifikasi lonceng real-time).

### Environment Variables tambahan
```
SUPER_ADMIN_REFERRAL_CODE=kode-rahasia-anda
```

Bucket Storage, SMTP, template OTP — sama seperti sebelumnya, lihat komentar
di `.env.local.example`, lalu jalankan `npm install && npm run dev`.

---

## 4. Cara Uji Alur Approval

1. Login Owner → Manajemen Karyawan → buat 1 akun Manager, 1 akun Kasir
2. Login Kasir → `/pos` → klik "Usulkan Menu" → isi & kirim
3. Login Manager/Owner → lihat lonceng di kanan atas dashboard → badge
   merah muncul otomatis (real-time, tanpa refresh)
4. Klik Setujui → cek menu muncul di Kelola Menu

---

## 5. Catatan Implementasi Penting

- Manager diperlakukan sama seperti Owner untuk akses dashboard, kecuali
  membuat/menghapus akun karyawan (tetap wewenang Owner) dan `/admin`.
- Harga menu: input disimpan sebagai string terpisah dari Product.price di
  form — memperbaiki bug lama di mana kolom selalu balik ke "0" saat
  dikosongkan (Number("") = 0 ditulis balik ke state).
- Kategori menu bebas lewat datalist — bisa pilih yang sudah ada atau
  ketik kategori baru.
- Reset diskon referral terjadi di webhook, bukan di create-transaction —
  supaya kalau pembayaran gagal/dibatalkan, akumulasi tidak hilang percuma.
- Kode referral tidak bisa dipakai untuk kode sendiri (dicegah di
  redeem_referral_code()).
- Realtime butuh tabel didaftarkan ke publication supabase_realtime —
  migrasi mencoba otomatis lewat ALTER PUBLICATION, tapi wajib dicek
  manual di Dashboard karena ini kadang butuh konfirmasi UI.

---

## 6. Dukungan

Hubungi Studio D13 lewat tombol WhatsApp di halaman FAQ dashboard, atau atur
nomornya di `NEXT_PUBLIC_STUDIO_D13_WHATSAPP` (`.env.local`).
