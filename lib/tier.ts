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
  historyDays: 7,
};

export function isPremiumReport(tier: Tier) {
  return tier === "supreme";
}

export function hasSalesHealth(tier: Tier) {
  return tier === "pro" || tier === "supreme";
}
