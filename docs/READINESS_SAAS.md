# Checklist Kesiapan SaaS caPOS untuk UMKM

Status: `[ ]` belum, `[x]` selesai, `[~]` sebagian.
Setiap item selesai harus punya bukti (commit, screenshot, atau hasil uji).

## 1. Fungsi inti (sudah ada, perlu diuji)

- [~] Kasir / POS online
- [~] Kasir offline dan sinkronisasi
- [~] Kelola menu (online)
- [ ] Kelola menu offline dengan resep (skenario B)
- [ ] Penolakan izin untuk kasir (skenario C)
- [ ] Mode "Semua Cabang" diblokir dengan benar (skenario D)
- [ ] Edit dan toggle menu lama tidak rusak (skenario E)
- [ ] HPP menu dihitung dari resep dan harga bahan cabang
- [~] Stok bahan dan opname
- [~] Laporan dan omzet
- [~] Pembayaran QRIS (Midtrans)

## 2. Keamanan

- [ ] Semua celah di `capos_security_audit.md` diverifikasi ulang dengan tes nyata
- [ ] RLS aktif di semua tabel yang berisi data tenant, dibuktikan dengan tes akun berbeda
- [ ] Total transaksi dihitung di server, bukan dari browser
- [ ] Webhook Midtrans idempoten dan memverifikasi signature
- [ ] Rate limit memakai penyimpanan bersama (Redis/Upstash), bukan memori
- [ ] Tidak ada kode akses default atau kredensial di repo
- [ ] Service role key hanya di server, tidak pernah `NEXT_PUBLIC_`
- [ ] Key yang pernah terekspos sudah dirotasi
- [ ] Penetration test oleh pihak independen

## 3. Data dan hukum

- [ ] Kebijakan privasi (sesuai UU PDP)
- [ ] Syarat dan ketentuan layanan
- [ ] Persetujuan pemrosesan data saat daftar
- [ ] Prosedur hapus akun dan data pelanggan
- [ ] Konsultasi dengan ahli hukum sudah dilakukan

## 4. Backup dan pemulihan

- [ ] Backup otomatis aktif (Supabase PITR atau backup terjadwal)
- [ ] Uji restore sungguhan, hasilnya dicatat
- [ ] Target waktu pemulihan (RTO) dan kehilangan data maksimal (RPO) ditulis

## 5. Operasi

- [ ] Kanal dukungan (email/WhatsApp) dan jam layanan
- [ ] Status page atau pengumuman gangguan
- [ ] Akses cadangan ke Supabase dan Vercel (tidak hanya satu akun)
- [ ] Monitoring error (mis. Sentry) dan alert
- [ ] Proses branch protection di `main` dan PR wajib

## 6. Produk dan harga

- [ ] Paket dan harga final
- [ ] Kebijakan refund
- [ ] Apa yang terjadi saat langganan berakhir (data bisa diekspor)
- [ ] Onboarding pengguna baru (panduan singkat, tanpa data contoh yang membingungkan)

## 7. Pilot

- [ ] 3 sampai 5 UMKM pilot dengan kesepakatan tertulis
- [ ] Minimal 4 minggu pilot tanpa insiden data
- [ ] Umpan balik pilot didokumentasikan dan ditindaklanjuti

## Keputusan go-live

Go-live jual berbayar hanya jika bagian 2, 3, 4, dan 7 semuanya `[x]`.
