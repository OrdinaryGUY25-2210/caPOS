"use client";

import { Loader2, XCircle, Calculator, CheckCircle2 } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import type { Product, ProductVariant, Recipe } from "@/lib/types";
import RecipeVersionBadge from "./RecipeVersionBadge";

/**
 * Recipe/BOM §8 — "Recipe summary" + "Cost summary" + "Version/status",
 * dipisah dari app/dashboard/recipes/page.tsx.
 */
export default function RecipeSummary({
  product,
  variant,
  activeRecipe,
  canWrite,
  recipeName,
  yieldQty,
  onNameChange,
  onYieldChange,
  onDeactivate,
}: {
  product: Product;
  variant: ProductVariant | null;
  activeRecipe: Recipe | null;
  canWrite: boolean;
  recipeName: string;
  yieldQty: string;
  onNameChange: (v: string) => void;
  onYieldChange: (v: string) => void;
  onDeactivate: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-neutral-900">
            {product.name}
            {variant && ` — ${variant.name}`}
          </p>
          <RecipeVersionBadge version={activeRecipe?.version ?? null} isActive={!!activeRecipe} />
        </div>
        {activeRecipe && canWrite && (
          <button onClick={onDeactivate} className="text-xs text-urgent font-medium flex items-center gap-1">
            <XCircle size={14} /> Nonaktifkan Resep
          </button>
        )}
      </div>

      {canWrite ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Nama Resep (opsional)</label>
            <input value={recipeName} onChange={(e) => onNameChange(e.target.value)} placeholder="Contoh: Es Kopi Susu Regular" className="input-field" />
          </div>
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 block">Yield (porsi per resep)</label>
            <input
              type="text"
              inputMode="numeric"
              value={yieldQty}
              onChange={(e) => onYieldChange(e.target.value.replace(/[^0-9]/g, ""))}
              className="input-field"
            />
          </div>
        </div>
      ) : (
        <p className="text-neutral-400 text-sm">Hanya manager/owner yang bisa mengubah resep.</p>
      )}
    </>
  );
}

/**
 * Baris aksi (Simpan / Hitung HPP) + hasil Cost summary — dipisah dari blok
 * di atas supaya bisa diletakkan setelah RecipeItemsEditor tanpa keduanya
 * bergantung urutan render satu file besar.
 */
export function RecipeActions({
  activeRecipe,
  saving,
  calculating,
  costPreview,
  yieldQty,
  onSave,
  onCalculateCost,
}: {
  activeRecipe: Recipe | null;
  saving: boolean;
  calculating: boolean;
  costPreview: number | null;
  yieldQty: string;
  onSave: () => void;
  onCalculateCost: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-neutral-100">
      <button disabled={saving} onClick={onSave} className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50">
        {saving && <Loader2 className="animate-spin" size={16} />}
        {activeRecipe ? "Simpan Perubahan Resep" : "Buat & Aktifkan Resep"}
      </button>
      {activeRecipe && (
        <button onClick={onCalculateCost} disabled={calculating} className="btn-outline flex items-center gap-2 text-sm">
          {calculating ? <Loader2 className="animate-spin" size={16} /> : <Calculator size={16} />}
          Hitung HPP
        </button>
      )}
      {costPreview !== null && (
        <div className="flex items-center gap-1 text-sm">
          <CheckCircle2 size={16} className="text-primary-dark" />
          <span className="text-neutral-600">Total HPP resep:</span>
          <span className="font-bold text-neutral-900">{formatRupiah(costPreview)}</span>
          <span className="text-neutral-400">({formatRupiah(costPreview / Math.max(1, Number(yieldQty || 1)))} / porsi)</span>
        </div>
      )}
    </div>
  );
}
