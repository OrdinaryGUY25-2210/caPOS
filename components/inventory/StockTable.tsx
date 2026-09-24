"use client";

import { PackagePlus, Pencil, Ban, CheckCircle2, ClipboardList } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import type { Ingredient } from "@/lib/types";
import StockStatusBadge from "./StockStatusBadge";

/**
 * Inventory §7 — tabel bahan baku, dipisah dari app/dashboard/ingredients/page.tsx.
 * Tombol "Opname" (ClipboardList) ditambahkan di sini — sebelumnya opname
 * hanya bisa lewat halaman /dashboard/stock-opname terpisah; sekarang bisa
 * langsung dari baris bahan yang sama tempat Adjust/86/Edit berada.
 */
export default function StockTable({
  rows,
  canWrite,
  isConsolidated,
  branchStockFor,
  costFor,
  onAdjust,
  onOpname,
  onToggle86,
  onEdit,
  onToggleArchive,
}: {
  rows: Ingredient[];
  canWrite: boolean;
  isConsolidated: boolean;
  branchStockFor: (id: string, threshold: number) => { qty: number; low: boolean };
  costFor: (id: string) => number;
  onAdjust: (ing: Ingredient) => void;
  onOpname: (ing: Ingredient) => void;
  onToggle86: (ing: Ingredient) => void;
  onEdit: (ing: Ingredient) => void;
  onToggleArchive: (ing: Ingredient) => void;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 text-left text-neutral-500">
            <th className="p-3 font-medium">Nama</th>
            <th className="p-3 font-medium">Kategori</th>
            <th className="p-3 font-medium">Unit</th>
            <th className="p-3 font-medium">Stok Cabang</th>
            <th className="p-3 font-medium">HPP / unit</th>
            <th className="p-3 font-medium">Status</th>
            <th className="p-3 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((ing) => {
            const { qty, low } = branchStockFor(ing.id, ing.low_stock_threshold);
            return (
              <tr key={ing.id}>
                <td className="p-3 font-medium text-neutral-900">
                  {ing.name}
                  {ing.is_86 && <span className="badge-urgent ml-2 text-xs">86 (Habis Sementara)</span>}
                </td>
                <td className="p-3 text-neutral-500">{ing.category || "—"}</td>
                <td className="p-3 text-neutral-500">{ing.purchase_unit} → {ing.inventory_unit}</td>
                <td className="p-3">
                  <StockStatusBadge qty={qty} unit={ing.inventory_unit} low={low} />
                </td>
                <td className="p-3">{formatRupiah(costFor(ing.id))}</td>
                <td className="p-3">
                  <span className={ing.status === "active" ? "badge-active" : "bg-neutral-100 text-neutral-500 text-xs font-medium px-2 py-0.5 rounded-full"}>
                    {ing.status === "active" ? "Aktif" : "Diarsipkan"}
                  </span>
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  {canWrite && (
                    <>
                      <button onClick={() => onAdjust(ing)} disabled={isConsolidated} className="text-primary-dark hover:bg-primary-light rounded-lg p-1.5 mr-1 disabled:opacity-30" title="Sesuaikan Stok">
                        <PackagePlus size={16} />
                      </button>
                      <button onClick={() => onOpname(ing)} disabled={isConsolidated} className="text-neutral-500 hover:bg-neutral-100 rounded-lg p-1.5 mr-1 disabled:opacity-30" title="Stok Opname">
                        <ClipboardList size={16} />
                      </button>
                      <button onClick={() => onToggle86(ing)} className="text-neutral-500 hover:bg-neutral-100 rounded-lg p-1.5 mr-1" title={ing.is_86 ? "Tandai tersedia lagi" : "Tandai habis sementara (86)"}>
                        {ing.is_86 ? <CheckCircle2 size={16} /> : <Ban size={16} />}
                      </button>
                      <button onClick={() => onEdit(ing)} className="text-neutral-500 hover:bg-neutral-100 rounded-lg p-1.5 mr-1" title="Edit">
                        <Pencil size={16} />
                      </button>
                      <button onClick={() => onToggleArchive(ing)} className="text-neutral-400 hover:bg-neutral-100 rounded-lg p-1.5 text-xs" title={ing.status === "active" ? "Arsipkan" : "Aktifkan"}>
                        {ing.status === "active" ? "Arsipkan" : "Aktifkan"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="p-8 text-center text-neutral-400">
                Belum ada bahan baku yang cocok.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
