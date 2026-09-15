export type Tier = "free" | "pro" | "supreme";

export interface SubscriptionLike {
  status: string;
  plan: string | null;
}

/** Samakan persis dengan fungsi tenant_tier() di supabase/schema.sql. */
export function getTier(sub: SubscriptionLike | null): Tier {
  if (!sub) return "free";
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

/** Batasan untuk tier Free — Pro & Supreme unlimited di semua ini. */
export const FREE_TIER_LIMITS = {
  maxCashiers: 2,
  maxMenu: 10,
  historyDays: 14,
};

/** Batas riwayat (hari) per tier — dipakai halaman Riwayat Transaksi & Laporan. */
export const HISTORY_DAYS_LIMIT: Record<Tier, number | null> = {
  free: 14,       // 7-14 hari sesuai permintaan; dipilih 14 sebagai batas maksimal free
  pro: 30,        // owner Pro bisa pilih periode 7/14/30 hari
  supreme: null,  // null = unlimited (tidak ada batas)
};

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
