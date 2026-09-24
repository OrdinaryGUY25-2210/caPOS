"use client";

import { Plus, Pencil, CheckCircle2, XCircle } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import type { Product, ProductVariant, Recipe } from "@/lib/types";
import { SkeletonList } from "@/components/Skeleton";

/**
 * Variant & Modifier §5 — tabel varian utk 1 menu terpilih, dipisah dari
 * app/dashboard/variants/page.tsx. Kolom "Resep" langsung menandai varian
 * yang belum terhubung ke resep manapun — satu sinyal yang sama dipakai
 * ProductConfigModal di Menu, supaya "varian tanpa resep" gampang
 * ditemukan dari 2 pintu berbeda.
 */
export default function VariantTable({
  product,
  variants,
  recipesByVariant,
  loading,
  canWrite,
  onAdd,
  onEdit,
  onToggleAvailable,
}: {
  product: Product;
  variants: ProductVariant[];
  recipesByVariant: Map<string | null, Recipe>;
  loading: boolean;
  canWrite: boolean;
  onAdd: () => void;
  onEdit: (v: ProductVariant) => void;
  onToggleAvailable: (v: ProductVariant) => void;
}) {
  return (
    <div className="card overflow-x-auto">
      <div className="flex items-center justify-between p-4 border-b border-neutral-100">
        <div>
          <p className="font-semibold text-neutral-900">{product.name}</p>
          <p className="text-xs text-neutral-400">Harga dasar (tanpa varian): {formatRupiah(product.price)}</p>
        </div>
        {canWrite && (
          <button onClick={onAdd} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus size={16} /> Tambah Varian
          </button>
        )}
      </div>

      {loading ? (
        <div className="p-4">
          <SkeletonList rows={3} withAvatar={false} />
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-left text-neutral-500">
              <th className="p-3 font-medium">Varian</th>
              <th className="p-3 font-medium">SKU</th>
              <th className="p-3 font-medium">Harga</th>
              <th className="p-3 font-medium">HPP</th>
              <th className="p-3 font-medium">Resep</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {variants.map((v) => {
              const hasRecipe = recipesByVariant.has(v.id);
              return (
                <tr key={v.id}>
                  <td className="p-3 font-medium text-neutral-900">{v.name}</td>
                  <td className="p-3 text-neutral-500">{v.sku || "—"}</td>
                  <td className="p-3">{formatRupiah(v.price)}</td>
                  <td className="p-3">{v.cost_price ? formatRupiah(v.cost_price) : "—"}</td>
                  <td className="p-3">
                    {hasRecipe ? <span className="badge-active">Ada resep</span> : <span className="text-neutral-400 text-xs">Belum ada</span>}
                  </td>
                  <td className="p-3">
                    <button onClick={() => onToggleAvailable(v)} disabled={!canWrite} className="flex items-center gap-1">
                      {v.is_available ? <CheckCircle2 size={16} className="text-primary-dark" /> : <XCircle size={16} className="text-neutral-300" />}
                      <span className={v.is_available ? "text-primary-dark text-xs" : "text-neutral-400 text-xs"}>
                        {v.is_available ? "Aktif" : "Nonaktif"}
                      </span>
                    </button>
                  </td>
                  <td className="p-3 text-right">
                    {canWrite && (
                      <button onClick={() => onEdit(v)} className="text-neutral-500 hover:bg-neutral-100 rounded-lg p-1.5" title="Edit">
                        <Pencil size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {variants.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-neutral-400">
                  Menu ini belum punya varian. Tanpa varian, menu dianggap satu ukuran (resep langsung ke menu ini di halaman
                  Resep).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
