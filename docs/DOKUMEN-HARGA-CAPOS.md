# DOKUMEN HARGA caPOS — Paket Custom per Fitur

**Produk:** caPOS — Point of Sale Kafe
**Sifat dokumen:** usulan struktur harga (belum final, butuh persetujuan pemilik)
**Tanggal:** 18 November 2026
**Dokumen terkait:** `TEST_REPORT.md`, `RENCANA_PERBAIKAN_CAPOS_DAN_EXPORT_PDF.md`
**Acuan harga saat ini:** Free Trial Rp0 / 28 hari · Pro Rp100.000/bulan · Supreme Rp900.000/tahun

---

## 1. Tujuan

Menjawab tiga kebutuhan:

1. Setiap fitur punya **harga sendiri**.
2. Harga bisa **diakumulasikan otomatis** sesuai fitur yang dicentang klien.
3. Kalau klien hanya minta **1 fitur**, nominalnya bisa langsung dipastikan.
4. Total akumulasi tetap **konsisten dengan paket Supreme** (tidak saling bertabrakan).

Model yang dipakai: **Base + Modul (à la carte) → diskon bundling → Supreme sebagai plafon.**

---

## 2. Temuan penting sebelum menetapkan harga

Harga yang berjalan sekarang **tidak konsisten secara matematis**:

| Paket | Harga sekarang | Ekuivalen per bulan | Masalah |
|---|---|---|---|
| Pro | Rp100.000/bulan | Rp100.000 | — |
| Supreme | Rp900.000/tahun | **Rp75.000** | Lebih murah daripada Pro, padahal isinya lebih banyak |

Artinya, kalau dibiarkan, **Supreme menghapus alasan orang membeli Pro** dan tidak menyisakan ruang untuk menjual fitur satuan.

**Keputusan yang harus diambil pemilik:** Supreme Rp900.000/tahun dipertahankan sebagai *harga promosi/legacy*, atau dikoreksi ke angka yang wajar (rekomendasi di dokumen ini: Rp499.000/bulan atau Rp4.990.000/tahun). Seluruh perhitungan di bawah memakai **struktur baru**, bukan harga lama.

---

## 3. Tiga lapis struktur harga

### Lapis 1 — Base / Core (wajib, semua paket berbayar)

**Pro — Rp100.000/bulan** (tahunan Rp1.000.000, hemat 2 bulan)

Sudah termasuk:

- Kasir/POS, buka-tutup shift, keranjang, pembayaran tunai/QRIS statis
- Struk & printer, refund penuh
- Menu, kategori, varian, modifier
- Laporan dasar (omzet, transaksi, riwayat 30 hari)
- Dashboard, FAQ, tur onboarding
- Kuota: **1 cabang · 2 staf · 50 menu · riwayat 30 hari**

### Lapis 2 — Modul (dipilih bebas, harga per bulan)

| Kode | Modul | Harga/bulan | Isi fitur (route) |
|---|---|---|---|
| `M01` | Multi-Cabang | 99.000 | `branches`, pemilih "Semua Cabang", filter lintas cabang, HPP per cabang |
| `M02` | Staf & Absensi | 59.000 | `employees`, `cashiers`, `attendance`, `cashier-evaluation` |
| `M03` | Resep & HPP | 49.000 | `recipes`, HPP per cabang, margin otomatis, snapshot HPP historis |
| `M04` | Inventori & Opname | 49.000 | `ingredients`, `stock`, `stock-opname`, waste bahan & waste produk |
| `M05` | Purchasing | 39.000 | `purchasing/suppliers`, `purchasing/purchase-orders`, penerimaan barang (WAC) |
| `M06` | QR Meja & Self-Order | 49.000 | `qr-tables`, halaman `/order/<slug>/<meja>` |
| `M07` | Online Order Hub | 59.000 | `online-orders` (GoFood/GrabFood/ShopeeFood), alur status pesanan |
| `M08` | Reservasi | 29.000 | `reservations`, ketersediaan meja |
| `M09` | CRM & Membership | 49.000 | `crm/customers`, `membership`, tier pelanggan, poin, `referral` |
| `M10` | Promosi & Voucher | 39.000 | `promotions`, voucher per cabang, diskon otomatis |
| `M11` | Analitik Lanjutan | 79.000 | `analytics/growth`, `menu-engineering`, `profitability`, `peak-hours`, `waste-loss` |
| `M12` | Export Lengkap & Audit | 39.000 | `laporan-pdf` 3 mode (Ringkasan / Hanya Keuntungan / Semua Data), Excel, `export_logs` |
| `M13` | QRIS Dinamis | 29.000 | `qris-dinamis`, pembayaran QR dinamis |
| `M14` | Channel Pricing | 29.000 | `channel-pricing` (harga beda per kanal penjualan) |
| `M15` | Target & KPI | 25.000 | `target`, pencapaian target penjualan |

