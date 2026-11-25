# Kebijakan Privasi caPOS

**Berlaku sejak:** ⟨TANGGAL BERLAKU⟩
**Versi:** 1.0
**Terakhir diperbarui:** 28 Oktober 2026

Dokumen ini menjelaskan bagaimana **Studio D13** ("kami") memproses data pribadi
saat Anda menggunakan **caPOS**, layanan aplikasi kasir (Point of Sale) berbasis
web untuk kafe dan usaha makanan/minuman, yang diakses melalui
`capos.alditriantama.com` ("Layanan").

Kebijakan ini disusun untuk memenuhi **Undang-Undang No. 27 Tahun 2022 tentang
Pelindungan Data Pribadi (UU PDP)**, **PP No. 71 Tahun 2019**, dan peraturan
terkait lainnya di Indonesia.

---

## 1. Identitas Pengendali Data Pribadi

| Item | Keterangan |
|---|---|
| Nama badan usaha | ⟨NAMA BADAN USAHA⟩ (Studio D13) |
| Bentuk usaha | ⟨PT / CV / Perorangan⟩ |
| Alamat | ⟨ALAMAT LENGKAP⟩ |
| Email privasi | ⟨privacy@domain-anda⟩ |
| Nomor kontak | ⟨NOMOR TELEPON⟩ |
| Pejabat/Petugas PDP | ⟨NAMA PIC⟩ — ⟨email PIC⟩ |

## 2. Peran Kami: Pengendali vs. Prosesor

Ini bagian terpenting untuk dipahami, karena caPOS menyimpan dua jenis data
dengan dua peran hukum berbeda:

| Jenis data | Contoh | Peran kami | Peran Anda |
|---|---|---|---|
| **Data akun & langganan** | Nama pemilik, email, kata sandi, nama kafe, riwayat tagihan | **Pengendali data** | Subjek data |
| **Data operasional kafe** | Daftar menu, transaksi, stok, data karyawan | **Prosesor data** (atas instruksi Anda) | **Pengendali data** |
| **Data pelanggan kafe Anda** | Nama pelanggan, nomor HP, kode member, riwayat pembelian | **Prosesor data** | **Pengendali data** |

Konsekuensinya: untuk data pelanggan kafe Anda, **Anda** yang wajib memiliki
dasar hukum (mis. persetujuan pelanggan saat mendaftar member) dan wajib
menyampaikan informasi privasi kepada pelanggan Anda. Kami hanya memproses
sesuai instruksi Anda dan tidak memakainya untuk tujuan lain.

## 3. Data Pribadi yang Kami Kumpulkan

### 3.1 Data yang Anda berikan langsung

| Kategori | Rincian | Wajib? |
|---|---|---|
| Identitas pemilik akun | Nama lengkap, alamat email | Wajib |
| Kredensial | Kata sandi (disimpan sebagai *hash*, tidak pernah dalam bentuk teks biasa) | Wajib |
| Profil usaha | Nama kafe, alamat cabang, nomor telepon cabang, logo | Wajib untuk operasional |
| Data karyawan | Nama, email, peran (owner/manager/kasir), cabang yang ditugaskan | Opsional (jika Anda menambah staf) |
| Data pelanggan kafe | Nama, nomor HP, kode member, tanggal lahir (opsional) | Opsional (jika Anda memakai fitur member) |
| Data pembayaran | Nama pemegang kartu, 4 digit terakhir, status transaksi | Wajib untuk langganan berbayar |

### 3.2 Data yang terbentuk dari pemakaian Layanan

| Kategori | Rincian |
|---|---|
| Transaksi | Nomor invoice, item, qty, harga, diskon, metode bayar, waktu, kasir, cabang |
| Stok & inventori | Pergerakan stok, HPP, penyesuaian, stok opname |
| Aktivitas akun | Waktu login, waktu verifikasi OTP, status langganan |
| Log teknis | Alamat IP, jenis perangkat/browser, pesan galat, waktu akses |

### 3.3 Data yang **tidak** kami kumpulkan

- Nomor kartu kredit/debit lengkap dan CVV — diproses sepenuhnya oleh
  **Midtrans** sebagai penyedia gerbang pembayaran berlisensi.
- Data biometrik, data kesehatan, data anak, atau data pribadi spesifik
  sebagaimana dimaksud Pasal 4 UU PDP.
- Kami **tidak** memasang Google Analytics, PostHog, atau pelacak iklan pada
  aplikasi (diverifikasi pada audit 28 Oktober 2026).

## 4. Dasar Hukum Pemrosesan

