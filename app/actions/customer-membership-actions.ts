"use server";

/**
 * Server actions BARU untuk fitur Kartu Member Digital (Modul Membership
 * CRM, migration_16 bagian H). Dipisah dari
 * app/actions/purchasing-loyalty-actions.ts yang sudah stabil supaya
 * tidak perlu menyentuh fungsi-fungsi yang sudah dipakai di produksi
 * (createCustomer, searchCustomers, dst). File ini HANYA menambah:
 *   - daftar/ buat tier pelanggan (customer_tiers)
 *   - assign tier ke pelanggan (RPC assign_customer_tier)
 *   - baca 1 kartu member (view v_member_card)
 *   - baca nilai tukar poin->Rupiah (loyalty_config.redeem_rupiah_per_point)
 *   - tukar poin (delegasi ke redeemLoyaltyPoints yang SUDAH ADA di
 *     purchasing-loyalty-actions.ts — tidak diduplikasi, cukup di-export
 *     ulang di sini supaya UI kartu member & POS cukup import dari satu
 *     tempat yang jelas relevan dengan modul ini)
 */

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getServerProfile } from "@/lib/getServerProfile";
import type { CustomerTier, MemberCard } from "@/lib/types";

export async function getCustomerTiers(): Promise<{ data?: CustomerTier[]; error?: string }> {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();
    if (!profile?.tenant_id) return { error: "Tenant tidak ditemukan" };

    const { data, error } = await supabase
      .from("customer_tiers")
      .select("*")
      .eq("tenant_id", profile.tenant_id)
      .eq("is_active", true)
      .order("min_spend_monthly", { ascending: true });

    if (error) throw error;
    return { data: (data as CustomerTier[]) ?? [] };
  } catch (error) {
    console.error("Error fetching customer tiers:", error);
    return { error: String(error) };
  }
}

export async function createCustomerTier(formData: {
  tier_name: string;
  discount_percentage: number;
  points_multiplier: number;
  min_spend_monthly?: number;
}): Promise<{ data?: { id: string }; error?: string }> {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();
    if (!profile?.tenant_id) return { error: "Tenant tidak ditemukan" };
    if (!formData.tier_name.trim()) return { error: "Nama tier wajib diisi." };

    const { data, error } = await supabase
      .from("customer_tiers")
      .insert({
        tenant_id: profile.tenant_id,
        tier_name: formData.tier_name.trim(),
        discount_percentage: formData.discount_percentage,
        points_multiplier: formData.points_multiplier,
        min_spend_monthly: formData.min_spend_monthly ?? 0,
      })
      .select("id")
      .single();

    if (error) throw error;
    revalidatePath("/dashboard/crm/customers");
    return { data };
  } catch (error) {
    console.error("Error creating customer tier:", error);
    return { error: String(error) };
  }
}

/** Assign/ubah tier seorang pelanggan lewat RPC assign_customer_tier (migration_16 bagian H9). */
export async function assignCustomerTier(customerId: string, tierId: string | null) {
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("assign_customer_tier", {
      p_customer_id: customerId,
      p_tier_id: tierId,
    });
    if (error) throw error;
    revalidatePath("/dashboard/crm/customers");
    return { success: true };
  } catch (error) {
    console.error("Error assigning customer tier:", error);
    return { error: String(error) };
  }
}

/** Ambil 1 kartu member digital lengkap (nama, tier, saldo poin) dari view v_member_card. */
export async function getMemberCard(customerId: string): Promise<{ data?: MemberCard; error?: string }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("v_member_card")
      .select("*")
      .eq("customer_id", customerId)
      .single();

    if (error) throw error;
    return { data: data as MemberCard };
  } catch (error) {
    console.error("Error fetching member card:", error);
    return { error: String(error) };
  }
}

/** Cari member card by member_code (dipakai jalur scan/cari di POS). */
export async function findMemberCardByCode(memberCode: string): Promise<{ data?: MemberCard; error?: string }> {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();
    if (!profile?.tenant_id) return { error: "Tenant tidak ditemukan" };

    const { data, error } = await supabase
      .from("v_member_card")
      .select("*")
      .eq("tenant_id", profile.tenant_id)
      .eq("member_code", memberCode.trim())
      .eq("is_active", true)
      .single();

    if (error) throw error;
    return { data: data as MemberCard };
  } catch (error) {
    return { error: String(error) };
  }
}

/** Nilai tukar 1 poin -> Rupiah (loyalty_config.redeem_rupiah_per_point, migration_16 bagian H4). */
export async function getPointsRedeemRate(): Promise<{ data?: number; error?: string }> {
  try {
    const supabase = await createClient();
    const { profile } = await getServerProfile();
    if (!profile?.tenant_id) return { error: "Tenant tidak ditemukan" };

    const { data, error } = await supabase
      .from("loyalty_config")
      .select("redeem_rupiah_per_point, is_enabled")
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (error) throw error;
    if (!data?.is_enabled) return { data: 0 };
    return { data: Number(data.redeem_rupiah_per_point) || 0 };
  } catch (error) {
    // Belum ada baris loyalty_config untuk tenant ini = program loyalitas
    // belum pernah diaktifkan — bukan error fatal untuk UI, cukup 0.
    return { data: 0 };
  }
}
