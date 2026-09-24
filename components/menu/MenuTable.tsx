"use client";

import { Pencil, Settings2 } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import type { Product } from "@/lib/types";
import ProductStatusBadge from "./ProductStatusBadge";

/**
 * Menu Management §6 — "Product list" sebagai tabel (bukan grid kartu).
 * Sebelumnya /dashboard/menu cuma punya 1 tampilan (grid foto besar) —
 * bagus untuk kasir tapi lambat dipindai Owner yang mau lihat harga &
 * status puluhan menu sekaligus. Ini alternatifnya, lebih padat.
 */
export default function MenuTable({
  products,
  onEdit,
  onConfigure,
  onToggleAvailability,
}: {
  products: Product[];
  onEdit: (p: Product) => void;
  onConfigure: (p: Product) => void;
  onToggleAvailability: (p: Product) => void;
}) {
  if (products.length === 0) {
    return <p className="text-center text-neutral-400 py-10">Tidak ada menu yang cocok dengan pencarian/filter.</p>;
  }

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
            <th className="py-2.5 px-4 font-medium">Menu</th>
            <th className="py-2.5 px-4 font-medium">Kategori</th>
            <th className="py-2.5 px-4 font-medium">Harga</th>
            <th className="py-2.5 px-4 font-medium">Status</th>
            <th className="py-2.5 px-4 font-medium text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50/60">
              <td className="py-2.5 px-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-neutral-100 flex items-center justify-center text-base shrink-0 overflow-hidden">
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      "☕"
                    )}
                  </div>
                  <span className="font-medium text-neutral-900 truncate">{p.name || "Tanpa nama"}</span>
                </div>
              </td>
              <td className="py-2.5 px-4 text-neutral-500">{p.category}</td>
              <td className="py-2.5 px-4 font-semibold text-neutral-900">{formatRupiah(p.price)}</td>
              <td className="py-2.5 px-4">
                <button onClick={() => onToggleAvailability(p)}>
                  <ProductStatusBadge isAvailable={p.is_available} />
                </button>
              </td>
              <td className="py-2.5 px-4">
                <div className="flex items-center justify-end gap-1">
                  <button onClick={() => onConfigure(p)} title="Varian, modifier & resep" className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500">
                    <Settings2 size={14} />
                  </button>
                  <button onClick={() => onEdit(p)} title="Edit produk" className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500">
                    <Pencil size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
