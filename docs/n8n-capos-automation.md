# Otomasi caPOS di n8n — Panduan Setup

Status per 14 Nov 2026: **8 workflow ada di n8n lokal** (`http://localhost:5678`), **5 aktif** (JB1, JB2, WF1, WF3, WF5). Penyimpanan memakai **Data Table bawaan n8n** (`Leads_Trial`, `Pembayaran_Langganan`) — tidak butuh credential Google. WF1 sudah dites ujung-ke-ujung (webhook → Telegram + email Resend + baris tabel). WF2 menunggu `MIDTRANS_SERVER_KEY`, WF4 masih opsional. URL publik n8n: **`https://n8n.cloudeflare.my.id`**.

| Workflow | ID | Node | Trigger |
|---|---|---|---|
| WF1 - Radar Tenant Baru | `fqAucdmhEbCVaAEa` | 6 | Webhook `capos/tenant-baru` |
| WF2 - Pembayaran Langganan | `oVJdLSW1CbZKCip3` | 5 | Webhook `capos/midtrans` |
| WF3 - Uptime Monitor caPOS | `JYTl14eAZxGQO3aj` | 5 | Schedule tiap 10 menit (09.00-22.00 WITA) |
| WF4 - Drip Email Trial | `PEH1vCQPa4znHsfz` | 14 | Webhook `capos/drip-trial` |
| WF5 - Mesin Konten Organik | `olKLzQ5NMMAkHKgk` | 6 | Schedule harian 09:00 WITA |

Arsitektur: semua konfigurasi memakai **environment variable** (`$env.*`), bukan hardcode. Jadi kamu set sekali, kelima workflow ikut.

---

## 0. Status blocker

| # | Hal | Status |
|---|---|---|
| 1 | Cloudflare Tunnel + domain publik `n8n.cloudeflare.my.id` | ✅ **selesai** (14 Nov 2026, tunnel `n8n-capos`) |
| 2 | Env `WEBHOOK_URL`, `TELEGRAM_*`, `RESEND_API_KEY`, `EMAIL_FROM`, `CAPOS_URL` | ✅ terisi & terbaca n8n |
| 3 | Penyimpanan data | ✅ **selesai** — Data Table n8n `Leads_Trial` (`29E96ITCERmIuznV`) & `Pembayaran_Langganan` (`iC8K3drAltvU21c5`). Credential Google tidak diperlukan |
| 4 | WF1 aktif + dites | ✅ webhook 200, Telegram terkirim, email Resend terkirim, baris tabel masuk |
| 5 | `MIDTRANS_SERVER_KEY` | ❌ masih kosong → WF2 belum bisa diverifikasi |
| 6 | `GROQ_API_KEY` | ❌ kosong → WF5 otomatis memakai template cadangan (tetap jalan) |
| 7 | MFA akun n8n | ❌ belum aktif (penting, UI sudah terbuka ke internet) |
| 8 | Google Sheets (opsional) | ⏸ tidak dipakai; bisa jadi upgrade nanti |

---

## 1. Set environment variable

Jalankan PowerShell **baru**, lalu:

```powershell
cd "C:\Users\aldic\OneDrive\Documents\Default Project"
powershell -ExecutionPolicy Bypass -File docs\set-n8n-env.ps1
```

Atau manual:

```powershell
setx TELEGRAM_BOT_TOKEN   "123456789:AAxxxxxxxxxxxxxxxx"
setx TELEGRAM_CHAT_ID     "-1001234567890"
setx RESEND_API_KEY       "re_xxxxxxxxxxxxxxxx"
setx EMAIL_FROM           "halo@alditriantama.com"
setx CAPOS_URL            "https://alditriantama.com"
setx MIDTRANS_SERVER_KEY  "SB-Mid-server-xxxxxxxx"
setx GROQ_API_KEY         "gsk_xxxxxxxxxxxxxxxx"
setx WEBHOOK_URL          "https://n8n.cloudeflare.my.id"
```

Lalu **restart n8n** (tutup proses `node` PID yang jalan, jalankan ulang `n8n start`). Env hanya terbaca saat proses start.

| Variable | Dipakai di | Wajib |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | WF1, WF2, WF3, WF5 | ya |
| `TELEGRAM_CHAT_ID` | WF1, WF2, WF3, WF5 | ya |
| `RESEND_API_KEY` | WF1, WF4 | ya |
| `EMAIL_FROM` | WF1, WF4 | ya |
| `CAPOS_URL` | WF1, WF3, WF4 | ya |
| `MIDTRANS_SERVER_KEY` | WF2 | ya untuk WF2 (belum diisi) |
| `GROQ_API_KEY` | WF5 | tidak (ada fallback) |
| `WEBHOOK_URL` | semua webhook | ya (produksi) |

