# Panduan Jemput Bola caPOS

Sistem otomatis untuk mencari calon pelanggan kafe, mengingatkan follow-up, dan menjaga konten tetap jalan. Semua berjalan di n8n lokal Anda, biaya Rp0, dan hasilnya masuk ke grup Telegram caPOS.

Dokumen ini menjelaskan: apa yang sudah dipasang, penilaian jujur atas rencana 7 hari Anda, rutinitas harian 30-45 menit, dan cara memperbaiki kalau ada yang macet.

---

## 1. Ringkasan: apa yang sudah jalan

| Nama di n8n | Jalan kapan | Yang dikerjakan | Kirim ke |
| --- | --- | --- | --- |
| JB1 - Radar Jemput Bola | 09:00, 13:00, 18:00 WITA | Memindai berita/artikel kafe & kasir dari Google News + Bing News, membuang yang sudah pernah dikirim, menyusun ringkasan + saran tindakan | Grup Telegram caPOS |
| JB2 - Outreach CRM | 09:05 WITA | Mengirim rencana hari ini: prospek yang belum di-DM, yang harus di-follow-up, template DM harian | Grup Telegram caPOS |
| JB2 - Outreach CRM | tiap 5 menit, 09.00-21.55 WITA | Membaca perintah Anda di grup (+kafe, list, dm, kirim, email, balas, trial, dst) lalu membalas | Grup Telegram caPOS |
| JB2 - Email otomatis | 09:30 WITA (hanya kalau dinyalakan) | Mengirim email perkenalan ke prospek berstatus `baru` yang punya alamat email, maks 15/hari, lewat Resend | Grup Telegram caPOS (laporan) |
| JB3 - Prospek Otomatis | Senin 09:10 WITA | Menarik data tempat makan/minum Sulawesi Tengah dari OpenStreetMap, membuang yang sudah pernah dikirim, mengirim 1 blok `+kafe` siap tempel | Grup Telegram caPOS |
| WF5 - Mesin Konten Organik | 09:00 WITA | Mengirim 1 draf konten harian (sebelumnya butuh Groq, sekarang ada draf cadangan) | Grup Telegram caPOS |

Semua pengiriman Telegram memakai kredensial n8n bernama "Telegram caPOS Bot", bukan lagi variabel env. Jadi jalur kirim tidak ikut rusak kalau env bermasalah.

**Yang berubah 22 Nov 2026 (v2):**

- `dm N` sekarang mengirim **kartu siap kirim**: teks pesan + tombol WhatsApp (`wa.me`, teks sudah terisi) atau Instagram (`ig.me`). Anda tinggal tekan kirim.
- `+kafe` menerima **banyak baris sekaligus** dan mendeteksi sendiri nomor HP / @instagram / email.
- Ada **email otomatis** lewat Resend (domain `alditriantama.com` sudah terverifikasi). Sejak 23 Nov 2026 sudah **dinyalakan**; matikan dengan `email auto off`.
- Ada **JB3** yang mengirim kandidat prospek dari OpenStreetMap tiap Senin.

Yang belum jalan dan tidak bisa dipaksa jalan sekarang:

| Bagian | Kendala | Akibat |
| --- | --- | --- |
| Google Sheets (opsional) | n8n belum punya kredensial Google | **Tidak masalah** — WF1/WF2 sekarang mencatat ke Data Table n8n (`Leads_Trial`, `Pembayaran_Langganan`). WF1 sudah aktif & dites |
| WF2 - Pembayaran Langganan | MIDTRANS_SERVER_KEY masih kosong | Tidak bisa memverifikasi pembayaran |
| WF5 - Draf AI (Groq) | GROQ_API_KEY masih kosong | Draf memakai template cadangan, bukan AI |
| Pantau TikTok/Instagram/Threads otomatis | Tidak ada API gratis untuk pencarian kata kunci | Tetap manual, tapi dibantu link 1 klik dari bot |

---

## 2. Penilaian jujur atas rencana 7 hari Anda

Rencananya bagus sebagai arah, tapi ada tiga hal yang perlu dikoreksi supaya tidak kecewa di hari ke-3.

