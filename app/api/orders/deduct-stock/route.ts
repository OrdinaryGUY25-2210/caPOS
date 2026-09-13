import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { DeductRecipeStockResult } from "@/lib/types";

/**
 * POST /api/orders/deduct-stock
 * Body: { order_id: string }
 *
 * Pemicu UTAMA pemotongan stok bahan baku (branch_ingredients_stock) adalah
 * otomatis, lewat RPC `deduct_recipe_stock()` yang sekarang dipanggil dari
 * dalam `checkout_order_v2()` sendiri (lihat migration_019). Endpoint ini
 * BUKAN jalur utama — ia disediakan untuk 2 skenario operasional:
 *   1. Backfill order lama yang sudah COMPLETED SEBELUM migrasi 019 di-apply
 *      (order-order itu tidak pernah dipotong stok bahan bakunya).
 *   2. Retry manual kalau sebelumnya gagal karena stok bahan baku kurang
 *      (mis. kasir sempat override manual, lalu stok direstock, baru retry).
 *
 * Aman dipanggil berulang kali untuk order yang sama — deduct_recipe_stock()
 * idempotent lewat recipe_consumption_logs (item yang sudah pernah dipotong
 * akan dikembalikan dengan reason "ALREADY_DEDUCTED", bukan dipotong dobel).
 *
 * Otorisasi: RPC ini SECURITY DEFINER tapi tetap memvalidasi
 * `current_tenant_id()` dari sesi pemanggil (lihat body fungsinya) — jadi
 * kita hanya perlu memastikan pemanggil sudah login & berperan
 * manager/owner (bukan cashier biasa) sebelum meneruskan ke RPC.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const orderId = body?.order_id;

  if (typeof orderId !== "string" || orderId.length === 0) {
    return NextResponse.json({ message: "order_id wajib diisi." }, { status: 400 });
  }

  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ message: "Belum login." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["owner", "manager", "super_admin"].includes(profile.role)) {
    return NextResponse.json(
      { message: "Hanya Owner/Manager yang boleh memicu ulang pemotongan stok bahan baku." },
      { status: 403 }
    );
  }

  const { data, error } = await supabase.rpc("deduct_recipe_stock", {
    p_order_id: orderId,
  });

  if (error) {
    // Pesan paling umum di sini: "Pesanan belum berstatus COMPLETED" atau
    // (dari consume_recipe di dalamnya) "Stok <ingredient> tidak cukup".
    return NextResponse.json({ message: error.message }, { status: 400 });
  }

  const results = (data ?? []) as DeductRecipeStockResult[];

  return NextResponse.json({
    order_id: orderId,
    results,
    summary: {
      deducted: results.filter((r) => r.deducted).length,
      already_deducted: results.filter((r) => r.reason === "ALREADY_DEDUCTED").length,
      no_recipe: results.filter((r) => r.reason === "NO_RECIPE").length,
      voided: results.filter((r) => r.reason === "VOIDED").length,
    },
  });
}
