"use client";

import { cx, formatRupiah } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import SoldOutToggle from "@/components/pos/SoldOutToggle";
import type { StockAwareProduct } from "./types";

export default function ProductCard({
  product,
  onAdd,
  onToggleSoldOut,
  saving,
}: {
  product: StockAwareProduct;
  onAdd: (p: StockAwareProduct) => void;
  onToggleSoldOut: (p: StockAwareProduct) => void;
  saving: boolean;
}) {
  const outOfStock = !!product.track_stock && (product.stock_qty ?? 0) <= 0;
  const soldOut = !product.is_available;
  const blocked = outOfStock || soldOut;
  const lowStock = !outOfStock && !!product.track_stock && (product.stock_qty ?? 0) <= (product.low_stock_threshold ?? 5);

  return (
    <div
      role="button"
      tabIndex={blocked ? -1 : 0}
      aria-disabled={blocked}
      onClick={() => !blocked && onAdd(product)}
      onKeyDown={(e) => {
        if (!blocked && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onAdd(product);
        }
      }}
      className={cx(
        "card p-3 text-left transition-all relative select-none touch-manipulation",
        blocked ? "opacity-60 cursor-default" : "hover:border-primary hover:shadow-md active:scale-[0.97] cursor-pointer"
      )}
    >
      <SoldOutToggle
        isAvailable={product.is_available}
        saving={saving}
        onToggle={() => onToggleSoldOut(product)}
        size="sm"
        className="absolute top-1.5 left-1.5 z-10"
      />

      <div className="aspect-square rounded-xl bg-neutral-100 mb-2 flex items-center justify-center text-neutral-300 text-3xl overflow-hidden relative">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          "☕"
        )}
        {soldOut && (
          <div className="absolute inset-0 bg-neutral-900/60 flex items-center justify-center">
            <span className="text-white text-xs font-bold uppercase tracking-wide bg-urgent px-2 py-1 rounded-full">
              Sold Out
            </span>
          </div>
        )}
        {!soldOut && product.track_stock && (
          <span
            className={cx(
              "absolute top-1.5 right-1.5",
              outOfStock || lowStock ? "badge-urgent" : "badge-active"
            )}
          >
            {outOfStock ? "Habis" : `Stok ${product.stock_qty}`}
          </span>
        )}
        {saving && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-primary" />
          </div>
        )}
      </div>

      <p className={cx("text-sm font-semibold line-clamp-2", soldOut ? "text-neutral-400" : "text-neutral-900")}>
        {product.name}
      </p>
      <p className={cx("text-sm font-bold mt-1", soldOut ? "text-neutral-400" : "text-primary")}>
        {formatRupiah(product.price)}
      </p>
    </div>
  );
}