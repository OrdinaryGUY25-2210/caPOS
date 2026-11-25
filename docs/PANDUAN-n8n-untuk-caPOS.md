# Panduan n8n untuk caPOS

**Versi bahasa sederhana — untuk kamu yang baru pertama kali pakai n8n.**

Dokumen teknis lengkapnya ada di `docs/n8n-capos-automation.md`. Dokumen ini adalah versi "lakukan ini, lalu ini".

---

## 1. Kabar baiknya: mesinnya sudah jadi

Otomasi sudah **dibuat, dipasang, dan dites** di n8n kamu. Status per 14 November 2026:

| Nama otomasi | Fungsinya | Status |
|---|---|---|
| **WF1 - Radar Tenant Baru** | Ada kafe daftar → tersimpan di tabel `Leads_Trial` + email sambutan + notif Telegram | ✅ **aktif**, sudah dites (Telegram + email + baris tabel masuk) |
| **WF2 - Pembayaran Langganan** | Ada yang bayar → tercatat di `Pembayaran_Langganan` + notif nominal | ⏸ belum aktif — menunggu `MIDTRANS_SERVER_KEY` |
| **WF3 - Uptime Monitor** | Cek caPOS tiap 10 menit (09.00-22.00). Kalau mati → kamu dapat peringatan | ✅ **aktif** |
| **WF4 - Drip Email Trial** | Email otomatis hari ke-3, 10, 21, 27 masa trial | ⏸ belum aktif — opsional |
| **WF5 - Mesin Konten** | Tiap pagi jam 9 → draf postingan medsos dikirim ke Telegram | ✅ **aktif** |
| **JB1 - Radar Jemput Bola** | 3× sehari: sinyal berita + ide prospek + link pencarian manual | ✅ **aktif** |
| **JB2 - Outreach CRM (Telegram)** | Perintah Telegram: `+kafe`, `list`, `dm`, `stats`, dst. | ✅ **aktif** |

Cara pakai JB1/JB2 ada di dokumen terpisah: `docs/PANDUAN-jemput-bola.md`.

Yang masih perlu kamu lakukan tinggal sedikit: isi `MIDTRANS_SERVER_KEY` (kalau mau WF2 nyala), aktifkan MFA, dan pasang trigger Supabase + Notification URL Midtrans.

---

## 2. Cara kerja n8n dalam 1 menit

Bayangkan n8n sebagai **satpam gedung**:

| Istilah | Arti sederhana |
|---|---|
| **Workflow** | Satu set instruksi: "kalau A terjadi, lakukan B lalu C" |
| **Trigger** | Pemicu — yang bikin instruksi mulai jalan (jadwal, atau ada yang "mengetuk pintu") |
| **Webhook** | Pintu tempat orang luar mengetuk. Supabase/Midtrans mengetuk pintu ini |
| **Node** | Satu kotak/langkah di dalam instruksi (kirim Telegram, tulis tabel, kirim email) |
| **Credential** | Kunci yang disimpan n8n untuk login ke layanan lain (Google, Telegram) |
| **Environment variable (env)** | Tulisan rahasia di komputer kamu yang dibaca n8n. Contoh: token bot Telegram |
| **Execution** | Catatan satu kali jalan — berguna untuk melihat error di langkah mana |

Alur WF1 sebagai contoh:

```
Supabase: ada tenant baru
        ↓ (mengetuk pintu webhook)
n8n: "oh, ada tenant baru"
        ↓
Simpan ke tabel Leads_Trial  →  Kirim email sambutan  →  Notif Telegram
```

> Urutannya sengaja begini: data dan email disimpan lebih dulu, notifikasi Telegram paling akhir. Kalau Telegram sedang lambat/putus, data dan email tetap aman.

---

## 3. Yang harus kamu siapkan

Semua gratis. Cukup daftar akun:

