export type Tier = "free" | "pro" | "supreme";

export interface SubscriptionLike {
  status: string;
  plan: string | null;
  /** Opsional: kalau disertakan, trial Supreme yang masih berjalan ikut dihitung (sama seperti tenant_tier() di DB). */
  super_trial_ends_at?: string | null;
}

/** Samakan persis dengan fungsi tenant_tier() di supabase/schema.sql. */
export function getTier(sub: SubscriptionLike | null): Tier {
  if (!sub) return "free";
  if (sub.super_trial_ends_at && new Date(sub.super_trial_ends_at).getTime() > Date.now()) return "supreme";
  if (sub.status === "active" && sub.plan === "yearly") return "supreme";
  if (sub.status === "active" && sub.plan === "monthly") return "pro";
  return "free";
}

export const TIER_LABEL: Record<Tier, string> = {
  free: "Free Trial",
  pro: "Pro",
  supreme: "Supreme",
};

export const TIER_BADGE_CLASS: Record<Tier, string> = {
  free: "badge-warning",
  pro: "badge-active",
  supreme: "badge-active",
};

/**
 * Batas riwayat (hari) per tier — dipakai halaman Riwayat Transaksi & Laporan.
 * SATU sumber kebenaran (WP-06): FREE_TIER_LIMITS.historyDays diambil dari sini.
 * Penegakan server-side untuk export ada di assert_export_allowed()
 * (supabase/20251104_profit_report_rpc.sql) — angka 30 hari Pro HARUS sama.
 */
export const HISTORY_DAYS_LIMIT: Record<Tier, number | null> = {
  free: 14,       // 7-14 hari sesuai permintaan; dipilih 14 sebagai batas maksimal free
  pro: 30,        // owner Pro bisa pilih periode 7/14/30 hari
  supreme: null,  // null = unlimited (tidak ada batas)
};

/** Batasan untuk tier Free — Pro & Supreme unlimited di semua ini. */
export const FREE_TIER_LIMITS = {
  maxCashiers: 2,
  maxMenu: 10,
  historyDays: HISTORY_DAYS_LIMIT.free as number,
};

/**
 * Export laporan PDF (semua mode: Ringkasan, Hanya Keuntungan, Semua Data):
 * Free Trial TIDAK BISA dalam bentuk apa pun. Mulai Pro.
 * Server menolaknya juga (RPC assert_export_allowed) — ini hanya untuk UI.
 */
export const PDF_EXPORT_PREMIUM = true;
export const PDF_EXPORT_MIN_TIER: Tier = "pro";

export function canExportPdf(tier: Tier) {
  return !PDF_EXPORT_PREMIUM || tier !== "free";
}

/** Mode "Semua Data": Pro & Supreme, hanya role owner/manager/super_admin. */
export function canExportFullData(tier: Tier, role: string | null | undefined) {
  return canExportPdf(tier) && (role === "owner" || role === "manager" || role === "super_admin");
}

/** Batas baris per tabel pada export "Semua Data" (rencana 6.9). Free = 0 (tidak boleh). */
export const EXPORT_ROW_LIMIT: Record<Tier, number> = {
  free: 0,
  pro: 50_000,
  supreme: 200_000,
};

/** Tanggal paling awal yang boleh dipilih untuk tier ini (null = tanpa batas). */
export function earliestAllowedDate(tier: Tier, now: Date = new Date()): Date | null {
  const days = HISTORY_DAYS_LIMIT[tier];
  if (!days) return null;
  const d = new Date(now);
  d.setDate(d.getDate() - days + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isPremiumReport(tier: Tier) {
  return tier === "supreme";
}

export function hasSalesHealth(tier: Tier) {
  return tier === "pro" || tier === "supreme";
}

/**
 * Batas jumlah cabang per tier — HARUS sama persis dengan
 * enforce_branch_limit() di supabase/migration_011_multi_branch_stock_opname.sql.
 * null = unlimited (Supreme).
 */
export const BRANCH_LIMIT: Record<Tier, number | null> = {
  free: 1,
  pro: 3,
  supreme: null,
};
