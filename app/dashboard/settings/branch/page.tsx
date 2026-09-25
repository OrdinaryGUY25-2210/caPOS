'use client';

import Link from 'next/link';
import { Store, MapPin, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { useBranch } from '@/lib/branchContext';

/**
 * Sebelumnya halaman ini presentation-only: EmptyState "Belum ada cabang"
 * selalu tampil apa pun kondisi tenant-nya, dan tombol "Tambah Cabang"
 * cuma menampilkan toast "belum tersedia di sini".
 *
 * Manajemen cabang SUNGGUHAN (create_branch RPC, batas tier, RLS
 * owner-only) sudah lengkap di app/dashboard/branches/page.tsx — jadi
 * daripada duplikasi logic itu di sini (risiko dua tempat itu suatu saat
 * tidak sinkron, sama seperti alasan settings/subscription mengarah ke
 * /dashboard/subscription), halaman ini sekarang jadi ringkasan NYATA
 * (baca dari BranchProvider yang sama dipakai /dashboard/branches) dengan
 * tombol ke sana untuk kelola penuh (tambah/nonaktifkan cabang).
 */
export default function BranchSettingsPage() {
  const { branches, loading } = useBranch();

  return (
    <div className="space-y-6">
      <SettingsHeader backHref="/dashboard/settings" title="Pengaturan Cabang" description="Kelola cabang bisnis Anda" />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="card p-4 flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : branches.length === 0 ? (
        <EmptyState
          icon={<Store size={20} />}
          title="Belum ada cabang"
          description="Mulai dengan menambahkan cabang bisnis Anda"
          actionLabel="Tambah Cabang"
          onAction={() => {
            window.location.href = '/dashboard/branches';
          }}
        />
      ) : (
        <div className="space-y-2">
          {branches.map((b) => (
            <div key={b.id} className="card p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center shrink-0 text-primary-dark">
                  <Store size={18} />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-neutral-900 truncate flex items-center gap-1.5">
                    {b.name}
                    {b.is_main && <span className="badge-active text-[10px]">Cabang Utama</span>}
                  </p>
                  {b.address && (
                    <p className="text-xs text-neutral-500 flex items-center gap-1 truncate">
                      <MapPin size={11} className="shrink-0" /> {b.address}
                    </p>
                  )}
                </div>
              </div>
              {b.is_active ? (
                <span className="badge-active shrink-0 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Aktif
                </span>
              ) : (
                <span className="badge-urgent shrink-0 flex items-center gap-1">
                  <XCircle size={12} /> Nonaktif
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <Link
        href="/dashboard/branches"
        className="btn-primary w-full sm:w-auto inline-flex items-center justify-center gap-2"
      >
        Kelola Cabang (tambah / nonaktifkan)
        <ArrowRight size={15} />
      </Link>
    </div>
  );
}
