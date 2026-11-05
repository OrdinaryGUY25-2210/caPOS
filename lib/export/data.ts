/**
 * lib/export/data.ts — pengambilan data export caPOS.
 *
 * Semua query memakai RLS pengguna (tanpa service_role). Filter cabang
 * diterapkan pada tabel yang punya kolom branch_id; tabel anak difilter
 * lewat ID induknya supaya tetap konsisten meski RLS longgar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeMetrics } from "@/lib/metrics";
import type { ExportMode, ExportScope, ReportData } from "@/lib/export/types";
import { buildSections } from "@/lib/export/sections";

const CHUNK = 200;

/** View agregat / tabel tanpa kolom id — paginasi tidak boleh `.order("id")`. */
const NO_ID_SOURCES = new Set([
  "best_seller_analytics",
  "peak_hours_analytics",
  "channel_commission_report",
  "daily_sales_analytics",
  "referrals",
]);

export interface FetchOptions {
  tenantId: string;
  branchId: string | null;
  branchName: string;
  cafeName: string;
  startISO: string;
  endISO: string;
  startLabel: string;
  endLabel: string;
  tier: string;
  role: string;
  mode: ExportMode;
  onProgress?: (message: string, pct: number) => void;
}

const BRANCH_TABLES = new Set([
  "transactions",
  "orders",
  "refunds",
  "qr_orders",
  "stock_opname_logs",
  "stock_opnames",
  "waste_logs",
  "ingredient_waste_logs",
  "recipe_consumption_logs",
  "purchase_orders",
  "goods_receipts",
  "customers",
  "vouchers",
  "shifts",
  "cash_movements",
  "reservations",
  "expenses",
  "branch_ingredients_stock",
  "product_branch_cost",
  "ingredient_stock_movements",
  "ingredient_stock_opname_logs",
]);

function emptyRaw(): ReportData["raw"] {
  return {
    transactions: [],
    items: [],
    payments: [],
    orders: [],
    orderItems: [],
    refunds: [],
    qrOrders: [],
    products: [],
    branches: [],
    branchCosts: [],
    variants: [],
    modifiers: [],
    recipes: [],
    recipeItems: [],
    ingredients: [],
    branchIngredients: [],
    consumption: [],
    stockOpnames: [],
    stockOpnameItems: [],
    stockOpnameLogs: [],
    wasteLogs: [],
    ingredientWasteLogs: [],
    suppliers: [],
    purchaseOrders: [],
    poItems: [],
    goodsReceipts: [],
    grnItems: [],
    customers: [],
    memberships: [],
    vouchers: [],
    voucherBranches: [],
    voucherRedemptions: [],
    promotions: [],
    referrals: [],
    profiles: [],
    shifts: [],
    attendance: [],
    cashMovements: [],
    reservations: [],
    expenses: [],
    viewDaily: [],
    viewBestSeller: [],
    viewProfitability: [],
    viewPeak: [],
    viewChannel: [],
    menuEngineering: [],
  };
}

