'use client';

import Link from 'next/link';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';

// PRIORITY 11 audit: this duplicated real functionality that already
// exists (Supabase-backed) at app/dashboard/qr-tables/page.tsx, but with
// a fake disabled URL field and a "Cetak QR Code" button with no handler.
// Point to the real page instead of duplicating/faking it.
export default function QRSettingsPage() {
  return (
    <div className="space-y-6">
      <SettingsHeader backHref="/dashboard/settings" title="Pengaturan QR Code" description="Atur QR code untuk online ordering" />

      <Alert
        variant="info"
        title="Dikelola di halaman lain"
        message="Generate dan cetak QR code per meja untuk self-order sudah tersedia di halaman QR Meja."
      />

      <SettingsCard title="QR Code Online Ordering" description="Konfigurasi QR code pelanggan">
        <Link href="/dashboard/qr-tables">
          <Button variant="primary">Buka Halaman QR Meja</Button>
        </Link>
      </SettingsCard>
    </div>
  );
}
