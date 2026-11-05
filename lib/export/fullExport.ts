"use client";

/**
 * Mode "Semua Data" — seluruh data caPOS pada periode & cabang terpilih,
 * terstruktur per domain A–G (rencana bagian 6.5/6.6/6.7).
 *
 *  - Ambil data lewat RPC get_export_table (pagination, RLS, PII dimask).
 *  - <= 5.000 baris total  : satu PDF penuh.
 *  - >  5.000 baris        : PDF ringkas (maks 500 baris/tabel) + satu file Excel.
 *  - Batas baris per tabel mengikuti tier (Pro 50.000, Supreme 200.000).
 *  Export async (job latar belakang) untuk > 200.000 baris BELUM ada — butuh
 *  infrastruktur di luar repo; data dipotong di batas tier dan ditandai di manifest.
 */
import * as XLSX from "xlsx";

import type { ProfitReport } from "@/lib/types";
import { EXPORT_ROW_LIMIT, type Tier } from "@/lib/tier";
import { hppQuality, metricsFromReport } from "@/lib/metrics";
import { fetchExportTable, getExportCounts, getProfitReport, type ExportTableResult } from "@/lib/exportApi";
import {
  createPdf, drawFooters, drawHeader, ensureSpace, paragraph, pct, rp, sectionTitle, slug, table, ymd, pageH, pageW, type PdfCtx,
} from "@/lib/pdf/common";
import { methodologyNote } from "@/lib/pdf/profitPdf";

export const SCHEMA_VERSION = "capos-export-v1";
export const PDF_FULL_MAX_ROWS = 5_000;
export const PDF_SAMPLE_ROWS = 500;

export interface Domain {
  id: string;
  title: string;
  tables: string[];
}

export const DOMAINS: Domain[] = [
  { id: "A", title: "Bagian A - Penjualan", tables: ["transactions", "transaction_items", "transaction_payments", "orders", "order_items", "qr_orders", "refunds"] },
  { id: "B", title: "Bagian B - Produk & HPP", tables: ["products", "product_branch_cost", "product_variants", "modifier_groups", "modifiers", "recipes", "recipe_items", "ingredients", "unit_conversions", "branch_ingredients_stock", "channel_pricings"] },
  { id: "C", title: "Bagian C - Inventori", tables: ["branch_stock", "stock_movements", "stock_opnames", "stock_opname_items", "stock_opname_logs", "ingredient_stock_movements", "ingredient_stock_opname_logs", "ingredient_waste_logs", "waste_logs", "recipe_consumption_logs"] },
  { id: "D", title: "Bagian D - Purchasing", tables: ["suppliers", "purchase_orders", "po_items", "goods_receipts", "grn_items", "purchase_invoices"] },
  { id: "E", title: "Bagian E - Pelanggan & Loyalty (data pribadi dimask)", tables: ["customers", "memberships", "customer_points", "customer_tiers", "loyalty_points_log", "loyalty_config", "vouchers", "voucher_redemptions", "promotions", "promotion_rules", "referrals", "referral_redemptions"] },
  { id: "F", title: "Bagian F - Operasional & Tim", tables: ["branches", "profiles", "shifts", "attendance", "cash_movements", "reservations", "branch_tables", "expenses", "audit_log"] },
];

export const ALL_TABLE_KEYS = DOMAINS.flatMap((d) => d.tables);

const LABEL: Record<string, string> = {
  transactions: "Transaksi", transaction_items: "Item Transaksi", transaction_payments: "Pembayaran Transaksi", orders: "Order",
  order_items: "Item Order", qr_orders: "Order QR", refunds: "Refund", products: "Menu/Produk", product_branch_cost: "HPP Menu per Cabang",
  product_variants: "Varian", modifier_groups: "Grup Modifier", modifiers: "Modifier", recipes: "Resep", recipe_items: "Bahan Resep",
  ingredients: "Bahan Baku", unit_conversions: "Konversi Satuan", branch_ingredients_stock: "Stok & Harga Bahan per Cabang",
  channel_pricings: "Harga per Kanal", branch_stock: "Stok Produk per Cabang", stock_movements: "Pergerakan Stok", stock_opnames: "Stok Opname",
  stock_opname_items: "Item Stok Opname", stock_opname_logs: "Log Stok Opname", ingredient_stock_movements: "Pergerakan Stok Bahan",
  ingredient_stock_opname_logs: "Log Opname Bahan", ingredient_waste_logs: "Waste Bahan", waste_logs: "Waste Produk",
  recipe_consumption_logs: "Konsumsi Resep", suppliers: "Pemasok", purchase_orders: "Purchase Order", po_items: "Item PO",
  goods_receipts: "Penerimaan Barang (GRN)", grn_items: "Item GRN", purchase_invoices: "Invoice Pembelian", customers: "Pelanggan",
  memberships: "Membership", customer_points: "Poin Pelanggan", customer_tiers: "Tier Pelanggan", loyalty_points_log: "Log Poin Loyalty",
  loyalty_config: "Konfigurasi Loyalty", vouchers: "Voucher", voucher_redemptions: "Pemakaian Voucher", promotions: "Promosi",
  promotion_rules: "Aturan Promosi", referrals: "Referral", referral_redemptions: "Pemakaian Referral", branches: "Cabang",
  profiles: "Karyawan (tanpa PIN)", shifts: "Shift", attendance: "Kehadiran", cash_movements: "Kas Masuk/Keluar",
  reservations: "Reservasi", branch_tables: "Meja", expenses: "Biaya Operasional", audit_log: "Audit Log",
};

