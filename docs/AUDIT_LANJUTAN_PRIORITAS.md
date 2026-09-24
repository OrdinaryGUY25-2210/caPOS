# Audit & Lanjutan caPOS — Priority 0–4

Dokumen ini merangkum hasil audit terhadap `caPOS.zip` yang diupload,
apa yang **sudah dibuatkan** di paket ini (kode dasar), dan **apa yang
masih harus dilanjutkan** — supaya AI/developer berikutnya tidak perlu
audit ulang dari nol.

Cara pakai file-file di paket ini: **timpa (replace)** file dengan path
yang sama persis di project `caPOS/` kamu. Semua path di bawah relatif
terhadap root project (folder yang berisi `package.json`).

---

## PRIORITY 0 — Canonical Project Structure — Target 100%

**Status: Temuan kritis ditemukan, sebagian diperbaiki di paket ini.**

### Temuan
1. **Ada duplikasi project**: `capos/capos/` (nested) adalah *project
   Fase‑1 yang sudah usang* — cuma 7 modul dashboard, tanpa
   `components/ui/` design system, komponen lama seperti
   `DashboardSidebar.tsx` / `PosNavbar.tsx` (bukan struktur
   `components/sidebar/` + `components/layout/` yang dipakai project
   utama). Project utama (`caPOS/` root) py 32 modul dashboard dan
   sudah pakai struktur final → **`caPOS/` root adalah canonical**,
   `capos/` nested **harus dihapus seluruhnya**.
2. **File wajib di root `app/` HILANG**: `app/layout.tsx`,
   `app/globals.css`, dan `app/page.tsx` tidak ada sama sekali di zip
   yang diupload. Tanpa file-file ini, `next build` akan gagal —
   project **tidak bisa jalan** dalam kondisi semula.

### Yang sudah dibuat di paket ini
| File | Lokasi tujuan | Keterangan |
|---|---|---|
| `app/layout.tsx` | `app/layout.tsx` | Root layout, load font Inter via `next/font`, import `globals.css`, metadata + PWA manifest link |
| `app/globals.css` | `app/globals.css` | Tailwind base + CSS variables (radius, shadow) + base focus-visible style |
| `app/page.tsx` | `app/page.tsx` | Redirect `/` → `/login` (middleware sudah handle redirect role-based untuk user yang sudah login) |

### Belum dikerjakan (lanjutkan di AI lain)
- **Hapus folder `capos/` (nested) dari repo** — ini aksi file-system,
  bukan sesuatu yang bisa dikirim sebagai "file baru". Jalankan salah
  satu:
  ```bash
  git rm -r capos/
  git commit -m "chore: remove orphaned nested Phase-1 project"
  ```
  atau hapus manual folder `capos/` lewat GitHub web UI / file manager,
  lalu commit.
- Setelah dihapus, jalankan `npm install && npm run build` untuk
  memastikan tidak ada import yang diam-diam mengacu ke
  `capos/components/...` dari project utama (cross-check dengan
  `grep -r "from '.*capos/" app/ components/ lib/` sebelum menghapus,
  untuk jaga-jaga).
- Audit ulang apakah ada file "hasil eksperimen" lain di luar
  `capos/` (mis. file `*.bak`, `*_old.tsx`, `*_copy.tsx`) — belum
  ditemukan di scan awal, tapi perlu diperiksa lagi setelah lebih
  banyak halaman diaudit.

---

## PRIORITY 1 — Global Design System — Target 98–100%

**Status: Base component sudah ada sebelumnya, tapi TIDAK memakai
brand token → sudah ditulis ulang di paket ini.**

### Temuan
`components/ui/*.tsx` (16 file) sudah ada di zip, sesuai daftar audit.
Tapi semua komponen memakai warna Tailwind generik (`bg-blue-600`,
`text-gray-700`, `border-red-200`, dst) — **bukan** token brand yang
didefinisikan di `tailwind.config.ts` (`primary` hijau `#10B981`,
`urgent`, `warning`, `neutral`, `sidebar`). Artinya walau semua halaman
sudah memakai komponen yang sama, warnanya tetap tidak konsisten
dengan identitas visual caPOS. Radius, focus state, disabled state,
dan tinggi elemen form (`Button`/`Input`/`Select`) juga belum
diseragamkan antar komponen.

### Yang sudah dibuat/ditulis ulang di paket ini
Semua file di bawah → timpa ke `components/ui/`:

