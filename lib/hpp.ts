/**
 * WP-02 — HPP menu per cabang.
 *
 * products.cost_price tetap menjadi default untuk seluruh tenant.
 * product_branch_cost (supabase/20251104_product_branch_cost.sql) menyimpan
 * override per cabang. Urutan baca (sama dengan get_product_cost() di DB):
 *   override cabang  →  products.cost_price  →  0
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const HPP_SOURCE_LABEL: Record<string, string> = {
  recipe: "Resep",
  branch: "HPP cabang",
  wac: "Rata-rata tertimbang",
  product: "HPP default menu",
  estimate: "Estimasi",
};

/** true bila error berasal dari migrasi 20251104_product_branch_cost.sql yang belum dijalankan. */
export function isMissingBranchCostTable(error: { message?: string; code?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /product_branch_cost/.test(error.message ?? "");
}

/** Ambil semua override HPP untuk satu cabang → Map(product_id → cost_price). */
export async function loadBranchCosts(
  supabase: SupabaseClient,
  tenantId: string,
  branchId: string
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("product_branch_cost")
    .select("product_id, cost_price")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId);
  if (error) {
    if (isMissingBranchCostTable(error)) return new Map(); // migrasi belum jalan → pakai default
    throw error;
  }
  return new Map((data ?? []).map((r: any) => [r.product_id as string, Number(r.cost_price)]));
}

/** Simpan HPP khusus satu cabang. */
export async function saveBranchCost(
  supabase: SupabaseClient,
  args: { tenantId: string; branchId: string; productId: string; costPrice: number }
) {
  return supabase.from("product_branch_cost").upsert(
    {
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      product_id: args.productId,
      cost_price: Math.max(0, args.costPrice),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "branch_id,product_id" }
  );
}

/** Hapus override → cabang itu kembali memakai default tenant. */
export async function clearBranchCost(supabase: SupabaseClient, branchId: string, productId: string) {
  return supabase.from("product_branch_cost").delete().eq("branch_id", branchId).eq("product_id", productId);
}
