"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import { cx } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import type { TableLiveStatus } from "@/lib/types";
import TableGrid from "@/components/tables/TableGrid";
import TableDetailModal from "@/components/tables/TableDetailModal";

/**
 * Table Management §4 — halaman utama /dashboard/tables. Sebelumnya papan
 * meja live (TableStatusBoard) cuma "menumpang" di halaman Reservasi;
 * sekarang ada halamannya sendiri, dengan toggle List/Floor dan seluruh
 * aksi (open, move, merge, split bill, cleaning) lewat komponen modular di
 * components/tables/.
 *
 * Target 97–98% dari spec: hampir semua item checklist (table list, floor
 * layout, status, open table, assign order, move, merge, split bill, print
 * bill, payment, close table, cleaning status, reservation indicator) ada
 * di sini — "Payment"/"Close table" sengaja tetap final-step-nya lewat
 * /pos (checkout_order_v2), bukan didobel di sini, supaya cuma ada 1 jalur
 * otorisasi pembayaran (lihat komentar di TableActionMenu).
 */
export default function TablesPage() {
  const { selectedBranchId, selectedBranch, canSwitchBranch } = useBranch();
  const [tables, setTables] = useState<TableLiveStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"compact" | "floor">("floor");
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveBranchId = selectedBranchId === ALL_BRANCHES ? null : selectedBranchId;

  useEffect(() => {
    if (!effectiveBranchId) {
      setLoading(false);
      return;
    }
    load();
    const supabase = createClient();
    const channel = supabase
      .channel(`tables-page-${effectiveBranchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `branch_id=eq.${effectiveBranchId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "branch_tables", filter: `branch_id=eq.${effectiveBranchId}` }, load)
      .subscribe();
    const interval = setInterval(load, 60000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBranchId]);

  async function load() {
    if (!effectiveBranchId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("table_live_status")
      .select("*")
      .eq("branch_id", effectiveBranchId)
      .order("table_number");
    setTables((data as TableLiveStatus[]) ?? []);
    setLoading(false);
  }

  const activeTable = tables.find((t) => t.table_id === activeTableId) ?? null;
  const availableTables = tables.filter((t) => t.status === "AVAILABLE");
  const occupiedTables = tables.filter(
    (t) => (t.status === "OCCUPIED" || t.status === "BILL_PRINTED") && t.table_id !== activeTableId
  );

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

  async function finishCleaning() {
    if (!activeTable) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.from("branch_tables").update({ needs_cleaning: false, cleaning_started_at: null }).eq("id", activeTable.table_id);
    setBusy(false);
    await load();
    setActiveTableId(null);
  }

  async function moveTo(target: TableLiveStatus) {
    if (!activeTable?.active_order_id) return;
    setBusy(true);
    const res = await fetch("/api/tables/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: activeTable.active_order_id, new_table_id: target.table_id }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      alert("Gagal memindah meja: " + (body.message ?? "unknown error"));
      return;
    }
    await load();
    setActiveTableId(null);
  }

  async function mergeInto(target: TableLiveStatus) {
    if (!activeTable?.active_order_id || !target.active_order_id) return;
    if (!window.confirm(`Gabungkan pesanan meja ${activeTable.table_number} ke meja ${target.table_number}?`)) return;
    setBusy(true);
    const res = await fetch("/api/tables/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_order_id: activeTable.active_order_id,
        target_order_id: target.active_order_id,
        reason: `Gabung meja ${activeTable.table_number} -> ${target.table_number} (Table Management)`,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      alert("Gagal menggabungkan meja: " + (body.message ?? "unknown error"));
      return;
    }
    await load();
    setActiveTableId(null);
  }

  if (!effectiveBranchId) {
    return (
      <div className="card p-8 text-center text-sm text-neutral-500">
        Pilih satu cabang terlebih dahulu untuk mengelola meja (tidak tersedia untuk tampilan Semua Cabang).
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Manajemen Meja</h1>
          <p className="text-sm text-neutral-500">
            {canSwitchBranch && selectedBranch ? selectedBranch.name : "Cabang Anda"} · {tables.length} meja
          </p>
        </div>
        <div className="flex gap-1 bg-neutral-100 rounded-lg p-1">
          <button
            onClick={() => setView("floor")}
            className={cx("px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5", view === "floor" ? "bg-white shadow-sm font-medium" : "text-neutral-500")}
          >
            <LayoutGrid size={14} /> Floor
          </button>
          <button
            onClick={() => setView("compact")}
            className={cx("px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5", view === "compact" ? "bg-white shadow-sm font-medium" : "text-neutral-500")}
          >
            <Rows3 size={14} /> List
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="card p-4">
          <TableGrid tables={tables} variant={view} onSelectTable={(t) => setActiveTableId(t.table_id)} />
        </div>
      )}

      {activeTable && (
        <TableDetailModal
          table={activeTable}
          availableTables={availableTables}
          occupiedTables={occupiedTables}
          busy={busy}
          onClose={() => setActiveTableId(null)}
          onPrintBill={printBill}
          onMove={moveTo}
          onMerge={mergeInto}
          onFinishCleaning={finishCleaning}
          onSplitSettled={load}
        />
      )}
    </div>
  );
}
