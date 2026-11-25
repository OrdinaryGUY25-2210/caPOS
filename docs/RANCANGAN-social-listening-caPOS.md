# Rancangan Otomasi Social Listening & Engagement caPOS (n8n + Python)

Versi draf: **1.0 - 14 November 2026**
Status: **rancangan, belum diimplementasikan**
Pemilik: Aldi (caPOS) - target biaya **Rp0** di fase awal

---

## 0. Ringkasan keputusan (baca ini dulu)

| # | Keputusan | Alasan singkat |
|---|---|---|
| 1 | Arsitektur **3 lapis**: Discovery -> Decision -> Action | Tiap lapis bisa diganti tanpa membongkar yang lain |
| 2 | **n8n = orkestrasi**, **Python (FastAPI) = kolektor + eksekutor** | Di mesin ini Python Code node n8n belum terpasang (lihat 1.2), dan Playwright/HTTP butuh proses sendiri |
| 3 | Default **Mode C (assist)**: bot menyiapkan sinyal + draf, manusia yang menekan "kirim" | Nyaman, tidak melanggar ToS, akun tidak kena shadowban |
| 4 | **Auto-post hanya** di kanal yang resmi mengizinkan: X (berbayar) dan Threads (butuh post_id) | IG & TikTok API tidak mengizinkan komentar ke posting orang lain |
| 5 | **Tidak ada DM otomatis** sama sekali | Sesuai permintaan; risiko restriction paling tinggi ada di DM massal |
| 6 | Semua rekap + persetujuan lewat **Telegram** (grup caPOS + chat pribadi owner) | Infrastruktur sudah ada, biaya Rp0 |
| 7 | Filter wilayah **berbasis skor**, bukan "mengandung kata Palu" | Banyak akun Palu tidak menulis "Palu" di caption, dan banyak yang menyebut Palu tapi bukan UMKM |
| 8 | Semua jadwal ikut jam operasional **09.00-22.00 WITA** | Konsisten dengan sistem yang sudah ada (belum ada server) |

**Peringatan penting sebelum mulai:** dua URL di brief **salah ketik dan tidak ada di DNS**. Lihat 1.1. Jangan pernah menaruh link yang mati di komentar publik.

---

## 1. Temuan verifikasi (14 Nov 2026)

### 1.1 URL: salah ketik, harus dikoreksi

| Yang ditulis di brief | Hasil cek | Status |
|---|---|---|
| `capos.alditrantama.com` | NXDOMAIN | **mati** |
| `capos-website.alditrantama.com` | NXDOMAIN | **mati** |
| `capos.alditriantama.com` | HTTP 200, title "Masuk - caPOS" (halaman login aplikasi) | hidup |
| `capos-website.alditriantama.com` | HTTP 200, title "caPOS - Aplikasi Kasir & Manajemen Kafe Anti Ribet" (landing page) | hidup |

**Aturan yang dipakai di sistem ini:**
- Untuk komentar publik, arahkan ke **landing page**: `https://capos-website.alditriantama.com`
- `https://capos.alditriantama.com` hanya untuk CTA "coba/login" setelah orang tanya-tanya (jangan di balasan pertama).
- Selalu pakai UTM supaya bisa diukur: `?utm_source=threads&utm_medium=reply&utm_campaign=sl-palu-2026-11`
- Sistem wajib menolak (hard guardrail) URL yang tidak lolos cek HTTP 200 sebelum dipakai di draf.

### 1.2 Python di n8n mesin ini

- Python 3.14.5 tersedia di Windows, **tetapi** paket `@n8n/task-runner-python` tidak ada di instalasi n8n 2.23.4 ini, jadi **Python Code node tidak bisa diandalkan**.
- Karena itu desain memakai **service Python terpisah** (FastAPI, jalan di `127.0.0.1:8765`) yang dipanggil n8n lewat HTTP Request. Keuntungan: bisa pakai Playwright/httpx, state kuota tersimpan, dan n8n tetap jadi "otak" alur.

### 1.3 Telegram: satu token hanya boleh satu konsumen

