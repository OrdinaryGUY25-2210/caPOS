'use client';

import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * PRIORITY 11 audit: Blocked by Supabase — there is no printer-config table
 * in the current schema (migrations 001–015), and migration 016+ is not
 * created automatically. Rather than fake a "Hubungkan Printer" flow that
 * does nothing, this page states the real status honestly.
 */
export default function PrinterSettingsPage() {
  return (
    <div className="space-y-6">
      <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Printer" description="Kelola printer yang tersedia" />

      <Alert
        variant="info"
        title="Belum tersedia"
        message="Manajemen printer belum tersambung ke database — belum ada tabel printer di skema saat ini."
      />

      <SettingsCard title="Printer Terhubung" description="Daftar printer yang siap digunakan">
        <EmptyState
          title="Belum ada printer terhubung"
          description="Fitur koneksi printer akan hadir setelah bagian ini tersambung ke database."
        />
      </SettingsCard>
    </div>
  );
}
