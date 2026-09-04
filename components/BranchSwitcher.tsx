"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Store, Building2 } from "lucide-react";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";

/**
 * Dropdown pemilih cabang di navbar dashboard Owner — bisa pilih satu
 * cabang spesifik, atau "Laporan Konsolidasi" (gabungan semua cabang).
 * Manager/Kasir tidak melihat dropdown ini sama sekali (mereka terkunci
 * ke 1 cabang penugasan lewat RLS + RPC, jadi tidak ada yang perlu dipilih).
 */
export default function BranchSwitcher() {
  const { branches, selectedBranchId, selectedBranch, canSwitchBranch, loading, setSelectedBranchId } = useBranch();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Manager/kasir (tidak bisa switch) atau tenant yang cuma punya 1 cabang
  // tidak perlu lihat dropdown ini — tidak ada gunanya menampilkan pilihan
  // kalau cuma ada 1 opsi.
  if (loading || !canSwitchBranch || branches.length <= 1) return null;

  const label = selectedBranchId === ALL_BRANCHES ? "Semua Cabang" : selectedBranch?.name ?? "Pilih Cabang";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-sm font-medium text-neutral-700 transition-colors"
      >
        {selectedBranchId === ALL_BRANCHES ? <Building2 size={15} className="text-primary" /> : <Store size={15} className="text-primary" />}
        <span className="max-w-[9rem] truncate">{label}</span>
        <ChevronDown size={14} className="text-neutral-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-64 bg-white rounded-xl border border-neutral-200 shadow-lg py-1.5 z-50 max-h-80 overflow-y-auto">
          <button
            onClick={() => {
              setSelectedBranchId(ALL_BRANCHES);
              setOpen(false);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-neutral-50 ${
              selectedBranchId === ALL_BRANCHES ? "text-primary font-semibold" : "text-neutral-700"
            }`}
          >
            <Building2 size={15} />
            <div>
              <p>Laporan Konsolidasi</p>
              <p className="text-[11px] text-neutral-400 font-normal">Gabungan seluruh cabang</p>
            </div>
          </button>

          <div className="my-1 border-t border-neutral-100" />

          {branches.map((b) => (
            <button
              key={b.id}
              onClick={() => {
                setSelectedBranchId(b.id);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-neutral-50 ${
                selectedBranchId === b.id ? "text-primary font-semibold" : "text-neutral-700"
              }`}
            >
              <Store size={15} />
              <div className="min-w-0">
                <p className="truncate">{b.name}</p>
                {!b.is_active && <p className="text-[11px] text-urgent font-normal">Nonaktif</p>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
