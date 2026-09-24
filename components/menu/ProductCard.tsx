"use client";

import { Pencil, Settings2 } from "lucide-react";
import { formatRupiah, cx } from "@/lib/utils";
import type { Product } from "@/lib/types";

/**
 * Menu Management §6 — kartu grid 1 produk. Dulu ditulis inline di
 * app/dashboard/menu/page.tsx; sekarang dipisah supaya bisa dipakai ulang
 * (mis. kalau nanti ada grid produk di halaman lain) tanpa copy-paste JSX.
 */
export default function ProductCard({
  product,
  onEdit,
  onConfigure,
  onToggleAvailability,
}: {
  product: Product;
  onEdit: () => void;
  onConfigure: () => void;
  onToggleAvailability: () => void;
}) {
  return (
    <div className="card p-3">
      <div className="aspect-square rounded-xl bg-neutral-100 mb-2 flex items-center justify-center text-3xl text-neutral-300 relative overflow-hidden">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          "☕"
        )}
        {product.id.startsWith("local-") && (
          <span className="absolute top-2 left-2 badge-warning text-[10px]">Belum sinkron</span>
        )}
        <div className="absolute top-2 right-2 flex gap-1">
          <button
            onClick={onConfigure}
            title="Varian, modifier & resep"
            className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center shadow-sm hover:bg-white"
          >
            <Settings2 size={12} />
          </button>
          <button
            onClick={onEdit}
            title="Edit produk"
            className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center shadow-sm hover:bg-white"
          >
            <Pencil size={12} />
          </button>
        </div>
      </div>
      <p className="text-sm font-semibold text-neutral-900 truncate">{product.name || "Tanpa nama"}</p>
      <p className="text-xs text-neutral-500">{product.category}</p>
      <p className="text-sm font-bold text-primary mt-1">{formatRupiah(product.price)}</p>

      <button
        onClick={onToggleAvailability}
        className={cx(
          "mt-2 w-full text-xs font-medium py-1.5 rounded-lg transition-colors",
          product.is_available ? "bg-primary-light text-primary-dark" : "bg-neutral-100 text-neutral-400"
        )}
      >
        {product.is_available ? "Tersedia" : "Habis / Nonaktif"}
      </button>
    </div>
  );
}
