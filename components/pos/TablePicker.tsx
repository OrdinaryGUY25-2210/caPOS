"use client";

import { useEffect, useState } from "react";
import { Loader2, Users, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cx, formatRupiah } from "@/lib/utils";
import type { TableLiveStatus } from "@/lib/types";

const STATUS_STYLE: Record<string, string> = {
  AVAILABLE: "bg-primary-light text-primary border-primary/30 hover:border-primary",
  RESERVED: "bg-warning-light text-warning border-warning/30",
  OCCUPIED: "bg-urgent-light text-urgent border-urgent/30",
  BILL_PRINTED: "bg-blue-50 text-blue-600 border-blue-200",
  CLEANING: "bg-neutral-200 text-neutral-500 border-neutral-300",
};

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Tersedia",
  RESERVED: "Direservasi",
  OCCUPIED: "Terisi",
  BILL_PRINTED: "Bill Dicetak",
  CLEANING: "Dibersihkan",
};

function elapsedMinutes(since: string | null) {
  if (!since) return null;
  return Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000));
}

/**
 * Grid pemilihan meja live untuk /pos (Phase 2 Update 1) — dibaca dari
 * `table_live_status` (Fase 4, diperluas Update 1 dengan CLEANING & data
 * order aktif). Dipakai di 2 tempat:
 *  - SendToKitchenModal: kasir WAJIB pilih meja AVAILABLE untuk order
 *    dine-in baru (tap AVAILABLE memanggil onSelectAvailable).
 *  - Panel "Meja & Bill Terbuka": tap meja OCCUPIED untuk lanjut ke
 *    pesanan/pembayarannya (tap OCCUPIED memanggil onSelectOccupied).
 */
export default function TablePicker({
  branchId,
  selectedTableId,
  onSelectAvailable,
  onSelectOccupied,
  onFinishCleaning,
}: {
  branchId: string | null;
  selectedTableId?: string | null;
  onSelectAvailable?: (table: TableLiveStatus) => void;
  onSelectOccupied?: (table: TableLiveStatus) => void;
  onFinishCleaning?: (table: TableLiveStatus) => void;
}) {
  const [tables, setTables] = useState<TableLiveStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!branchId) return;
    load();
    const supabase = createClient();
    // Realtime: meja lain bisa berubah status kapan saja (order baru,
    // pembayaran lunas, cleaning selesai) dari device kasir lain.
    const channel = supabase
      .channel(`table-live-${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `branch_id=eq.${branchId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "branch_tables", filter: `branch_id=eq.${branchId}` }, load)
      .subscribe();
    const interval = setInterval(load, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function load() {
    if (!branchId) return;
    const supabase = createClient();
    const { data } = await supabase.from("table_live_status").select("*").eq("branch_id", branchId).order("table_number");
    setTables((data as TableLiveStatus[]) ?? []);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-neutral-400">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <p className="text-sm text-neutral-500 py-4 text-center">
        Belum ada meja terdaftar untuk cabang ini. Tambahkan di Dashboard &rarr; Meja QR.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {tables.map((t) => {
        const mins = t.status === "OCCUPIED" || t.status === "BILL_PRINTED" ? elapsedMinutes(t.occupied_at) : t.status === "CLEANING" ? elapsedMinutes(t.cleaning_started_at) : null;
        const clickable =
          (t.status === "AVAILABLE" && !!onSelectAvailable) ||
          ((t.status === "OCCUPIED" || t.status === "BILL_PRINTED") && !!onSelectOccupied) ||
          (t.status === "CLEANING" && !!onFinishCleaning);

        return (
          <button
            key={t.table_id}
            disabled={!clickable}
            onClick={() => {
              if (t.status === "AVAILABLE") onSelectAvailable?.(t);
              else if (t.status === "OCCUPIED" || t.status === "BILL_PRINTED") onSelectOccupied?.(t);
              else if (t.status === "CLEANING") onFinishCleaning?.(t);
            }}
            className={cx(
              "px-2 py-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-0.5 transition-all",
              STATUS_STYLE[t.status],
              selectedTableId === t.table_id ? "ring-2 ring-primary" : "",
              !clickable && "opacity-70 cursor-default"
            )}
          >
            <span className="text-sm">Meja {t.table_number}</span>
            <span className="text-[10px] font-normal opacity-80 flex items-center gap-1">
              <Users size={10} /> {t.capacity}
            </span>
            <span className="text-[10px] font-normal opacity-80">{STATUS_LABEL[t.status]}</span>
            {(t.status === "OCCUPIED" || t.status === "BILL_PRINTED") && (
              <>
                <span className="text-[10px] font-bold">{t.active_order_number}</span>
                <span className="text-[10px] font-normal opacity-80">{formatRupiah(t.active_order_total)}</span>
                {mins !== null && (
                  <span className="text-[10px] font-normal opacity-80 flex items-center gap-1">
                    <Clock size={10} /> {mins} mnt
                  </span>
                )}
              </>
            )}
            {t.status === "CLEANING" && mins !== null && (
              <span className="text-[10px] font-normal opacity-80 flex items-center gap-1">
                <Clock size={10} /> {mins} mnt &middot; Tap selesai
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
