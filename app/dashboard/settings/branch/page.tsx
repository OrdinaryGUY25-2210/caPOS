'use client';

import { useState } from 'react';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Toast } from '@/components/ui/Toast';

export default function BranchSettingsPage() {
  const [notice, setNotice] = useState('');

  return (
    <div className="space-y-6">
      <SettingsHeader title="Pengaturan Cabang" description="Kelola cabang bisnis Anda" />

      {notice && <Toast variant="info" message={notice} />}

      {/* Cabang sesungguhnya dikelola di app/dashboard/branches/page.tsx
          (Supabase penuh). Entri settings ini masih presentation-only —
          tombol tidak lagi diam saja, tapi jujur bilang fitur ini belum
          tersedia di sini. */}
      <EmptyState
        title="Belum ada cabang"
        description="Mulai dengan menambahkan cabang bisnis Anda"
        actionLabel="Tambah Cabang"
        onAction={() => setNotice('Fitur ini belum tersedia di halaman Pengaturan — kelola cabang di menu Cabang & Tim.')}
      />
    </div>
  );
}
