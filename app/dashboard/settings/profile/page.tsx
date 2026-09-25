'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AvatarUploadCard } from '@/components/profile/AvatarUploadCard';
import { PasswordChangeForm } from '@/components/profile/PasswordChangeForm';
import { DeleteAccountModal } from '@/components/profile/DeleteAccountModal';
import { getCurrentProfile } from '@/lib/getCurrentProfile';
import { createClient } from '@/lib/supabase/client';

/**
 * PRIORITY 12 audit finding: this page was the only real, reachable entry
 * point in the "Profile / Account" area (ProfileDropdown, ProfileCard,
 * AccountSettings are never rendered anywhere in the app — dead code, not
 * fixed here since fixing unreachable UI has no user-facing effect). But
 * this page had no Delete Account section at all, even though a fully
 * working DELETE /api/account endpoint (owner-only, wipes the whole
 * tenant) already exists in the backend with nothing calling it. Wired
 * that up here with real Loading/Success/Error/Confirmation states.
 */
export default function ProfileSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (profile) {
        setFullName(profile.full_name ?? '');
        setEmail(profile.email ?? '');
        setRole(profile.role);
        const supabase = createClient();
        const { data: tenant } = await supabase
          .from('tenants')
          .select('name')
          .eq('id', profile.tenant_id)
          .single();
        setBusinessName(tenant?.name ?? '');
      }
      setLoading(false);
    })();
  }, []);

  const isOwner = role === 'owner';

  async function handleDeleteAccount() {
    setDeleteError('');
    const res = await fetch('/api/account', { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.message || 'Gagal menghapus akun.');
    }
    router.push('/login');
  }

  return (
    <div className="space-y-6">
      <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Profil" description="Kelola informasi profil Anda" />

      <Alert
        variant="info"
        title="Belum tersambung sepenuhnya"
        message="Nama & email di bawah ini data akun Anda sesungguhnya, tapi mengedit nama/email belum tersedia. Ubah password dan hapus akun sudah tersambung ke database."
      />

      <AvatarUploadCard />

      <SettingsCard title="Informasi Dasar" description="Detail profil Anda">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Nama Lengkap" value={loading ? '' : fullName} disabled placeholder={loading ? 'Memuat...' : 'Nama Lengkap'} />
          <Input label="Email" type="email" value={loading ? '' : email} disabled placeholder={loading ? 'Memuat...' : 'Email'} />
        </div>
      </SettingsCard>

      <PasswordChangeForm />

      <SettingsCard title="Hapus Akun" description="Hapus akun dan seluruh data kafe Anda secara permanen">
        {loading ? (
          <p className="text-sm text-gray-500">Memuat...</p>
        ) : isOwner ? (
          <>
            {deleteError && <Alert variant="error" message={deleteError} />}
            <Button variant="danger" onClick={() => setDeleteModalOpen(true)}>
              Hapus Akun
            </Button>
          </>
        ) : (
          <p className="text-sm text-gray-500">
            Hanya pemilik (Owner) kafe yang bisa menghapus akun. Hubungi Owner jika Anda ingin berhenti menggunakan caPOS.
          </p>
        )}
      </SettingsCard>

      <DeleteAccountModal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        businessName={businessName}
        onConfirm={async () => {
          try {
            await handleDeleteAccount();
          } catch (e) {
            setDeleteError(e instanceof Error ? e.message : 'Gagal menghapus akun.');
            throw e;
          }
        }}
      />
    </div>
  );
}