### Yang realistis

1. Membuat konten "show, don't tell" (kasir mode pesawat, QR order, stok). Ini paling kuat karena pemilik kafe menilai dari bukti, bukan fitur.
2. Direct outreach 3-5 kafe per hari. Ini yang paling cepat mendatangkan pengguna awal.
3. Membangun cerita di Threads (build in public). Murah, cocok untuk Anda yang membangun sendiri.

### Yang tidak realistis (dan sudah saya sesuaikan)

1. "Social listening otomatis di TikTok, Instagram, Threads". Ketiga platform itu tidak menyediakan pencarian kata kunci gratis. Yang ada hanya API untuk akun sendiri, dan itu pun butuh proses persetujuan. Solusi yang saya pasang: radar berita (Google News + Bing) untuk sinyal dan bahan konten, plus link pencarian 1 klik ke TikTok/Threads/IG/Maps di pesan pagi. Anda tetap klik, tapi tidak perlu mengetik ulang.
2. "DM otomatis ke calon pelanggan". Ini berisiko: kirim DM massal dari akun pribadi bisa dibatasi bahkan diblokir platform. Yang bot lakukan adalah menyiapkan draf, mencatat status, dan mengingatkan follow-up. Tombol kirim tetap di tangan Anda.
3. "Semua otomatis, saya tinggal terima hasil". Tidak ada sistem Rp0 yang bisa begitu. Yang bisa diotomatiskan adalah mengingat, merangkum, dan menyiapkan bahan. Yang tidak bisa: membangun kepercayaan dengan calon pelanggan.

### Yang paling sering dilupakan: follow-up

Kebanyakan closing bukan dari DM pertama, tapi dari pesan kedua atau ketiga. Karena itu JB2 menyimpan status setiap prospek dan menyodorkan yang sudah 3 hari tidak disentuh. Ini bagian yang biasanya bocor kalau dikerjakan manual.

### Rencana 7 hari versi realistis

| Hari | Fokus | Target |
| --- | --- | --- |
| 1 | Pasang sistem, kumpulkan 20 kafe dari Google Maps, kirim 5 DM | 20 prospek masuk bot, 5 DM |
| 2 | 1 konten offline-first (rekam layar mode pesawat), 5 DM | 1 konten, 5 DM, 1 balasan |
| 3 | Follow-up yang jatuh tempo, 1 konten QR order, 5 DM | 5 follow-up, 5 DM |
| 4 | Tawarkan trial 28 hari ke yang sudah membalas, 1 konten stok | 2 trial |
| 5 | Bantu setup 1 kafe (datang atau remote), 5 DM | 1 kafe pakai caPOS |
| 6 | Minta testimoni + screenshot, jadikan konten, 5 DM | 1 bukti sosial |
| 7 | Evaluasi angka, ulangi yang paling banyak dibalas | 25 DM, 3-5 balasan, 1-2 trial |

Aturan sederhana: 5 DM per hari lebih baik daripada 30 DM sekali seminggu. Konsisten 7 hari mengalahkan semangat 1 hari.

---

## 3. Ide tambahan yang saya masukkan

1. CRM di Telegram, bukan di spreadsheet. Anda sudah pegang HP; tidak perlu buka laptop untuk mencatat prospek.
2. Template DM berputar (3 varian) supaya pesan tidak terasa sama persis ke semua orang.
3. Setiap sinyal radar diberi saran tindakan, bukan hanya judul berita. Contoh: "kafe baru = calon pelanggan, cari IG-nya".
4. Radar menyimpan riwayat judul yang sudah dikirim, jadi tidak ada berita berulang.
5. Rencana pagi selalu menyebut target angka, supaya jelas kapan hari itu dianggap selesai.
6. Statistik respon rate: jumlah dibalas dibagi total prospek. Ini indikator paling jujur apakah pesan Anda menarik atau perlu diubah.

Ide yang bisa Anda tambahkan nanti (belum dipasang):

