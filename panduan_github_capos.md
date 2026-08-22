# Panduan Lengkap: Dari Buat Repo GitHub sampai Audit Otomatis caPOS

Panduan ini 100% lewat web browser, tidak perlu install `git` atau tools apa
pun di laptop. Ikuti berurutan dari Bagian 1.

---

## Bagian 1 — Buat Akun & Repository GitHub

### 1.1 Buat akun GitHub (lewati jika sudah punya)
1. Buka **github.com** → klik **Sign up** di kanan atas.
2. Isi email, password, dan **username** (ini akan jadi bagian URL profil kamu, mis. `github.com/username-kamu`).
3. Verifikasi email lewat kode yang dikirim ke inbox kamu.

### 1.2 Buat repository baru
1. Setelah login, klik ikon **+** di pojok kanan atas → pilih **New repository**.
2. Isi form:
   - **Owner**: akun/username kamu (biarkan default).
   - **Repository name**: ketik `capos` *(nama ini akan dipakai lagi nanti sebagai referensi di panduan-panduan berikutnya, jadi pakai nama ini persis)*.
   - **Description** (opsional): `caPOS - Point of Sale Kafe by Studio D13`.
   - **Visibility**: pilih **Private** kalau kode ini rahasia/komersial, atau **Public** kalau tidak masalah kode dilihat orang lain. *(Private tetap gratis untuk GitHub Actions dengan kuota 2.000 menit/bulan.)*
   - **JANGAN** centang "Add a README file" — biarkan kosong, karena kita akan upload folder project yang sudah lengkap.
3. Klik **Create repository**.
4. Kamu akan diarahkan ke halaman repo kosong bernama `username-kamu/capos` dengan beberapa opsi cara mengisi repo — abaikan dulu, lanjut ke Bagian 2.

---

## Bagian 2 — Upload Project caPOS ke Repo (Tanpa Git di Laptop)

1. Di halaman repo `capos` yang masih kosong, cari link kecil bertuliskan **uploading an existing file** (ada di tengah halaman, di bawah instruksi `git init`). Klik itu.
   - Kalau link tersebut tidak terlihat, buka langsung: `github.com/username-kamu/capos/upload/main`
2. **Ekstrak dulu file `capos.zip`** di laptop kamu (klik kanan → Extract/Unzip) sampai jadi folder `capos` berisi banyak subfolder (`app`, `lib`, `components`, `supabase`, dst).
3. Buka folder hasil ekstrak, **select semua isi folder `capos`** (bukan foldernya, tapi isinya — `app`, `lib`, `components`, `supabase`, `package.json`, `README.md`, dll sekaligus), lalu **drag-and-drop** semuanya ke area upload di browser GitHub.
   - GitHub browser upload mendukung folder — kamu bisa drag seluruh struktur folder sekaligus, ia akan mempertahankan strukturnya.
   - Proses upload bisa memakan waktu beberapa menit tergantung jumlah file (folder `node_modules` seharusnya sudah tidak ada di zip, jadi ukurannya kecil).
4. Setelah semua file muncul di daftar upload, scroll ke bawah ke bagian **Commit changes**:
   - Judul commit: `Initial commit - caPOS project`
   - Pilih **Commit directly to the main branch**.
5. Klik **Commit changes**.
6. Tunggu sampai halaman reload — sekarang repo `capos` kamu sudah berisi semua source code.

> **Catatan:** File `.env.local` sengaja **tidak** ada di zip (sudah di-exclude) karena berisi kredensial rahasia. Jangan pernah upload file `.env.local` asli berisi API key ke GitHub, walau repo private.

---

## Bagian 3 — Cek GitHub Actions Otomatis Jalan

Karena project sudah menyertakan file `.github/workflows/audit.yml`, GitHub **otomatis** mendeteksi dan menjalankannya setelah commit di Bagian 2.

1. Di halaman repo, klik tab **Actions** (di baris menu atas, sebelah "Pull requests").
2. Kamu akan melihat satu run bernama **caPOS Security & Quality Audit** dengan status:
   - 🟡 kuning berputar = sedang berjalan
   - ✅ hijau = semua langkah sukses
   - ❌ merah = ada langkah gagal (klik run tersebut untuk lihat detail error di log)
3. Klik run tersebut → klik job **code-quality** untuk melihat detail tiap langkah (`npm audit`, `madge`, `next lint`, `ts-prune`).
4. Job **zap-scan** kemungkinan masih gagal di tahap ini — wajar, karena target URL-nya (`https://capos.vercel.app`) belum ada. Kita akan perbaiki di Bagian 4 setelah deploy ke Vercel.

---

## Bagian 4 — Deploy ke Vercel (Supaya Ada URL untuk ZAP Scan)

1. Buka **vercel.com** → klik **Sign Up** → pilih **Continue with GitHub** (login pakai akun GitHub yang sama).
2. Setelah masuk dashboard Vercel, klik **Add New...** → **Project**.
3. Di daftar "Import Git Repository", cari repo **capos** → klik **Import**.
   - Kalau repo tidak muncul, klik **Adjust GitHub App Permissions** dan izinkan Vercel mengakses repo `capos`.
