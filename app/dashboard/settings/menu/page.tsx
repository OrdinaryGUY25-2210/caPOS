'use client';

import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';

// PRIORITY 11 audit: Presentation-only — checkboxes were hardcoded
// (defaultChecked, no state) and Save had no handler at all. Menu
// visibility itself is really managed in app/dashboard/menu/page.tsx
// (Supabase-backed). Kept as a preview here, but now says so honestly
// instead of pretending Save works.
export default function MenuSettingsPage() {
  return (
    <div className="space-y-6">
      <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Menu" description="Atur tampilan dan struktur menu" />

      <Alert
        variant="info"
        title="Belum tersambung ke database"
        message="Toggle di bawah ini pratinjau tampilan saja. Untuk mengubah menu, kategori, dan varian sesungguhnya, buka menu Kelola Menu & Stok."
      />

      <SettingsCard title="Visibility Menu" description="Pilih kategori yang ditampilkan di POS">
        <div className="space-y-3">
          <label className="flex items-center gap-2 opacity-60">
            <input type="checkbox" defaultChecked disabled className="w-4 h-4" />
            <span>Tampilkan Kategori Produk</span>
          </label>
          <label className="flex items-center gap-2 opacity-60">
            <input type="checkbox" defaultChecked disabled className="w-4 h-4" />
            <span>Tampilkan Varian Produk</span>
          </label>
          <label className="flex items-center gap-2 opacity-60">
            <input type="checkbox" defaultChecked disabled className="w-4 h-4" />
            <span>Tampilkan Modifier</span>
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