Sistem yang sudah ada (JB2) memakai **getUpdates (polling)**. Kalau kita tambah node `Telegram Trigger` (yang memakai webhook) dengan token yang sama, keduanya akan bertabrakan (error 409 / pesan hilang).

**Keputusan:** tombol persetujuan (`callback_query`) dan perintah `/sl` ditangani **di dalam JB2** (tambah cabang di node `Proses Perintah`), bukan bot baru. Kalau nanti mau tombol instan tanpa menunggu 5 menit, baru buat bot kedua khusus SL.

### 1.4 Status uji kerangka (14 Nov 2026)

Service Python sudah dicoba jalan (bukan hanya desain):

| Uji | Hasil |
|---|---|
| `GET /health` | 200, mode semua `assist`, kuota terbaca |
| `POST /collect` (Google News RSS) | 8 dari 8 item baru, contoh nyata: "Konsep Industrial Jadi Daya Tarik Cafe Buzz bagi Anak Muda di Kota Palu" (RRI), "Coffee Shop Menjamur di Palu, Pajak Tembus Rp11 Miliar" (Radar Palu) |
| `POST /post` mode assist | `siap_tempel`, tidak memposting apa pun |
| Idempotensi | permintaan kedua tidak dieksekusi ulang |
| Secret salah | ditolak HTTP 401 |
| Scheduler | belum disambung ke n8n |

Artinya: lapis discovery paling murah (RSS) sudah terbukti menghasilkan sinyal Palu yang relevan tanpa kredensial platform apa pun.

### 1.5 Jam operasional

Semua workflow baru mengikuti jendela **09.00-22.00 WITA** (`Asia/Makassar`) dan berhenti total di luar itu, konsisten dengan JB1/JB2/WF3/WF5.

---

## 2. Matriks kemampuan platform (per Nov 2026)

Ini bagian yang menentukan seluruh desain. Angka/endpoint bisa berubah; **wajib dicek ulang saat implementasi**.

| Platform | Cari posting publik (keyword) | Balas posting orang lain | Balas komentar di posting sendiri | Catatan biaya/izin |
|---|---|---|---|---|
| **Threads** | Tidak ada endpoint pencarian publik | **Bisa**, lewat `reply_to_id` (API resmi), asal `post_id` diketahui | Bisa (`threads_read_replies`, `threads_manage_replies`) | Gratis; app review Meta; token long-lived 60 hari |
| **X / Twitter** | **Butuh API Basic (~USD 200/bln)**; free tier sangat terbatas | Bisa (API v2, OAuth 2.0 user context) | Bisa | Gratis = tulis terbatas, baca hampir nol |
| **Instagram** | Tidak ada pencarian post publik | **Tidak bisa** (API hanya media milik sendiri) | Bisa (`instagram_manage_comments`) | Gratis; hanya akun profesional |
| **TikTok** | Tidak ada pencarian publik | **Tidak bisa** | Bisa untuk video sendiri (comment list/reply) | Gratis; app review |

**Konsekuensi jujur:** "bot otomatis komentar di IG dan TikTok ke posting orang lain" **tidak mungkin** lewat API resmi. Yang mungkin: bot menemukan sinyal, menulis draf, lalu manusia menempelkannya (assist), atau otomasi browser dengan cookie (**Mode B**, berisiko ban/shadowban).

---

## 3. Tiga mode operasi

| Mode | Cara kerja | Risiko | Biaya | Rekomendasi |
|---|---|---|---|---|
| **C - Assist** (default) | Bot menemukan sinyal -> AI menyusun draf -> Telegram minta persetujuan -> teks siap tempel + link posting | Nyaris nol | Rp0 | **Mulai di sini** |
| **A - Auto resmi** | Sama, tapi eksekusi otomatis lewat API resmi (Threads/X) setelah disetujui | Rendah-sedang (aturan platform soal duplikasi/spam) | X Basic $200/bln | Aktifkan setelah Mode C terbukti relevan |
| **B - Cookie automation** | Playwright login pakai cookie, komentar otomatis di IG/TikTok/Threads | **Tinggi**: shadowban, ban, ToS | Rp0 + akun burner + proxy | **Tidak disarankan** untuk akun brand; kalau tetap mau, pakai akun burner & cap 5-8/hari |

