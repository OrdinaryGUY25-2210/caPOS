"use client";

import { Search, X } from "lucide-react";

/**
 * Menu Management §6 — "Search" dari checklist yang sebelumnya belum ada
 * sama sekali di /dashboard/menu (Owner harus scroll manual untuk cari 1
 * menu di antara puluhan/ratusan produk).
 */
export default function MenuSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative flex-1 min-w-[180px]">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Cari nama menu..."
        className="input-field pl-9 pr-8 w-full"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-300 hover:text-neutral-500"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
