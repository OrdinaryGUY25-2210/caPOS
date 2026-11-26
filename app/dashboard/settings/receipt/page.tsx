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
import Link from 'next/link';
import Receipt from '@/components/Receipt';
import { buildSampleReceiptData } from '@/lib/sampleReceipt';
import { resetHideBrandingCache } from '@/lib/useHideBranding';
import { computeCharges, resetChargeSettingsCache, DEFAULT_SERVICE_LABEL, DEFAULT_TAX_LABEL } from '@/lib/charges';

// migration_018: tenants.receipt_header_text & receipt_footer_text baru
// (tenants.receipt_paper_width sudah ada sejak migration_16, tapi belum
// pernah ditulis dari mana pun — halaman ini yang pertama menulisnya).
// Dipakai oleh components/Receipt.tsx & app/pos/page.tsx saat mencetak
// struk asli, jadi perubahan di sini langsung kelihatan di kasir.
interface ReceiptState {
  paperWidth: '58mm' | '80mm';
  headerText: string;
  footerText: string;
  showWifi: boolean;
  wifiSsid: string;
  wifiPassword: string;
  hideBranding: boolean;
  servicePct: string;
  taxPct: string;
  taxInclusive: boolean;
  serviceLabel: string;
  taxLabel: string;
}

/** Persen 0–100, maksimal 2 desimal (sesuai NUMERIC(5,2) di database). */
function parsePct(v: string): number {
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
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
    showWifi: false,
    wifiSsid: '',
    wifiPassword: '',
    hideBranding: false,
    servicePct: '0',
    taxPct: '0',
    taxInclusive: false,
    serviceLabel: DEFAULT_SERVICE_LABEL,
    taxLabel: DEFAULT_TAX_LABEL,
  });
  const [cafeName, setCafeName] = useState('Kafe Anda');
  const [isSupreme, setIsSupreme] = useState(false);
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
        .select('name, receipt_paper_width, receipt_header_text, receipt_footer_text, show_wifi_on_receipt, wifi_ssid, wifi_password, receipt_hide_branding, service_charge_pct, tax_pct, tax_inclusive, service_label, tax_label')
        .eq('id', profile.tenant_id)
        .single();

      if (tenant) {
        setReceiptData({
          paperWidth: (tenant.receipt_paper_width as '58mm' | '80mm') ?? '58mm',
          headerText: tenant.receipt_header_text ?? '',
          footerText: tenant.receipt_footer_text ?? '',
          showWifi: !!tenant.show_wifi_on_receipt,
          wifiSsid: tenant.wifi_ssid ?? '',
          wifiPassword: tenant.wifi_password ?? '',
          hideBranding: !!tenant.receipt_hide_branding,
          servicePct: String(tenant.service_charge_pct ?? 0),
          taxPct: String(tenant.tax_pct ?? 0),
          taxInclusive: !!tenant.tax_inclusive,
          serviceLabel: tenant.service_label || DEFAULT_SERVICE_LABEL,
          taxLabel: tenant.tax_label || DEFAULT_TAX_LABEL,
        });
        if (tenant.name) setCafeName(tenant.name);
      }
      if (profile.role === 'super_admin') {
        setIsSupreme(true);
      } else {
        const { data: tier } = await supabase.rpc('tenant_tier', { p_tenant_id: profile.tenant_id });
        setIsSupreme(tier === 'supreme');
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
        show_wifi_on_receipt: receiptData.showWifi,
        wifi_ssid: receiptData.wifiSsid.trim() || null,
        wifi_password: receiptData.wifiPassword.trim() || null,
        // Hanya Supreme yang boleh true (ditegakkan juga oleh trigger di database).
        receipt_hide_branding: isSupreme ? receiptData.hideBranding : false,
        service_charge_pct: parsePct(receiptData.servicePct),
        tax_pct: parsePct(receiptData.taxPct),
        tax_inclusive: receiptData.taxInclusive,
        service_label: receiptData.serviceLabel.trim().slice(0, 30) || DEFAULT_SERVICE_LABEL,
        tax_label: receiptData.taxLabel.trim().slice(0, 30) || DEFAULT_TAX_LABEL,
      })
      .eq('id', tenantId);

    setSaving(false);
    if (error) {
      setStatus({ type: 'error', message: 'Gagal menyimpan: ' + error.message });
      return;
    }
    resetHideBrandingCache();
    resetChargeSettingsCache();
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

      <SettingsCard title="Biaya Layanan & Pajak" description="Dihitung otomatis di kasir, struk, dan laporan. Isi 0 jika tidak dipakai">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Nama biaya layanan di struk"
            value={receiptData.serviceLabel}
            maxLength={30}
            onChange={(e) => setReceiptData({ ...receiptData, serviceLabel: e.target.value })}
            placeholder="Contoh: Service Charge, Biaya Layanan"
            disabled={!canEdit}
          />
          <Input
            label="Biaya layanan (%)"
            inputMode="decimal"
            value={receiptData.servicePct}
            onChange={(e) => setReceiptData({ ...receiptData, servicePct: e.target.value.replace(/[^0-9.,]/g, '') })}
            placeholder="Contoh: 5"
            disabled={!canEdit}
          />
          <Input
            label="Nama pajak di struk"
            value={receiptData.taxLabel}
            maxLength={30}
            onChange={(e) => setReceiptData({ ...receiptData, taxLabel: e.target.value })}
            placeholder="Contoh: PPN, PB1, Pajak Restoran"
            disabled={!canEdit}
          />
          <Input
            label="Pajak (%)"
            inputMode="decimal"
            value={receiptData.taxPct}
            onChange={(e) => setReceiptData({ ...receiptData, taxPct: e.target.value.replace(/[^0-9.,]/g, '') })}
            placeholder="Contoh: 10 (PB1) atau 11 (PPN)"
            disabled={!canEdit}
          />
        </div>
        <div className="mt-3 space-y-2 text-sm text-neutral-700">
          <label className="flex items-start gap-2">
            <input type="radio" name="taxMode" checked={!receiptData.taxInclusive} onChange={() => setReceiptData({ ...receiptData, taxInclusive: false })} disabled={!canEdit} className="mt-0.5" />
            <span><strong>Ditambahkan</strong> di atas harga menu (pelanggan membayar lebih besar dari harga menu).</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="taxMode" checked={receiptData.taxInclusive} onChange={() => setReceiptData({ ...receiptData, taxInclusive: true })} disabled={!canEdit} className="mt-0.5" />
            <span><strong>Sudah termasuk</strong> di harga menu (total tidak berubah; struk hanya merinci bagian pajaknya).</span>
          </label>
        </div>
        {(() => {
          const demo = computeCharges(100000, { servicePct: parsePct(receiptData.servicePct), taxPct: parsePct(receiptData.taxPct), taxInclusive: receiptData.taxInclusive, serviceLabel: receiptData.serviceLabel, taxLabel: receiptData.taxLabel });
          return (
            <p className="text-xs text-neutral-500 mt-3">
              Contoh pesanan Rp 100.000 → {receiptData.serviceLabel.trim() || DEFAULT_SERVICE_LABEL} Rp {demo.service.toLocaleString('id-ID')}, {receiptData.taxLabel.trim() || DEFAULT_TAX_LABEL} Rp {demo.tax.toLocaleString('id-ID')}
              {receiptData.taxInclusive ? ' (sudah termasuk)' : ''}, <strong>total Rp {demo.total.toLocaleString('id-ID')}</strong>.
              Urutan hitung: (harga − diskon) + service, lalu pajak dihitung dari hasilnya.
            </p>
          );
        })()}
      </SettingsCard>

      <SettingsCard title="WiFi di Struk" description="Tampilkan nama & password WiFi kafe di bagian bawah struk">
        <div className="grid grid-cols-1 gap-4">
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={receiptData.showWifi}
              onChange={(e) => setReceiptData({ ...receiptData, showWifi: e.target.checked })}
              disabled={!canEdit}
            />
            Cetak info WiFi di struk
          </label>
          {receiptData.showWifi && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Nama WiFi (SSID)"
                value={receiptData.wifiSsid}
                onChange={(e) => setReceiptData({ ...receiptData, wifiSsid: e.target.value })}
                placeholder="Contoh: Kopi-Palu-WiFi"
                disabled={!canEdit}
              />
              <Input
                label="Password WiFi"
                value={receiptData.wifiPassword}
                onChange={(e) => setReceiptData({ ...receiptData, wifiPassword: e.target.value })}
                placeholder="Contoh: kopi1234"
                disabled={!canEdit}
              />
            </div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard title="Branding caPOS" description="Baris “powered by caPOS — Studio D13” di bawah struk">
        <label className={'flex items-start gap-2 text-sm ' + (isSupreme ? 'text-neutral-700' : 'text-neutral-400')}>
          <input
            type="checkbox"
            className="mt-0.5"
            checked={isSupreme && receiptData.hideBranding}
            onChange={(e) => setReceiptData({ ...receiptData, hideBranding: e.target.checked })}
            disabled={!canEdit || !isSupreme}
          />
          <span>Sembunyikan tulisan “powered by caPOS” di struk (fitur khusus paket Supreme)</span>
        </label>
        {!isSupreme && (
          <p className="text-xs text-neutral-500 mt-2">
            Fitur ini hanya untuk paket Supreme.{' '}
            <Link href="/dashboard/subscription" className="text-primary-dark underline font-medium">
              Lihat paket
            </Link>
          </p>
        )}
      </SettingsCard>

      <SettingsCard title="Pratinjau Struk" description="Contoh tampilan sesuai pengaturan di atas (belum disimpan sampai Anda menekan Simpan)">
        <div className="rounded-2xl bg-neutral-100 p-3 flex justify-center overflow-x-auto">
          <Receipt
            data={buildSampleReceiptData({
              cafeName,
              headerText: receiptData.headerText || null,
              footerText: receiptData.footerText || null,
              showWifi: receiptData.showWifi,
              wifiSsid: receiptData.wifiSsid,
              wifiPassword: receiptData.wifiPassword,
              width: receiptData.paperWidth,
              hideBranding: isSupreme && receiptData.hideBranding,
            })}
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
