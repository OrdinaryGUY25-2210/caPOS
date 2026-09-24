"use client";

import { useEffect, useState } from "react";
import { Loader2, Printer, ArrowRightLeft, Combine, Clock, Users, ArrowLeft } from "lucide-react";
import Modal from "@/components/Modal";
import ConfirmDialog from "@/components/ConfirmDialog";
import { createClient } from "@/lib/supabase/client";
import { cx, formatRupiah } from "@/lib/utils";
import type { TableLiveStatus } from "@/lib/types";

const STATUS_STYLE: Record<string, string> = {
  AVAILABLE: "bg-primary-light text-primary border-primary/30",
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
 * Peta status meja real-time — dibaca dari view `table_live_status`
 * (Fase 4, diperluas Migrasi 019 dengan status BILL_PRINTED). Dipasang
 * di Dashboard > Reservasi supaya manager/owner langsung tahu meja mana
 * yang "RESERVED" 30-60 menit sebelum kedatangan.
 *
 * Migrasi 019 melengkapi papan ini dari sekadar tampilan status jadi
 * bisa BERTINDAK: tap sebuah meja untuk Cetak Bill, Pindah Meja, Gabung
 * Meja, atau Tandai Selesai Dibersihkan — tanpa harus lewat /pos.
 * Move & Merge lewat /api/tables/move & /api/tables/merge (route HTTP
 * yang sama dipakai OpenBillPanel.tsx), sehingga 1 jalur otorisasi untuk
 * kedua tempat.
 */
export default function TableStatusBoard({ branchId }: { branchId: string }) {
  const [tables, setTables] = useState<TableLiveStatus[]>([]);
  const [activeTable, setActiveTable] = useState<TableLiveStatus | null>(null);
  const [subView, setSubView] = useState<"MENU" | "MOVE" | "MERGE">("MENU");
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ mode: "MOVE" | "MERGE"; target: TableLiveStatus } | null>(null);

  useEffect(() => {
    if (!branchId) return;
    load();
    const supabase = createClient();
    const channel = supabase
      .channel(`table-board-${branchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `branch_id=eq.${branchId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "branch_tables", filter: `branch_id=eq.${branchId}` }, load)
      .subscribe();
    const interval = setInterval(load, 60000); // jaring pengaman — jendela RESERVED bergerak seiring waktu
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function load() {
    const supabase = createClient();
    const { data } = await supabase.from("table_live_status").select("*").eq("branch_id", branchId).order("table_number");
    const fresh = (data as TableLiveStatus[]) ?? [];
    setTables(fresh);
    // Sinkronkan panel yang sedang terbuka dengan data terbaru (mis. total berubah karena item baru masuk dari KDS).
    setActiveTable((prev) => (prev ? fresh.find((t) => t.table_id === prev.table_id) ?? null : prev));
  }

  function openActions(t: TableLiveStatus) {
    setSubView("MENU");
    setActiveTable(t);
  }

  async function printBill() {
    if (!activeTable?.active_order_id) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("mark_bill_printed", { p_order_id: activeTable.active_order_id });
    setBusy(false);
    if (error) {
      alert("Gagal menandai bill dicetak: " + error.message);
      return;
    }
    await load();
    window.print();
  }

  async function finishCleaning(t: TableLiveStatus) {
    setBusy(true);
    const supabase = createClient();
    await supabase.from("branch_tables").update({ needs_cleaning: false, cleaning_started_at: null }).eq("id", t.table_id);
    setBusy(false);
    await load();
    setActiveTable(null);
  }

  function moveTo(target: TableLiveStatus) {
    if (!activeTable?.active_order_id) return;
    // Item #28 — sebelumnya "Pindah Meja" langsung eksekusi begitu meja
    // tujuan ditekan, tanpa konfirmasi sama sekali. Sekarang lewat dialog
    // Confirmation dulu.
    setConfirmAction({ mode: "MOVE", target });
  }

  async function applyMoveTo(target: TableLiveStatus) {
    if (!activeTable?.active_order_id) return;
    const res = await fetch("/api/tables/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: activeTable.active_order_id, new_table_id: target.table_id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message ?? "unknown error");
    await load();
    setActiveTable(null);
  }

  function mergeInto(target: TableLiveStatus) {
    if (!activeTable?.active_order_id || !target.active_order_id) return;
    setConfirmAction({ mode: "MERGE", target });
  }

  async function applyMergeInto(target: TableLiveStatus) {
    if (!activeTable?.active_order_id || !target.active_order_id) return;
    const res = await fetch("/api/tables/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_order_id: activeTable.active_order_id,
        target_order_id: target.active_order_id,
        reason: `Gabung meja ${activeTable.table_number} -> ${target.table_number} (Dashboard)`,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message ?? "unknown error");
    await load();
    setActiveTable(null);
  }

  if (tables.length === 0) return null;

  const availableTables = tables.filter((t) => t.status === "AVAILABLE");
  const occupiedTables = tables.filter(
    (t) => (t.status === "OCCUPIED" || t.status === "BILL_PRINTED") && t.table_id !== activeTable?.table_id
  );

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 mb-6">
      <p className="font-bold text-neutral-900 text-sm mb-3">Status Meja Live</p>
      <div className="flex flex-wrap gap-2">
        {tables.map((t) => {
          const mins =
            t.status === "OCCUPIED" || t.status === "BILL_PRINTED" ? elapsedMinutes(t.occupied_at) : t.status === "CLEANING" ? elapsedMinutes(t.cleaning_started_at) : null;
          const actionable = t.status === "OCCUPIED" || t.status === "BILL_PRINTED" || t.status === "CLEANING";
          return (
            <button
              key={t.table_id}
              disabled={!actionable}
              onClick={() => (t.status === "CLEANING" ? finishCleaning(t) : openActions(t))}
              className={cx(
                "px-3 py-2 rounded-xl border text-xs font-semibold flex flex-col items-center min-w-[72px] transition-transform",
                STATUS_STYLE[t.status],
                actionable ? "hover:scale-[1.03] cursor-pointer" : "cursor-default opacity-90"
              )}
              title={t.status === "CLEANING" ? "Tap untuk tandai selesai dibersihkan" : actionable ? "Tap untuk aksi meja" : undefined}
            >
              <span>Meja {t.table_number}</span>
              <span className="text-[10px] font-normal opacity-80">{STATUS_LABEL[t.status] ?? t.status}</span>
              {(t.status === "OCCUPIED" || t.status === "BILL_PRINTED") && (
                <span className="text-[10px] font-normal opacity-80">{formatRupiah(t.active_order_total)}</span>
              )}
              {mins !== null && (
                <span className="text-[10px] font-normal opacity-80 flex items-center gap-0.5">
                  <Clock size={9} /> {mins}mnt
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeTable && (
        <Modal title={`Meja ${activeTable.table_number} — ${activeTable.active_order_number ?? ""}`} onClose={() => setActiveTable(null)}>
          {subView === "MENU" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-neutral-50 rounded-lg px-3 py-2 text-sm">
                <span className="text-neutral-500 flex items-center gap-1"><Users size={13} /> Kapasitas {activeTable.capacity}</span>
                <span className="font-bold text-primary">{formatRupiah(activeTable.active_order_total)}</span>
              </div>

              <button disabled={busy} onClick={printBill} className="btn-outline w-full text-sm flex items-center justify-center gap-2">
                {busy ? <Loader2 className="animate-spin" size={14} /> : <Printer size={14} />} Cetak Bill
              </button>
              <button disabled={busy || availableTables.length === 0} onClick={() => setSubView("MOVE")} className="btn-outline w-full text-sm flex items-center justify-center gap-2">
                <ArrowRightLeft size={14} /> Pindah Meja
              </button>
              <button disabled={busy || occupiedTables.length === 0} onClick={() => setSubView("MERGE")} className="btn-outline w-full text-sm flex items-center justify-center gap-2">
                <Combine size={14} /> Gabung ke Meja Lain
              </button>
              <p className="text-xs text-neutral-400 text-center pt-1">
                Void item, batalkan pesanan, diskon manual & split bill dilakukan dari kasir (/pos) supaya PIN supervisor tercatat di sana.
              </p>
            </div>
          )}

          {subView === "MOVE" && (
            <div className="space-y-3">
              <button onClick={() => setSubView("MENU")} className="text-xs text-neutral-500 flex items-center gap-1">
                <ArrowLeft size={12} /> Kembali
              </button>
              <p className="text-xs text-neutral-500">Pilih meja tujuan (harus tersedia):</p>
              {busy ? (
                <div className="flex justify-center py-6"><Loader2 className="animate-spin text-neutral-400" size={20} /></div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {availableTables.map((t) => (
                    <button key={t.table_id} onClick={() => moveTo(t)} className="px-2 py-2.5 rounded-xl border border-primary/30 bg-primary-light text-primary text-xs font-semibold">
                      Meja {t.table_number}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {subView === "MERGE" && (
            <div className="space-y-3">
              <button onClick={() => setSubView("MENU")} className="text-xs text-neutral-500 flex items-center gap-1">
                <ArrowLeft size={12} /> Kembali
              </button>
              <p className="text-xs text-neutral-500">Gabungkan ke meja terisi lain (item dipindah jadi 1 tagihan, meja ini dibebaskan):</p>
              {busy ? (
                <div className="flex justify-center py-6"><Loader2 className="animate-spin text-neutral-400" size={20} /></div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {occupiedTables.map((t) => (
                    <button
                      key={t.table_id}
                      onClick={() => mergeInto(t)}
                      className="px-3 py-2.5 rounded-xl border border-urgent/30 bg-urgent-light text-urgent text-xs font-semibold flex flex-col items-center"
                    >
                      <span>Meja {t.table_number}</span>
                      <span className="opacity-80">{formatRupiah(t.active_order_total)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.mode === "MOVE" ? "Pindahkan Pesanan?" : "Gabungkan Pesanan?"}
          description={
            confirmAction.mode === "MOVE"
              ? `Pindahkan pesanan meja ${activeTable?.table_number} ke meja ${confirmAction.target.table_number}?`
              : `Gabungkan pesanan meja ${activeTable?.table_number} ke meja ${confirmAction.target.table_number}? Bill meja ${activeTable?.table_number} akan hilang dan digabung ke meja ${confirmAction.target.table_number}.`
          }
          confirmLabel={confirmAction.mode === "MOVE" ? "Ya, Pindahkan" : "Ya, Gabungkan"}
          successMessage={confirmAction.mode === "MOVE" ? "Meja dipindahkan." : "Pesanan digabung."}
          onClose={() => setConfirmAction(null)}
          onConfirm={() =>
            confirmAction.mode === "MOVE" ? applyMoveTo(confirmAction.target) : applyMergeInto(confirmAction.target)
          }
        />
      )}
    </div>
  );
}
