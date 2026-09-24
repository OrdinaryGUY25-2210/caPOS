'use client';

import { useState } from 'react';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Toast } from '@/components/ui/Toast';
import { createClient } from '@/lib/supabase/client';
import { getCurrentProfile } from '@/lib/getCurrentProfile';

/**
 * PRIORITY 12 audit finding: this form previously faked a success message
 * without calling Supabase at all — the password was never actually
 * changed. Real fix (no new migration needed — this is just Supabase
 * Auth):
 *  1. Re-authenticate with the current password via
 *     signInWithPassword(email, current) — confirms "Password Saat Ini"
 *     is actually correct instead of trusting it blindly.
 *  2. supabase.auth.updateUser({ password: new }) — same call already
 *     used in app/forgot-password/page.tsx.
 * Loading / Success / Error states are real now, not simulated.
 */
export function PasswordChangeForm() {
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [variant, setVariant] = useState<'success' | 'error'>('success');

  const handleSave = async () => {
    if (!passwords.current || !passwords.new) {
      setVariant('error');
      setMessage('Isi password saat ini dan password baru.');
      return;
    }
    if (passwords.new.length < 6) {
      setVariant('error');
      setMessage('Password baru minimal 6 karakter.');
      return;
    }
    if (passwords.new !== passwords.confirm) {
      setVariant('error');
      setMessage('Konfirmasi password baru tidak cocok.');
      return;
    }

    setIsSaving(true);
    setMessage('');
    try {
      const { profile } = await getCurrentProfile();
      if (!profile?.email) {
        setVariant('error');
        setMessage('Gagal mengambil data akun. Coba muat ulang halaman.');
        return;
      }

      const supabase = createClient();

      // Verifikasi password saat ini benar-benar cocok sebelum mengganti.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: passwords.current,
      });
      if (reauthError) {
        setVariant('error');
        setMessage('Password saat ini salah.');
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: passwords.new });
      if (updateError) {
        setVariant('error');
        setMessage('Gagal mengubah password: ' + updateError.message);
        return;
      }

      setVariant('success');
      setMessage('Password berhasil diubah.');
      setPasswords({ current: '', new: '', confirm: '' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {message && <Toast variant={variant} message={message} />}
      <SettingsCard title="Ubah Password" description="Perbarui password Anda">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            label="Password Saat Ini"
            type="password"
            value={passwords.current}
            onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
          />
          <Input
            label="Password Baru"
            type="password"
            value={passwords.new}
            onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
          />
          <Input
            label="Konfirmasi Password"
            type="password"
            value={passwords.confirm}
            onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
          />
        </div>
        <div className="mt-4 flex gap-3">
          <Button
            variant="outline"
            onClick={() => setPasswords({ current: '', new: '', confirm: '' })}
            disabled={isSaving}
          >
            Batal
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Menyimpan...' : 'Ubah Password'}
          </Button>
        </div>
      </SettingsCard>
    </>
  );
}