- Google Alerts untuk nama kafe tertentu, diarahkan ke RSS (gratis, setup manual di google.com/alerts).
- Satu halaman "studi kasus" berisi 1 kafe yang memakai caPOS, dipakai sebagai bukti di DM.
- Follow-up otomatis lewat email untuk trial yang hampir habis (butuh WF4 / drip email).

---

## 4. Cara memakai: perintah Telegram

Ketik di grup caPOS (boleh juga di chat pribadi bot). Balasan datang maksimal sekitar 5 menit, karena bot memeriksa pesan setiap 5 menit. Pemeriksaan hanya jalan 09.00-22.00 WITA; perintah yang dikirim di luar jam itu dibalas pada 09.00 pagi berikutnya.

| Perintah | Fungsi | Contoh |
| --- | --- | --- |
| bantu | Daftar semua perintah | bantu |
| +kafe | Tambah prospek. Bisa **banyak baris sekaligus**; nomor HP / @instagram / email dikenali otomatis | +kafe Kopi Senja \| Palu \| @kopisenja \| halo@kopisenja.id |
| list | Lihat semua prospek + status, termasuk siapa yang sudah punya email | list |
| dm 3 | **Kartu siap kirim**: teks pesan + tombol WhatsApp (`wa.me`, teks sudah terisi) atau Instagram (`ig.me`). Status jadi di-DM | dm 3 |
| kirim 3 | Kirim ulang kartu prospek 3 tanpa mengubah status | kirim 3 |
| email | Cek apakah email otomatis hidup/mati | email |
| email auto on | Nyalakan email otomatis Resend (kirim 09.30 WITA, maks 15/hari) | email auto on |
| email auto off | Matikan email otomatis | email auto off |
| email 3 | Kirim email perkenalan manual ke prospek 3 | email 3 |
| balas 3 sudah balas | Catat bahwa prospek 3 menjawab | balas 3 minta info harga |
| trial 3 | Tandai prospek 3 mulai trial | trial 3 |
| menang 3 | Tandai jadi pelanggan | menang 3 |
| tolak 3 | Tandai tidak tertarik | tolak 3 |
| hapus 3 | Hapus prospek 3 | hapus 3 |
| cari kata | Link pencarian cepat (TikTok, Threads, IG, Maps, Google) | cari kafe palu |
| stats | Ringkasan angka + respon rate | stats |
| ping | Cek bot hidup | ping |

Catatan: tanda \| adalah pemisah kolom. Kalau lupa, cukup tulis "+kafe Nama Kafe" dan sisanya diisi belakangan.

**Menempel banyak kafe sekaligus.** Kirim satu pesan berisi beberapa baris `+kafe`, masing-masing satu kafe. Bot menambahkan semuanya dalam satu balasan dan menolak nama yang sudah ada (tidak dobel). Ini cara tercepat memindahkan daftar email yang Anda kumpulkan manual:

    +kafe Kopi Senja | Palu | @kopisenja | halo@kopisenja.id
    +kafe Kedai Rindu | Palu | 0812xxxxxxx | rindu@kedairindu.com
    +kafe Warung Kopi Tua | Donggala | @warkoptua | warkoptua@gmail.com

Kolom email boleh di kolom ke berapa pun — bot mencari pola `nama@domain` di seluruh baris. Setelah ditempel, ketik `list` untuk memastikan emailnya terbaca, lalu `email auto on` kalau belum aktif. Jam 09.30 WITA berikutnya bot mengirim email perkenalan ke semua prospek `baru` yang punya email (maks 15/hari), lalu melapor ke grup.

Arti status:

- baru: belum dihubungi
- di-DM: draf sudah disiapkan atau pesan sudah dikirim
- dibalas: calon pelanggan menjawab
- trial: sedang mencoba caPOS
- pelanggan: sudah memakai
- tolak: tidak tertarik

---

## 5. Rutinitas harian 30-45 menit

### Pagi (10 menit)

1. Buka grup Telegram caPOS.
2. Baca pesan 09:00 (draf konten) dan 09:05 (rencana + template DM).
3. Salin draf konten, edit sedikit sesuai gaya Anda, posting ke TikTok/IG/Threads. Jangan tunggu sempurna.

### Siang (20 menit)

