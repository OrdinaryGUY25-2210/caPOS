'use client';

import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Alert } from '@/components/ui/Alert';

// PRIORITY 11 audit: fully static mock (fake "Chrome - Windows" session,
// non-functional 2FA/API-key buttons). Blocked by Supabase — no 2FA,
// session-tracking, or API-key tables exist in the current schema
// (migrations 001–015). Replaced the fake data with an honest status.
export default function SecuritySettingsPage() {
  return (
    <div className="space-y-6">
      <SettingsHeader title="Pengaturan Keamanan" description="Kelola keamanan akun Anda" />

      <Alert
        variant="info"
        title="Belum tersedia"
        message="Autentikasi dua faktor, manajemen sesi login, dan API keys belum tersambung ke database — belum ada tabel terkait di skema saat ini. Untuk ganti password, gunakan bagian Profil."
      />

      <SettingsCard title="Autentikasi Dua Faktor" description="Tambahkan lapisan keamanan ekstra">
        <p className="text-sm text-gray-600">Belum tersedia.</p>
      </SettingsCard>

      <SettingsCard title="Sesi Aktif" description="Kelola sesi login Anda">
        <p className="text-sm text-gray-600">Belum tersedia.</p>
      </SettingsCard>

      <SettingsCard title="API Keys" description="Kelola API keys untuk integrasi">
        <p className="text-sm text-gray-600">Belum tersedia.</p>
      </SettingsCard>
    </div>
  );
}