/** Kolom ringkas per tabel untuk PDF (Excel selalu memuat SEMUA kolom). */
const COLS: Record<string, string[]> = {
  transactions: ["created_at", "invoice_number", "branch_id", "cashier_id", "payment_method", "subtotal_amount", "discount_amount", "total_amount"],
  transaction_items: ["transaction_id", "product_id", "qty", "unit_price", "subtotal", "cost_price_snapshot", "hpp_source"],
  transaction_payments: ["transaction_id", "method", "amount", "reference_number", "created_at"],
  orders: ["created_at", "order_number", "branch_id", "order_type", "channel", "status", "channel_commission_amount", "manual_discount_amount"],
  order_items: ["order_id", "product_name", "qty", "unit_price", "subtotal", "item_status", "voided_qty"],
  qr_orders: ["created_at", "branch_id", "customer_name", "customer_phone", "payment_method", "payment_status", "total_amount"],
  refunds: ["created_at", "branch_id", "transaction_id", "refund_type", "amount", "reason_category", "status"],
  products: ["name", "category", "price", "cost_price", "track_stock", "stock_mode", "is_available"],
  product_branch_cost: ["branch_id", "product_id", "cost_price", "updated_at"],
  product_variants: ["product_id", "name", "price", "cost_price", "is_available"],
  modifier_groups: ["name", "is_required", "min_select", "max_select"],
  modifiers: ["modifier_group_id", "name", "price_adjustment", "is_available"],
  recipes: ["name", "product_id", "version", "is_active", "yield_quantity"],
  recipe_items: ["recipe_id", "ingredient_id", "quantity", "unit", "wastage_percentage"],
  ingredients: ["name", "category", "inventory_unit", "purchase_unit", "low_stock_threshold", "status"],
  unit_conversions: ["from_unit", "to_unit", "factor"],
  branch_ingredients_stock: ["branch_id", "ingredient_id", "stock_qty", "cost_price", "low_stock_threshold"],
  channel_pricings: ["product_id", "channel", "markup_pct", "commission_pct", "is_active"],
  branch_stock: ["branch_id", "product_id", "stock_qty", "low_stock_threshold"],
  stock_movements: ["created_at", "branch_id", "product_id", "type", "qty_change", "note"],
  stock_opnames: ["created_at", "branch_id", "status", "total_loss_value", "note"],
  stock_opname_items: ["opname_id", "ingredient_id", "system_qty", "physical_qty", "difference_qty", "loss_value", "reason"],
  stock_opname_logs: ["created_at", "branch_id", "product_id", "system_qty", "physical_qty", "difference_qty", "loss_value", "reason"],
  ingredient_stock_movements: ["created_at", "branch_id", "ingredient_id", "type", "qty_change", "unit", "note"],
  ingredient_waste_logs: ["created_at", "branch_id", "ingredient_id", "waste_type", "qty_wasted", "total_loss_amount", "note"],
  waste_logs: ["created_at", "branch_id", "product_name", "waste_type", "qty_wasted", "total_loss_amount", "notes"],
  recipe_consumption_logs: ["created_at", "branch_id", "ingredient_id", "quantity", "unit", "cost_snapshot", "source_type"],
  suppliers: ["supplier_code", "company_name", "contact_person", "phone_number", "bank_name", "bank_account", "is_active"],
  purchase_orders: ["created_at", "po_number", "branch_id", "supplier_id", "status", "subtotal_amount", "tax_amount", "total_amount"],
  po_items: ["po_id", "product_name", "qty_ordered", "qty_received", "unit_price", "subtotal"],
  goods_receipts: ["created_at", "grn_number", "branch_id", "supplier_id", "po_id"],
  grn_items: ["grn_id", "product_name", "qty_received", "unit_price", "actual_cost"],
  purchase_invoices: ["invoice_date", "invoice_number", "supplier_id", "amount", "status", "due_date"],
  customers: ["customer_code", "customer_name", "phone_number", "email", "visit_count", "lifetime_spend", "last_visit_date", "tier_id"],
  memberships: ["member_code", "customer_name", "customer_phone", "discount_percentage", "valid_until", "is_active"],
  customer_points: ["customer_id", "points_balance", "lifetime_earned", "lifetime_redeemed"],
  customer_tiers: ["tier_name", "min_spend_monthly", "discount_percentage", "points_multiplier", "is_active"],
  loyalty_points_log: ["created_at", "customer_id", "transaction_type", "points_amount", "balance_after", "description"],
  loyalty_config: ["points_per_rupiah", "points_expiry_days", "min_points_for_redemption", "is_enabled"],
  vouchers: ["voucher_code", "voucher_name", "discount_type", "discount_value", "usage_count", "usage_limit", "expiry_date"],
  voucher_redemptions: ["redeemed_at", "voucher_id", "customer_id", "discount_given"],
  promotions: ["promo_name", "promo_code", "promo_type", "is_active", "start_date", "end_date"],
  promotion_rules: ["promotion_id", "rule_type", "rule_value"],
  referrals: ["code", "accumulated_uses", "created_at"],
  referral_redemptions: ["code", "reward_granted", "created_at"],
  branches: ["name", "address", "is_main", "is_active"],
  profiles: ["full_name", "role", "job_title", "email", "is_active", "branch_id"],
  shifts: ["opened_at", "closed_at", "branch_id", "cashier_id", "status", "opening_cash", "closing_cash_expected", "closing_cash_actual", "cash_difference"],
  attendance: ["date_start", "employee_id", "type", "status", "reason"],
  cash_movements: ["created_at", "branch_id", "type", "amount", "reason", "created_by"],
  reservations: ["reservation_at", "branch_id", "customer_name", "customer_phone", "party_size", "status", "deposit_amount"],
  branch_tables: ["branch_id", "table_number", "capacity", "is_active"],
  expenses: ["expense_date", "branch_id", "amount", "description", "status"],
  audit_log: ["created_at", "branch_id", "user_id", "action", "entity_type", "reason"],
};

