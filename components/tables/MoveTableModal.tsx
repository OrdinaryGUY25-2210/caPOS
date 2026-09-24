"use client";

import { Loader2, ArrowLeft } from "lucide-react";
import type { TableLiveStatus } from "@/lib/types";

/**
 * Table Management §4 — "Move table": pindahkan order aktif dari
 * `activeTable` ke salah satu meja AVAILABLE lain. Dipanggil dari
 * TableDetailModal sebagai sub-view (bukan modal terpisah di atas modal),
 * supaya transisi terasa satu alur.
 */
export default function MoveTableModal({
  activeTable,
  availableTables,
  busy,
  onBack,
  onMove,
}: {
  activeTable: TableLiveStatus;
  availableTables: TableLiveStatus[];
  busy: boolean;
  onBack: () => void;
  onMove: (target: TableLiveStatus) => void;
}) {
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-xs text-neutral-500 flex items-center gap-1">
        <ArrowLeft size={12} /> Kembali
      </button>
      <p className="text-xs text-neutral-500">
        Pindahkan order Meja {activeTable.table_number} ke meja tujuan (harus tersedia):
      </p>
      {busy ? (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin text-neutral-400" size={20} />
        </div>
      ) : availableTables.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-6">Tidak ada meja tersedia saat ini.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {availableTables.map((t) => (
            <button
              key={t.table_id}
              onClick={() => onMove(t)}
              className="px-2 py-2.5 rounded-xl border border-primary/30 bg-primary-light text-primary text-xs font-semibold"
            >
              Meja {t.table_number}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
