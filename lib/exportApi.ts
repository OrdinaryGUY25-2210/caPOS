"use client";

/**
 * Pemanggil RPC export (supabase/20251104_*.sql).
 * Semua pengecekan tier/role dilakukan SERVER-SIDE oleh assert_export_allowed();
 * di sini hanya menerjemahkan kode error menjadi pesan yang ramah.
 */
import { createClient } from "@/lib/supabase/client";
import type { ProfitReport } from "@/lib/types";
import { DEMO_REPORT_TX, DEMO_REPORT_ITEMS, DEMO_REPORT_OPNAME } from "@/lib/demoData";

export class ExportError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const FRIENDLY: Record<string, string> = {
  EXPORT_PDF_TIER: "Export laporan PDF tidak tersedia di paket Free Trial. Upgrade ke Pro atau Supreme untuk memakainya.",
  EXPORT_ROLE: "Hanya Owner atau Manager yang boleh mengunduh laporan.",
  EXPORT_RANGE_LIMIT: "Rentang tanggal melebihi batas paket Anda (Pro maksimal 30 hari terakhir).",
  EXPORT_RANGE_INVALID: "Tanggal akhir harus sama atau setelah tanggal awal.",
  EXPORT_UNMASK_DENIED: "Hanya Owner yang boleh membuka data pelanggan yang disamarkan.",
  NOT_AUTHENTICATED: "Sesi login berakhir. Silakan login ulang.",
};

/** Ubah error Supabase/Postgres menjadi ExportError dengan pesan Indonesia. */
export function toExportError(err: any): ExportError {
  const raw: string = err?.message ?? String(err ?? "");
  const code = Object.keys(FRIENDLY).find((c) => raw.includes(c));
  if (code) return new ExportError(code, FRIENDLY[code]);
  if (/get_profit_report|get_export_|assert_export_allowed|log_export|function .* does not exist|PGRST202/i.test(raw)) {
    return new ExportError(
      "MIGRATION_MISSING",
      "Fitur export belum aktif di database. Jalankan 5 file supabase/20251104_*.sql di Supabase SQL Editor (lihat docs/EXPORT_PDF_LENGKAP.md)."
    );
  }
  return new ExportError("UNKNOWN", raw || "Terjadi kesalahan saat membuat laporan.");
}

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta";
  } catch {
    return "Asia/Jakarta";
  }
}

export async function getProfitReport(args: {
  branchId: string | null;
  from: Date;
  to: Date;
}): Promise<ProfitReport> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_profit_report", {
    p_branch_id: args.branchId,
    p_from: args.from.toISOString(),
    p_to: args.to.toISOString(),
    p_tz: browserTimeZone(),
  });
  if (error) throw toExportError(error);
  return data as ProfitReport;
}

export type ExportCounts = Record<string, number>;

export async function getExportCounts(args: { branchId: string | null; from: Date; to: Date }): Promise<ExportCounts> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_export_counts", {
    p_branch_id: args.branchId,
    p_from: args.from.toISOString(),
    p_to: args.to.toISOString(),
    p_tz: browserTimeZone(),
  });
  if (error) throw toExportError(error);
  return (data ?? {}) as ExportCounts;
}

export interface ExportTableResult {
  table: string;
  total: number;
  rows: Record<string, any>[];
  /** true bila hasil dipotong oleh batas baris tier (Pro: 50.000 per tabel). */
  capped: boolean;
}

/**
 * Ambil SELURUH baris satu tabel lewat pagination (WP-09) — tidak ada lagi
 * .limit(10000) diam-diam. `maxRows` membatasi jumlah baris yang diambil
 * (mis. 500 untuk lampiran di PDF, atau batas tier untuk Excel).
 */
