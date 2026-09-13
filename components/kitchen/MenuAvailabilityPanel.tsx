"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import Modal from "@/components/Modal";
import SoldOutToggle from "@/components/pos/SoldOutToggle";
import { cx } from "@/lib/utils";
import type { Product } from "@/lib/types";

/**
 * Panel "Kelola Ketersediaan Menu" — dibuka dari header KDS. Dapur biasanya
 * yang PERTAMA tahu kalau satu item bahan bakunya habis di tengah jam
 * sibuk (bukan kasir), jadi toggle Sold Out/Menu 86 disediakan langsung
 * di layar ini, bukan cuma di /pos atau /dashboard/menu. Perubahan di sini
 * langsung tersinkron ke POS lain lewat channel realtime yang sama
 * (lihat lib/useProductAvailabilityChannel.ts).
 */
export default function MenuAvailabilityPanel({
  products,
  savingIds,
  onToggle,
  onClose,
}: {
  products: Product[];
  /** id produk yang sedang dalam proses update (tampilkan spinner, cegah double-tap). */
  savingIds: Set<string>;
  onToggle: (product: Product) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, search]);

  const soldOutCount = products.filter((p) => !p.is_available).length;

  return (
    <Modal title="Kelola Ketersediaan Menu" onClose={onClose} maxWidth="sm:max-w-md">
      <p className="text-xs text-neutral-500 -mt-2">
        Tandai item yang bahan bakunya habis — status tersinkron langsung ke semua kasir dan otomatis memblokir pemesanan lewat QR Self-Order.
        {soldOutCount > 0 && <span className="text-urgent font-medium"> {soldOutCount} item sedang Sold Out.</span>}
      </p>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari menu..."
          className="input-field pl-9 text-sm"
          autoFocus
        />
      </div>

      <div className="space-y-1.5 max-h-[50vh] overflow-y-auto -mx-1 px-1">
        {filtered.length === 0 && <p className="text-center text-neutral-400 text-sm py-8">Menu tidak ditemukan.</p>}
        {filtered.map((product) => (
          <div
            key={product.id}
            className={cx(
              "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
              product.is_available ? "border-neutral-200 bg-white" : "border-urgent/30 bg-red-50"
            )}
          >
            <div className="flex-1 min-w-0">
              <p className={cx("text-sm font-medium truncate", product.is_available ? "text-neutral-900" : "text-neutral-500 line-through")}>
                {product.name}
              </p>
              <p className="text-xs text-neutral-400">{product.category}</p>
            </div>
            {!product.is_available && <span className="badge-urgent shrink-0">Sold Out</span>}
            <SoldOutToggle
              isAvailable={product.is_available}
              saving={savingIds.has(product.id)}
              onToggle={() => onToggle(product)}
            />
          </div>
        ))}
      </div>
    </Modal>
  );
}
