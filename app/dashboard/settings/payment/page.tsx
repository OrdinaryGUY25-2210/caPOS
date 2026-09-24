'use client';

import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';

// PRIORITY 11 audit: Presentation-only — checkboxes hardcoded, Save had
// no handler. There is no payment-methods-config table in the schema
// (migrations 001–015). Blocked by Supabase until that table exists.
export default function PaymentSettingsPage() {
  return (
    <div className="space-y-6">
      <SettingsHeader title="Pengaturan Pembayaran" description="Atur metode pembayaran yang tersedia" />

      <Alert
        variant="info"
        title="Belum tersedia"
        message="Pengaturan metode pembayaran belum tersambung ke database — belum ada tabel konfigurasi pembayaran di skema saat ini."
      />

      <SettingsCard title="Metode Pembayaran" description="Pilih metode pembayaran yang diaktifkan">
        <div className="space-y-3">
          <label className="flex items-center gap-2 opacity-60">
            <input type="checkbox" defaultChecked disabled className="w-4 h-4" />
            <span>Tunai</span>
          </label>
          <label className="flex items-center gap-2 opacity-60">
            <input type="checkbox" defaultChecked disabled className="w-4 h-4" />
            <span>Kartu Kredit</span>
          </label>
          <label className="flex items-center gap-2 opacity-60">
            <input type="checkbox" defaultChecked disabled className="w-4 h-4" />
            <span>E-Wallet</span>
          </label>
          <label className="flex items-center gap-2 opacity-60">
            <input type="checkbox" disabled className="w-4 h-4" />
            <span>Transfer Bank</span>
          </label>
        </div>
      </SettingsCard>

      <div className="flex justify-end gap-3">
        <Button variant="outline" disabled title="Belum tersambung ke database">Batal</Button>
        <Button variant="primary" disabled title="Belum tersambung ke database">Simpan Perubahan</Button>
      </div>
    </div>
  );
}