export async function fetchExportTable(args: {
  table: string;
  branchId: string | null;
  from: Date;
  to: Date;
  maxRows: number;
  unmask?: boolean;
  pageSize?: number;
  onPage?: (fetched: number, total: number) => void;
}): Promise<ExportTableResult> {
  const supabase = createClient();
  const pageSize = Math.min(args.pageSize ?? 2000, 5000);
  const rows: Record<string, any>[] = [];
  let total = 0;
  let capped = false;
  let offset = 0;

  while (rows.length < args.maxRows) {
    const { data, error } = await supabase.rpc("get_export_table", {
      p_table: args.table,
      p_branch_id: args.branchId,
      p_from: args.from.toISOString(),
      p_to: args.to.toISOString(),
      p_tz: browserTimeZone(),
      p_offset: offset,
      p_limit: Math.min(pageSize, args.maxRows - rows.length),
      p_unmask: !!args.unmask,
    });
    if (error) throw toExportError(error);
    const page = data as { total: number | null; rows: Record<string, any>[]; capped: boolean };
    total = Number(page.total ?? total);
    capped = capped || !!page.capped;
    const got = page.rows ?? [];
    rows.push(...got);
    offset += got.length;
    args.onPage?.(rows.length, total);
    if (got.length === 0 || offset >= total) break;
  }
  return { table: args.table, total, rows, capped: capped || (total > rows.length && rows.length >= args.maxRows) };
}

export async function logExport(args: {
  mode: "ringkasan" | "laba" | "semua_data" | "omzet_excel" | "omzet_csv";
  branchId: string | null;
  from: Date;
  to: Date;
  rowCount?: number;
  fileName?: string;
  unmasked?: boolean;
}) {
  try {
    const supabase = createClient();
    await supabase.rpc("log_export", {
      p_mode: args.mode,
      p_branch_id: args.branchId,
      p_from: args.from.toISOString(),
      p_to: args.to.toISOString(),
      p_row_count: args.rowCount ?? null,
      p_file_name: args.fileName ?? null,
      p_unmasked: !!args.unmasked,
    });
  } catch {
    /* log gagal tidak boleh menggagalkan unduhan */
  }
}

/** Laporan contoh (data demo) untuk tenant yang belum punya aktivitas — sama seperti halaman lama. */
export function demoProfitReport(from: Date, to: Date): ProfitReport {
  const tx = DEMO_REPORT_TX as any[];
  const items = DEMO_REPORT_ITEMS as any[];
  const omzet = tx.reduce((s, t) => s + Number(t.total_amount), 0);
  const hpp = items.reduce((s, it) => s + Number(it.qty) * Number(it.products?.cost_price ?? 0), 0);
  const susut = (DEMO_REPORT_OPNAME as any[]).reduce((s, r) => s + Number(r.loss_value), 0);
  const day = new Date().toISOString().slice(0, 10);

  const pay = new Map<string, { transaksi: number; omzet: number }>();
  for (const t of tx) {
    const k = String(t.payment_method ?? "CASH").toUpperCase();
    const e = pay.get(k) ?? { transaksi: 0, omzet: 0 };
    e.transaksi += 1;
    e.omzet += Number(t.total_amount);
    pay.set(k, e);
  }
  const menu = items.map((it) => ({
    menu: String(it.products?.name ?? "Produk"),
    qty: Number(it.qty),
    omzet: Number(it.subtotal),
    hpp: Number(it.qty) * Number(it.products?.cost_price ?? 0),
  }));

  return {
    generated_at: new Date().toISOString(),
    tier: "pro",
    branch_id: null,
    from: from.toISOString(),
    to: to.toISOString(),
    tz: browserTimeZone(),
    summary: {
      omzet, subtotal: omzet, diskon: 0, transaksi: tx.length,
      item_terjual: items.reduce((s, it) => s + Number(it.qty), 0),
      hpp, refund: 0, susut, komisi: 0, opex: 0, opex_tersedia: false,
      hpp_lines_actual: 0, hpp_lines_estimate: items.length,
    },
    daily: [{ tanggal: day, transaksi: tx.length, omzet, hpp }],
    daily_by_branch: [{ tanggal: day, branch_id: null, cabang: "Contoh", transaksi: tx.length, omzet }],
    by_payment: Array.from(pay.entries()).map(([metode, v]) => ({ metode, ...v })),
    by_category: [{ kategori: "Contoh", qty: menu.reduce((s, m) => s + m.qty, 0), omzet, hpp }],
    top_menu: [...menu].sort((a, b) => b.qty - a.qty).slice(0, 10),
    top_profit_menu: menu.map((m) => ({ ...m, laba: m.omzet - m.hpp })).sort((a, b) => b.laba - a.laba).slice(0, 10),
    by_branch: [],
  };
}