Sistem dirancang agar **mode per kanal** bisa diatur di tabel konfigurasi (`SL_Konfigurasi`), misal: `threads=auto_api`, `x=assist`, `instagram=assist`, `tiktok=assist`.

---

## 4. Arsitektur

```
                    +-----------------------------+
   RSS/News/Manual  |  Python service :8765       |   API resmi (opsional)
   ----------------->  /collect  /post  /health  <---------------------+
   Telegram intake  |  (httpx, dedupe, kuota)     |                     |
                    +--------------+--------------+                     |
                                   | HTTP                                |
                                   v                                     |
+---------------------------------------------------------------------------------+
|                                   n8n (lokal)                                   |
|                                                                                 |
|  SL1 Penjadwal Kolektor --> SL2 Skoring --> SL3 Draf AI --> SL4 Persetujuan --> |
|        (30 mnt)              (geo/intent)     (Groq)          (Telegram)        |
|                                                                  |              |
|                                                                  v              |
|                                                            SL5 Eksekutor -------+
|                                                                                 |
|  SL6 Rekap Harian 21.30        SL7 Health/Kuota/Kill-switch   SL8 Intake Manual  |
+---------------------------------------------------------------------------------+
        |                                       |
        v                                       v
  Data Tables (SL_Sinyal, SL_Balasan,      Telegram: grup caPOS (rekap)
  SL_Akun_Kuota, SL_Log_Aksi, SL_Konfigurasi)  + chat owner (approval)
```

Prinsip: **data dan keputusan tidak pernah bergantung pada Telegram**. Kalau Telegram timeout, sinyal dan draf tetap tersimpan (pola yang sudah dipakai WF1).

---

## 5. Alur n8n rinci (spesifikasi node)

Semua workflow baru diberi prefix `SL` supaya tidak bertabrakan dengan WF1-WF5/JB1-JB2.

### SL0 - Konfigurasi & Guardrail (sub-workflow)

| Node | Tipe | Parameter kunci |
|---|---|---|
| `Mulai` | Execute Sub-workflow Trigger | inputs: `bagian` (opsional) |
| `Ambil Konfigurasi` | Data Table (Get Row) `SL_Konfigurasi` | key `aktif` |
| `Gabung Default` | Code | merge default + DB, hitung `jam_operasional` dari `Asia/Makassar` |
| `Kembalikan` | Edit Fields / Code | return `{cfg, dalam_jam, versi}` |

Output dipakai semua workflow lain supaya **satu tempat untuk mematikan sistem** (`paused=true`).

### SL1 - Penjadwal Kolektor

| Node | Tipe | Parameter kunci |
|---|---|---|
| `Tiap 30 Menit` | Schedule Trigger | cron `*/30 9-21 * * *`, TZ `Asia/Makassar` |
| `Cek Aktif` | Execute Sub-workflow (SL0) | - |
| `Kalau Paused` | IF | `{{$json.paused}}` true -> `Selesai` |
| `Panggil Kolektor` | HTTP Request POST `http://127.0.0.1:8765/collect` | body: `{sources, keywords, geo, since_minutes:45}`, timeout 60s, retry 2x/5s, `onError: continue` |
| `Rapikan Sinyal` | Code | normalisasi field, hash `post_id + platform`, buang duplikat dalam batch |
| `Saring Duplikat` | Data Table (Get Many) `SL_Sinyal` filter `hash` in list | - |
| `Hanya Baru` | Merge/IF | simpan yang belum ada |
| `Simpan Sinyal` | Data Table (Insert) `SL_Sinyal` | status `baru`, `ditemukan_pada` |
| `Ada Baru?` | IF | count > 0 -> SL2 |

Catatan: `since_minutes:45` (lebih besar dari interval 30 menit) memberi toleransi kalau satu putaran gagal.

### SL2 - Skoring & Prioritas

