"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Ingredient } from "@/lib/types";

export type RecipeItemDraft = { id?: string; ingredient_id: string; quantity: string; unit: string; wastage_percentage: string; notes: string };

/**
 * Recipe/BOM §8 — "Ingredient selector", "Quantity", "Unit" + empty state,
 * dipisah dari app/dashboard/recipes/page.tsx.
 */
export default function RecipeItemsEditor({
  items,
  ingredients,
  onAddRow,
  onUpdateRow,
  onRemoveRow,
}: {
  items: RecipeItemDraft[];
  ingredients: Ingredient[];
  onAddRow: () => void;
  onUpdateRow: (idx: number, patch: Partial<RecipeItemDraft>) => void;
  onRemoveRow: (idx: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-neutral-700">Bahan Baku</label>
        <button onClick={onAddRow} type="button" className="text-xs text-primary-dark font-medium flex items-center gap-1">
          <Plus size={12} /> Tambah Bahan
        </button>
      </div>
      <div className="space-y-2">
        {items.map((it, idx) => {
          const ing = ingredients.find((i) => i.id === it.ingredient_id);
          return (
            <div key={idx} className="flex flex-wrap items-center gap-2 bg-neutral-50 rounded-xl p-2">
              <select
                value={it.ingredient_id}
                onChange={(e) => {
                  const newIng = ingredients.find((i) => i.id === e.target.value);
                  onUpdateRow(idx, { ingredient_id: e.target.value, unit: newIng?.inventory_unit ?? it.unit });
                }}
                className="input-field flex-1 min-w-[140px] text-sm"
              >
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                inputMode="decimal"
                value={it.quantity}
                onChange={(e) => onUpdateRow(idx, { quantity: e.target.value.replace(/[^0-9.]/g, "") })}
                placeholder="Jumlah"
                className="input-field w-20 text-sm"
              />
              <span className="text-xs text-neutral-400 w-12">{ing?.inventory_unit}</span>
              <input
                type="text"
                inputMode="decimal"
                value={it.wastage_percentage}
                onChange={(e) => onUpdateRow(idx, { wastage_percentage: e.target.value.replace(/[^0-9.]/g, "") })}
                placeholder="Waste %"
                title="Persentase waste/susut"
                className="input-field w-20 text-sm"
              />
              <span className="text-xs text-neutral-400">% waste</span>
              <button onClick={() => onRemoveRow(idx)} type="button" className="text-neutral-400 hover:text-urgent ml-auto">
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
        {items.length === 0 && <p className="text-neutral-400 text-sm">Belum ada bahan di resep ini.</p>}
      </div>
    </div>
  );
}