| File | Perubahan utama |
|---|---|
| `Button.tsx` | Token `primary`/`urgent`, size terkunci `sm/md/lg` (h-8/h-10/h-12, align dengan Input & Select), state `loading`, focus-visible ring |
| `Card.tsx` | + `CardHeader`, `CardTitle`; shadow token `--shadow-card` |
| `Alert.tsx` | Peta warna status disamakan dengan Badge & Toast |
| `Badge.tsx` | Peta warna status disamakan dengan Alert & Toast |
| `Input.tsx` | `forwardRef`, error/hint state, tinggi `h-10` konsisten dengan Button md |
| `Select.tsx` | `forwardRef`, placeholder option, error/hint state, tinggi `h-10` |
| `Modal.tsx` | Size terkunci `sm/md/lg`, ESC to close, lock scroll body, footer slot |
| `Confirmation.tsx` | Pakai `footer` slot Modal baru, tambah `loading` state |
| `EmptyState.tsx` | Icon container konsisten, size Button `sm` |
| `ErrorState.tsx` | Warna `urgent`, aksi opsional (tidak dipaksa selalu ada tombol) |
| `Skeleton.tsx` | + helper `SkeletonTableRows` untuk state Loading tabel |
| `Table.tsx` | Wrapper `overflow-x-auto` + border, header uppercase neutral-500 |
| `Tabs.tsx` | Controlled/uncontrolled (`value`/`onChange` opsional), disabled tab, a11y `role="tablist"` |
| `Toast.tsx` | Token warna status, `onDismiss` callback |
| `Tooltip.tsx` | `onFocus`/`onBlur` untuk aksesibilitas keyboard, opsi `side` |
| `Pagination.tsx` | Windowing halaman (`1 … 4 5 6 … 20`) untuk total halaman besar, `aria-current` |

Semua komponen sekarang import `cx` dari `lib/utils.ts` (helper yang
sudah ada di project — tidak menambah dependency baru).

`app/globals.css` (lihat Priority 0) juga bagian dari Priority 1:
mendefinisikan `--radius-*`, `--shadow-*`, focus-visible ring global,
dan scrollbar tipis.

### Belum dikerjakan (lanjutkan di AI lain)
- **Grep & ganti seluruh halaman** yang masih memakai warna hardcoded
  (`bg-blue-*`, `bg-red-*`, dst di luar `components/ui/`) supaya benar-
  benar memakai komponen di atas. Mulai dari:
  ```bash
  grep -rl "bg-blue-\|bg-red-\|bg-green-\|bg-yellow-" app/ components/ \
    --include="*.tsx" | grep -v "components/ui/"
  ```
  lalu untuk tiap file, ganti elemen custom (`<button className="...">`,
  `<div className="rounded... border...">` dsb) dengan
  `<Button>`, `<Card>`, `<Badge>`, dst dari `components/ui`.
- **Toast belum punya provider/queue** — saat ini `Toast.tsx` cuma
  komponen presentasional single-instance. Perlu dibuat
  `components/ui/ToastProvider.tsx` (context + `useToast()` hook) agar
  bisa dipanggil dari mana saja tanpa prop-drilling, lalu dipasang
  sekali di `app/layout.tsx` (Klien Component, mis. lewat wrapper
  `<Providers>` — jangan taruh `"use client"` langsung di RootLayout
  server component).
- Audit checklist detail Priority 1 yang belum dicek satu-satu:
  spacing form (jarak antar `Input`/`Select` dalam satu form),
  shadow konsisten di semua `Modal`/`Card` turunan, dan warna status
  di grafik `recharts` (belum disentuh — masih project lama).

---

## PRIORITY 2 — Dashboard Layout & Sidebar — Target 98–100%

**Status: BELUM disentuh di paket ini — kode sudah ada & tampak
lengkap di zip, perlu audit detail terpisah.**

File yang sudah ada (belum diaudit isi & konsistensinya terhadap
Priority 1 token baru):
- `components/sidebar/Sidebar.tsx`
- `components/sidebar/SidebarGroup.tsx`
- `components/sidebar/SidebarItem.tsx`
- `components/sidebar/MobileDrawer.tsx`
- `components/sidebar/NavTooltip.tsx`
- `components/layout/DashboardLayout.tsx`
- `components/layout/Navbar.tsx`

### Untuk AI lanjutan
1. Baca `docs/PHASE_2A2_UI_UX_AUDIT.md` dan
   `docs/PHASE_2A2_COMPLETION_REPORT.md` — sudah ada catatan audit
   sebelumnya dari fase restrukturisasi sidebar (`sidebar` color token
   di `tailwind.config.ts` dibuat khusus untuk ini).
2. Cek apakah `Sidebar.tsx` dkk sudah memakai token `sidebar.*` dari
   `tailwind.config.ts` (bukan `bg-gray-900` dsb).
3. Verifikasi 3 breakpoint sesuai spesifikasi: desktop (sidebar fixed +
   topbar), tablet (sidebar collapsible), mobile (`MobileDrawer.tsx`).
4. Cek checklist: active menu state, nested group expand/collapse,
   scroll area sidebar independen dari scroll konten, tooltip saat
   sidebar collapsed (`NavTooltip.tsx`), profile dropdown + logout di
   `Navbar.tsx`, page transition saat pindah menu.

---

## PRIORITY 3 — Global Page State — Target 98%