**Total seluruh modul (à la carte): Rp721.000/bulan**

### Lapis 3 — Add-on kuota (di atas paket apa pun)

| Item | Harga | Catatan |
|---|---|---|
| Cabang tambahan | Rp49.000/bulan per cabang | Berlaku setelah kuota paket habis |
| Staf tambahan | Rp15.000/bulan per staf | Berlaku setelah kuota paket habis |

---

## 4. Kronologi perhitungan harga

Urutan ini yang harus dijalankan di server (bukan di browser), supaya angka tidak bisa dimanipulasi:

1. **Pilih base** → Pro Rp100.000 (selalu ada untuk tenant berbayar).
2. **Centang modul** → jumlahkan harga tiap modul yang aktif.
3. **Subtotal** = base + total modul.
4. **Diskon bundling** → diterapkan bila jumlah modul mencapai ambang tertentu (lihat §6).
5. **Plafon Supreme** → bila subtotal setelah diskon melebihi Supreme, otomatis dialihkan ke Supreme (klien tidak mungkin bayar lebih mahal dari paket all-in).
6. **Prorata** → bila perubahan dilakukan di tengah periode berjalan.
7. **Pajak** → PPN 11% bila tenant PKP (opsional, konfirmasi ke konsultan pajak).
8. **Total tagihan** → diterbitkan sebagai invoice, menunggu pembayaran.

---

## 5. Akumulasi & contoh perhitungan

### 5.1 Jika klien hanya minta 1 fitur

| Pilihan | Base | Modul | **Total/bulan** |
|---|---|---|---|
| Hanya QRIS Dinamis | 100.000 | 29.000 | **129.000** |
| Hanya Analitik Lanjutan | 100.000 | 79.000 | **179.000** |
| Hanya QR Meja & Self-Order | 100.000 | 49.000 | **149.000** |
| Hanya Multi-Cabang | 100.000 | 99.000 | **199.000** |

> Catatan: base tidak bisa dilepas karena tanpa base, modul tidak punya tempat berjalan (tidak ada kasir, menu, dan laporan dasar).

### 5.2 Kombinasi umum

| Skenario | Rincian | Subtotal | Diskon | **Total/bulan** |
|---|---|---|---|---|
| Kafe kecil | Base + M06 QR Meja | 149.000 | — | **149.000** |
| Kafe ramai | Base + M03 + M04 + M06 | 247.000 | — | **247.000** |
| Kafe + online order | Base + M03 + M04 + M06 + M07 | 306.000 | — | **306.000** |
| Multi-cabang | Base + M01 + M02 + M03 + M04 + M11 | 435.000 | 5% | **413.250** |
| Hampir lengkap | Base + M01,M02,M03,M04,M06,M07,M09,M10,M11,M12 | 670.000 | 10% | **603.000** |
| Semua modul (à la carte) | Base + 15 modul | 821.000 | 15% | **697.850** |

### 5.3 Supreme

**Supreme — Rp499.000/bulan** (tahunan **Rp4.990.000**, setara 10 bulan).

Isi: **seluruh 15 modul** + kuota **5 cabang · 20 staf · 200 menu** + riwayat tanpa batas.

Perbandingan:

| | Total |
|---|---|
| Semua modul à la carte (setelah diskon 15%) | Rp697.850/bulan |
| Supreme | Rp499.000/bulan |
| **Hemat dengan Supreme** | **Rp198.850/bulan (±28%)** |

Dengan angka ini, Supreme tetap menjadi pilihan termahal **dan** paling untung — tidak lagi lebih murah daripada Pro.

---

## 6. Aturan diskon bundling (usulan)

| Jumlah modul aktif | Diskon |
|---|---|
| 1–2 modul | 0% |
| 3–5 modul | 5% |
| 6–9 modul | 10% |
| 10–15 modul | 15% |
| Semua modul | otomatis dialihkan ke Supreme (lebih murah) |

Diskon dihitung dari **subtotal (base + modul)**, bukan dari base saja. Aturan ini disimpan di server agar konsisten dengan tampilan super admin.

---

## 7. Alur di panel super admin