const MONEY_RE = /(amount|price|cost|total|subtotal|spend|discount_given|loss|deposit|cash|_value|omzet|hpp|laba|komisi)/i;
const NOT_MONEY_RE = /(^|_)(pct|percent|percentage|qty|quantity|count|multiplier|factor|visit|points)(_|$)|_id$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

type Row = Record<string, any>;

interface Lookups {
  branch: Map<string, string>;
  user: Map<string, string>;
  product: Map<string, string>;
  ingredient: Map<string, string>;
  supplier: Map<string, string>;
  customer: Map<string, string>;
  tx: Map<string, string>;
  order: Map<string, string>;
  po: Map<string, string>;
  grn: Map<string, string>;
  voucher: Map<string, string>;
  recipe: Map<string, string>;
  promo: Map<string, string>;
  group: Map<string, string>;
  tier: Map<string, string>;
}

function mapOf(rows: Row[] | undefined, key: string, idKey = "id") {
  return new Map<string, string>((rows ?? []).map((r) => [String(r[idKey]), String(r[key] ?? "")]));
}

function buildLookups(t: Record<string, ExportTableResult>): Lookups {
  return {
    branch: mapOf(t.branches?.rows, "name"),
    user: mapOf(t.profiles?.rows, "full_name"),
    product: mapOf(t.products?.rows, "name"),
    ingredient: mapOf(t.ingredients?.rows, "name"),
    supplier: mapOf(t.suppliers?.rows, "company_name"),
    customer: mapOf(t.customers?.rows, "customer_name"),
    tx: mapOf(t.transactions?.rows, "invoice_number"),
    order: mapOf(t.orders?.rows, "order_number"),
    po: mapOf(t.purchase_orders?.rows, "po_number"),
    grn: mapOf(t.goods_receipts?.rows, "grn_number"),
    voucher: mapOf(t.vouchers?.rows, "voucher_code"),
    recipe: mapOf(t.recipes?.rows, "name"),
    promo: mapOf(t.promotions?.rows, "promo_name"),
    group: mapOf(t.modifier_groups?.rows, "name"),
    tier: mapOf(t.customer_tiers?.rows, "tier_name"),
  };
}

