"use client";

import { Loader2, ArrowLeft } from "lucide-react";
import type { TableLiveStatus } from "@/lib/types";
import { formatRupiah } from "@/lib/utils";

/**
 * Table Management §4 — "Merge table": gabungkan item dari order
 * `activeTable` ke order meja lain yang juga sedang terisi, jadi 1 tagihan.
 * Meja asal otomatis dibebaskan (dikosongkan) oleh RPC `merge` di server.
 */
export default function MergeTableModal({
  activeTable,
  occupiedTables,
  busy,
  onBack,
  onMerge,
}: {
  activeTable: TableLiveStatus;
  occupiedTables: TableLiveStatus[];
  busy: boolean;
  onBack: () => void;
  onMerge: (target: TableLiveStatus) => void;
}) {
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-xs text-neutral-500 flex items-center gap-1">
        <ArrowLeft size={12} /> Kembali
      </button>
      <p className="text-xs text-neutral-500">
        Gabungkan order Meja {activeTable.table_number} ke meja terisi lain (jadi 1 tagihan, meja ini
        dibebaskan):
      </p>
      {busy ? (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin text-neutral-400" size={20} />
        </div>
      ) : occupiedTables.length === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-6">Tidak ada meja terisi lain untuk digabung.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {occupiedTables.map((t) => (
            <button
              key={t.table_id}
              onClick={() => onMerge(t)}
              className="px-3 py-2.5 rounded-xl border border-urgent/30 bg-urgent-light text-urgent text-xs font-semibold flex flex-col items-center"
            >
              <span>Meja {t.table_number}</span>
              <span className="opacity-80">{formatRupiah(t.active_order_total)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
