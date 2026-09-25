'use client';

import { useEffect, useState } from 'react';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { Alert } from '@/components/ui/Alert';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/Skeleton';
import { getCurrentProfile } from '@/lib/getCurrentProfile';
import { createClient } from '@/lib/supabase/client';

// migration_018 menambah kolom profil bisnis (business_email,
// business_category, tax_id, registration_number, address, city,
// province, postal_code, country) ke `tenants` — sebelumnya tidak ada
// tempat penyimpanannya sama sekali (lihat migration_018_settings_pages.sql
// untuk alasannya). Halaman ini sekarang baca/tulis kolom itu sungguhan,
// menggantikan preview statis sebelumnya.
interface FormState {
  businessName: string;
  businessPhone: string;
  businessEmail: string;
  businessCategory: string;
  taxId: string;
  registrationNumber: string;
  businessAddress: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

const EMPTY_FORM: FormState = {
  businessName: '',
  businessPhone: '',
  businessEmail: '',
  businessCategory: '',
  taxId: '',
  registrationNumber: '',
  businessAddress: '',
  city: '',
  province: '',
  postalCode: '',
  country: 'Indonesia',
};

export default function BusinessSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormState>(EMPTY_FORM);
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
        .select(
          'name, phone, business_email, business_category, tax_id, registration_number, address, city, province, postal_code, country'
        )
        .eq('id', profile.tenant_id)
        .single();

      if (tenant) {
        setFormData({
          businessName: tenant.name ?? '',
          businessPhone: tenant.phone ?? '',
          businessEmail: tenant.business_email ?? '',
          businessCategory: tenant.business_category ?? '',
          taxId: tenant.tax_id ?? '',
          registrationNumber: tenant.registration_number ?? '',
          businessAddress: tenant.address ?? '',
          city: tenant.city ?? '',
          province: tenant.province ?? '',
          postalCode: tenant.postal_code ?? '',
          country: tenant.country ?? 'Indonesia',
        });
      }
      setLoading(false);
    })();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setStatus(null);
  };

  async function handleSave() {
    if (!tenantId) return;
    setSaving(true);
    setStatus(null);

    const supabase = createClient();
    const { error } = await supabase
      .from('tenants')
      .update({
        name: formData.businessName.trim() || undefined,
        phone: formData.businessPhone.trim() || null,
        business_email: formData.businessEmail.trim() || null,
        business_category: formData.businessCategory.trim() || null,
        tax_id: formData.taxId.trim() || null,
        registration_number: formData.registrationNumber.trim() || null,
        address: formData.businessAddress.trim() || null,
        city: formData.city.trim() || null,
        province: formData.province.trim() || null,
        postal_code: formData.postalCode.trim() || null,
        country: formData.country.trim() || null,
      })
      .eq('id', tenantId);

    setSaving(false);
    if (error) {
      // RLS "Tenants: owner/manager update own tenant" (migration_018)
      // menolak role selain owner/manager/super_admin — kasir yang entah
      // bagaimana sampai di sini akan lihat pesan ini, bukan silent fail.
      setStatus({ type: 'error', message: 'Gagal menyimpan: ' + error.message });
      return;
    }
    setStatus({ type: 'success', message: 'Perubahan tersimpan.' });
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Bisnis" description="Kelola informasi bisnis Anda" />
        <div className="card p-6 space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Bisnis" description="Kelola informasi bisnis Anda" />

      {!canEdit && (
        <Alert
          variant="info"
          title="Khusus Owner/Supervisor"
          message="Kamu bisa melihat data ini, tapi hanya Owner atau Supervisor yang bisa mengubahnya."
        />
      )}

      {status && <Alert variant={status.type === 'success' ? 'success' : 'error'} message={status.message} />}

      <SettingsCard title="Informasi Dasar" description="Detail bisnis utama Anda">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Nama Bisnis" name="businessName" value={formData.businessName} onChange={handleChange} placeholder="Masukkan nama bisnis" disabled={!canEdit} />
          <Input label="Kategori Bisnis" name="businessCategory" value={formData.businessCategory} onChange={handleChange} placeholder="Kafe, Restoran, dsb." disabled={!canEdit} />
          <Input label="Email Bisnis" name="businessEmail" type="email" value={formData.businessEmail} onChange={handleChange} placeholder="email@bisnis.com" disabled={!canEdit} />
          <Input label="Telepon" name="businessPhone" value={formData.businessPhone} onChange={handleChange} placeholder="+62 xxx xxxx xxxx" disabled={!canEdit} />
        </div>
      </SettingsCard>

      <SettingsCard title="Informasi Identitas" description="Identitas hukum bisnis">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="NPWP / Tax ID" name="taxId" value={formData.taxId} onChange={handleChange} placeholder="15.xxx.xxx.x-xxx.xxx" disabled={!canEdit} />
          <Input label="Nomor Registrasi" name="registrationNumber" value={formData.registrationNumber} onChange={handleChange} placeholder="0123456789" disabled={!canEdit} />
        </div>
      </SettingsCard>

      <SettingsCard title="Alamat Bisnis" description="Lokasi geografis bisnis">
        <div className="grid grid-cols-1 gap-4">
          <Input label="Alamat Lengkap" name="businessAddress" value={formData.businessAddress} onChange={handleChange} placeholder="Jalan, no. rumah" disabled={!canEdit} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Kota" name="city" value={formData.city} onChange={handleChange} placeholder="Kota" disabled={!canEdit} />
            <Input label="Provinsi" name="province" value={formData.province} onChange={handleChange} placeholder="Provinsi" disabled={!canEdit} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Kode Pos" name="postalCode" value={formData.postalCode} onChange={handleChange} placeholder="12345" disabled={!canEdit} />
            <Input label="Negara" name="country" value={formData.country} onChange={handleChange} placeholder="Indonesia" disabled={!canEdit} />
          </div>
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