| Tujuan | Dasar hukum (UU PDP) |
|---|---|
| Membuat & mengelola akun, menyediakan fitur POS | Pelaksanaan perjanjian — Pasal 20 ayat (2) huruf a |
| Memproses pembayaran langganan | Pelaksanaan perjanjian |
| Mengirim kode OTP & notifikasi transaksional | Pelaksanaan perjanjian |
| Mencegah penipuan, penyalahgunaan, dan kegagalan sistem | Kepentingan sah — Pasal 20 ayat (2) huruf f |
| Memenuhi kewajiban pembukuan/pajak | Kewajiban hukum — Pasal 20 ayat (2) huruf c |
| Mengirim informasi produk/promosi | **Persetujuan** — Pasal 20 ayat (2) huruf b (dapat ditarik kapan pun) |

## 5. Cookies dan Penyimpanan Lokal

caPOS **tidak** memakai cookie iklan atau pelacak pihak ketiga. Yang dipakai:

| Nama / jenis | Fungsi | Masa simpan |
|---|---|---|
| Cookie sesi autentikasi | Menjaga Anda tetap login | Sampai logout / kedaluwarsa token |
| `capos:demo-dismissed:v1` (localStorage) | Mengingat bahwa Anda sudah menutup banner data contoh | Sampai dihapus dari browser |
| Cache offline (IndexedDB) | Menyimpan menu & antrean transaksi saat internet putus | Sampai tersinkron atau dihapus |

Anda dapat menghapus data lokal kapan pun melalui pengaturan browser. Menghapus
data lokal akan mengeluarkan Anda dari sesi dan menghapus antrean transaksi
offline yang belum tersinkron.

## 6. Pihak Ketiga yang Menerima Data

Kami **tidak menjual** data pribadi. Data hanya dibagikan kepada penyedia
layanan yang diperlukan agar Layanan berjalan:

| Pihak | Fungsi | Data yang diterima | Lokasi pemrosesan |
|---|---|---|---|
| **Supabase Inc.** | Basis data, autentikasi, penyimpanan | Seluruh data aplikasi (terenkripsi saat transit) | ⟨REGION: mis. Singapore⟩ |
| **Midtrans (PT Midtrans)** | Gerbang pembayaran langganan | Nama, email, nominal, rincian transaksi | Indonesia |
| **Penyedia hosting** ⟨NAMA⟩ | Menjalankan aplikasi web | Log akses, alamat IP | ⟨REGION⟩ |
| **Penyedia email transaksional** ⟨NAMA⟩ | Pengiriman OTP & notifikasi | Alamat email, isi notifikasi | ⟨REGION⟩ |

Selain itu, data dapat diungkapkan apabila **diwajibkan oleh hukum** atau
perintah pengadilan yang sah, dan kami akan memberi tahu Anda sejauh diizinkan
secara hukum.

### 6.1 Transfer Data Lintas Negara

Apabila penyedia di atas memproses data di luar Indonesia, kami memastikan
transfer dilakukan sesuai **Pasal 56 UU PDP** — yaitu adanya tingkat
pelindungan yang setara atau pelindungan yang memadai, dan dicatat dalam
dokumentasi internal kami.

## 7. Masa Retensi

| Jenis data | Lama disimpan | Alasan |
|---|---|---|
| Data akun aktif | Selama akun aktif | Menyediakan Layanan |
| Data akun setelah penghapusan | Dihapus/dianonimkan maksimum **30 hari** | Masa tenggang pemulihan |
| Catatan transaksi & pembukuan | **10 tahun** | Kewajiban UU KUP & UU Perseroan |
| Data pelanggan kafe (member) | Sampai Anda menghapusnya, atau 24 bulan tidak aktif | Instruksi Anda sebagai pengendali |
| Log teknis | 90 hari | Keamanan & investigasi insiden |
| Antrean transaksi offline | Sampai tersinkron, maksimum 30 hari | Integritas data penjualan |

Setelah masa retensi berakhir, data dihapus secara permanen atau dianonimkan
sehingga tidak dapat dikaitkan dengan individu mana pun.

## 8. Langkah Keamanan

| Aspek | Penerapan |
|---|---|
| Enkripsi transit | TLS 1.2+ dengan HSTS 2 tahun pada seluruh domain |
| Isolasi data antar-tenant | Row Level Security (RLS) di PostgreSQL — setiap query dibatasi `tenant_id` |
| Otorisasi | Berbasis peran (owner, manager, kasir, super admin) dan divalidasi di server, bukan hanya di UI |
| Kata sandi | Di-hash dengan algoritma satu arah (bcrypt) oleh Supabase Auth |
| Kunci rahasia | Kunci `service_role` tidak pernah dikirim ke browser (diverifikasi pada audit) |
| Validasi harga | Total transaksi dihitung di server dari harga database, bukan dari nilai kiriman klien |
| Header keamanan | CSP, X-Frame-Options, X-Content-Type-Options, Permissions-Policy, COOP |