const USER_KEYS = new Set(["cashier_id", "created_by", "user_id", "employee_id", "received_by", "recorded_by", "approved_by", "requested_by", "updated_by"]);

function resolveId(key: string, v: string, L: Lookups): string {
  const pick = (m: Map<string, string>) => m.get(v) || v.slice(0, 8);
  if (key === "branch_id") return pick(L.branch);
  if (USER_KEYS.has(key)) return pick(L.user);
  if (key === "product_id") return pick(L.product);
  if (key === "ingredient_id") return pick(L.ingredient);
  if (key === "supplier_id") return pick(L.supplier);
  if (key === "customer_id") return pick(L.customer);
  if (key === "transaction_id") return pick(L.tx);
  if (key === "order_id") return pick(L.order);
  if (key === "po_id") return pick(L.po);
  if (key === "grn_id") return pick(L.grn);
  if (key === "voucher_id") return pick(L.voucher);
  if (key === "recipe_id") return pick(L.recipe);
  if (key === "promotion_id") return pick(L.promo);
  if (key === "modifier_group_id") return pick(L.group);
  if (key === "tier_id") return pick(L.tier);
  return v.slice(0, 8);
}

function fmtDate(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function cell(key: string, v: any, L: Lookups): string {
  if (v === null || v === undefined || v === "") return "-";
  if (typeof v === "boolean") return v ? "Ya" : "Tidak";
  if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && !/(code|number|phone|invoice|sku|token)/i.test(key))) {
    const n = Number(v);
    if (MONEY_RE.test(key) && !NOT_MONEY_RE.test(key)) return rp(n);
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
  }
  if (typeof v === "string") {
    if (ISO_RE.test(v)) return fmtDate(v);
    if (UUID_RE.test(v)) return resolveId(key, v, L);
    return v.length > 48 ? `${v.slice(0, 45)}...` : v;
  }
  const s = JSON.stringify(v);
  return s.length > 48 ? `${s.slice(0, 45)}...` : s;
}

function header(key: string) {
  return key.replace(/_id$/, "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function pickColumns(tableKey: string, rows: Row[]): string[] {
  const curated = COLS[tableKey];
  if (curated) return curated.filter((k) => rows.length === 0 || k in rows[0] || rows.some((r) => k in r));
  const keys = rows.length ? Object.keys(rows[0]) : [];
  return keys.filter((k) => k !== "id" && k !== "tenant_id" && typeof rows[0][k] !== "object").slice(0, 8);
}

// ---------------------------------------------------------------------------
// Pengumpulan data
// ---------------------------------------------------------------------------
export interface FullExportOptions {
  branchId: string | null;
  branchLabel: string;
  cafeName: string;
  from: Date;
  to: Date;
  periodLabel: string;
  tier: Tier;
  unmask: boolean;
  onProgress?: (pct: number, message: string) => void;
}

export interface Collected {
  report: ProfitReport;
  counts: Record<string, number>;
  tables: Record<string, ExportTableResult>;
  totalRows: number;
  fetchedRows: number;
  truncated: boolean;
}

export async function estimateFullExport(o: Pick<FullExportOptions, "branchId" | "from" | "to">) {
  const counts = await getExportCounts(o);
  const total = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
  return {
    counts,
    total,
    mode: total <= PDF_FULL_MAX_ROWS ? ("pdf" as const) : ("excel" as const),
    // perkiraan kasar: ~150 byte/baris di Excel terkompresi, ~35 baris/halaman PDF
    estKB: Math.max(30, Math.round((Math.min(total, PDF_FULL_MAX_ROWS) / 35) * 6 + (total > PDF_FULL_MAX_ROWS ? (total * 150) / 1024 : 0))),
    estPages: total <= PDF_FULL_MAX_ROWS ? Math.round(total / 30) + 8 : Math.min(ALL_TABLE_KEYS.length * 4 + 10, 220),
  };
}

export async function collectAll(o: FullExportOptions): Promise<Collected> {
  const prog = o.onProgress ?? (() => {});
  prog(2, "Menghitung ukuran data...");
  const counts = await getExportCounts(o);
  const totalRows = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
  const cap = Math.max(EXPORT_ROW_LIMIT[o.tier], 1);
  const maxPerTable = totalRows <= PDF_FULL_MAX_ROWS ? PDF_FULL_MAX_ROWS : cap;

  prog(5, "Menghitung laba rugi...");
  const report = await getProfitReport({ branchId: o.branchId, from: o.from, to: o.to });

  const tables: Record<string, ExportTableResult> = {};
  let fetched = 0;
  let truncated = false;
  const keys = ALL_TABLE_KEYS;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    prog(8 + Math.round((i / keys.length) * 70), `Mengambil ${LABEL[key] ?? key}...`);
    if (!counts[key]) {
      tables[key] = { table: key, total: 0, rows: [], capped: false };
      continue;
    }
    const res = await fetchExportTable({
      table: key, branchId: o.branchId, from: o.from, to: o.to, maxRows: maxPerTable, unmask: o.unmask,
    });
    tables[key] = res;
    fetched += res.rows.length;
    if (res.capped || res.total > res.rows.length) truncated = true;
  }
  return { report, counts, tables, totalRows, fetchedRows: fetched, truncated };
}

