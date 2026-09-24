"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import type { TableLiveStatus } from "@/lib/types";
import TableActionMenu from "./TableActionMenu";
import MoveTableModal from "./MoveTableModal";
import MergeTableModal from "./MergeTableModal";
import SplitBillModal from "./SplitBillModal";

type SubView = "MENU" | "MOVE" | "MERGE" | "SPLIT";

/**
 * Table Management §4 — modal utama saat sebuah meja di-tap dari TableGrid.
 * Menyatukan TableActionMenu + MoveTableModal + MergeTableModal +
 * SplitBillModal sebagai satu alur (sub-view di dalam 1 modal), persis flow
 * yang diminta: Occupied → Bill / Payment / Close table / Cleaning.
 */
export default function TableDetailModal({
  table,
  availableTables,
  occupiedTables,
  busy,
  onClose,
  onPrintBill,
  onMove,
  onMerge,
  onFinishCleaning,
  onSplitSettled,
}: {
  table: TableLiveStatus;
  availableTables: TableLiveStatus[];
  occupiedTables: TableLiveStatus[];
  busy: boolean;
  onClose: () => void;
  onPrintBill: () => void;
  onMove: (target: TableLiveStatus) => void;
  onMerge: (target: TableLiveStatus) => void;
  onFinishCleaning: () => void;
  onSplitSettled: () => void;
}) {
  const [subView, setSubView] = useState<SubView>("MENU");

  if (subView === "SPLIT") {
    return (
      <SplitBillModal
        table={table}
        onClose={() => setSubView("MENU")}
        onSettled={() => {
          onSplitSettled();
          setSubView("MENU");
        }}
      />
    );
  }

  return (
    <Modal title={`Meja ${table.table_number}${table.active_order_number ? ` — ${table.active_order_number}` : ""}`} onClose={onClose}>
      {subView === "MENU" && (
        <TableActionMenu
          table={table}
          busy={busy}
          canMove={availableTables.length > 0}
          canMerge={occupiedTables.length > 0}
          onPrintBill={onPrintBill}
          onMove={() => setSubView("MOVE")}
          onMerge={() => setSubView("MERGE")}
          onSplitBill={() => setSubView("SPLIT")}
          onFinishCleaning={onFinishCleaning}
        />
      )}

      {subView === "MOVE" && (
        <MoveTableModal
          activeTable={table}
          availableTables={availableTables}
          busy={busy}
          onBack={() => setSubView("MENU")}
          onMove={onMove}
        />
      )}

      {subView === "MERGE" && (
        <MergeTableModal
          activeTable={table}
          occupiedTables={occupiedTables}
          busy={busy}
          onBack={() => setSubView("MENU")}
          onMerge={onMerge}
        />
      )}
    </Modal>
  );
}
