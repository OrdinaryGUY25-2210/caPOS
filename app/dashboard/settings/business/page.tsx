'use client';

import { useState } from 'react';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { Alert } from '@/components/ui/Alert';
import { Input } from '@/components/ui/Input';

// PRIORITY 11 audit finding: previously simulated a fake loading delay
// (setTimeout) and "Simpan Perubahan" faked a success toast without
// writing anything — no business-profile table (NPWP, address, etc.)
// exists in the schema (migrations 001–015) beyond `tenants.name`, which
// is managed elsewhere. Blocked by Supabase. Kept as an editable preview
// with an honest status instead of a lie.
export default function BusinessSettingsPage() {
  const [formData, setFormData] = useState({
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
    country: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <div className="space-y-6">
      <SettingsHeader title="Pengaturan Bisnis" description="Kelola informasi bisnis Anda" />

      <Alert
        variant="info"
        title="Belum tersambung ke database"
        message="Pratinjau saja — belum ada tabel profil bisnis (NPWP, alamat, dsb.) di skema saat ini, jadi perubahan di bawah ini belum bisa disimpan."
      />

      <SettingsCard title="Informasi Dasar" description="Detail bisnis utama Anda">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Nama Bisnis" name="businessName" value={formData.businessName} onChange={handleChange} placeholder="Masukkan nama bisnis" />
          <Input label="Kategori Bisnis" name="businessCategory" value={formData.businessCategory} onChange={handleChange} placeholder="Pilih kategori" />
          <Input label="Email Bisnis" name="businessEmail" type="email" value={formData.businessEmail} onChange={handleChange} placeholder="email@bisnis.com" />
          <Input label="Telepon" name="businessPhone" value={formData.businessPhone} onChange={handleChange} placeholder="+62 xxx xxxx xxxx" />
        </div>
      </SettingsCard>

      <SettingsCard title="Informasi Identitas" description="Identitas hukum bisnis">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="NPWP / Tax ID" name="taxId" value={formData.taxId} onChange={handleChange} placeholder="15.xxx.xxx.x-xxx.xxx" />
          <Input label="Nomor Registrasi" name="registrationNumber" value={formData.registrationNumber} onChange={handleChange} placeholder="0123456789" />
        </div>
      </SettingsCard>

      <SettingsCard title="Alamat Bisnis" description="Lokasi geografis bisnis">
        <div className="grid grid-cols-1 gap-4">
          <Input label="Alamat Lengkap" name="businessAddress" value={formData.businessAddress} onChange={handleChange} placeholder="Jalan, no. rumah" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Kota" name="city" value={formData.city} onChange={handleChange} placeholder="Kota" />
            <Input label="Provinsi" name="province" value={formData.province} onChange={handleChange} placeholder="Provinsi" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Kode Pos" name="postalCode" value={formData.postalCode} onChange={handleChange} placeholder="12345" />
            <Input label="Negara" name="country" value={formData.country} onChange={handleChange} placeholder="Indonesia" />
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
