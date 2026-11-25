# Dokumen PDF caPOS + n8n

Folder ini berisi versi PDF dari dokumen di `docs/`.

| File | Isi | Halaman |
| --- | --- | --- |
| `PANDUAN-n8n-untuk-caPOS.pdf` | Panduan bahasa sederhana: status otomasi, apa yang harus dilakukan, dan cara menjalankan | 9 |
| `n8n-capos-automation.pdf` | Referensi teknis: endpoint webhook, field, workflow, Data Table, tunnel Cloudflare, dan detail integrasi | 8 |
| `panduan-jemput-bola.pdf` | Panduan sistem jemput bola: radar sinyal, CRM outreach di Telegram, rutinitas 30-45 menit, dan penilaian rencana 7 hari | 7 |
| `rancangan-social-listening-capos.pdf` | Rancangan otomasi social listening & engagement: matriks kemampuan platform, 3 mode operasi, spesifikasi workflow SL0-SL7, skema Data Table, skoring wilayah Palu, guardrail, dan kebutuhan kredensial | 12 |

## Dari mana PDF ini dibuat

- `docs/PANDUAN-n8n-untuk-caPOS.md` -> `PANDUAN-n8n-untuk-caPOS.pdf`
- `docs/n8n-capos-automation.md` -> `n8n-capos-automation.pdf`
- `docs/PANDUAN-jemput-bola.md` -> `panduan-jemput-bola.pdf`
- `docs/RANCANGAN-social-listening-caPOS.md` -> `rancangan-social-listening-capos.pdf`

Kalau isi markdown diubah, PDF perlu dibuat ulang agar tetap sama.

## Alamat publik n8n

`https://n8n.cloudeflare.my.id` (Cloudflare Tunnel `n8n-capos` → `http://localhost:5678`).

Dokumen terakhir diperbarui: **14 November 2026**.