| Yang dibutuhkan | Untuk apa | Biaya |
|---|---|---|
| Bot Telegram | Notifikasi ke HP kamu | Gratis |
| Tabel n8n (Data Table) | Tempat mencatat lead & pembayaran | Gratis, sudah bawaan n8n |
| Resend | Kirim email otomatis | Gratis (100 email/hari) |
| Groq | AI pembuat draf konten | Gratis (opsional — tanpa ini pakai template cadangan) |
| Cloudflare | Membuka n8n ke internet | Gratis |
| Midtrans | (sudah kamu pakai) | — |

---

## 4. Enam langkah berikutnya

Kerjakan berurutan. Total waktu santai: **± 1 jam** (belum termasuk tunggu DNS).

### ✅ Langkah 1 — Nyalakan n8n (2 menit)

**Cara paling gampang:** klik dua kali file `start-n8n.bat` di folder project ini.
Browser akan terbuka sendiri ke `http://localhost:5678` dalam ± 20 detik.

**Kalau lewat terminal:**

```powershell
n8n.cmd start
```

> ⚠️ Jangan ketik `n8n` saja di PowerShell. Di komputer kamu ada file kosong bernama `n8n` di `C:\Windows\System32` yang membuat perintah itu gagal. Pakai `n8n.cmd start`.

**Tanda berhasil:** halaman n8n terbuka, kamu bisa login.

---

### ✅ Langkah 2 — Isi "kunci rahasia" (10 menit)

Ini bagian terpenting. Tanpa ini, otomasi akan error di tengah jalan.

1. Buka PowerShell baru di folder project.
2. Jalankan:

```powershell
powershell -ExecutionPolicy Bypass -File docs\set-n8n-env.ps1
```

3. Script akan menanyakan 8 nilai satu per satu. Kalau belum punya, tekan **Enter** untuk lewati.
4. Setelah selesai, **tutup jendela n8n lalu jalankan `start-n8n.bat` lagi**. (Env hanya dibaca saat n8n mulai.)

**Dari mana dapat nilainya?**

| Kunci | Cara mendapatkannya |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Chat `@BotFather` di Telegram → kirim `/newbot` → ikuti instruksi → dapat token |
| `TELEGRAM_CHAT_ID` | Kirim pesan apa saja ke bot kamu, lalu buka `https://api.telegram.org/bot<TOKEN>/getUpdates` → lihat angka `"id"` (untuk grup angkanya negatif, mis. `-100...`) |
| `RESEND_API_KEY` | Daftar di resend.com → API Keys → Create |
| `EMAIL_FROM` | Contoh: `caPOS <halo@alditriantama.com>` |
| `CAPOS_URL` | Alamat website caPOS kamu, mis. `https://alditriantama.com` |
| `MIDTRANS_SERVER_KEY` | Dashboard Midtrans → Settings → Access Keys |
| `GROQ_API_KEY` | Daftar di console.groq.com → API Keys |
| `WEBHOOK_URL` | `https://n8n.cloudeflare.my.id` (setelah Langkah 4 selesai) |

**Tanda berhasil:** buka PowerShell baru, ketik `echo $env:TELEGRAM_BOT_TOKEN` → keluar tokennya (bukan kosong).

---

### ✅ Langkah 3 — Tabel penyimpanan (sudah siap, 0 menit)

Dulu rencananya memakai Google Sheets. Karena credential Google belum ada, penyimpanan sekarang memakai **Data Table bawaan n8n**: gratis, tidak perlu daftar apa pun, dan datanya ikut tersimpan di database n8n (ikut ter-backup bersama workflow).

Dua tabel sudah dibuat dan sudah diisi lewat tes:

| Tabel | Kolom |
|---|---|
| `Leads_Trial` | `tanggal`, `nama_kafe`, `email`, `telepon`, `tenant_id`, `sumber`, `status` |
| `Pembayaran_Langganan` | `tanggal`, `order_id`, `tenant_id`, `nama`, `email`, `nominal`, `metode`, `status_midtrans`, `status_tenant` |

**Cara melihat datanya:**

1. Buka n8n (`http://localhost:5678`).
2. Di menu kiri cari **Data Tables** (ikon tabel).
3. Klik `Leads_Trial` atau `Pembayaran_Langganan`.