1. Ketik list, pilih 5 prospek berstatus baru.
2. Untuk tiap prospek: ketik dm NOMOR, salin teksnya, kirim lewat IG/WhatsApp.
3. Kalau ada kafe baru ditemukan, tambahkan dengan +kafe.

### Sore (10 menit)

1. Buka pesan 13:00 atau 18:00 dari radar. Pilih 1 berita yang paling relevan.
2. Tulis 1 komentar bernilai di postingan kafe yang relevan, atau simpan sebagai ide konten besok.
3. Cek bagian "Perlu follow-up" di rencana pagi. Kalau ada yang 3 hari belum dijawab, kirim satu pesan singkat: tanya kabar, jangan jualan.

### Mingguan (10 menit)

1. Ketik stats. Catat respon rate.
2. Kalau respon rate di bawah 20%, ganti template DM (minta variasi lain di hari berikutnya) atau perbaiki target (kafe yang benar-benar baru buka lebih responsif).

---

## 6. Setup sekali saja

1. Pastikan n8n menyala. Sejak 14 Nov 2026 n8n dinyalakan otomatis tanpa jendela (Task Scheduler `caPOS-n8n` + watchdog tiap 5 menit), jadi tidak perlu membiarkan jendela "n8n - caPOS" terbuka.
2. Pastikan bot @StudioD13_Bot sudah menjadi anggota grup caPOS. Kalau belum, tambahkan lewat menu anggota grup.
3. Kalau baru mengubah variabel env, restart n8n: buka Task Manager, akhiri proses node.exe milik n8n. Watchdog akan menyalakannya lagi dalam ±5 menit, tetap tanpa jendela.
4. Setelah n8n hidup, ketik bantu di grup. Kalau dibalas daftar perintah, sistem siap.

Kalau langkah 4 tidak dibalas:

- Buka n8n, lihat workflow JB2 - Outreach CRM (Telegram) harus berstatus Active.
- Buka tab Executions, cari eksekusi terakhir. Kalau ada tanda merah, klik dan lihat node mana yang gagal.
- Pastikan grup yang dipakai benar: id -1004449496335.

---

## 7. Yang perlu Anda ubah nanti

### Ganti kota

Default kota: Palu. Untuk mengganti, ada dua cara.

Cara cepat (tanpa restart): buka workflow JB1, node "Radar Berita", cari baris:

    const KOTA = envAtau('CAPOS_CITY', 'Palu');

Ganti Palu dengan kota Anda, lalu Save.

Cara rapi: set variabel Windows CAPOS_CITY, lalu restart n8n.

### Ganti kata kunci radar

Buka node "Radar Berita", cari daftar bawaan:

    'aplikasi kasir kafe', 'sistem kasir cafe', 'aplikasi kasir warung', ...

Tambahkan atau ganti sesuai target Anda. Bisa juga lewat env CAPOS_RADAR_KEYWORDS, dipisah koma.

### Ganti jam kirim

Buka workflow, klik node jadwal, ubah jam. Zona waktu workflow sudah diset Asia/Makassar (WITA), jadi jam 9 berarti 09:00 WITA. Jam operasional yang dipakai sekarang 09.00-22.00; jangan pasang jadwal di luar itu kecuali kamu siap komputer menyala 24 jam.

### Ganti grup tujuan

Semua node Telegram memakai chat id -1004449496335. Kalau grup berganti, ubah chat id di node Kirim Digest, Kirim Rencana, Kirim Balasan, dan Kirim ke Telegram (WF5).

---

## 8. Batasan yang harus Anda tahu