// ---------------------------------------------------------------------------
// Analitik (Bagian G) — dihitung dari data yang sama, bukan query terpisah
// ---------------------------------------------------------------------------
export interface Analytics {
  peakHours: { jam: string; order: number }[];
  channel: { channel: string; order: number; omzetKomisi: number; komisi: number }[];
  menuEngineering: { menu: string; kelas: string; qty: number; omzet: number; hpp: number; marginPerUnit: number }[];
}

export function buildAnalytics(c: Collected, tz: string): Analytics {
  const hourCount = new Array(24).fill(0) as number[];
  for (const t of c.tables.transactions?.rows ?? []) {
    let h = 0;
    try {
      h = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).format(new Date(t.created_at))) % 24;
    } catch {
      h = new Date(t.created_at).getHours();
    }
    hourCount[h] += 1;
  }
  const peakHours = hourCount.map((n, h) => ({ jam: `${String(h).padStart(2, "0")}:00`, order: n })).filter((x) => x.order > 0);

  const ch = new Map<string, { order: number; komisi: number }>();
  for (const o of c.tables.orders?.rows ?? []) {
    const k = String(o.channel ?? "DINE_IN");
    const e = ch.get(k) ?? { order: 0, komisi: 0 };
    e.order += 1;
    e.komisi += Number(o.channel_commission_amount ?? 0);
    ch.set(k, e);
  }
  const channel = Array.from(ch.entries()).map(([channel, v]) => ({ channel, order: v.order, omzetKomisi: 0, komisi: v.komisi }));

  const prodCost = new Map<string, number>((c.tables.products?.rows ?? []).map((p) => [String(p.id), Number(p.cost_price ?? 0)]));
  const prodName = new Map<string, string>((c.tables.products?.rows ?? []).map((p) => [String(p.id), String(p.name)]));
  const agg = new Map<string, { qty: number; omzet: number; hpp: number }>();
  for (const it of c.tables.transaction_items?.rows ?? []) {
    const id = String(it.product_id ?? "?");
    const e = agg.get(id) ?? { qty: 0, omzet: 0, hpp: 0 };
    const unit = it.cost_price_snapshot != null ? Number(it.cost_price_snapshot) : prodCost.get(id) ?? 0;
    e.qty += Number(it.qty);
    e.omzet += Number(it.subtotal);
    e.hpp += Number(it.qty) * unit;
    agg.set(id, e);
  }
  const list = Array.from(agg.entries()).map(([id, v]) => ({
    menu: prodName.get(id) ?? id.slice(0, 8), ...v, marginPerUnit: v.qty > 0 ? (v.omzet - v.hpp) / v.qty : 0,
  }));
  const totalQty = list.reduce((s, x) => s + x.qty, 0);
  const totalMargin = list.reduce((s, x) => s + (x.omzet - x.hpp), 0);
  const popCut = list.length ? (totalQty / list.length) * 0.7 : 0; // aturan 70% menu engineering
  const marginCut = totalQty > 0 ? totalMargin / totalQty : 0;
  const menuEngineering = list
    .map((x) => {
      const pop = x.qty >= popCut;
      const high = x.marginPerUnit >= marginCut;
      const kelas = pop && high ? "Star" : pop ? "Plowhorse" : high ? "Puzzle" : "Dog";
      return { ...x, kelas };
    })
    .sort((a, b) => b.qty - a.qty);

  return { peakHours, channel, menuEngineering };
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
export async function renderFullPdf(
  o: FullExportOptions,
  data: Collected,
  fileName: string,
  rowsPerTable: number,
  dataHash: string
) {
  const tz = data.report.tz;
  const L = buildLookups(data.tables);
  const q = hppQuality(data.report.summary.hpp_lines_actual, data.report.summary.hpp_lines_estimate);
  const m = metricsFromReport(data.report);
  const an = buildAnalytics(data, tz);

  const c: PdfCtx = await createPdf({
    cafeName: o.cafeName, branchLabel: o.branchLabel, periodLabel: o.periodLabel,
    title: "Laporan Lengkap - Semua Data", orientation: "l",
  });
  const { doc } = c;

  // ---- 1. Cover ----
  c.y = 140;
  doc.setFont("helvetica", "bold"); doc.setFontSize(26);
  doc.text("Laporan Lengkap caPOS", c.margin, c.y); c.y += 34;
  doc.setFontSize(14); doc.setFont("helvetica", "normal");
  doc.text(o.cafeName, c.margin, c.y); c.y += 22;
  doc.setFontSize(11);
  for (const line of [
    `Cabang    : ${o.branchLabel}`,
    `Periode   : ${o.periodLabel}`,
    `Dicetak   : ${new Date().toLocaleString("id-ID")}`,
    `Versi skema: ${SCHEMA_VERSION}`,
    `Hash data : ${dataHash}`,
    `Kualitas HPP: ${q.label}`,
  ]) { doc.text(line, c.margin, c.y); c.y += 18; }
  c.y += 10;
  doc.setFontSize(9); doc.setTextColor(110);
  doc.text(
    doc.splitTextToSize(
      "Dokumen rahasia. Data pelanggan (telepon, email) dan rekening pemasok disamarkan secara default. " +
        "PIN karyawan, kunci pembayaran, dan kredensial tidak pernah diekspor.", 600) as string[],
    c.margin, c.y
  );
  doc.setTextColor(0);

  // ---- 2. Daftar isi (diisi belakangan) ----
  doc.addPage();
  const tocPage = doc.getNumberOfPages();
  const toc: { title: string; page: number }[] = [];

  // ---- 3. Ringkasan Eksekutif ----
  doc.addPage(); c.y = 50;
  toc.push({ title: "Ringkasan Eksekutif", page: doc.getNumberOfPages() });
  drawHeader(c);
  sectionTitle(c, "Ringkasan Eksekutif");
  const s = data.report.summary;
  table(c, ["Metrik", "Nilai", "Metrik", "Nilai"], [
    ["Omzet", rp(m.omzet), "Laba Kotor", rp(m.labaKotor)],
    ["Subtotal sebelum diskon", rp(s.subtotal), "Susut Stok", rp(m.susutStok)],
    ["Diskon", rp(m.diskon), "Komisi Channel", rp(m.komisi)],
    ["HPP", rp(m.hpp), s.opex_tersedia ? "Biaya Operasional" : "Biaya Operasional (belum dipakai)", s.opex_tersedia ? rp(m.biayaOperasional) : "-"],
    ["Refund", rp(m.refund), "LABA BERSIH", rp(m.labaBersih)],
    ["Transaksi", String(m.transaksi), "Margin Kotor", pct(m.marginKotor)],
    ["Rata-rata / Transaksi (AOV)", rp(m.aov), "Item Terjual", String(m.itemTerjual)],
  ]);
  paragraph(c, `${q.label}: ${q.note}`);

  // ---- 4-9. Bagian A-F ----
  for (const dom of DOMAINS) {
    doc.addPage(); c.y = 50;
    toc.push({ title: dom.title, page: doc.getNumberOfPages() });
    doc.setFont("helvetica", "bold"); doc.setFontSize(15);
    doc.text(dom.title, c.margin, c.y); c.y += 24;
    for (const key of dom.tables) {
      const res = data.tables[key];
      if (!res || res.total === 0) continue;
      const rows = res.rows.slice(0, rowsPerTable);
      const cols = pickColumns(key, rows);
      sectionTitle(c, `${LABEL[key] ?? key} - ${rows.length.toLocaleString("id-ID")} dari ${res.total.toLocaleString("id-ID")} baris`, 80);
      table(c, cols.map(header), rows.map((r) => cols.map((k) => cell(k, r[k], L))), { fontSize: 7, gap: 16 });
      if (res.total > rows.length) {
        paragraph(c, `Ditampilkan ${rows.length} baris pertama. Data lengkap ada di file Excel.`, 8);
      }
    }
  }

  // ---- 10. Bagian G - Analitik ----
  doc.addPage(); c.y = 50;
  toc.push({ title: "Bagian G - Analitik", page: doc.getNumberOfPages() });
  doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text("Bagian G - Analitik", c.margin, c.y); c.y += 24;
  const R = data.report;
  sectionTitle(c, "Omzet & Laba Harian");
  table(c, ["Tanggal", "Transaksi", "Omzet", "HPP", "Laba Kotor"], R.daily.map((d) => [d.tanggal, String(d.transaksi), rp(d.omzet), rp(d.hpp), rp(Number(d.omzet) - Number(d.hpp))]), { fontSize: 8 });
  sectionTitle(c, "Menu Terlaris (Top 10)");
  table(c, ["Menu", "Terjual", "Omzet", "HPP"], R.top_menu.map((t) => [t.menu, String(t.qty), rp(t.omzet), rp(t.hpp)]), { fontSize: 8 });
  sectionTitle(c, "Profitabilitas Produk (Top 10 Laba)");
  table(c, ["Menu", "Terjual", "Omzet", "HPP", "Laba"], R.top_profit_menu.map((t) => [t.menu, String(t.qty), rp(t.omzet), rp(t.hpp), rp(t.laba)]), { fontSize: 8 });
  sectionTitle(c, "Menu Engineering (Star / Plowhorse / Puzzle / Dog)");
  table(c, ["Menu", "Kelas", "Terjual", "Omzet", "HPP", "Margin/unit"], an.menuEngineering.slice(0, 60).map((x) => [x.menu, x.kelas, String(x.qty), rp(x.omzet), rp(x.hpp), rp(x.marginPerUnit)]), { fontSize: 8 });
  sectionTitle(c, "Jam Sibuk");
  table(c, ["Jam", "Jumlah Transaksi"], an.peakHours.map((h) => [h.jam, String(h.order)]), { fontSize: 8 });
  sectionTitle(c, "Komisi per Channel");
  table(c, ["Channel", "Order", "Komisi"], an.channel.map((x) => [x.channel, String(x.order), rp(x.komisi)]), { fontSize: 8 });
  sectionTitle(c, "Metode Pembayaran");
  table(c, ["Metode", "Transaksi", "Omzet"], R.by_payment.map((p) => [p.metode, String(p.transaksi), rp(p.omzet)]), { fontSize: 8 });
  if (R.by_branch.length > 1) {
    sectionTitle(c, "Rekap per Cabang");
    table(c, ["Cabang", "Transaksi", "Omzet", "HPP", "Susut", "Komisi", "OPEX"], R.by_branch.map((b) => [b.branch_name, String(b.transaksi), rp(b.omzet), rp(b.hpp), rp(b.susut), rp(b.komisi), rp(b.opex)]), { fontSize: 8 });
  }
  methodologyNote(c);

  // ---- 11. Lampiran ----
  doc.addPage(); c.y = 50;
  toc.push({ title: "Lampiran - Daftar Tabel & Glosarium", page: doc.getNumberOfPages() });
  doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text("Lampiran", c.margin, c.y); c.y += 24;
  sectionTitle(c, "Daftar Tabel & Jumlah Baris");
  table(c, ["Tabel", "Keterangan", "Baris di database", "Baris di dokumen ini"], ALL_TABLE_KEYS.map((k) => [
    k, LABEL[k] ?? k, String(data.counts[k] ?? 0), String(Math.min(data.tables[k]?.rows.length ?? 0, rowsPerTable)),
  ]), { fontSize: 8 });
  sectionTitle(c, "Glosarium Metrik");
  table(c, ["Metrik", "Rumus"], [
    ["Omzet", "Jumlah total_amount semua transaksi pada periode & cabang"],
    ["HPP", "Jumlah (qty x HPP per unit saat transaksi); sumber: snapshot > resep cabang > HPP menu cabang > HPP default"],
    ["Laba Kotor", "Omzet - Refund - HPP"],
    ["Susut Stok", "Selisih stok opname + waste produk"],
    ["Laba Bersih", "Laba Kotor - Susut - Komisi channel - Biaya operasional (bila modul dipakai)"],
    ["Margin Kotor", "Laba Kotor / Omzet x 100"],
    ["AOV", "Omzet / jumlah transaksi"],
    ["Star / Plowhorse / Puzzle / Dog", "Popularitas (>= 70% rata-rata qty) x margin per unit (>= rata-rata tertimbang)"],
  ], { fontSize: 8 });

  // ---- Isi Daftar Isi di halaman yang dicadangkan ----
  doc.setPage(tocPage);
  c.y = 60;
  doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text("Daftar Isi", c.margin, c.y); c.y += 28;
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  for (const t of toc) {
    doc.text(t.title, c.margin, c.y);
    doc.text(String(t.page), pageW(c) - c.margin, c.y, { align: "right" });
    c.y += 20;
    if (c.y > pageH(c) - 60) break;
  }

  drawFooters(c, fileName, q);
  return doc;
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------
function flatten(rows: Row[]): Row[] {
  return rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[k] = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
    return out;
  });
}