**Tanda berhasil:** setelah tes WF1 (Langkah 6), muncul baris baru di `Leads_Trial`.

> **Kalau nanti mau pindah ke Google Sheets** (opsional, tidak wajib): buat spreadsheet dengan 2 tab bernama `Leads_Trial` dan `Pembayaran_Langganan`, header persis seperti tabel di atas, sambungkan credential **Google Sheets OAuth2 API** (lihat Lampiran C), lalu ganti node `Catat ke ...` menjadi node Google Sheets. Selama belum, Data Table sudah lebih dari cukup.

---

### ✅ Langkah 4 — Buka "pintu" dari internet (15–30 menit)

Supabase dan Midtrans ada di internet. Mereka tidak bisa mengetuk `localhost` di komputer kamu. Jadi n8n harus diberi alamat publik.

Ada 3 pilihan. **Pilih satu saja.**

#### Opsi A — Cloudflare Tunnel + subdomain permanen ✅ *(sudah terpasang)*

Hasil: `https://n8n.cloudeflare.my.id` → diteruskan ke n8n lokal `http://localhost:5678`.

**Kenapa pakai domain terpisah:** `alditriantama.com` tetap di nameserver Rumahweb supaya website & email Resend (`halo@alditriantama.com`) tidak terganggu. Untuk n8n dipakai domain khusus **`cloudeflare.my.id`** yang dibeli terpisah.

**Yang sudah dikerjakan (14 Nov 2026):**

1. Domain `cloudeflare.my.id` dimasukkan ke Cloudflare (paket **Free**).
2. Nameserver diganti di registrar menjadi `meera.ns.cloudflare.com` + `ray.ns.cloudflare.com` → status zona **Active**.
3. `cloudflared` v2026.11.0 terpasang di `C:\Program Files (x86)\cloudflared\`.
4. Tunnel dibuat: nama **`n8n-capos`**, ID `73696a31-99a7-4b7c-943e-6963f649c013`.
5. DNS `n8n.cloudeflare.my.id` (CNAME) diarahkan ke tunnel itu.
6. Config tersimpan di `C:\Users\<nama-kamu>\.cloudflared\config.yml`:
   `hostname n8n.cloudeflare.my.id` → `service http://localhost:5678`.
7. Autostart lewat **Scheduled Task** `caPOS-cloudflared` (jalan otomatis saat login) — tidak memakai `cloudflared service install` karena butuh hak admin.
8. Sudah diuji: `https://n8n.cloudeflare.my.id/healthz` → `{"status":"ok"}`, dan webhook publik dijawab **HTTP 200** dengan eksekusi tercatat di n8n.

**Kalau nanti perlu mengulang dari nol (mis. ganti PC):**

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel login
cloudflared tunnel create n8n-capos
cloudflared tunnel route dns n8n-capos n8n.cloudeflare.my.id
cloudflared tunnel run --url http://localhost:5678 n8n-capos
```

> Supaya URL webhook yang ditampilkan n8n benar, `WEBHOOK_URL` harus `https://n8n.cloudeflare.my.id` dan n8n di-restart setelah env diubah.

---

#### Opsi B — Quick Tunnel (buat tes cepat, 2 menit)

Tanpa domain, tanpa daftar. Tapi alamatnya **berubah setiap restart** dan hanya untuk tes.

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:5678
```

Akan muncul alamat seperti `https://kucing-biru-1234.trycloudflare.com`. Pakai alamat itu untuk tes. Kalau n8n restart, alamatnya ganti dan harus diperbarui di Supabase/Midtrans.

---

#### Opsi C — Ngrok (alternatif, ada domain tetap gratis)

Daftar di ngrok.com → dapat 1 domain statis gratis → jalankan `ngrok http 5678 --domain=xxx.ngrok-free.app`.

---

### ✅ Langkah 5 — Pasang pemicu di Supabase & Midtrans (10 menit)

Lakukan setelah Langkah 4 berhasil.

**A. Supabase (untuk WF1 & WF4)**

