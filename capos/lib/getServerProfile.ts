import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Versi SERVER dari getCurrentProfile() (lib/getCurrentProfile.ts memakai
 * @/lib/supabase/client, yang TIDAK bisa dipanggil dari Server Action /
 * Route Handler — tidak ada akses ke cookie request di sana, jadi
 * auth.getUser() akan selalu balik null di server).
 *
 * Dipakai di app/actions/*.ts (Server Actions Phase 3) untuk mengetahui
 * tenant_id/role user yang sedang login sebelum insert/update data.
 *
 * PERBAIKAN (merge notes): app/actions/purchasing-loyalty-actions.ts
 * versi asli (Phase 3) memanggil getCurrentProfile() versi client di
 * dalam Server Action — ini bug (selalu gagal dengan "Tenant tidak
 * ditemukan"). Sudah diganti untuk memakai helper ini. Lihat
 * docs/CATATAN_PENGGABUNGAN.md bagian "Bug yang diperbaiki".
 */
export async function getServerProfile(): Promise<{
  profile: Profile | null;
  userId: string | null;
}> {
  const supabase = await createClient();
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