| Node | Tipe | Parameter kunci |
|---|---|---|
| `Mulai` | Execute Sub-workflow Trigger | input: array sinyal |
| `Skor Wilayah` | Code | gazetteer Palu + hashtag + bio + prefix 0451 (lihat bagian 7) |
| `Skor Niat` | Code | bobot intent per keyword (lihat bagian 7) |
| `Skor Risiko` | Code | blacklist: politik, agama, duka/kecelakaan, komplain caPOS, kompetitor |
| `Skor Akhir` | Code | `0.45*intent + 0.35*geo + 0.20*recency - 0.5*risk` |
| `Routing` | Switch | `>=0.65` -> layak; `0.50-0.65` -> manual_review; `<0.50` atau risk>=0.4 -> skip |
| `Update Status` | Data Table (Update) `SL_Sinyal` | simpan skor + alasan (audit trail) |
| `Kirim ke Draf` | Execute Sub-workflow (SL3) | hanya status `layak` |

### SL3 - Penyusun Draf Balasan (AI)

| Node | Tipe | Parameter kunci |
|---|---|---|
| `Mulai` | Execute Sub-workflow Trigger | input: sinyal layak |
| `Pilih Prompt` | Code | `prompt_id` = `{platform}-{intent_class}` + versi (`v1.0`) |
| `Groq Chat` | HTTP Request POST `https://api.groq.com/openai/v1/chat/completions` | `model: llama-3.3-70b-versatile`, `temperature 0.7`, `max_tokens 220`, `response_format: json_object`, header `Authorization: Bearer $env.GROQ_API_KEY`, timeout 40s, retry 1 |
| `Validasi Draf` | Code | cek JSON valid, panjang per platform, kata terlarang, jumlah link <=1, tanpa DM/harga/klaim palsu (bagian 9) |
| `Retry Ketat?` | IF | gagal -> panggil Groq sekali lagi dengan prompt "perbaiki", kalau gagal lagi -> `manual_review` |
| `Cek Link` | HTTP Request HEAD | hanya jika `needs_link=true`; wajib 200 (link diverifikasi) |
| `Simpan Draf` | Data Table (Insert) `SL_Balasan` | status `menunggu_persetujuan`, simpan `prompt_id` + `model` |
| `Kirim Approval` | HTTP Request Telegram `sendMessage` | HTML, inline keyboard 4 tombol, `onError: continue`, timeout 15s |

Format pesan approval (ringkas, bisa dibaca di HP):

```
🎯 SINYAL BARU - Threads | skor 0.82
👤 @kopisenja_palu - "kasir sering salah hitung kalau ramai"
🔗 <link posting>
💡 Alasan: sebut Palu + keluhan operasional kasir

📝 Draf balasan:
"Fase paling chaos itu biasanya pas jam pulang kerja..."

[✅ Setujui] [✏️ Edit] [⏭ Lewati] [🚫 Blacklist]
```

### SL4 - Persetujuan & Eksekusi

| Node | Tipe | Parameter kunci |
|---|---|---|
| `Webhook Approval` | Webhook POST `/webhook/sl/approve` | header `x-sl-secret` = `$env.SL_WEBHOOK_SECRET`, responseMode `onReceived` |
| `Verifikasi` | IF/Code | tolak jika secret salah |
| `Ambil Draf` | Data Table (Get Row) `SL_Balasan` | by id |
| `Mode Kanal` | Switch | `auto_api` -> Posting; `assist` -> Kirim Siap Tempel; `paused` -> Selesai |
| `Posting` | HTTP Request POST `http://127.0.0.1:8765/post` | `{platform, post_id, text, idempotency_key}`; service menegakkan cap & jeda |
| `Simpan Hasil` | Data Table (Update) `SL_Balasan` | `status=terkirim`, `platform_comment_id`, `waktu` |
| `Konfirmasi` | Telegram `sendMessage` | "✅ terkirim ke Threads" / "❌ gagal: alasan" |
| `Kirim Siap Tempel` | Telegram `sendMessage` | teks + deep link + tombol "Sudah saya kirim" (menandai manual) |

**Idempotensi:** `idempotency_key = hash(draf_id)` supaya tombol yang ditekan dua kali tidak mengirim dua komentar.

### SL5 - Rekap Harian & Mingguan

