/**
 * lib/hpp.ts — resolusi HPP per baris transaksi.
 *
 * Urutan fallback (sama dengan dokumen RENCANA_PERBAIKAN):
 *   1. transaction_items.cost_price_snapshot  (paling akurat, diisi trigger)
 *   2. product_branch_cost.cost_price         (HPP khusus cabang)
 *   3. products.cost_price                    (default tenant)
 *   4. 0                                      (belum diisi → ditandai estimasi)
 *
 * Catatan: fungsi ini murni (tanpa akses jaringan) supaya bisa dipakai
 * halaman laporan, export PDF, dan export Excel dengan hasil yang identik.
 */

export type CostSource = "snapshot" | "branch" | "product" | "estimate";

export interface CostProductRow {
  id: string;
  cost_price?: number | null;
}

export interface CostBranchRow {
  product_id: string;
  branch_id: string;
  cost_price: number;
}

export interface CostItemRow {
  qty: number | string;
  product_id?: string | null;
  transaction_id?: string | null;
  cost_price_snapshot?: number | string | null;
  hpp_source?: string | null;
  products?: { name?: string | null; cost_price?: number | string | null } | null;
}

export interface ResolvedCost {
  unitCost: number;
  totalCost: number;
  source: CostSource;
}

export function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Map productId → cost default tenant. */
export function buildProductCostMap(products: CostProductRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of products) map.set(p.id, toNumber(p.cost_price));
  return map;
}

/** Map `${branchId}:${productId}` → cost khusus cabang. */
export function buildBranchCostMap(rows: CostBranchRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) map.set(`${r.branch_id}:${r.product_id}`, toNumber(r.cost_price));
  return map;
}

/**
 * Resolusi biaya satu item transaksi. `branchId = null` berarti laporan
 * konsolidasi: pakai snapshot dulu, lalu HPP produk default tenant (karena
 * satu item memang milik satu cabang, snapshot tetap yang paling benar).
 */
export function resolveItemCost(
  item: CostItemRow,
  productCostMap: Map<string, number>,
  branchCostMap: Map<string, number>,
  branchId: string | null
): ResolvedCost {
  const qty = toNumber(item.qty);
  const snapshot = item.cost_price_snapshot;
  const snapshotNumber = toNumber(snapshot);
  // Snapshot > 0 selalu menang. Snapshot 0 hanya dianggap final bila sumbernya
  // bukan 'estimate' (mis. item gratis yang memang Rp0); kalau estimasi,
  // coba fallback HPP cabang/produk dulu.
  const snapshotFinal =
    snapshot !== null &&
    snapshot !== undefined &&
    (snapshotNumber > 0 || (item.hpp_source !== null && item.hpp_source !== undefined && item.hpp_source !== "estimate"));
  if (snapshotFinal) {
    return { unitCost: snapshotNumber, totalCost: snapshotNumber * qty, source: "snapshot" };
  }

  const productId = item.product_id ?? "";
  const branchCost = branchId ? branchCostMap.get(`${branchId}:${productId}`) : undefined;
  if (branchCost !== undefined && branchCost > 0) {
    return { unitCost: branchCost, totalCost: branchCost * qty, source: "branch" };
  }

  const product = productCostMap.get(productId) ?? toNumber(item.products?.cost_price);
  if (product > 0) {
    return { unitCost: product, totalCost: product * qty, source: "product" };
  }

  return { unitCost: 0, totalCost: 0, source: "estimate" };
}
