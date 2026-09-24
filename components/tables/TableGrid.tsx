"use client";

import type { TableLiveStatus, TableLiveStatusValue } from "@/lib/types";
import TableCard from "./TableCard";

const SECTION_ORDER: TableLiveStatusValue[] = ["OCCUPIED", "BILL_PRINTED", "RESERVED", "CLEANING", "AVAILABLE"];
const SECTION_LABEL: Record<TableLiveStatusValue, string> = {
  OCCUPIED: "Terisi",
  BILL_PRINTED: "Bill Dicetak — Menunggu Bayar",
  RESERVED: "Direservasi",
  CLEANING: "Perlu Dibersihkan",
  AVAILABLE: "Tersedia",
};

/**
 * Table Management §4 — "Table list" + "Floor layout" dalam satu komponen.
 *
 * Skema `branch_tables` saat ini belum menyimpan koordinat (x/y) meja, jadi
 * "Floor layout" di sini diimplementasikan sebagai peta visual berbasis
 * status (dikelompokkan per section, kartu lebih besar/persegi seperti
 * denah) — bukan denah bebas-drag. Kalau nanti kolom posisi ditambahkan ke
 * `branch_tables`, tampilan `variant="floor"` tinggal dipetakan ke koordinat
 * itu tanpa mengubah TableCard/TableGrid.
 */
export default function TableGrid({
  tables,
  onSelectTable,
  variant = "compact",
}: {
  tables: TableLiveStatus[];
  onSelectTable: (table: TableLiveStatus) => void;
  variant?: "compact" | "floor";
}) {
  if (tables.length === 0) {
    return <p className="text-sm text-neutral-400 text-center py-10">Belum ada meja terdaftar untuk cabang ini.</p>;
  }

  return (
    <div className="space-y-6">
      {SECTION_ORDER.map((status) => {
        const rows = tables.filter((t) => t.status === status);
        if (rows.length === 0) return null;
        return (
          <div key={status}>
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
              {SECTION_LABEL[status]} <span className="text-neutral-300 font-normal">({rows.length})</span>
            </p>
            <div
              className={
                variant === "floor"
                  ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3"
                  : "flex flex-wrap gap-2"
              }
            >
              {rows.map((t) => (
                <TableCard key={t.table_id} table={t} variant={variant} onClick={() => onSelectTable(t)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