function sheetName(s: string) {
  return s.replace(/[\\/?*[\]:]/g, "-").slice(0, 31);
}

function appendAnalyticsSheets(wb: XLSX.WorkBook, data: Collected, an: Analytics) {
  const R = data.report;
  const add = (name: string, rows: Row[]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ info: "Tidak ada data" }]), sheetName(name));
  add("Ringkasan", Object.entries(R.summary).map(([metrik, nilai]) => ({ metrik, nilai })));
  add("Harian", R.daily);
  add("Menu Terlaris", R.top_menu);
  add("Profitabilitas", R.top_profit_menu);
  add("Per Kategori", R.by_category);
  add("Metode Bayar", R.by_payment);
  add("Per Cabang", R.by_branch);
  add("Menu Engineering", an.menuEngineering);
  add("Jam Sibuk", an.peakHours);
  add("Komisi Channel", an.channel);
}

/** Satu workbook Excel: satu sheet per tabel (A-G) + sheet analitik + sheet manifest. */
function fullWorkbook(data: Collected, an: Analytics, manifest: Record<string, unknown>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const dom of DOMAINS) {
    for (const key of dom.tables) {
      const res = data.tables[key];
      if (!res || res.rows.length === 0) continue;
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flatten(res.rows)), sheetName(key));
    }
  }
  appendAnalyticsSheets(wb, data, an);
  const manifestRows = Object.entries(manifest).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(manifestRows), "Manifest");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