```
[ Daftar fitur per tenant ]
  ☐ Multi-Cabang            Rp 99.000
  ☑ QR Meja & Self-Order    Rp 49.000
  ☑ Online Order Hub        Rp 59.000
  ☐ CRM & Membership        Rp 49.000
  ...
  ─────────────────────────────────────
  Subtotal                 Rp 208.000
  Diskon bundling (3–5)      -Rp 10.400
  ─────────────────────────────────────
  TOTAL / bulan            Rp 197.600

        [ Aktifkan & Terbitkan Invoice ]
```

**Status yang harus dibedakan:**

| Status | Arti | Fitur menyala? |
|---|---|---|
| `draft` | Super admin baru mencentang | ❌ |
| `invoiced` | Invoice sudah terbit, menunggu bayar | ❌ |
| `paid` | Pembayaran terkonfirmasi | ✅ (mulai tanggal efektif) |
| `cancelled` | Invoice kedaluwarsa / dibatalkan | ❌ |

**Aturan wajib:**

1. Toggle **tidak** mengubah hak akses. Hanya menyimpan draft.
2. Tombol **Aktifkan** menerbitkan invoice — bukan menyalakan fitur.
3. Fitur menyala **hanya** setelah webhook pembayaran mengisi `paid_at`.
4. Harga di invoice **di-snapshot** (harga saat itu), supaya perubahan katalog tidak mengubah tagihan lama.
5. Webhook harus **idempotent** — satu invoice hanya boleh menghasilkan satu aktivasi.
6. Setiap toggle dan aktivasi dicatat di **audit log**: siapa, kapan, fitur apa, invoice mana.
7. Invoice tidak dibayar sampai jatuh tempo → `cancelled`, toggle kembali ke kondisi awal.
8. Hanya **super admin** yang boleh toggle dan menerbitkan invoice; tenant hanya melihat dan membayar.

### Struktur data minimum

```sql
feature_catalog   (code, name, category, price_monthly, price_yearly,
                   unit, is_active, sort_order)

tenant_features   (tenant_id, feature_code, status, invoice_id,
                   price_snapshot, starts_at, ends_at, created_by)

subscription_invoices (id, tenant_id, period_start, period_end,
                   subtotal, discount, tax, total, status,
                   paid_at, payment_ref, created_by)

feature_audit_log (id, actor_id, tenant_id, action, payload, created_at)
```

Fitur dicek di server lewat satu helper, misal `hasFeature(tenant, 'M06')`, dan **setiap API modul wajib memanggil helper itu** — bukan hanya menyembunyikan menu di sidebar.

---

## 8. Prorata & perubahan di tengah periode

Contoh: klien sudah bayar Pro (Rp100.000) untuk 30 hari, lalu di hari ke-15 menambah M13 QRIS Dinamis (Rp29.000).

```
Sisa hari          = 15
Nilai prorata      = 15/30 × 29.000 = Rp14.500
Ditagih sekarang   = Rp14.500
Periode berikutnya = Rp129.000 (penuh)
```

Aturan yang perlu diputuskan: tambah fitur ditagih **prorata langsung**, sedangkan **lepas fitur** baru berlaku **periode berikutnya** (tanpa refund). Ini mencegah klien memakai fitur sebentar lalu menukar uangnya.

---

## 9. Yang masih perlu diputuskan pemilik

1. **Supreme Rp900.000/tahun** dipertahankan sebagai promo, atau diganti ke Rp499.000/bulan?
2. Diskon bundling memakai tabel §6, atau diskon tetap per paket?
3. Tambah fitur: prorata langsung, atau selalu mulai periode berikutnya?
4. Apakah tenant boleh **mengajukan** fitur sendiri (masuk antrean approval), atau murni super admin yang menentukan?
5. PPN 11% diberlakukan atau harga sudah termasuk pajak?
6. Masa tenggang setelah invoice jatuh tempo (usulan: 3 hari, fitur tetap aktif, lalu suspend)?
7. Batas minimum transaksi (usulan: minimal 1 modul agar tidak ada tenant base-only yang membebani server)?

---

## 10. Ringkasan satu paragraf

Harga dihitung sebagai **base Rp100.000 + harga modul yang dicentang**, diakumulasikan di server, lalu dikurangi diskon bundling bila modulnya banyak. Kalau semua modul diambil, sistem otomatis mengarahkan ke **Supreme Rp499.000/bulan** karena lebih murah. Fitur **tidak pernah** menyala dari toggle saja — toggle hanya membuat draft, tombol "Aktifkan" menerbitkan invoice, dan fitur baru aktif setelah **pembayaran terkonfirmasi** lewat webhook.
