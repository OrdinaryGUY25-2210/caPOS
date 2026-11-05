/** Tipe bersama untuk fitur Export PDF/Excel caPOS. */

import type { ReportMetrics } from "@/lib/metrics";

export type ExportMode = "ringkasan" | "profit" | "full";

export interface ExportScope {
  tenantId: string;
  /** null = Semua Cabang (konsolidasi). */
  branchId: string | null;
  branchName: string;
  cafeName: string;
  /** ISO string, inklusif. */
  startISO: string;
  endISO: string;
  startLabel: string;
  endLabel: string;
  tier: string;
  role: string;
  generatedAt: string;
}

export interface ReportSection {
  key: string;
  title: string;
  head: string[];
  rows: (string | number)[][];
  /** Jumlah baris asli sebelum dipotong untuk PDF. */
  totalRows: number;
  /** true kalau PDF hanya memuat sebagian baris. */
  truncated: boolean;
}

export interface ReportData {
  scope: ExportScope;
  mode: ExportMode;
  metrics: ReportMetrics;
  sections: ReportSection[];
  /** Data mentah untuk renderer PDF yang butuh struktur khusus. */
  raw: {
    transactions: any[];
    items: any[];
    payments: any[];
    orders: any[];
    orderItems: any[];
    refunds: any[];
    qrOrders: any[];
    products: any[];
    branches: any[];
    branchCosts: any[];
    variants: any[];
    modifiers: any[];
    recipes: any[];
    recipeItems: any[];
    ingredients: any[];
    branchIngredients: any[];
    consumption: any[];
    stockOpnames: any[];
    stockOpnameItems: any[];
    stockOpnameLogs: any[];
    wasteLogs: any[];
    ingredientWasteLogs: any[];
    suppliers: any[];
    purchaseOrders: any[];
    poItems: any[];
    goodsReceipts: any[];
    grnItems: any[];
    customers: any[];
    memberships: any[];
    vouchers: any[];
    voucherBranches: any[];
    voucherRedemptions: any[];
    promotions: any[];
    referrals: any[];
    profiles: any[];
    shifts: any[];
    attendance: any[];
    cashMovements: any[];
    reservations: any[];
    expenses: any[];
    viewDaily: any[];
    viewBestSeller: any[];
    viewProfitability: any[];
    viewPeak: any[];
    viewChannel: any[];
    menuEngineering: any[];
  };
  warnings: string[];
}

export interface PdfRenderResult {
  pages: number;
  filename: string;
}