> `CAPOS_SHEET_ID` sudah tidak dipakai (penyimpanan pindah ke Data Table n8n). Boleh dibiarkan di env.

---

## 2. Cloudflare Tunnel (sudah dipasang)

Domain publik: **`n8n.cloudeflare.my.id`** → `http://localhost:5678`.

| Item | Nilai |
|---|---|
| Tunnel | `n8n-capos` |
| Tunnel ID | `73696a31-99a7-4b7c-943e-6963f649c013` |
| Config | `C:\Users\aldic\.cloudflared\config.yml` |
| Credential tunnel | `C:\Users\aldic\.cloudflared\73696a31-99a7-4b7c-943e-6963f649c013.json` (**rahasia, jangan dibagikan**) |
| Nameserver | `meera.ns.cloudflare.com`, `ray.ns.cloudflare.com` |
| Autostart | Scheduled Task `caPOS-cloudflared` (saat login) + `caPOS-n8n` |

Perintah yang dipakai:

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel login                       # browser → pilih zona cloudeflare.my.id
cloudflared tunnel create n8n-capos
cloudflared tunnel route dns n8n-capos n8n.cloudeflare.my.id
cloudflared --config "$env:USERPROFILE\.cloudflared\config.yml" tunnel run n8n-capos
```

Cek: `https://n8n.cloudeflare.my.id/healthz` harus balas `{"status":"ok"}`. Sudah diuji — termasuk webhook publik (HTTP 200 + eksekusi tercatat).

> `cloudflared service install` **tidak dipakai** karena butuh hak admin. Penggantinya Scheduled Task `caPOS-cloudflared` yang jalan saat login. Kalau nanti mau versi service, buka PowerShell **as Administrator** lalu jalankan perintah itu.

> Catatan keamanan: UI n8n ikut terbuka ke internet. **Aktifkan MFA** (Settings → Personal → Two-factor authentication) dan pertimbangkan **Cloudflare Access** (Zero Trust → Access → Applications) dengan policy *bypass* untuk path `/webhook*` supaya callback Supabase/Midtrans tetap jalan.

---

## 3. Penyimpanan data (Data Table n8n)

Google Sheets **tidak dipakai lagi** — credential Google belum ada, jadi penyimpanan memakai fitur **Data Table** bawaan n8n (tersimpan di `~/.n8n/database.sqlite`, ikut ter-backup).

| Tabel | ID | Kolom |
|---|---|---|
| `Leads_Trial` | `29E96ITCERmIuznV` | `tanggal`, `nama_kafe`, `email`, `telepon`, `tenant_id`, `sumber`, `status` |
| `Pembayaran_Langganan` | `iC8K3drAltvU21c5` | `tanggal`, `order_id`, `tenant_id`, `nama`, `email`, `nominal`, `metode`, `status_midtrans`, `status_tenant` |

Cara akses:

- **UI:** menu **Data Tables** di sidebar n8n → pilih tabel.
- **API:** `GET /api/v1/data-tables/<id>/rows` dengan header `X-N8N-API-KEY`.

Node `Catat ke Leads_Trial` (WF1) dan `Catat ke Pembayaran_Langganan` (WF2) bertipe `n8n-nodes-base.dataTable` dengan mapping eksplisit, mis.:

```
tanggal   = {{ $('Normalisasi Data').item.json.tanggal }}
nama_kafe = {{ $('Normalisasi Data').item.json.nama_kafe }}
```

> Selalu ambil dari node sumber (`$('Normalisasi Data')` / `$('Verifikasi & Format')`), **jangan** `$json.*`, karena node sebelumnya (Telegram/email) mengubah bentuk data.

`Content_Queue` tidak dibuat: node `Catat ke Content_Queue` di WF5 diganti No-Op (konfigurasi asli disimpan di `notes` node).

**Upgrade opsional ke Google Sheets:** buat spreadsheet dengan 2 tab (`Leads_Trial`, `Pembayaran_Langganan`) + header persis seperti kolom di atas, buat credential **Google Sheets OAuth2 API**, lalu ganti node Data Table dengan node Google Sheets (mode *auto-map*). Tidak wajib.

---

## 4. Telegram