**Status: BELUM disentuh — komponen dasarnya (Priority 1) sudah
tersedia (`EmptyState`, `ErrorState`, `Skeleton`/`SkeletonTableRows`),
tapi pemakaiannya di tiap halaman belum diaudit.**

### Untuk AI lanjutan
1. Buat daftar semua route di `app/dashboard/**`, `app/pos`,
   `app/kitchen`, `app/order`, `app/reserve` (lihat listing lengkap di
   `docs/FILE_STRUCTURE.md`).
2. Untuk tiap halaman yang fetch data, pastikan render 5 state:
   Loading (`Skeleton`/`SkeletonTableRows`) → Loaded → Empty
   (`EmptyState`, dengan copy spesifik per modul, contoh sudah ada di
   task description: "Belum ada produk...") → Error (`ErrorState`) →
   Success (toast/redirect setelah aksi).
3. Prioritaskan halaman dengan tabel besar dulu (transactions, stock,
   purchasing, crm) karena paling sering menampilkan "blank screen"
   saat data kosong.

---

## PRIORITY 4 — POS Presentation Finalization — Target 97–98%

**Status: BELUM disentuh — semua komponen POS sudah ada & tampak
lengkap (termasuk fitur yang tidak disebut di task asal:
`SplitBillModal`, `RefundModal`, `SoldOutToggle`, `TablePicker`,
`ProductConfigModal`, `QrOrderAlert`, `OpenBillPanel`).**

File yang ada di `components/pos/` (22 file) — lihat listing lengkap
lewat `ls components/pos/` di project. Semua sesuai daftar di task
asal, ditambah beberapa modul lanjutan dari Fase 2–4.

### Untuk AI lanjutan
1. Jalankan flow lengkap secara manual (atau baca kode) mengikuti urutan:
   `ProductGrid` → `ProductConfigModal` (variant/modifier) → `Cart`/
   `CartItem` → `CustomerSelector`/`TableSelector`/`TablePicker` →
   `OrderTypeSelector` → `DiscountModal` → `PaymentModal` →
   `CashPayment`/`QRISPayment`/`SplitBillModal` → `CheckoutSuccess`.
2. Checklist dari task asal yang perlu dicek satu per satu: tidak ada
   layout jump saat modal terbuka, cart tetap terlihat/jelas di mobile
   & tablet, ukuran modal tidak berlebihan (sudah ada `size` prop baru
   di `Modal.tsx` — pastikan semua modal POS pakai `size="sm"` atau
   `"md"`, bukan lebar custom), hierarki harga (harga asli vs diskon)
   jelas secara visual, quantity stepper punya disabled state saat
   min/max tercapai, tombol checkout disabled selama `loading` (cegah
   duplicate click — `Button` baru sudah punya prop `loading` untuk ini).
3. Pastikan semua komponen POS ini sudah mengganti pemakaian
   button/modal/badge custom-nya dengan `components/ui/*` yang baru
   (lihat catatan Priority 1 di atas).

---

## Ringkasan File yang Dikirim di Paket Ini

```
app/
├── layout.tsx          ← BARU (sebelumnya tidak ada)
├── globals.css         ← BARU (sebelumnya tidak ada)
└── page.tsx             ← BARU (sebelumnya tidak ada)

components/ui/
├── Alert.tsx            ← ditulis ulang
├── Badge.tsx             ← ditulis ulang
├── Button.tsx            ← ditulis ulang
├── Card.tsx               ← ditulis ulang
├── Confirmation.tsx        ← ditulis ulang
├── EmptyState.tsx           ← ditulis ulang
├── ErrorState.tsx             ← ditulis ulang
├── Input.tsx                   ← ditulis ulang
├── Modal.tsx                    ← ditulis ulang
├── Pagination.tsx                 ← ditulis ulang
├── Select.tsx                      ← ditulis ulang
├── Skeleton.tsx                     ← ditulis ulang
├── Table.tsx                         ← ditulis ulang
├── Tabs.tsx                           ← ditulis ulang
├── Toast.tsx                           ← ditulis ulang
└── Tooltip.tsx                          ← ditulis ulang

docs/
└── AUDIT_LANJUTAN_PRIORITAS.md  ← dokumen ini
```

**Tindakan manual yang HARUS dilakukan (tidak bisa dikirim sebagai
file)**: hapus folder `capos/` (nested duplicate project) dari root
repo — lihat Priority 0.

**Progres kasar terhadap target task asal:**
- Priority 0: ~60% (file kritis dibuat, penghapusan folder duplikat
  masih manual)
- Priority 1: ~70% (base component sudah token-consistent, migrasi
  pemakaian di seluruh halaman + Toast provider belum)
- Priority 2: 0% (belum diaudit — kode sudah ada, tinggal cek)
- Priority 3: 0% (komponen dasar siap, penerapan per-halaman belum)
- Priority 4: 0% (belum diaudit — kode sudah ada, tinggal cek)
