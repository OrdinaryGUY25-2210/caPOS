"use client";

import { createClient } from "@/lib/supabase/client";
import { db } from "@/lib/dexie";
import type { Profile } from "@/lib/types";

/**
 * Ambil profil (role, tenant_id, dll) dari user yang sedang login.
 * Dipakai di halaman dashboard/pos/admin untuk tahu tenant_id mana yang
 * boleh diakses — jangan pernah hardcode tenant_id di frontend untuk data
 * nyata (lihat celah #3 di audit sebelumnya soal total_amount).
 *
 * BUG FIX (offline mode /pos): `auth.getUser()` SELALU melakukan roundtrip
 * ke server Supabase Auth untuk verifikasi ulang token (beda dari
 * `auth.getSession()` yang cukup baca token dari local storage, tanpa
 * jaringan). Sebelumnya, kalau device sedang offline, `getUser()` gagal,
 * fungsi ini langsung balas { profile: null, userId: null }, dan halaman
 * /pos yang memanggilnya (`if (!profile || !userId) return;`) BERHENTI
 * TOTAL — termasuk logic pemuatan menu dari cache Dexie yang seharusnya
 * jadi andalan waktu offline. Sekarang: kalau berhasil online, hasilnya
 * disimpan ke cache lokal (db.authCache); kalau gagal (offline), jatuh ke
 * `getSession()` (lokal, tanpa jaringan) untuk tahu siapa yang login, lalu
 * ambil data profil dari cache tadi.
 */
export async function getCurrentProfile(): Promise<{
  profile: Profile | null;
  userId: string | null;
}> {
  const supabase = createClient();

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (profile) {
        // Simpan snapshot profil ini supaya bisa dipakai lagi sebagai
        // fallback kalau nanti device ini offline (lihat blok di bawah).
        await db.authCache.put({ id: user.id, profile, cachedAt: new Date().toISOString() }).catch(() => {});
        return { profile: profile as Profile, userId: user.id };
      }
      return { profile: null, userId: user.id };
    }
  } catch {
    // auth.getUser() melempar (network error dsb) — lanjut ke fallback offline di bawah.
  }

  // FALLBACK OFFLINE — getUser() gagal/tidak ada user (kemungkinan besar
  // karena tidak ada jaringan). getSession() tidak butuh jaringan sama
  // sekali karena cuma baca token yang sudah tersimpan di local storage
  // dari sesi login sebelumnya.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) return { profile: null, userId: null };

  const cached = await db.authCache.get(session.user.id).catch(() => undefined);
  if (cached?.profile) {
    return { profile: cached.profile as Profile, userId: session.user.id };
  }

  // Device ini belum pernah online sekali pun sambil login sebagai user
  // ini, jadi memang belum ada apa pun yang bisa dijadikan fallback.
  return { profile: null, userId: null };
}