1. Chat `@BotFather` → `/newbot` → simpan token → `TELEGRAM_BOT_TOKEN`.
2. Kirim 1 pesan ke bot kamu, lalu buka `https://api.telegram.org/bot<TOKEN>/getUpdates` → ambil `chat.id` → `TELEGRAM_CHAT_ID`.
3. Untuk grup: tambahkan bot ke grup, ambil ID negatif (mis. `-1001234567890`).

---

## 5. Supabase → n8n webhook

Aktifkan `pg_net` (biasanya sudah aktif di Supabase). Jalankan di SQL Editor:

```sql
-- helper: kirim event ke n8n dengan header rahasia
create or replace function public.notify_n8n(target_path text, payload jsonb)
returns void language plpgsql security definer as $$
begin
  perform net.http_post(
    url := 'https://n8n.cloudeflare.my.id/webhook/' || target_path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', 'GANTI_DENGAN_SECRET_DARI_webhook-secret.txt'
    ),
    body := payload
  );
end; $$;

-- tenant baru -> WF1
create or replace function public.trg_tenant_baru() returns trigger
language plpgsql security definer as $$
begin
  perform public.notify_n8n('capos/tenant-baru', jsonb_build_object(
    'type', TG_OP, 'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA, 'record', to_jsonb(NEW)
  ));
  return NEW;
end; $$;

-- tenant baru -> WF4 (drip email)
create or replace function public.trg_tenant_drip() returns trigger
language plpgsql security definer as $$
begin
  perform public.notify_n8n('capos/drip-trial', jsonb_build_object(
    'type', TG_OP, 'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA, 'record', to_jsonb(NEW)
  ));
  return NEW;
end; $$;

drop trigger if exists trg_tenant_baru on public.tenants;
create trigger trg_tenant_baru after insert on public.tenants
for each row execute function public.trg_tenant_baru();

drop trigger if exists trg_tenant_drip on public.tenants;
create trigger trg_tenant_drip after insert on public.tenants
for each row execute function public.trg_tenant_drip();
```

Secret-nya ada di file `C:\Users\aldic\AppData\Local\Temp\opencode\n8n-snap\webhook-secret.txt`
dan tersimpan di n8n sebagai credential **caPOS Webhook Secret**.

> Kalau trigger dipasang di `profiles` (bukan `tenants`), field `email` otomatis terisi karena WF1 membaca `record.email`.

---

## 6. Midtrans

Di dashboard Midtrans → **Settings → Configuration → Payment Notification URL**:

```
https://n8n.cloudeflare.my.id/webhook/capos/midtrans
```

WF2 memverifikasi `signature_key` = `SHA512(order_id + status_code + gross_amount + server_key)`.
Kalau `MIDTRANS_SERVER_KEY` salah, workflow mengirim alert "WEBHOOK MIDTRANS DITOLAK" ke Telegram (bukan diam-diam).

---

## 7. Urutan aktivasi & tes

1. Set env → restart n8n. (sudah)
2. Data Table `Leads_Trial` & `Pembayaran_Langganan` sudah dibuat di dalam n8n. (sudah)
3. Workflow yang sudah aktif: **JB1, JB2, WF1, WF3, WF5**. Sisanya: WF2 menunggu `MIDTRANS_SERVER_KEY`, WF4 opsional.
4. Tes manual:

| Workflow | Cara tes |
|---|---|
| WF1 | `curl -X POST https://n8n.cloudeflare.my.id/webhook/capos/tenant-baru -H "x-webhook-secret: <secret>" -H "Content-Type: application/json" -d '{"table":"tenants","record":{"id":"test-1","name":"Kafe Tes","email":"tes@example.com"}}'` |
| WF2 | Kirim notifikasi tes dari dashboard Midtrans (ada tombol "Test notification") |
| WF3 | Sementara set `CAPOS_URL` ke URL yang pasti mati, tunggu ≤10 menit |
| WF4 | Kirim payload sama ke `/webhook/capos/drip-trial` — email pertama baru terkirim 3 hari kemudian |
| WF5 | Klik **Execute workflow** manual |

5. Cek **Executions** di n8n untuk melihat error per node.

---

## 8. Sistem Jemput Bola (JB1 & JB2)

Workflow tambahan untuk outbound/organic growth, biaya Rp0, tanpa Google Sheets.