1. Buka Supabase → **SQL Editor**.
2. Salin seluruh blok SQL dari `docs/n8n-capos-automation.md` bagian **5. Supabase → n8n webhook**.
3. Ganti tulisan `GANTI_DENGAN_SECRET_DARI_webhook-secret.txt` dengan isi file:
   `C:\Users\aldic\AppData\Local\Temp\opencode\n8n-snap\webhook-secret.txt`
4. Klik **Run**.

**B. Midtrans (untuk WF2)**

1. Dashboard Midtrans → **Settings → Configuration**.
2. Isi **Payment Notification URL**:
   `https://n8n.cloudeflare.my.id/webhook/capos/midtrans`
3. Simpan.

**Tanda berhasil:** nanti saat ada tenant baru / pembayaran, muncul di tab **Executions** n8n.

---

### ✅ Langkah 6 — Nyalakan & tes (10 menit)

**Urutan menyalakan yang kusarankan** (dari paling gampang ke paling rumit):

| Urutan | Workflow | Kenapa duluan |
|---|---|---|
| 1 | **WF3 - Uptime Monitor** | Cuma butuh Telegram + URL. Tidak butuh tabel/tunnel | ✅ sudah aktif |
| 2 | **WF5 - Mesin Konten** | Butuh Groq + Telegram. Bisa dites manual | ✅ sudah aktif |
| 3 | **JB1 & JB2 - Jemput Bola** | Radar berita + CRM Telegram | ✅ sudah aktif |
| 4 | **WF1 - Radar Tenant Baru** | Butuh tunnel + tabel + Resend | ✅ sudah aktif |
| 5 | **WF2 - Pembayaran** | Butuh `MIDTRANS_SERVER_KEY` + Notification URL | ⏸ tunggu key Midtrans |
| 6 | **WF4 - Drip Email** | Butuh tunnel + Resend (efeknya baru terasa 3 hari) | ⏸ opsional |

**Cara menyalakan satu workflow:**

1. Buka workflow → klik **Save** (pojok kanan atas).
2. Geser tombol **Active** di pojok kanan atas sampai biru.
3. Selesai.

**Cara tes tanpa menunggu kejadian nyata:**

| Workflow | Cara tes |
|---|---|
| WF3 | Tunggu maksimal 10 menit → cek tab **Executions** |
| WF5 | Buka workflow → klik **Execute workflow** |
| WF1 | Kirim "ketukan" palsu lewat PowerShell (lihat di bawah) |
| WF2 | Dashboard Midtrans punya tombol **Test notification** |
| WF4 | Kirim ketukan palsu ke `/webhook/capos/drip-trial` |

**Tes WF1 (kirim data palsu):**

```powershell
$secret = Get-Content "C:\Users\aldic\AppData\Local\Temp\opencode\n8n-snap\webhook-secret.txt"
$body = '{"table":"tenants","record":{"id":"tes-1","name":"Kafe Tes","email":"tes@example.com","created_at":"2026-11-13T09:00:00Z"}}'
Invoke-RestMethod -Method Post -Uri "https://n8n.cloudeflare.my.id/webhook/capos/tenant-baru" `
  -Headers @{ "x-webhook-secret" = $secret; "Content-Type" = "application/json" } `
  -Body $body
```

**Tanda berhasil:** HP kamu berbunyi (notifikasi Telegram), email sambutan masuk, dan baris baru muncul di tabel `Leads_Trial` (menu **Data Tables**).

---

## 5. Cara menjalankan sehari-hari

### Menyalakan

- **Otomatis (sudah diset):** saat kamu login ke Windows, dua Scheduled Task jalan sendiri:
  - `caPOS-n8n` → menjalankan n8n tanpa jendela (log: `%LOCALAPPDATA%\caPOS\n8n.log`). Task ini juga mengulang tiap 5 menit: kalau n8n mati, otomatis dinyalakan lagi (tetap tanpa jendela).
  - `caPOS-cloudflared` → menyalakan tunnel `n8n.cloudeflare.my.id` (dicek tiap 1 menit).
