import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface SettingsHeaderProps {
  title: string;
  description?: string;
  /**
   * Halaman ini adalah "menu dalam menu" di bawah /dashboard/settings
   * (Pengaturan Kafe) — beri link kembali ke sana supaya tidak harus lewat
   * sidebar lagi. Kosongkan kalau halaman ini memang halaman induk
   * (/dashboard/settings sendiri tidak butuh tombol ini).
   */
  backHref?: string;
  backLabel?: string;
}

export function SettingsHeader({ title, description, backHref, backLabel = 'Pengaturan Kafe' }: SettingsHeaderProps) {
  return (
    <div className="mb-6">
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:text-primary-dark mb-3 -ml-1 px-1 py-0.5 rounded transition-colors"
        >
          <ArrowLeft size={15} />
          {backLabel}
        </Link>
      )}
      <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
      {description && <p className="text-gray-600 mt-1">{description}</p>}
    </div>
  );
}