1. n8n jalan di komputer Anda. Kalau komputer benar-benar dimatikan, tidak ada pesan dan tidak ada balasan. Karena belum ada server, semua jadwal dibatasi **09.00-22.00 WITA** supaya komputer tidak bekerja 24 jam. Mematikan monitor tidak berpengaruh: n8n tetap jalan.
2. Bot memeriksa perintah tiap 5 menit (09.00-21.55 WITA), jadi balasan tidak instan. Ini disengaja supaya n8n tidak sibuk dan riwayat eksekusi tidak menumpuk. Perintah di luar jam itu dibalas pagi berikutnya.
3. Radar hanya membaca berita/artikel, bukan postingan media sosial. Untuk media sosial, gunakan link pencarian di pesan pagi.
4. Data prospek tersimpan di dalam workflow (bukan spreadsheet). Kalau workflow dihapus, data ikut hilang. Backup: buka workflow, menu tiga titik, Download.
5. Jangan membagikan file JSON workflow JB2 ke publik, karena di dalamnya ada token bot cadangan. Kalau token bocor, buat token baru di @BotFather lalu ganti di n8n.
6. Penyimpanan data pindah ke Data Table n8n (`Leads_Trial`, `Pembayaran_Langganan`) karena kredensial Google belum ada. WF1 sudah aktif dan dites. Node "Catat ke Content_Queue" di WF5 sengaja dijadikan placeholder (No-Op) supaya WF5 tetap bisa aktif; catatan cara mengembalikannya ada di node tersebut.
7. Belum ada API key Midtrans dan Groq. Tanpa Groq, WF5 memakai template cadangan; tanpa Midtrans, WF2 tidak bisa memverifikasi pembayaran.

---

## 9. Kalau ada masalah

| Gejala | Kemungkinan penyebab | Tindakan |
| --- | --- | --- |
| Tidak ada pesan sama sekali | n8n mati, atau workflow tidak aktif | Nyalakan n8n, cek status Active di daftar workflow |
| Pesan radar kosong tiap hari | Semua berita sudah pernah dikirim | Normal. Radar hanya kirim yang baru. Ubah kata kunci kalau ingin cakupan lain |
| Perintah tidak dibalas | JB2 nonaktif, atau bot bukan anggota grup | Aktifkan JB2, tambahkan bot ke grup |
| Balasan muncul terlambat | Memang diperiksa tiap 5 menit | Tunggu, atau ubah jadwal jadi 1 menit (lebih banyak eksekusi) |
| Tidak ada balasan padahal jam 23.00 | Di luar jam operasional 09.00-22.00 | Tunggu sampai 09.00, atau ubah cron di node `Cek Perintah (09-22)` |
| Error "chat not found" | chat id salah atau bot dikeluarkan dari grup | Cek id grup, masukkan bot lagi |
| WF2 belum aktif | `MIDTRANS_SERVER_KEY` belum diisi | Isi key Midtrans, lalu aktifkan WF2 |
| Draf konten terasa kaku | Groq belum aktif | Isi GROQ_API_KEY, atau edit manual draf sebelum posting |
| Data prospek hilang | Workflow dihapus atau di-reset | Kembalikan dari file JSON backup |
| "Prospek otomatis gagal" dari JB3 | Server OpenStreetMap lambat/putus (bukan bug bot) | Normal. JB3 hanya menambah prospek; kalau berulang, tambah kafe manual dengan `+kafe` |
| Email tidak terkirim | `email auto off`, prospek tidak berstatus `baru`, atau alamat email tidak terbaca | Ketik `email`. Pastikan `email auto on`, status prospek masih `baru`, dan `list` menampilkan emailnya |
| Email masuk ke Spam | Reputasi domain masih baru | Kirim sedikit dulu (5-10/hari), minta penerima menandai "bukan spam" |

Cara melihat error dengan cepat: buka n8n, menu Executions, klik eksekusi paling atas yang berwarna merah, lalu lihat node yang ditandai. Pesan error biasanya cukup jelas, misalnya "chat not found" atau "Bad Request".

---

## 10. Angka yang perlu dipantau

| Metrik | Cara melihat | Target awal |
| --- | --- | --- |
| DM terkirim per hari | hitung dari list berstatus di-DM | 5 |
| Respon rate | stats | minimal 20% |
| Trial | stats | 1-2 per minggu |
| Pelanggan | stats | 1 per 2 minggu |
| Konten terbit | manual, catat di kalender | 5 per minggu |

Kalau respon rate rendah, masalahnya biasanya di target, bukan di aplikasi. Kafe yang baru buka 1-3 bulan jauh lebih responsif daripada kafe yang sudah mapan.