export async function fetchReportData(
  supabase: SupabaseClient,
  opts: FetchOptions
): Promise<ReportData> {
  const warnings: string[] = [];
  const raw = emptyRaw();
  const isFull = opts.mode === "full";

  const report = (msg: string, pct: number) => opts.onProgress?.(msg, pct);

  async function safe(label: string, query: any, quiet = false): Promise<any[]> {
    try {
      const { data, error } = await query;
      if (error) {
        if (!quiet) warnings.push(`${label}: ${error.message}`);
        return [];
      }
      return data ?? [];
    } catch (err: any) {
      if (!quiet) warnings.push(`${label}: ${err?.message ?? String(err)}`);
      return [];
    }
  }

  function scoped(table: string) {
    let q: any = supabase.from(table).select("*").eq("tenant_id", opts.tenantId);
    if (opts.branchId && BRANCH_TABLES.has(table)) {
      q = q.eq("branch_id", opts.branchId);
    }
    return q;
  }

  /**
   * Ambil SEMUA baris pada rentang tanggal dengan paginasi eksplisit.
   * PostgREST membatasi jumlah baris per request (default Supabase 1000),
   * jadi `.limit(20000)` saja TIDAK cukup — harus `.range()` berulang.
   */
  async function fetchRanged(
    label: string,
    table: string,
    column = "created_at",
    limit = 20000,
    quiet = false
  ): Promise<any[]> {
    const PAGE = 1000;
    const out: any[] = [];
    let offset = 0;
    while (out.length < limit) {
      const take = Math.min(PAGE, limit - out.length);
      try {
        let q: any = scoped(table)
          .gte(column, opts.startISO)
          .lte(column, opts.endISO)
          .order(column, { ascending: true });
        if (!NO_ID_SOURCES.has(table)) q = q.order("id", { ascending: true });
        const { data, error } = await q.range(offset, offset + take - 1);
        if (error) {
          if (!quiet) warnings.push(`${label}: ${error.message}`);
          break;
        }
        const rows = data ?? [];
        out.push(...rows);
        if (rows.length < take) break;
        offset += rows.length;
      } catch (err: any) {
        if (!quiet) warnings.push(`${label}: ${err?.message ?? String(err)}`);
        break;
      }
    }
    return out.slice(0, limit);
  }

  async function fetchScopedAll(
    label: string,
    table: string,
    limit = 5000,
    quiet = true,
    orderColumn?: string
  ): Promise<any[]> {
    const PAGE = 1000;
    const out: any[] = [];
    let offset = 0;
    while (out.length < limit) {
      const take = Math.min(PAGE, limit - out.length);
      let q: any = scoped(table);
      if (orderColumn) {
        q = q.order(orderColumn, { ascending: true });
        if (!NO_ID_SOURCES.has(table)) q = q.order("id", { ascending: true });
      } else if (!NO_ID_SOURCES.has(table)) {
        q = q.order("id", { ascending: true });
      }
      try {
        const { data, error } = await q.range(offset, offset + take - 1);
        if (error) {
          if (!quiet) warnings.push(`${label}: ${error.message}`);
          break;
        }
        const rows = data ?? [];
        out.push(...rows);
        if (rows.length < take) break;
        offset += rows.length;
      } catch (err: any) {
        if (!quiet) warnings.push(`${label}: ${err?.message ?? String(err)}`);
        break;
      }
    }
    return out.slice(0, limit);
  }

  async function fetchIn(
    table: string,
    column: string,
    ids: string[],
    limit = 40000
  ): Promise<any[]> {
    if (ids.length === 0) return [];
    const PAGE = 1000;
    const out: any[] = [];
    for (let i = 0; i < ids.length && out.length < limit; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      let offset = 0;
      while (out.length < limit) {
        const take = Math.min(PAGE, limit - out.length);
        try {
          const { data, error } = await supabase
            .from(table)
            .select("*")
            .in(column, slice)
            .order("id", { ascending: true })
            .range(offset, offset + take - 1);
          if (error) break;
          const rows = data ?? [];
          out.push(...rows);
          if (rows.length < take) break;
          offset += rows.length;
        } catch {
          break;
        }
      }
    }
    return out.slice(0, limit);
  }

  // ---------------------------------------------------------------- inti
  report("Mengambil transaksi & item penjualan…", 10);

  const [transactions, products, profiles, orders, branches] = await Promise.all([
    fetchRanged("transaksi", "transactions", "created_at", 20000, false),
    fetchScopedAll("produk", "products", 5000, false, "name"),
    safe(
      "karyawan",
      supabase
        .from("profiles")
        .select("id, full_name, role, job_title, branch_id, is_active")
        .eq("tenant_id", opts.tenantId)
        .limit(2000),
      false
    ),
    fetchRanged("order", "orders", "created_at", 20000, false),
    safe(
      "cabang",
      supabase
        .from("branches")
        .select("id, name, slug, address, is_main, is_active")
        .eq("tenant_id", opts.tenantId)
        .order("is_main", { ascending: false }),
      false
    ),
  ]);

  const txIds = transactions.map((t: any) => t.id).filter(Boolean);
  const orderIds = orders.map((o: any) => o.id).filter(Boolean);

  report("Mengambil rincian item & pembayaran…", 25);

  const [itemsRaw, payments, branchCosts] = await Promise.all([
    fetchIn("transaction_items", "transaction_id", txIds, 40000),
    fetchIn("transaction_payments", "transaction_id", txIds, 40000),
    fetchScopedAll("hpp cabang", "product_branch_cost", 5000, !isFull),
  ]);

  report("Mengambil susut stok & opname…", 40);

  const [stockOpnameLogs, wasteLogs, ingredientWasteLogs, consumption, stockOpnames] = await Promise.all([
    fetchRanged("stok opname", "stock_opname_logs", "created_at", 20000, false),
    fetchRanged("waste", "waste_logs", "created_at", 20000, false),
    fetchRanged("waste bahan", "ingredient_waste_logs", "created_at", 20000, true),
    fetchRanged("konsumsi resep", "recipe_consumption_logs", "created_at", 20000, false),
    // Opname bahan baku (fitur aktif sejak migration_16). Header menyimpan
    // total_loss_value sehingga tidak perlu menarik semua item untuk metrik.
    fetchRanged("opname", "stock_opnames", "created_at", 5000, false),
  ]);

  // Biaya operasional diambil untuk SEMUA mode supaya "Laba Bersih" di PDF
  // sama dengan RPC get_profit_report dan Excel dashboard. Bila RLS menolak
  // (mis. kasir), query gagal senyap dan opex dianggap 0.
  const expenses = await fetchRanged("biaya operasional", "expenses", "expense_date", 20000, true);

  // ---------------------------------------------------------------- lengkap
  if (isFull) {
    report("Mengambil data katalog, inventori, dan purchasing…", 55);

    const [orderItems, refunds, qrOrders, variants, modifiers, recipes, recipeItems, ingredients, branchIngredients] =
      await Promise.all([
        fetchIn("order_items", "order_id", orderIds, 20000),
        fetchRanged("refund", "refunds", "created_at", 10000, true),
        fetchRanged("qr order", "qr_orders", "created_at", 10000, true),
        fetchScopedAll("varian", "product_variants", 5000, true),
        fetchScopedAll("modifier", "modifiers", 5000, true),
        fetchScopedAll("resep", "recipes", 5000, true),
        fetchScopedAll("item resep", "recipe_items", 10000, true),
        fetchScopedAll("bahan", "ingredients", 5000, true),
        fetchScopedAll("stok bahan", "branch_ingredients_stock", 10000, true),
      ]);

    const stockOpnameIds = stockOpnames.map((r: any) => r.id).filter(Boolean);
    const stockOpnameItems = await fetchIn("stock_opname_items", "opname_id", stockOpnameIds, 10000);

    report("Mengambil purchasing, pelanggan, dan operasional…", 70);

    const [ingredientWasteLogsFull, suppliers, purchaseOrders, goodsReceipts, customers, memberships, vouchers, promotions, referrals] =
      await Promise.all([
        Promise.resolve(ingredientWasteLogs),
        fetchScopedAll("pemasok", "suppliers", 2000, true),
        fetchScopedAll("purchase order", "purchase_orders", 5000, true),
        fetchScopedAll("goods receipt", "goods_receipts", 5000, true),
        fetchScopedAll("pelanggan", "customers", 5000, true),
        fetchScopedAll("membership", "memberships", 5000, true),
        fetchScopedAll("voucher", "vouchers", 2000, true),
        fetchScopedAll("promosi", "promotions", 2000, true),
        fetchScopedAll("referral", "referrals", 2000, true),
      ]);

    // voucher_redemptions tidak punya tenant_id/branch_id — ambil lewat
    // voucher_id milik tenant ini, lalu batasi tanggal di klien.
    const voucherIds = vouchers.map((v: any) => v.id).filter(Boolean);
    const voucherRedemptions = (
      await fetchIn("voucher_redemptions", "voucher_id", voucherIds, 20000)
    ).filter((r: any) => {
      const at = r.redeemed_at ? new Date(r.redeemed_at).getTime() : 0;
      return at >= new Date(opts.startISO).getTime() && at <= new Date(opts.endISO).getTime();
    });
    const voucherBranches = await fetchIn("voucher_branches", "voucher_id", voucherIds, 10000);

    const poIds = purchaseOrders.map((r: any) => r.id).filter(Boolean);
    const grIds = goodsReceipts.map((r: any) => r.id).filter(Boolean);
    const [poItems, grnItems] = await Promise.all([
      fetchIn("po_items", "po_id", poIds, 10000),
      fetchIn("grn_items", "grn_id", grIds, 10000),
    ]);

    const [shifts, attendance, cashMovements, reservations] = await Promise.all([
      fetchRanged("shift", "shifts", "opened_at", 5000, true),
      fetchScopedAll("kehadiran", "attendance", 5000, true),
      fetchRanged("kas", "cash_movements", "created_at", 5000, true),
      fetchRanged("reservasi", "reservations", "reservation_at", 5000, true),
    ]);

    report("Mengambil data analitik…", 85);

    const [viewDaily, viewBestSeller, viewProfitability, viewPeak, viewChannel, menuEngineering] =
      await Promise.all([
        fetchRanged("analitik harian", "daily_sales_analytics", "sale_date", 10000, true),
        fetchScopedAll("menu terlaris", "best_seller_analytics", 5000, true),
        fetchScopedAll("profitabilitas", "product_profitability", 5000, true),
        fetchScopedAll("jam sibuk", "peak_hours_analytics", 2000, true),
        fetchScopedAll("komisi channel", "channel_commission_report", 5000, true),
        (async () => {
          try {
            const { data, error } = await supabase.rpc("menu_engineering_report", {
              p_tenant_id: opts.tenantId,
              p_branch_id: opts.branchId,
              p_date_from: opts.startLabel,
              p_date_to: opts.endLabel,
            });
            if (error) return [];
            return data ?? [];
          } catch {
            return [];
          }
        })(),
      ]);

    raw.orderItems = orderItems;
    raw.refunds = refunds;
    raw.qrOrders = qrOrders;
    raw.variants = variants;
    raw.modifiers = modifiers;
    raw.recipes = recipes;
    raw.recipeItems = recipeItems;
    raw.ingredients = ingredients;
    raw.branchIngredients = branchIngredients;
    raw.stockOpnames = stockOpnames;
    raw.stockOpnameItems = stockOpnameItems;
    raw.ingredientWasteLogs = ingredientWasteLogsFull;
    raw.suppliers = suppliers;
    raw.purchaseOrders = purchaseOrders;
    raw.poItems = poItems;
    raw.goodsReceipts = goodsReceipts;
    raw.grnItems = grnItems;
    raw.customers = customers;
    raw.memberships = memberships;
    raw.vouchers = vouchers;
    raw.voucherBranches = voucherBranches;
    raw.voucherRedemptions = voucherRedemptions;
    raw.promotions = promotions;
    raw.referrals = referrals;
    raw.shifts = shifts;
    raw.attendance = attendance;
    raw.cashMovements = cashMovements;
    raw.reservations = reservations;
    raw.viewDaily = viewDaily;
    raw.viewBestSeller = viewBestSeller;
    raw.viewProfitability = viewProfitability;
    raw.viewPeak = viewPeak;
    raw.viewChannel = viewChannel;
    raw.menuEngineering = menuEngineering;
  }

  raw.transactions = transactions;
  raw.items = itemsRaw;
  raw.payments = payments;
  raw.orders = orders;
  raw.products = products;
  raw.branches = branches;
  raw.branchCosts = branchCosts;
  raw.consumption = consumption;
  raw.stockOpnameLogs = stockOpnameLogs;
  raw.stockOpnames = stockOpnames;
  raw.wasteLogs = wasteLogs;
  raw.ingredientWasteLogs = ingredientWasteLogs;
  raw.profiles = profiles;
  raw.expenses = expenses;

  const metrics = computeMetrics({
    transactions,
    items: itemsRaw,
    products,
    branchCosts,
    branchId: opts.branchId,
    stockOpnameLogs,
    stockOpnames,
    wasteLogs,
    ingredientWasteLogs,
    orders,
    expenses,
    includeOpex: true,
  });

  if (transactions.length >= 20000) {
    warnings.push("Transaksi mencapai batas 20.000 baris — export dibatasi. Persempit periode atau pilih satu cabang.");
  }
  if (itemsRaw.length >= 40000) {
    warnings.push("Item transaksi mencapai batas 40.000 baris — rincian item dipotong.");
  }
  if (metrics.hppEstimasiItem > 0) {
    warnings.push(
      `${metrics.hppEstimasiItem} dari ${itemsRaw.length} item belum punya snapshot HPP. Angka HPP memakai fallback dan ditandai estimasi.`
    );
  }

  const scope: ExportScope = {
    tenantId: opts.tenantId,
    branchId: opts.branchId,
    branchName: opts.branchName,
    cafeName: opts.cafeName,
    startISO: opts.startISO,
    endISO: opts.endISO,
    startLabel: opts.startLabel,
    endLabel: opts.endLabel,
    tier: opts.tier,
    role: opts.role,
    generatedAt: new Date().toISOString(),
  };

  const sections = buildSections({ scope, mode: opts.mode, metrics, raw, warnings });

  report("Menyiapkan laporan…", 95);

  return { scope, mode: opts.mode, metrics, sections, raw, warnings };
}
