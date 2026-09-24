import React from 'react';
import { SettingsCard } from '@/components/settings/SettingsCard';

// PRIORITY 12 audit finding: "Ubah Foto" had no onClick handler at all,
// and the avatar itself was always a hardcoded "A" placeholder. Blocked
// by Supabase — the `profiles` table (lib/types.ts) has no avatar_url
// column and no storage bucket is set up for it, so there's nothing to
// upload to yet. Removed the dead button instead of leaving a fake one.
export function AvatarUploadCard() {
  return (
    <SettingsCard title="Foto Profil" description="Ubah foto profil Anda">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-blue-600 text-white flex items-center justify-center text-2xl font-bold">
          A
        </div>
        <p className="text-xs text-gray-600">
          Upload foto profil belum tersedia — belum ada penyimpanan foto di database.
        </p>
      </div>
    </SettingsCard>
  );
}
