"use client";

/**
 * Penanda kecil bahwa blok data di dekatnya adalah data CONTOH, bukan data
 * asli tenant. Dipakai bersama `DemoBanner` di seluruh halaman mode contoh.
 */
export default function DemoBadge({ label = "Contoh" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide align-middle">
      {label}
    </span>
  );
}
