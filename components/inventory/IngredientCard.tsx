"use client";

import { PackagePlus, Pencil, Ban, CheckCircle2, ClipboardList } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import type { Ingredient } from "@/lib/types";
import StockStatusBadge from "./StockStatusBadge";

/**
 * Inventory §7 — kartu bahan baku, alternatif dari baris tabel (sebelumnya
 * /dashboard/ingredients cuma punya 1 tampilan tabel; kartu ini dipakai
 * kalau owner lebih suka scan visual per-bahan, mirip pola grid di Menu).
 */
export default function IngredientCard({
  ingredient,
  qty,
  low,
  costPerUnit,
  canWrite,
  onAdjust,
  onOpname,
  onEdit,
  onToggle86,
}: {
  ingredient: Ingredient;
  qty: number;
  low: boolean;
  costPerUnit: number;
  canWrite: boolean;
  onAdjust: () => void;
  onOpname: () => void;
  onEdit: () => void;
  onToggle86: () => void;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900 truncate">{ingredient.name}</p>
          <p className="text-xs text-neutral-500">{ingredient.category || "Tanpa kategori"}</p>
        </div>
        {ingredient.is_86 && <span className="badge-urgent text-[10px] shrink-0">86</span>}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <StockStatusBadge qty={qty} unit={ingredient.inventory_unit} low={low} />
        <span className="text-xs text-neutral-400">{formatRupiah(costPerUnit)}/{ingredient.inventory_unit}</span>
      </div>

      {canWrite && (
        <div className="mt-3 flex items-center gap-1 border-t border-neutral-100 pt-2.5">
          <button onClick={onAdjust} title="Sesuaikan Stok" className="flex-1 flex items-center justify-center py-1.5 rounded-lg text-primary-dark hover:bg-primary-light">
            <PackagePlus size={15} />
          </button>
          <button onClick={onOpname} title="Stok Opname" className="flex-1 flex items-center justify-center py-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100">
            <ClipboardList size={15} />
          </button>
          <button onClick={onToggle86} title={ingredient.is_86 ? "Tandai tersedia" : "Tandai 86"} className="flex-1 flex items-center justify-center py-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100">
            {ingredient.is_86 ? <CheckCircle2 size={15} /> : <Ban size={15} />}
          </button>
          <button onClick={onEdit} title="Edit" className="flex-1 flex items-center justify-center py-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100">
            <Pencil size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