| Node | Tipe | Parameter kunci |
|---|---|---|
| `Rekap 21.30` | Schedule Trigger | cron `30 21 * * *` (mingguan: `0 20 * * 0`) |
| `Hitung Angka` | Data Table (Get Many) + Code | sinyal, layak, draf, disetujui, terkirim, gagal, per platform |
| `Top Prospek` | Code | 10 teratas: akun, platform, link, alasan, skor |
| `Kirim Rekap` | Telegram `sendMessage` | HTML, dipecah <=3500 karakter |

Isi rekap: angka harian, 10 prospek teratas, 3 balasan terbaik (untuk dipelajari), daftar `manual_review` yang menunggu keputusan manusia, dan status kuota akun.

### SL6 - Health, Kuota & Kill Switch

| Node | Tipe | Parameter kunci |
|---|---|---|
| `Tiap 15 Menit` | Schedule Trigger | cron `*/15 9-21 * * *` |
| `Cek Service` | HTTP GET `http://127.0.0.1:8765/health` | timeout 10s |
| `Cek Kuota` | Data Table `SL_Akun_Kuota` | sisa cap hari ini |
| `Evaluasi` | Code | service mati / error rate >20% / auth gagal 2x / kuota habis -> `paused=true` |
| `Alert` | Telegram `sendMessage` | satu pesan, hindari spam (diam 60 menit setelah alert yang sama) |

### SL7 - Intake Manual (paling cepat menghasilkan)

| Node | Tipe | Parameter kunci |
|---|---|---|
| `Webhook Intake` | Webhook POST `/webhook/sl/intake` | body `{url, catatan}` |
| `Ambil Metadata` | HTTP Request (Python `/resolve`) | judul, author, teks, platform, tanggal |
| `Simpan` | Data Table `SL_Sinyal` | source `manual` |
| `Lanjut Skor` | Execute SL2 | - |

Di Telegram cukup: `/pantau https://www.threads.net/@akun/post/xxxx` (ditangani cabang JB2), atau tempel link ke form sederhana.

---

## 6. Skema Data Table (kompatibel dengan Data Table n8n yang sudah dipakai)

### SL_Konfigurasi
`key`, `value` (JSON string), `diubah_pada`, `diubah_oleh`
Contoh key: `aktif`, `mode_kanal`, `cap_harian`, `jam_operasional`, `ambang_skor`, `versi_prompt`.

### SL_Sinyal
`id`, `hash`, `platform`, `post_id`, `post_url`, `thread_id`, `parent_comment_id`, `author`, `author_url`, `author_bio`, `teks`, `bahasa`, `lokasi_petunjuk`, `keyword_hits` (JSON), `geo_score`, `intent_score`, `risk_score`, `skor_akhir`, `status`, `alasan`, `sumber`, `ditemukan_pada`, `diposting_pada`

Status: `baru` -> `layak` / `manual_review` / `skip` -> `didraf` -> `disetujui` -> `terkirim` / `gagal` / `dilewati`.

### SL_Balasan
`id`, `sinyal_id`, `platform`, `draf_teks`, `prompt_id`, `model`, `confidence`, `needs_link`, `link_dipakai`, `status`, `disetujui_oleh`, `disetujui_pada`, `dikirim_pada`, `platform_comment_id`, `error`, `idempotency_key`

### SL_Akun_Kuota
`platform`, `handle`, `mode`, `cap_harian`, `terpakai_hari_ini`, `tanggal`, `jeda_minimal_detik`, `terakhir_aksi`, `status` (`sehat`/`jeda`/`paused`), `catatan`

### SL_Log_Aksi
`waktu`, `aktor` (`bot`/`owner`), `aksi`, `platform`, `sinyal_id`, `hasil`, `detail`

---

## 7. Filter wilayah Palu & skoring

### 7.1 Sinyal wilayah (bukan hanya kata "Palu")