| Workflow | ID | Jadwal | Isi |
| --- | --- | --- | --- |
| `JB1 - Radar Jemput Bola` | `tu4osa3pRDjrbfNk` | 09:00, 13:00, 18:00 WITA | Code node `Radar Berita` menarik RSS Google News + Bing News untuk daftar kata kunci, menyaring, membuang judul yang sudah pernah dikirim (static data), lalu menyusun digest + saran tindakan. Dikirim node Telegram `Kirim Digest` |
| `JB2 - Outreach CRM (Telegram)` | `8MvAXbGihN2J33L4` | 09:05 WITA + tiap 5 menit (09.00-21.55) | Cabang 1: `Susun Rencana` (rencana harian + follow-up + template DM) lalu `Kirim Rencana`. Cabang 2: `Proses Perintah` memanggil `getUpdates`, menjalankan perintah (+kafe, list, dm, balas, trial, menang, tolak, hapus, cari, stats, ping), menyimpan state, lalu `Kirim Balasan` |

Detail teknis：

- Static data (bukan database): `JB2` menyimpan `global.prospek[]` (id, nama, area, kontak, catatan, status, dibuat, terakhir, riwayat), `global.nextId`, `global.offset` (offset getUpdates), `global.terakhir_poll`. `JB1` menyimpan `global.terlihat{judul: waktu}` (maks 1200 entri).
- Kredensial: `telegramApi` id `TgCaP0sRadar0001` ("Telegram caPOS Bot"). Tidak memakai `$env` untuk mengirim, jadi tidak terpengaruh `N8N_BLOCK_ENV_ACCESS_IN_NODE`.
- Token untuk `getUpdates` diambil berurutan dari `$vars.TELEGRAM_BOT_TOKEN` (tabel `variables`), `$env.TELEGRAM_BOT_TOKEN`, lalu nilai cadangan di dalam kode (lihat catatan keamanan di bagian 8).
- Zona waktu workflow diset `Asia/Makassar`; `saveDataSuccessExecution: none` supaya eksekusi polling tiap 5 menit tidak menumpuk. Eksekusi gagal tetap disimpan.
- Jam operasional semua jadwal dibatasi **09.00-22.00 WITA** (belum ada server, jadi komputer tidak dibebani 24 jam). Cron yang dipakai: JB2 `*/5 9-21 * * *` dan WF3 `*/10 9-21 * * *`. Webhook WF1/WF2/WF4 tetap menerima 24 jam selama n8n hidup, jadi lead yang masuk malam hari tidak hilang.
- Kata kunci radar: array `bawaan` di node `Radar Berita`, atau env `CAPOS_RADAR_KEYWORDS` (dipisah koma) dan `CAPOS_CITY`.
- Pesan dibatasi ±3500 karakter dan maksimal 8 item per digest; balasan perintah maksimal 6 per putaran.
- Google Sheets tidak dipakai di JB1/JB2. `WF5` node `Catat ke Content_Queue` diganti No-Op karena kredensial Google belum ada; Simpan konfigurasi aslinya ada di `notes` node tersebut.

### Batasan desain

- TikTok/Instagram/Threads tidak menyediakan pencarian kata kunci gratis. JB1 memakai RSS berita sebagai sinyal dan menyertakan link pencarian manual (TikTok, Threads, IG hashtag, Google Maps) pada digest pertama tiap hari.
- Bot hanya menyiapkan draf DM. Pengiriman tetap manual untuk menghindari pembatasan akun.
- `getUpdates` tidak bisa dipakai kalau bot punya webhook aktif. Jangan aktifkan Telegram Trigger untuk bot yang sama.

---

## 9. Catatan

- Workflow lama `W1 - Pembuat Ide Mingguan` masih ada dan tumpang tindih dengan WF5. Bisa di-archive kalau WF5 sudah jalan.
- Budget Rp0: Telegram gratis, Resend free tier 100 email/hari, Groq free tier, Supabase free tier, Cloudflare Tunnel gratis, Data Table n8n gratis (tanpa Google Sheets).
- Telegram dari server rumahan kadang lambat/putus. Node `Alert Telegram` sudah diberi **retry 2× (timeout 15 s)** dan `onError: continueRegularOutput`, jadi kegagalan Telegram tidak membatalkan penyimpanan data maupun email. Urutan WF1: simpan tabel → email → Telegram.
- Drip email memakai `Wait` node 3/7/11/6 hari. Execution tetap "menunggu" di database n8n — jangan hapus data execution sebelum selesai, dan jangan nonaktifkan WF4 saat masih ada yang menunggu.
- API key audit (`opencode-audit`) kadaluarsa 13 Des 2026; hapus di Settings → n8n API kalau sudah tidak dipakai.