- **Cara manual:** klik dua kali `start-n8n.bat`.
- **Cara manual (PowerShell):** `n8n.cmd start`.
- Kalau kamu menyalakan n8n manual lewat jendela hitam, jangan tutup jendela itu. Untuk kembali ke mode tanpa jendela: tutup jendela tersebut, lalu tunggu maksimal 5 menit sampai watchdog menyalakannya lagi.

### Mematikan

- Tutup jendela hitam n8n (kalau dijalankan manual), atau hentikan proses `node.exe` milik n8n. Watchdog akan menyalakannya lagi dalam ±5 menit, jadi mematikan permanen = matikan/disable task `caPOS-n8n`.

### Cek sehat / tidaknya

| Yang dicek | Cara | Seharusnya |
|---|---|---|
| n8n hidup | Buka `http://localhost:5678` | Halaman login muncul |
| Alamat publik hidup | Buka `https://n8n.cloudeflare.my.id/healthz` | `{"status":"ok"}` |
| Otomasi jalan | Menu **Executions** | Ada baris hijau (sukses) |
| Otomasi error | Menu **Executions** → klik baris merah | Lihat node mana yang merah |

### Backup (penting, 1 menit)

Semua workflow, credential, dan riwayat ada di satu file. Salin saat n8n **sedang mati**:

```powershell
# matikan n8n dulu, lalu:
Copy-Item "$env:USERPROFILE\.n8n\database.sqlite" "D:\backup\n8n-database-$(Get-Date -Format yyyyMMdd).sqlite"
```

---

## 6. Kalau ada error (bahasa manusia)

Buka **Executions** → klik yang merah → node yang merah adalah tempat masalahnya.

| Yang kamu lihat | Artinya | Solusi |
|---|---|---|
| `401 Unauthorized` di node Telegram | Token bot salah/kosong | Cek `TELEGRAM_BOT_TOKEN`, restart n8n |
| `chat not found` | Kamu belum pernah chat bot-nya | Kirim pesan ke bot dulu, ambil ulang `TELEGRAM_CHAT_ID` |
| `timeout of 15000ms exceeded` di Alert Telegram | Koneksi ke Telegram sedang lambat | Tidak fatal — data & email tetap jalan, notif dicoba ulang 2×. Cek lagi nanti |
| `message text is empty` di Alert Telegram | Pesan tidak terbentuk (data kosong) | Lihat output node `Normalisasi Data` di eksekusi itu |
| Kolom tabel kosong semua | Mapping kolom salah | Buka node `Catat ke ...` → pastikan tiap kolom memakai `$('Normalisasi Data').item.json.<nama>` |
| `403 Forbidden` dari Resend | Domain pengirim belum diverifikasi | Di Resend → Domains → tambahkan & verifikasi `alditriantama.com` |
| `Invalid API Key` dari Groq | `GROQ_API_KEY` salah | Buat ulang key di console.groq.com (atau biarkan kosong, WF5 pakai template cadangan) |
| Webhook balas `404` | Workflow belum **Active**, atau URL salah | Nyalakan workflow-nya, cek path-nya |
| Webhook balas `403` | Header secret tidak cocok | Samakan secret di SQL Supabase dengan isi `webhook-secret.txt` |
| `ECONNREFUSED` di WF3 | caPOS memang mati (atau URL salah) | Ini justru kerja WF3 — cek `CAPOS_URL` |
| Env masih kosong setelah diisi | n8n belum di-restart | Tutup & jalankan ulang n8n |

---

## 7. Checklist akhir

