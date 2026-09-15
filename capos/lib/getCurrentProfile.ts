"use client";

import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

/**
 * Ambil profil (role, tenant_id, dll) dari user yang sedang login.
 * Dipakai di halaman dashboard/pos/admin untuk tahu tenant_id mana yang
 * boleh diakses — jangan pernah hardcode tenant_id di frontend untuk data
 * nyata (lihat celah #3 di audit sebelumnya soal total_amount).
 */
export async function getCurrentProfile(): Promise<{
  profile: Profile | null;
  userId: string | null;
}> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { profile: null, userId: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return { profile: (profile as Profile) ?? null, userId: user.id };
}