| Sinyal | Contoh | Bobot |
|---|---|---|
| Nama kota/daerah | Palu, Sigi, Donggala, Poso, Tawaeli, Palu Barat, Palu Timur, Palu Selatan, Palu Utara, Mantikulore, Tatanga, Ulujadi, Kawatuna | 0.55 |
| Landmark/jalan | Jl. Basuki Rahmat, Jl. Emmy Saelan, Jl. Hasanuddin, Jl. Sam Ratulangi, Jl. Diponegoro, Jl. Maluku, Taman Nasional Lore Lindu, Pantai Talise, Vatulemo | 0.45 |
| Hashtag | #kafepalu #kulinerpalu #kopipalu #umkmpalu #palukeren #pesonapalu | 0.40 |
| Bio/lokasi profil | "Palu", "Central Sulawesi", "Sulteng", ikon pin + Palu | 0.35 |
| Nomor telepon | prefix **0451** | 0.30 |
| Bahasa/istilah lokal | "nasi jagung", "kaledo", "palumara", "banggai" | 0.15 |

`geo_score = clamp(jumlah bobot yang cocok, 0, 1)`, lalu **kurangi 0.3** kalau caption jelas-jelas nasional/iklan (mis. "berlaku seluruh Indonesia", "reseller seluruh Indonesia").

### 7.2 Intent (niat)

| Kelas intent | Contoh keyword | Bobot dasar |
|---|---|---|
| `masalah_operasional` | kasir lambat, antre panjang, salah hitung, stok tidak ketemu, laporan manual, shift ribet, karyawan cuma 1-2 | 0.9 |
| `cari_solusi` | rekomendasi aplikasi kasir, aplikasi POS kafe, sistem kasir murah, self order | 0.85 |
| `buka_usaha` | baru buka kafe, rencana buka resto, modal usaha kafe, survei lokasi | 0.75 |
| `diskusi_umum` | omzet kafe, sepi pengunjung, promo kafe, menu baru | 0.45 |
| `lowongan/kerja` | lowongan kasir, gaji kasir, magang | 0.0 (buang) |

`intent_score = bobot tertinggi + 0.1*(jumlah keyword lain)`, maksimal 1.

### 7.3 Risiko (hard skip)

- Politik, agama, konflik, bencana/kecelakaan/duka -> skip.
- Keluhan/komplain tentang caPOS -> **jangan dibalas bot**, eskalasi ke owner.
- Kompetitor (sebut merek POS lain) -> skip, jangan menjelekkan.
- Akun tanpa foto/baru dibuat <7 hari dan hanya promosi -> skip (indikasi bot/spam).
- Posting lebih tua dari 72 jam -> skip (balasan terlambat terlihat aneh).

### 7.4 Contoh perhitungan

```
Post: "baru buka kafe kecil di Palu, karyawan cuma 2, kalau ramai kasirnya kacau"
geo    = 0.55 (kota) + 0.35 (bio "Palu") = 0.90
intent = 0.90 (masalah_operasional) = 0.90
recency= 1.0 (2 jam lalu)
risk   = 0
skor   = 0.45*0.90 + 0.35*0.90 + 0.20*1.0 - 0 = 0.92  -> layak, draf otomatis

Post: "aplikasi kasir apa yang bagus? aku di Jakarta"
geo    = 0.0
intent = 0.85
skor   = 0.45*0.85 + 0 + 0.20 - 0 = 0.58  -> manual_review (Fase 1 belum ekspansi)
```

Ambang: `>=0.65` otomatis draf, `0.50-0.65` antre review, `<0.50` skip. Semua ambang bisa diubah di `SL_Konfigurasi` tanpa mengedit workflow.

---

## 8. Prompt AI (ringkas)

Prompt lengkap, few-shot, dan aturan negatif ada di **`automation/social-listening/prompts.md`**. Ringkasnya:

- Peran: "social media responder caPOS, orang Palu, ngobrol natural, bukan sales".
- Output **JSON**: `{reply, intent, confidence, why_relevant, needs_link, risk_flags}`.
- Batas panjang: X <= 260 karakter, Threads <= 420, IG/TikTok <= 300.
- Gaya: 1-2 kalimat empati/mirroring + 1 pertanyaan balik; **soft sell** maksimal 1 kalimat; tanpa jargon.
- Dilarang: harga, janji fitur di luar knowledge base, testimoni palsu, menyebut kompetitor, ajakan DM, link di balasan pertama (kecuali intent `cari_solusi`), lebih dari 1 emoji, huruf kapital berlebihan.
- Wajib: bahasa Indonesia santai, sapa tidak berlebihan, jangan menyalin kalimat postingan.
- Jika ragu atau `risk_flags` tidak kosong -> `confidence < 0.5` dan sistem mengarahkan ke review manusia.

