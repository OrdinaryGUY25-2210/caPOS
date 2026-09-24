/**
 * Inventory §7 — badge angka stok, dipakai konsisten di StockTable &
 * IngredientCard (sebelumnya style `badge-urgent`/`badge-active` ditulis
 * ulang inline di /dashboard/ingredients maupun /dashboard/stock).
 */
export default function StockStatusBadge({ qty, unit, low }: { qty: number; unit: string; low: boolean }) {
  return <span className={low ? "badge-urgent" : "badge-active"}>{qty} {unit}</span>;
}
