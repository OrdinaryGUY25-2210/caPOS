# Phase 4 — Perubahan Kecil di File yang SUDAH ADA

File-file di bawah ini **sudah ada** sejak Phase 1-3 dan cukup ditambah
beberapa baris (bukan ditimpa total). Salin bagian yang ditandai ke lokasi
yang sesuai di file aslimu.

---

## 1. `middleware.ts` — buka akses publik untuk `/order` dan `/reserve`

Pelanggan yang scan QR / mengisi form reservasi publik **tidak login**,
jadi kedua path ini harus ditambahkan ke `publicPaths`.

```ts
// SEBELUM:
const publicPaths = ["/login", "/register", "/forgot-password"];

// SESUDAH:
const publicPaths = ["/login", "/register", "/forgot-password", "/order", "/reserve"];
```

Tidak ada perubahan lain di middleware — guard role (super_admin/owner/
manager/cashier) untuk `/admin` dan `/dashboard` tetap seperti semula.

---

## 2. `lib/types.ts` — tambahkan tipe Phase 4

Tempel seluruh isi `lib/types-phase4.ts` (di paket ini) ke **akhir**
`lib/types.ts` yang sudah ada. Tidak ada tipe lama yang perlu diubah,
KECUALI dua interface berikut yang perlu ditambah field baru (kolom yang
sama juga ditambahkan ke tabelnya lewat `phase4_schema.sql`):

```ts
export interface Branch {
  // ...field lama tetap...
  slug: string; // BARU — dipakai di URL publik /order & /reserve
}

export interface Order {
  // ...field lama tetap...
  table_id: string | null;               // BARU — tautan ke branch_tables
  channel: OrderChannel;                 // BARU — 'pos' | 'qr_self_order' | 'reservation' | 'gofood' | 'grabfood' | 'shopeefood' | 'website'
  channel_commission_amount: number;     // BARU — snapshot komisi platform saat order dibuat
}
```

---

## 3. `components/DashboardSidebar.tsx` — menu navigasi baru

Tambahkan import ikon berikut ke baris import `lucide-react` yang sudah ada:

```ts
import {
  // ...ikon lama tetap...
  QrCode,
  CalendarClock,
  Bike,
  Percent,
  TrendingUp,
  Grid3x3,
} from "lucide-react";
```

Lalu tambahkan 5 baris berikut ke array `NAV_ITEMS` (disarankan setelah
item `"Kelola Menu & Stok"` supaya berkelompok dengan operasional harian):

```ts
{ href: "/dashboard/qr-tables", label: "QR Meja & Self-Order", icon: QrCode },
{ href: "/dashboard/reservations", label: "Reservasi Meja", icon: CalendarClock },
{ href: "/dashboard/online-orders", label: "Online Order Hub", icon: Bike },
{ href: "/dashboard/channel-pricing", label: "Harga per Kanal", icon: Percent },
{ href: "/dashboard/analytics/growth", label: "Analitik Pertumbuhan", icon: TrendingUp },
{ href: "/dashboard/analytics/menu-engineering", label: "Menu Engineering", icon: Grid3x3 },
```

---

## 4. `components/PosNavbar.tsx` — pasang notifikasi pesanan QR/Online

Import komponen baru dan render di dalam navbar POS (butuh `branch_id`
kasir yang sedang login — variabel ini biasanya sudah ada di komponen
POS sebagai `profile.branch_id` atau `session.branchId`):

```tsx
import QrOrderAlert from "@/components/pos/QrOrderAlert";

// ...di dalam JSX PosNavbar, di mana saja (elemen ini fixed-position):
<QrOrderAlert branchId={profile?.branch_id ?? null} />
```

Kalau ingin notifikasi yang sama juga muncul di layar KDS
(`app/kitchen/page.tsx`), pasang komponen yang sama di sana dengan
`branchId` yang dipakai KDS.

---

## 5. `package.json` — dependency baru

Phase 4 memakai 2 library tambahan untuk Generator QR (belum ada di
Phase 1-3):

```bash
npm install qrcode
npm install --save-dev @types/qrcode
```

`jspdf` dan `jspdf-autotable` yang dipakai untuk PDF cetak QR meja
**sudah ada** di `package.json` sejak Phase 1 (dipakai `laporan-pdf`),
jadi tidak perlu diinstal ulang.

---

## 6. Environment Variables — tidak ada variabel BARU

QRIS Dynamic (Phase 4) memakai `MIDTRANS_SERVER_KEY` yang **sama** dengan
yang sudah kamu set sejak Phase 1 untuk pembayaran langganan. Tidak ada
`.env` baru yang wajib ditambahkan. Opsional:

```
MIDTRANS_IS_PRODUCTION=false   # "true" kalau sudah pakai server key production
```

Kalau variabel ini tidak diset, `app/api/orders/qris-charge` otomatis
memakai Midtrans **Sandbox** — aman untuk uji coba sebelum go-live.

---

## 7. Midtrans Dashboard — Payment Notification URL

Karena webhook pembayaran pesanan QR dipisah dari webhook langganan
(lihat komentar di `app/api/midtrans/order-notification/route.ts`), kalau
akun Midtrans-mu hanya mengizinkan **satu** Payment Notification URL,
pilih salah satu:

- **Opsi A (disarankan):** gabungkan isi `order-notification/route.ts` ke
  dalam `app/api/midtrans/notification/route.ts` yang sudah ada — cukup
  tambahkan pengecekan `if (order_id.startsWith("QRORDER-"))` di awal
  handler existing untuk mencabangkan ke logika `mark_qr_order_paid`.
- **Opsi B:** daftarkan dua Merchant/Account berbeda di Midtrans kalau
  ingin memisah environment langganan vs pesanan sepenuhnya.

---

## 8. `app/globals.css` — kelas utilitas kecil (opsional, kosmetik)

Halaman `/order/[branch]/[table]` memakai kelas `no-scrollbar` untuk
menyembunyikan scrollbar strip kategori menu. Tambahkan ke `globals.css`
(opsional — tanpa ini scrollbar tetap muncul, tidak ada yang rusak):

```css
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
```