- [x] n8n bisa dinyalakan lewat `start-n8n.bat`
- [x] Env wajib sudah terisi (`TELEGRAM_*`, `RESEND_API_KEY`, `EMAIL_FROM`, `CAPOS_URL`, `WEBHOOK_URL`)
- [x] Tabel `Leads_Trial` & `Pembayaran_Langganan` ada (Data Table n8n)
- [x] `https://n8n.cloudeflare.my.id/healthz` balas `{"status":"ok"}`
- [x] Tunnel Cloudflare + autostart (`caPOS-cloudflared`) aktif
- [x] `WEBHOOK_URL` = `https://n8n.cloudeflare.my.id`
- [x] WF1 aktif & sudah dites (Telegram msg + email + baris tabel)
- [x] WF3 menyala & tidak ada error di Executions
- [x] JB1 & JB2 menyala (radar jemput bola + CRM Telegram)
- [ ] MFA n8n diaktifkan (Settings → Personal → Two-factor authentication) ← **prioritas**
- [ ] Trigger Supabase sudah dijalankan
- [ ] `MIDTRANS_SERVER_KEY` diisi → WF2 diaktifkan
- [ ] Notification URL Midtrans sudah diisi
- [ ] Backup database n8n sudah dibuat

---

## Lampiran A — Ringkasan env var

| Nama | Contoh isi | Dipakai |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `123456789:AA...` | WF1, WF2, WF3, WF5 |
| `TELEGRAM_CHAT_ID` | `-100...` (grup) | WF1, WF2, WF3, WF5 |
| `RESEND_API_KEY` | `re_...` | WF1, WF4 |
| `EMAIL_FROM` | `halo@alditriantama.com` | WF1, WF4 |
| `CAPOS_URL` | `https://alditriantama.com` | WF1, WF3, WF4 |
| `MIDTRANS_SERVER_KEY` | `SB-Mid-server-...` | WF2 (**belum diisi**) |
| `GROQ_API_KEY` | `gsk_...` | WF5 (opsional) |
| `WEBHOOK_URL` | `https://n8n.cloudeflare.my.id` | Semua webhook |
| `CAPOS_CITY` | `Palu` | JB1 (opsional, default Palu) |

> `CAPOS_SHEET_ID` tidak dipakai lagi sejak penyimpanan pindah ke Data Table. Boleh dibiarkan.
> JB1/JB2 mengirim Telegram lewat credential **Telegram caPOS Bot**, bukan `$env`, jadi tetap jalan walau env berubah.

---

## Lampiran B — Alamat webhook (setelah tunnel aktif)

| Workflow | Alamat |
|---|---|
| WF1 | `https://n8n.cloudeflare.my.id/webhook/capos/tenant-baru` |
| WF2 | `https://n8n.cloudeflare.my.id/webhook/capos/midtrans` |
| WF4 | `https://n8n.cloudeflare.my.id/webhook/capos/drip-trial` |

---

## Lampiran C — Kalau nanti mau pakai Google Sheets (opsional)

Data Table bawaan n8n sudah cukup. Bagian ini hanya perlu kalau kamu ingin datanya juga ada di Google Sheets.

1. Buka `console.cloud.google.com` → buat project (nama bebas).
2. Menu **APIs & Services → Library** → cari **Google Sheets API** → **Enable**.
3. **APIs & Services → OAuth consent screen** → pilih **External** → isi nama aplikasi → simpan.
4. **Credentials → Create Credentials → OAuth client ID** → tipe **Web application**.
5. Di **Authorized redirect URI**, isi:
   `http://localhost:5678/rest/oauth2-credential/callback`
6. Salin **Client ID** dan **Client Secret** → tempel di form credential Google Sheets di n8n.
7. Klik **Sign in with Google**.

---

## Lampiran D — Istilah yang sering bikin bingung

| Istilah | Arti gampangnya |
|---|---|
| **Active / Inactive** | Menyala / mati |
| **Save** | Menyimpan perubahan (kalau tidak, perubahan hilang) |
| **Execute workflow** | Menjalankan sekali secara manual untuk tes |
| **Executions** | Riwayat semua kali otomasi jalan |
| **Production URL** | Alamat webhook yang dipakai saat workflow **Active** |
| **Test URL** | Alamat khusus untuk tes; hanya hidup saat kamu klik "Listen" |
| **Node** | Satu kotak/langkah |
| **Expression** | Rumus kecil di dalam node, selalu diawali `=` |
| **Restart** | Tutup lalu buka lagi programnya |

---

*Terakhir diperbarui: 14 November 2026*
