'use client';

import { useState } from 'react';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Alert } from '@/components/ui/Alert';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

// PRIORITY 11 audit finding: "Simpan Perubahan" previously faked a
// success toast without writing anything — no receipt-settings table
// exists in the schema (migrations 001–015). Blocked by Supabase.
// Kept as an editable preview (paper width / header / footer text
// genuinely affect nothing yet) with an honest status instead of a lie.
export default function ReceiptSettingsPage() {
  const [receiptData, setReceiptData] = useState({
    paperWidth: '58',
    headerText: '',
    footerText: '',
  });

  return (
    <div className="space-y-6">
      <SettingsHeader title="Pengaturan Kwitansi" description="Atur format dan konten kwitansi" />

      <Alert
        variant="info"
        title="Belum tersambung ke database"
        message="Pratinjau saja — belum ada tabel pengaturan kwitansi di skema saat ini, jadi perubahan di bawah ini belum bisa disimpan."
      />

      <SettingsCard title="Format Kwitansi" description="Pengaturan dimensi dan layout">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Lebar Kertas (mm)"
            value={receiptData.paperWidth}
            onChange={(e) => setReceiptData({ ...receiptData, paperWidth: e.target.value })}
            options={[
              { value: '58', label: '58mm' },
              { value: '80', label: '80mm' },
            ]}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Teks Kwitansi" description="Header dan footer kustom">
        <div className="grid grid-cols-1 gap-4">
          <Input
            label="Teks Header"
            value={receiptData.headerText}
            onChange={(e) => setReceiptData({ ...receiptData, headerText: e.target.value })}
            placeholder="Teks yang ditampilkan di atas kwitansi"
          />
          <Input
            label="Teks Footer"
            value={receiptData.footerText}
            onChange={(e) => setReceiptData({ ...receiptData, footerText: e.target.value })}
            placeholder="Teks yang ditampilkan di bawah kwitansi"
          />
        </div>
      </SettingsCard>
    </div>
  );
}
