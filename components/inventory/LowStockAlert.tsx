import { AlertTriangle } from "lucide-react";

/**
 * Inventory §7 — banner "N bahan menipis", dipakai di Ingredients & Stock
 * page. `items` opsional: kalau diisi, tampilkan nama-namanya (persis
 * pola yang sudah ada di /dashboard/stock); kalau tidak, cukup jumlahnya
 * saja (pola yang sudah ada di /dashboard/ingredients).
 */
export default function LowStockAlert({ count, items }: { count: number; items?: string[] }) {
  if (count === 0) return null;
  return (
    <div className="card p-4 border-urgent bg-urgent-light/40 flex items-start gap-3">
      <AlertTriangle className="text-urgent shrink-0 mt-0.5" size={18} />
      <div className="text-sm text-neutral-800">
        <p className="font-semibold">{count} {items ? "menu" : "bahan"} stoknya menipis atau habis{items ? ":" : "."}</p>
        {items && items.length > 0 && <p className="text-neutral-600 mt-0.5">{items.join(", ")}</p>}
      </div>
    </div>
  );
}