---

## 11. Prinsip yang jangan dilanggar

1. Jangan kirim DM massal dengan teks identik. Itu cara tercepat membuat akun dibatasi.
2. Jangan menjanjikan fitur yang belum ada. Lebih baik menolak satu fitur daripada kehilangan kepercayaan.
3. Jangan bicara fitur di pesan pertama. Tanya masalahnya dulu.
4. Jangan menyerah di DM pertama. Follow-up sopan, bukan mengulang iklan.
5. Simpan setiap bukti (screenshot percakapan, testimoni) karena itu bahan konten paling kuat.

---

## 12. Daftar periksa sebelum mulai

- n8n menyala (otomatis, tanpa jendela)
- JB1 - Radar Jemput Bola berstatus Active
- JB2 - Outreach CRM (Telegram) berstatus Active
- JB3 - Prospek Otomatis berstatus Active (kirim Senin 09.10)
- WF5 - Mesin Konten Organik berstatus Active
- Bot sudah ada di grup caPOS
- Perintah bantu dibalas bot
- Sudah punya 5 kafe pertama untuk di-DM hari ini
- Kalau mau jalur email: sudah ada kafe dengan alamat email, dan `email auto on` sudah diketik

Kalau semua tercentang, Anda tidak perlu membuka n8n lagi hari itu. Cukup Telegram.

---

## 13. Jam operasional 09.00-22.00 & mematikan monitor

Sejak 14 Nov 2026 semua jadwal dibatasi ke jam kerja 09.00-22.00 WITA (sebelumnya ada yang 07.00). Alasannya: belum ada server, jadi komputer tidak dibebani 24 jam.

| Workflow | Jadwal baru | Catatan |
| --- | --- | --- |
| JB1 - Radar Jemput Bola | 09:00, 13:00, 18:00 | node `Jadwal Radar (09/13/18)` |
| JB2 - rencana harian | 09:05 | node `Jadwal Pagi 09.05` |
| JB2 - perintah Telegram | tiap 5 menit, 09.00-21.55 | cron `*/5 9-21 * * *` |
| JB2 - email otomatis | 09:30 (hanya kalau `email auto on`) | node `Jadwal Email 09.30` |
| JB3 - prospek OSM | Senin 09:10 | node `Jadwal Mingguan` |
| WF3 - uptime monitor | tiap 10 menit, 09.00-21.50 | cron `*/10 9-21 * * *` |
| WF5 - konten organik | 09:00 | node `Setiap Hari 09.00` |

**Mematikan monitor aman.** Mematikan layar tidak sama dengan mematikan komputer. n8n tetap jalan, jadwal tetap jalan, pesan Telegram tetap terkirim. Pengaturan daya saat ini (mode listrik/AC):

- Tidur otomatis (sleep): tidak pernah (0)
- Hibernate otomatis: tidak pernah (0). Sebelumnya 12 jam; diubah 14 Nov 2026 supaya n8n tidak mati sendiri saat komputer lama tidak disentuh.
- Timer bangun (wake timer): diizinkan
- Monitor: tidak pernah mati sendiri. Kalau ingin hemat listrik, matikan monitor secara manual; n8n tidak terpengaruh.
- Saat pakai baterai: sleep tidak pernah, hibernate setelah 3 jam idle. Untuk tetap hidup saat dicabut, ubah `hibernate-timeout-dc` ke 0.

Yang benar-benar mematikan sistem hanya: shutdown/restart, logout, atau menutup paksa proses n8n. Setelah restart, n8n hidup sendiri lewat Task Scheduler `caPOS-n8n` (tanpa jendela), dan watchdog memeriksa tiap 5 menit kalau n8n mati.

Kalau ingin komputer ikut istirahat malam untuk hemat listrik: matikan setelah 22.00 dan nyalakan lagi kapan saja. Jadwal 09.00-22.00 tidak terpengaruh, tetapi lead yang masuk lewat webhook saat komputer mati tidak tercatat. Untuk bisnis, lebih aman komputer dibiarkan hidup 24 jam dengan monitor mati.