async function sha256Hex(text: string) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "tidak-tersedia";
  }
}

export interface FullExportResult {
  blob: Blob;
  fileName: string;
  kind: "pdf" | "excel";
  totalRows: number;
  truncated: boolean;
  unmasked: boolean;
}

/**
 * format "pdf"   : <= 5.000 baris -> PDF penuh; lebih -> PDF ringkas (sampel per tabel)
 * format "excel" : satu workbook Excel berisi satu sheet per tabel + analitik + manifest
 */
export async function runFullExport(o: FullExportOptions, format: "pdf" | "excel"): Promise<FullExportResult> {
  const prog = o.onProgress ?? (() => {});
  const data = await collectAll(o);
  const an = buildAnalytics(data, data.report.tz);
  const base = `capos-semua-data-${slug(o.branchLabel)}-${ymd(o.to)}`;

  const manifest = {
    schema: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    cafe: o.cafeName,
    branch: o.branchLabel,
    period: { from: o.from.toISOString(), to: o.to.toISOString(), timezone: data.report.tz },
    tier: o.tier,
    pii_masked: !o.unmask,
    row_limit_per_table: EXPORT_ROW_LIMIT[o.tier],
    truncated: data.truncated,
    tables: ALL_TABLE_KEYS.map((k) => ({
      table: k, label: LABEL[k] ?? k, rows_in_db: data.counts[k] ?? 0, rows_exported: data.tables[k]?.rows.length ?? 0,
    })),
    hpp_quality: hppQuality(data.report.summary.hpp_lines_actual, data.report.summary.hpp_lines_estimate),
  };
  const hash = (await sha256Hex(JSON.stringify({ c: data.counts, s: data.report.summary, f: o.from, t: o.to, b: o.branchId }))).slice(0, 16);

  if (format === "excel") {
    prog(90, "Menyusun file Excel...");
    const buf = fullWorkbook(data, an, { ...manifest, data_hash: hash });
    prog(100, "Selesai");
    return {
      blob: new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      fileName: `${base}.xlsx`, kind: "excel", totalRows: data.totalRows, truncated: data.truncated, unmasked: o.unmask,
    };
  }

  prog(85, "Menyusun PDF...");
  const rowLimit = data.totalRows <= PDF_FULL_MAX_ROWS ? PDF_FULL_MAX_ROWS : PDF_SAMPLE_ROWS;
  const doc = await renderFullPdf(o, data, `${base}.pdf`, rowLimit, hash);
  prog(100, "Selesai");
  return { blob: doc.output("blob"), fileName: `${base}.pdf`, kind: "pdf", totalRows: data.totalRows, truncated: data.truncated, unmasked: o.unmask };
}