Kami tetap mencatat bahwa **tidak ada sistem yang 100% aman**. Apabila terjadi
kegagalan pelindungan data pribadi, kami akan memberitahukan subjek data dan
lembaga pengawas **paling lambat 3 × 24 jam** sesuai Pasal 46 UU PDP.

## 9. Hak Anda sebagai Subjek Data

Sesuai Pasal 5–13 UU PDP, Anda berhak:

1. **Mendapat informasi** tentang pemrosesan data Anda (Pasal 5).
2. **Mengakses dan memperoleh salinan** data pribadi Anda (Pasal 6).
3. **Memperbaiki/melengkapi** data yang tidak akurat (Pasal 7).
4. **Menghapus atau memusnahkan** data (Pasal 8) — dapat dilakukan sendiri
   melalui **Pengaturan → Profil & Akun → Hapus Akun**.
5. **Menarik kembali persetujuan** (Pasal 9) — untuk pemrosesan yang dasarnya
   persetujuan, tanpa memengaruhi keabsahan pemrosesan sebelumnya.
6. **Mengajukan keberatan** atas pemrosesan berbasis kepentingan sah (Pasal 10).
7. **Menunda/membatasi pemrosesan** (Pasal 11).
8. **Mendapatkan dan memindahkan data** dalam format yang umum dipakai
   (portabilitas, Pasal 13).

**Cara menggunakan hak:** kirim email ke ⟨privacy@domain-anda⟩ dengan subjek
`Permintaan Hak PDP — <email akun>`. Kami akan memverifikasi identitas Anda dan
menanggapi dalam **14 hari kerja** (dapat diperpanjang 14 hari lagi untuk
permintaan yang kompleks, dengan pemberitahuan).

**Mengajukan keluhan:** jika jawaban kami tidak memuaskan, Anda dapat mengadu
kepada lembaga pengawas PDP yang ditunjuk Pemerintah Indonesia.

## 10. Data Anak

Layanan ditujukan untuk pelaku usaha dan tidak dirancang untuk digunakan anak
di bawah 18 tahun. Kami tidak dengan sengaja mengumpulkan data anak. Apabila
Anda mengetahui adanya data anak dalam sistem, hubungi kami untuk penghapusan.

## 11. Perubahan Kebijakan

Kami dapat memperbarui kebijakan ini bila ada perubahan fitur, penyedia, atau
peraturan. Perubahan material akan diberitahukan melalui email terdaftar atau
banner di aplikasi **paling lambat 14 hari** sebelum berlaku, disertai nomor
versi baru. Tanggal "Berlaku sejak" di atas akan diperbarui.

## 12. Kontak

| Keperluan | Kanal |
|---|---|
| Pertanyaan privasi & permintaan hak PDP | ⟨privacy@domain-anda⟩ |
| Insiden keamanan | ⟨security@domain-anda⟩ |
| Dukungan umum | ⟨support@domain-anda⟩ / ⟨nomor WhatsApp⟩ |

---

### Lampiran A — Daftar Subprosesor

| No | Nama | Layanan | Dasar penunjukan | Tanggal peninjauan berikutnya |
|---|---|---|---|---|
| 1 | Supabase Inc. | Database, Auth, Storage | Kebutuhan teknis inti | ⟨tanggal⟩ |
| 2 | Midtrans | Pembayaran langganan | Kebutuhan penagihan | ⟨tanggal⟩ |
| 3 | ⟨Hosting⟩ | Aplikasi web | Kebutuhan teknis inti | ⟨tanggal⟩ |
| 4 | ⟨Email provider⟩ | OTP & notifikasi | Kebutuhan teknis inti | ⟨tanggal⟩ |

### Lampiran B — Catatan Kepatuhan Internal

| Kewajiban | Status |
|---|---|
| Kebijakan privasi dapat diakses publik | **Belum** — halaman `/kebijakan-privasi` masih 404 (audit 28 Okt 2026) |
| Persetujuan eksplisit di form pendaftaran | **Sudah** — checkbox ditambahkan (lihat `08-consent-pendaftaran.md`) |
| Mekanisme hapus akun mandiri | **Sudah** — Pengaturan → Profil & Akun |
| Pencatatan bukti persetujuan (evidence of consent) | **Belum** — perlu tabel `consent_records` |
| Prosedur notifikasi kebocoran data ≤3×24 jam | **Belum** — perlu ditambahkan ke runbook insiden |
| Penunjukan Petugas PDP | **Belum** — perlu Surat Keputusan internal |

> **Catatan:** dokumen ini adalah draf siap pakai, **bukan** nasihat hukum.
> Sebelum dipublikasikan, mintalah peninjauan konsultan hukum dan lengkapi
> seluruh bagian bertanda ⟨...⟩.