4. Di halaman konfigurasi:
   - **Framework Preset**: otomatis terdeteksi **Next.js**, biarkan default.
   - **Environment Variables**: klik expand, tambahkan tiga baris ini (nilai ambil dari Supabase Dashboard → Project Settings → API):
     | Name | Value |
     |---|---|
     | `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxx.supabase.co` |
     | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (anon/public key dari Supabase) |
     | `SUPABASE_SERVICE_ROLE_KEY` | (service role key — tandai sebagai **Sensitive**) |
5. Klik **Deploy**. Tunggu 1–3 menit.
6. Setelah selesai, Vercel menampilkan URL project kamu, contoh: `capos-username.vercel.app`. **Salin URL ini.**

### 4.1 Update workflow dengan URL Vercel yang benar
1. Kembali ke tab GitHub repo `capos` → klik file `.github/workflows/audit.yml`.
2. Klik ikon pensil (**Edit this file**) di kanan atas.
3. Cari baris:
   ```yaml
   target: "https://capos.vercel.app"
   ```
   Ganti dengan URL asli dari Vercel, misalnya:
   ```yaml
   target: "https://capos-username.vercel.app"
   ```
4. Scroll ke bawah → **Commit changes** → **Commit directly to the main branch**.
5. Ini otomatis memicu Actions berjalan ulang (cek lagi tab **Actions**) — sekarang job **zap-scan** akan benar-benar memindai aplikasi live kamu.

---

## Bagian 5 — Jalankan `supabase/schema.sql` di Supabase

1. Buka **supabase.com** → login/daftar → **New Project**.
2. Isi nama project (mis. `capos-production`), password database, pilih region terdekat (Southeast Asia untuk latensi terbaik dari Indonesia) → **Create new project**. Tunggu ±2 menit sampai provisioning selesai.
3. Di sidebar kiri, klik **SQL Editor** → **New query**.
4. Kembali ke GitHub repo `capos`, buka file `supabase/schema.sql`, klik tombol **Copy raw file** (ikon salin di kanan atas file).
5. Paste seluruh isi ke SQL Editor Supabase → klik **Run** (atau `Ctrl+Enter`).
6. Pastikan muncul **Success. No rows returned** tanpa error merah.
7. Ambil kredensial: **Project Settings** (ikon gear) → **API** → salin **Project URL**, **anon public key**, dan **service_role key** — ini yang dipakai di Environment Variables Vercel (Bagian 4) dan `.env.local` kalau mau jalan lokal nanti.

---

## Bagian 6 — Aktifkan SonarCloud (Dashboard Kualitas Kode)

1. Buka **sonarcloud.io** → **Log in** → **With GitHub**.
2. Klik **+** (kanan atas) → **Analyze new project**.
3. Pilih organisasi GitHub kamu → centang repo **capos** → **Set Up**.
4. Pilih metode **GitHub Actions** saat ditanya bagaimana analisis dijalankan (SonarCloud akan memberi contoh snippet, tapi untuk pemakaian dasar cukup opsi **Automatic Analysis** yang tidak perlu ubah workflow apa pun).
5. Tunggu beberapa menit — dashboard akan menampilkan skor **Maintainability**, **Reliability**, **Security Hotspots**, dan daftar *code smell* per file.

---

## Bagian 7 — Aktifkan Dependabot (Cek Dependency Rentan)

1. Di repo GitHub `capos`, klik tab **Settings**.
2. Sidebar kiri → **Code security** (atau **Security** tergantung versi UI).
3. Cari bagian **Dependabot alerts** → klik **Enable**.
4. Cari bagian **Dependabot security updates** → klik **Enable** juga (biar PR perbaikan otomatis dibuat kalau ada CVE).
5. Hasil temuan nanti muncul di tab **Security** → **Dependabot alerts** repo kamu.

---

## Bagian 8 — Ringkasan: Cara Cek Semua Hasil Audit

| Yang mau dicek | Lokasi |
|---|---|
| Hasil `npm audit`, `madge`, `lint`, `ts-prune` | Tab **Actions** → run terbaru → job **code-quality** |
| Hasil scan ZAP (header keamanan, XSS dasar) | Tab **Actions** → run terbaru → job **zap-scan** → lihat artifact laporan |
| Skor kualitas kode & code smell | Dashboard **sonarcloud.io** → project `capos` |
| Kerentanan dependency (CVE) | Tab **Security** → **Dependabot alerts** di repo GitHub |
| Aplikasi live untuk dites manual | URL Vercel (`capos-username.vercel.app`) |

Setiap kali kamu edit file lewat web GitHub dan commit, seluruh proses di
Bagian 3–8 berjalan ulang otomatis — tidak perlu mengulang langkah manapun,
cukup tunggu tab **Actions** selesai berwarna hijau.
