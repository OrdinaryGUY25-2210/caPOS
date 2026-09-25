'use client';

import { useEffect, useState } from 'react';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Skeleton } from '@/components/Skeleton';
import { getCurrentProfile } from '@/lib/getCurrentProfile';
import { createClient } from '@/lib/supabase/client';

// migration_018 menambah tabel payment_methods_config (1 baris per
// tenant). Sebelumnya checkbox di halaman ini hardcoded/disabled karena
// memang belum ada tabelnya sama sekali — sekarang baca/tulis baris asli,
// dengan default (cash/kartu/e-wallet ON, transfer bank OFF) dipakai
// kalau tenant belum pernah menyimpan (belum ada baris).
interface MethodsState {
  cash: boolean;
  card: boolean;
  ewallet: boolean;
  bankTransfer: boolean;
}

const DEFAULT_METHODS: MethodsState = { cash: true, card: true, ewallet: true, bankTransfer: false };

export default function PaymentSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [methods, setMethods] = useState<MethodsState>(DEFAULT_METHODS);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  async function load() {
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }
    setCanEdit(profile.role === 'owner' || profile.role === 'manager' || profile.role === 'super_admin');
    setTenantId(profile.tenant_id);

    const supabase = createClient();
    const { data: row } = await supabase
      .from('payment_methods_config')
      .select('cash_enabled, card_enabled, ewallet_enabled, bank_transfer_enabled')
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle();

    setMethods(
      row
        ? {
            cash: row.cash_enabled,
            card: row.card_enabled,
            ewallet: row.ewallet_enabled,
            bankTransfer: row.bank_transfer_enabled,
          }
        : DEFAULT_METHODS
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCancel() {
    setStatus(null);
    setLoading(true);
    await load();
  }

  function toggle(key: keyof MethodsState) {
    if (!canEdit) return;
    setMethods((prev) => ({ ...prev, [key]: !prev[key] }));
    setStatus(null);
  }

  async function handleSave() {
    if (!tenantId) return;
    setSaving(true);
    setStatus(null);

    const supabase = createClient();
    const { error } = await supabase.from('payment_methods_config').upsert({
      tenant_id: tenantId,
      cash_enabled: methods.cash,
      card_enabled: methods.card,
      ewallet_enabled: methods.ewallet,
      bank_transfer_enabled: methods.bankTransfer,
      updated_at: new Date().toISOString(),
    });

    setSaving(false);
    if (error) {
      setStatus({ type: 'error', message: 'Gagal menyimpan: ' + error.message });
      return;
    }
    setStatus({ type: 'success', message: 'Metode pembayaran tersimpan.' });
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Pembayaran" description="Atur metode pembayaran yang tersedia" />
        <div className="card p-6 space-y-3">
          <Skeleton className="h-4 w-24" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-40" />
          ))}
        </div>
      </div>
    );
  }

  const ROWS: { key: keyof MethodsState; label: string; hint?: string }[] = [
    { key: 'cash', label: 'Tunai' },
    { key: 'card', label: 'Kartu Kredit', hint: 'Diproses lewat mesin EDC kasir sendiri' },
    { key: 'ewallet', label: 'E-Wallet' },
    { key: 'bankTransfer', label: 'Transfer Bank' },
  ];

  return (
    <div className="space-y-6">
      <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Pembayaran" description="Atur metode pembayaran yang tersedia" />

      {!canEdit && (
        <Alert variant="info" title="Khusus Owner/Supervisor" message="Kamu bisa melihat pengaturan ini, tapi hanya Owner atau Supervisor yang bisa mengubahnya." />
      )}

      {status && <Alert variant={status.type === 'success' ? 'success' : 'error'} message={status.message} />}

      <SettingsCard title="Metode Pembayaran" description="Pilih metode pembayaran yang diaktifkan di kasir (/pos)">
        <div className="space-y-3">
          {ROWS.map((row) => (
            <label key={row.key} className={"flex items-center gap-2" + (canEdit ? "" : " opacity-60")}>
              <input
                type="checkbox"
                checked={methods[row.key]}
                onChange={() => toggle(row.key)}
                disabled={!canEdit}
                className="w-4 h-4 accent-primary"
              />
              <span>{row.label}</span>
              {row.hint && <span className="text-xs text-neutral-400">— {row.hint}</span>}
            </label>
          ))}
        </div>
      </SettingsCard>

      <div className="flex justify-end gap-3">
        <Button variant="outline" disabled={!canEdit || saving} onClick={handleCancel}>
          Batal
        </Button>
        <Button variant="primary" disabled={!canEdit} loading={saving} onClick={handleSave}>
          Simpan Perubahan
        </Button>
      </div>
    </div>
  );
}
