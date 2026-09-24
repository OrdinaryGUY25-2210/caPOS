"use client";

import { forwardRef } from "react";
import { Search, PackageOpen } from "lucide-react";
import { cx } from "@/lib/utils";
import ProductCard from "./ProductCard";
import { EmptyState } from "./ui";
import type { StockAwareProduct } from "./types";

const CATEGORIES = ["Semua", "Kopi", "Non-Kopi", "Makanan", "Dessert"];

const ProductGrid = forwardRef<
  HTMLInputElement,
  {
    products: StockAwareProduct[];
    search: string;
    onSearchChange: (v: string) => void;
    category: string;
    onCategoryChange: (v: string) => void;
    onAdd: (p: StockAwareProduct) => void;
    onToggleSoldOut: (p: StockAwareProduct) => void;
    savingIds: Set<string>;
    loading?: boolean;
  }
>(function ProductGrid(
  { products, search, onSearchChange, category, onCategoryChange, onAdd, onToggleSoldOut, savingIds, loading },
  searchRef
) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Cari menu... (F1)"
            aria-label="Cari menu"
            className="input-field pl-10"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto shrink-0 -mx-1 px-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => onCategoryChange(cat)}
              aria-pressed={cat === category}
              className={cx(
                "px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap shrink-0 transition-colors touch-manipulation",
                cat === category
                  ? "bg-primary text-white"
                  : "bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-100"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 overflow-y-auto pb-4">
        {loading &&
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card p-3 animate-pulse">
              <div className="aspect-square rounded-xl bg-neutral-100 mb-2" />
              <div className="h-4 bg-neutral-100 rounded mb-1.5" />
              <div className="h-4 bg-neutral-100 rounded w-2/3" />
            </div>
          ))}
        {!loading &&
          products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onAdd={onAdd}
              onToggleSoldOut={onToggleSoldOut}
              saving={savingIds.has(product.id)}
            />
          ))}
        {!loading && products.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={<PackageOpen size={28} />}
              title={search ? "Menu tidak ditemukan" : "Belum ada menu"}
              description={
                search
                  ? `Tidak ada hasil untuk "${search}". Coba kata kunci lain atau ubah kategori.`
                  : "Tambahkan menu dari Dashboard → Menu supaya bisa dijual di sini."
              }
            />
          </div>
        )}
      </div>
    </div>
  );
});

export default ProductGrid;