Contoh draf yang diharapkan:

> "Fase paling chaos itu biasanya pas jam pulang kerja ya. Kalau mau, self-order lewat HP bisa motong satu titik antrean tanpa nambah orang. Lagi paling sering kena di bagian catat pesanan atau hitung bayar?"

---

## 9. Guardrail & kepatuhan (hard rules)

| Aturan | Nilai | Ditegakkan di |
|---|---|---|
| Jam aksi | 09.00-21.30 WITA | Python + SL0 |
| Cap per akun per hari | X 15, Threads 12, IG 8, TikTok 5 | `SL_Akun_Kuota` + `/post` |
| Jeda antar aksi | 6-15 menit acak, minimal 6 | Python (sleep/queue) |
| 1 balasan per thread | ya | dedupe `thread_id` |
| 1 balasan per akun per 7 hari | ya | dedupe `author` |
| Panjang balasan | X 260, Threads 420, IG/TikTok 300 | validator SL3 |
| Link | maks 1, wajib HTTP 200, hanya landing + UTM | validator SL3 |
| DM otomatis | **dilarang total** | tidak ada node DM |
| Duplikasi teks | kemiripan < 0.8 antar balasan (cosine/jaccard) | validator |
| Blacklist | kata kasar, politik, agama, duka | SL2 |
| Kill switch | `aktif=false` di `SL_Konfigurasi` | SL0 |
| Audit | semua aksi tercatat di `SL_Log_Aksi` | SL4 |

Kepatuhan: patuhi ToS tiap platform; perlakukan data publik sebagai data terbatas (UU PDP), simpan hanya yang perlu, hapus atas permintaan, dan jangan pernah menyimpan password akun sosial (kecuali Mode B dengan cookie terenkripsi dan akun terpisah).

---

## 10. Kredensial yang dibutuhkan (eksplisit)

### 10.1 Wajib untuk Mode C (bisa mulai hari ini, Rp0)

| # | Kebutuhan | Detail | Disimpan di |
|---|---|---|---|
| 1 | Telegram Bot Token | bot yang sudah dipakai caPOS (`@StudioD13_Bot`) | sudah ada (env) |
| 2 | Telegram `chat_id` grup caPOS | `-1004449496335` | sudah ada |
| 3 | Telegram `user_id` owner | untuk kirim tombol approval ke chat pribadi (bukan grup) | env `SL_OWNER_CHAT_ID` |
| 4 | Groq API Key | daftar gratis di console.groq.com; scope chat completions | n8n Header Auth credential (bukan env) |
| 5 | Secret webhook SL | string acak 32+ karakter untuk `x-sl-secret` | env `SL_WEBHOOK_SECRET` |

### 10.2 Untuk Mode A (auto-post resmi)

| Platform | Yang harus disiapkan | Scope/izin | Catatan |
|---|---|---|---|
| **X** | Akun brand + X Developer App (OAuth 2.0 user context) | `tweet.read`, `tweet.write`, `users.read`, `offline.access` | Pencarian butuh Basic ~USD 200/bln. Tanpa itu: tetap Mode C |
| **Threads** | Meta app + Threads API, akun Threads brand | `threads_basic`, `threads_content_publish`, `threads_read_replies`, `threads_manage_replies` | Token long-lived 60 hari, perlu auto-refresh; App Review Meta 2-6 minggu |
| **Instagram** | IG profesional + Facebook Page + Meta app | `instagram_basic`, `instagram_manage_comments`, `pages_show_list` | Hanya balas komentar di media sendiri |
| **TikTok** | TikTok for Developers app (Login Kit + Content Posting) | `video.list`, `comment.list`, `comment.create` (video sendiri) | Tidak ada akses posting publik |

### 10.3 Untuk Mode B (opsional, berisiko)

- Akun **burner** per platform (jangan akun brand).
- Cookie sesi (bukan password), diekspor dari browser, disimpan **terenkripsi** (Windows DPAPI / Credential Manager), file di luar folder sinkronisasi.
- Opsional: proxy residensial Indonesia (berbayar).
- Persetujuan tertulis dari Anda bahwa risiko ban ditanggung.

