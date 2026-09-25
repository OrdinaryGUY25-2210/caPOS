'use client';

import { useEffect, useState } from 'react';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Alert } from '@/components/ui/Alert';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/Skeleton';
import { getCurrentProfile } from '@/lib/getCurrentProfile';
import { createClient } from '@/lib/supabase/client';

// migration_018: tenants.receipt_header_text & receipt_footer_text baru
// (tenants.receipt_paper_width sudah ada sejak migration_16, tapi belum
// pernah ditulis dari mana pun — halaman ini yang pertama menulisnya).
// Dipakai oleh components/Receipt.tsx & app/pos/page.tsx saat mencetak
// struk asli, jadi perubahan di sini langsung kelihatan di kasir.
interface ReceiptState {
  paperWidth: '58mm' | '80mm';
  headerText: string;
  footerText: string;
}

export default function ReceiptSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<ReceiptState>({
    paperWidth: '58mm',
    headerText: '',
    footerText: '',
  });
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) {
        setLoading(false);
        return;
      }
      setCanEdit(profile.role === 'owner' || profile.role === 'manager' || profile.role === 'super_admin');
      setTenantId(profile.tenant_id);

      const supabase = createClient();
      const { data: tenant } = await supabase
        .from('tenants')
        .select('receipt_paper_width, receipt_header_text, receipt_footer_text')
        .eq('id', profile.tenant_id)
        .single();

      if (tenant) {
        setReceiptData({
          paperWidth: (tenant.receipt_paper_width as '58mm' | '80mm') ?? '58mm',
          headerText: tenant.receipt_header_text ?? '',
          footerText: tenant.receipt_footer_text ?? '',
        });
      }
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    if (!tenantId) return;
    setSaving(true);
    setStatus(null);

    const supabase = createClient();
    const { error } = await supabase
      .from('tenants')
      .update({
        receipt_paper_width: receiptData.paperWidth,
        receipt_header_text: receiptData.headerText.trim() || null,
        receipt_footer_text: receiptData.footerText.trim() || null,
      })
      .eq('id', tenantId);

    setSaving(false);
    if (error) {
      setStatus({ type: 'error', message: 'Gagal menyimpan: ' + error.message });
      return;
    }
    setStatus({ type: 'success', message: 'Pengaturan kwitansi tersimpan. Struk berikutnya di kasir akan memakai ini.' });
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Kwitansi" description="Atur format dan konten kwitansi" />
        <div className="card p-6 space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Kwitansi" description="Atur format dan konten kwitansi" />

      {!canEdit && (
        <Alert variant="info" title="Khusus Owner/Supervisor" message="Kamu bisa melihat pengaturan ini, tapi hanya Owner atau Supervisor yang bisa mengubahnya." />
      )}

      {status && <Alert variant={status.type === 'success' ? 'success' : 'error'} message={status.message} />}

      <SettingsCard title="Format Kwitansi" description="Pengaturan dimensi dan layout">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Lebar Kertas"
            value={receiptData.paperWidth}
            onChange={(e) => setReceiptData({ ...receiptData, paperWidth: e.target.value as '58mm' | '80mm' })}
            disabled={!canEdit}
            options={[
              { value: '58mm', label: '58mm' },
              { value: '80mm', label: '80mm' },
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
            disabled={!canEdit}
          />
          <Input
            label="Teks Footer"
            value={receiptData.footerText}
            onChange={(e) => setReceiptData({ ...receiptData, footerText: e.target.value })}
            placeholder="Teks yang ditampilkan di bawah kwitansi"
            disabled={!canEdit}
          />
        </div>
      </SettingsCard>

      {canEdit && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Simpan Perubahan
          </Button>
        </div>
      )}
    </div>
  );
}
