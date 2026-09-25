-- =========================================================
-- MIGRATION 019 — status tur onboarding per akun (bukan per perangkat).
--
-- components/onboarding/app-tour.tsx sebelumnya menyimpan status selesai
-- di localStorage: begitu user yang sama login di perangkat/browser lain
-- (atau habis clear data), tur muncul lagi dari awal — dan sebaliknya,
-- localStorage browser lama tidak pernah kepakai lagi begitu tenant baru
-- register (browser baru = localStorage kosong = tur seharusnya tampil,
-- yang sebenarnya sudah benar untuk kasus itu). Masalah sebenarnya
-- kenapa tur "tidak pernah muncul sama sekali setelah register" adalah
-- komponennya tidak pernah dipasang di halaman manapun (lihat
-- components/DashboardShell.tsx) — bukan soal storage. Tapi selagi
-- membenahi, sekalian pindah status selesainya ke sini supaya konsisten
-- lintas perangkat, karena satu akun bisa dipakai login di HP & laptop.
-- =========================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_tour_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.onboarding_tour_completed_at IS 'Kapan user menyelesaikan/menutup tur onboarding (components/onboarding/app-tour.tsx). NULL = belum pernah. Sengaja per-user (bukan per-tenant) supaya tiap kasir/karyawan baru yang login pertama kali tetap lihat tur, bukan cuma owner yang pertama register.';

-- Tidak perlu policy RLS baru: kolom ini ada di tabel `profiles`, dan
-- policy "Profiles: own row, own tenant, or super_admin" (schema.sql)
-- sudah FOR ALL dengan `id = auth.uid()`, jadi user selalu bisa
-- menulis kolom ini di baris profilnya sendiri.