### 10.4 Yang TIDAK boleh diminta/diberikan

Password akun brand, kode OTP/2FA, akses email utama, atau jasa beli follower/komentar.

---

## 11. Biaya

| Komponen | Rp0 (Mode C) | Naik kelas |
|---|---|---|
| n8n + Python service | lokal, gratis | VPS USD 5-10/bln |
| LLM | Groq free tier | Gemini/OpenAI berbayar |
| Telegram | gratis | - |
| Discovery | RSS + intake manual | X Basic USD 200/bln |
| Auto-post | Threads/IG/TikTok API gratis | proxy + akun burner |

---

## 12. Metrik sukses (ukur, jangan menebak)

| Metrik | Cara ukur | Target 30 hari |
|---|---|---|
| Sinyal ditemukan/hari | `SL_Sinyal` | 15-40 (Palu) |
| Presisi relevansi | sampling manual 20/hari | >=70% |
| Approval rate draf | `SL_Balasan` | >=60% |
| Balasan terkirim/hari | `SL_Log_Aksi` | 5-10 (Mode C) |
| Klik ke landing | UTM di analytics | >=3% dari balasan |
| Prospek masuk (DM/telepon) | catat manual di JB2 | >=5/minggu |
| Akun kena limit/ban | manual | 0 |

---

## 13. Roadmap implementasi

| Sprint | Isi | Keluaran | Estimasi |
|---|---|---|---|
| **0** | Service Python (`/health`, `/collect` RSS, `/resolve`), SL1+SL2, rekap Telegram | Radar Palu jalan, belum ada balasan | 1-2 hari |
| **1** | Prompt v1.0, SL3, approval Telegram (via JB2), pencatatan aksi manual | Draf siap tempel, ukur approval rate | 3-4 hari |
| **2** | SL4 + Mode A untuk Threads (setelah app review), cap & health | Auto-post terbatas | 1-2 minggu (menunggu review) |
| **3** | Ekspansi kota (Makassar/Manado/Kendari), A/B tone, laporan mingguan | Skala nasional bertahap | setelah stabil |

Definisi "stabil" sebelum ekspansi: 2 minggu berturut-turut tanpa ban/limit, precision >=70%, dan approval rate >=60%.

---

## 14. Risiko & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Shadowban/ban | Akun hilang | Mode C dulu, cap ketat, jeda acak, tanpa link di balasan pertama |
| Balasan terasa spam | Reputasi rusak | Review manusia, 1 balasan per thread, bahasa natural |
| Link salah/mati | Kepercayaan hilang | Guardrail HTTP 200 + URL yang sudah diverifikasi (1.1) |
| Data pribadi | UU PDP | Simpan minimum, hapus atas permintaan, akses terbatas |
| API berubah | Alur mati | Adapter terpisah + SL6 health + kill switch |
| Komputer mati | Tidak ada aksi | Jadwal 09-22, watchdog n8n yang sudah ada |
| Biaya X | Rp0 gagal | Tetap Mode C untuk X, atau batasi ke Threads |

---

## 15. Keputusan yang perlu Anda ambil

1. **Mode awal**: setuju mulai Mode C (assist) untuk semua kanal? (rekomendasi: ya)
2. **Akun**: pakai akun brand caPOS yang ada, atau buat akun khusus "caPOS Palu"? (rekomendasi: brand, jangan akun palsu)
3. **X**: siap bayar ~USD 200/bln untuk pencarian, atau X tetap assist/manual?
4. **Mode B**: perlu sama sekali, atau cukup Mode C sampai ada tim?
5. **Approval**: tombol persetujuan dikirim ke chat pribadi Anda (rekomendasi) atau ke grup caPOS?
6. **Ekspansi**: setelah Palu stabil 2 minggu, kota berikutnya mana?

---

## 16. Lampiran

- Prompt lengkap + few-shot: `automation/social-listening/prompts.md`
- Kode service Python: `automation/social-listening/collector.py`
- Konfigurasi keyword & gazetteer Palu: `automation/social-listening/config/keywords-palu.json`
- Cara pasang: `automation/social-listening/README.md`
