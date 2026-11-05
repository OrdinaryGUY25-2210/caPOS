/**
 * lib/metrics.ts — definisi tunggal metrik laporan caPOS.
 *
 * Dipakai oleh halaman Laporan & Omzet, Laporan PDF, dan Export Excel supaya
 * angka tidak pernah berbeda antar halaman untuk periode & cabang yang sama.
 *
 * Definisi resmi:
 *   Omzet          = Σ transactions.total_amount
 *   Subtotal       = Σ transactions.subtotal_amount (fallback total_amount)
 *   Diskon         = Σ transactions.discount_amount
 *   HPP            = Σ (qty × unit cost) memakai resolusi lib/hpp.ts
 *   Laba Kotor     = Omzet − HPP
 *   Susut Stok     = Σ stock_opnames.total_loss_value
 *                    + Σ stock_opname_logs.loss_value (legacy)
 *                    + Σ waste_logs.total_loss_amount
 *                    + Σ ingredient_waste_logs.total_loss_amount
 *   Komisi Channel = Σ orders.channel_commission_amount
 *   OPEX           = Σ expenses.amount (status disetujui, bila modul aktif)
 *   Laba Bersih    = Laba Kotor − Susut − Komisi − OPEX
 */

import {
  buildBranchCostMap,
  buildProductCostMap,
  resolveItemCost,
  toNumber,
  type CostBranchRow,
  type CostItemRow,
  type CostProductRow,
} from "@/lib/hpp";

export interface MetricArgs {
  transactions: any[];
  items: CostItemRow[];
  products: CostProductRow[];
  branchCosts?: CostBranchRow[];
  branchId?: string | null;
  stockOpnameLogs?: any[];
  stockOpnames?: any[];
  wasteLogs?: any[];
  ingredientWasteLogs?: any[];
  orders?: any[];
  expenses?: any[];
  includeOpex?: boolean;
}

export interface ReportMetrics {
  omzet: number;
  subtotal: number;
  diskon: number;
  hpp: number;
  labaKotor: number;
  susutStok: number;
  komisiChannel: number;
  opex: number;
  labaBersih: number;
  marginKotorPct: number;
  aov: number;
  totalTransaksi: number;
  itemTerjual: number;
  hppEstimasiItem: number;
  totalItem: number;
  hppAktual: boolean;
}

export function computeMetrics(args: MetricArgs): ReportMetrics {
  const productCostMap = buildProductCostMap(args.products ?? []);
  const branchCostMap = buildBranchCostMap(args.branchCosts ?? []);
  const branchId = args.branchId ?? null;

  const omzet = (args.transactions ?? []).reduce((s, t) => s + toNumber(t.total_amount), 0);
  const subtotal = (args.transactions ?? []).reduce(
    (s, t) => s + toNumber(t.subtotal_amount ?? t.total_amount),
    0
  );
  const diskon = (args.transactions ?? []).reduce((s, t) => s + toNumber(t.discount_amount), 0);

  let hpp = 0;
  let itemTerjual = 0;
  let hppEstimasiItem = 0;
  const txBranch = new Map<string, string | null>();
  for (const t of args.transactions ?? []) {
    if (t?.id) txBranch.set(t.id, t.branch_id ?? null);
  }
  for (const item of args.items ?? []) {
    // Konsolidasi: pakai cabang transaksi item agar HPP khusus cabang tetap
    // terpakai saat snapshot belum ada.
    const itemBranch =
      branchId ?? (item.transaction_id ? txBranch.get(item.transaction_id) ?? null : null);
    const resolved = resolveItemCost(item, productCostMap, branchCostMap, itemBranch);
    hpp += resolved.totalCost;
    itemTerjual += toNumber(item.qty);
    if (resolved.source === "estimate") hppEstimasiItem += 1;
  }

  const susutOpname = (args.stockOpnameLogs ?? []).reduce((s, r) => s + toNumber(r.loss_value), 0);
  const susutOpnameHeader = (args.stockOpnames ?? []).reduce(
    (s, r) => s + toNumber(r.total_loss_value),
    0
  );
  const susutWaste = (args.wasteLogs ?? []).reduce((s, r) => s + toNumber(r.total_loss_amount), 0);
  const susutWasteBahan = (args.ingredientWasteLogs ?? []).reduce(
    (s, r) => s + toNumber(r.total_loss_amount ?? r.loss_value),
    0
  );
  const susutStok = susutOpname + susutOpnameHeader + susutWaste + susutWasteBahan;

  const komisiChannel = (args.orders ?? []).reduce(
    (s, o) => s + toNumber(o.channel_commission_amount),
    0
  );

  const opex = args.includeOpex
    ? (args.expenses ?? [])
        .filter((e) => {
          if (e.voided_at) return false;
          const status = String(e.status ?? "APPROVED").toUpperCase();
          return status === "APPROVED" || status === "PAID";
        })
        .reduce((s, e) => s + toNumber(e.amount), 0)
    : 0;

  const labaKotor = omzet - hpp;
  const labaBersih = labaKotor - susutStok - komisiChannel - opex;
  const totalTransaksi = (args.transactions ?? []).length;
  const totalItem = (args.items ?? []).reduce((s, i) => s + toNumber(i.qty), 0);

  return {
    omzet,
    subtotal,
    diskon,
    hpp,
    labaKotor,
    susutStok,
    komisiChannel,
    opex,
    labaBersih,
    marginKotorPct: omzet > 0 ? (labaKotor / omzet) * 100 : 0,
    aov: totalTransaksi > 0 ? omzet / totalTransaksi : 0,
    totalTransaksi,
    itemTerjual,
    hppEstimasiItem,
    totalItem,
    hppAktual: (args.items ?? []).length > 0 && hppEstimasiItem === 0,
  };
}
