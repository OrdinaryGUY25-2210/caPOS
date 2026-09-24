'use client';

import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Alert } from '@/components/ui/Alert';

// PRIORITY 11 audit: fully static mock (Install/toggle buttons with no
// handlers). "Install Desktop App" is a real PWA browser capability
// (window.beforeinstallprompt) — not wired here. Offline sync / push
// notification preferences have no table in the current schema
// (migrations 001–015). Replaced fake toggles with an honest status.
export default function PWASettingsPage() {
  return (
    <div className="space-y-6">
      <SettingsHeader title="Pengaturan Aplikasi" description="Kelola pengaturan Progressive Web App" />

      <Alert
        variant="info"
        title="Belum tersedia"
        message="Install aplikasi bisa dilakukan lewat menu 'Install App' di browser Anda. Preferensi mode offline & notifikasi push belum tersambung ke database."
      />

      <SettingsCard title="Instalasi Aplikasi" description="Install caPOS sebagai aplikasi desktop">
        <p className="text-sm text-gray-600">
          Gunakan ikon install di address bar browser Anda (Chrome/Edge) untuk memasang caPOS sebagai aplikasi.
        </p>
      </SettingsCard>

      <SettingsCard title="Offline Mode" description="Sinkronisasi data untuk akses offline">
        <p className="text-sm text-gray-600">Belum tersedia sebagai pengaturan — caching offline berjalan otomatis di latar belakang.</p>
      </SettingsCard>

      <SettingsCard title="Notifikasi" description="Kelola notifikasi aplikasi">
        <p className="text-sm text-gray-600">Belum tersedia.</p>
      </SettingsCard>
    </div>
  );
}
