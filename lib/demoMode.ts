"use client";

import { useEffect, useState } from "react";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { createClient } from "@/lib/supabase/client";

// Hasil "tenant belum punya transaksi" di-cache sebentar supaya berpindah
// antar halaman tidak memicu belasan query count. TTL pendek supaya begitu
// transaksi pertama dibuat, contoh cepat hilang tanpa perlu reload penuh.
const TTL_MS = 10_000;
let cacheValue: boolean | null = null;
let cacheAt = 0;

/**
 * True kalau tenant BELUM punya satu pun transaksi.
 *
 * Ini satu-satunya pemicu "mode contoh": selama belum ada transaksi, halaman
 * yang mendukung menampilkan data contoh; setelah transaksi pertama ada,
 * semua contoh hilang.
 */
export async function tenantHasNoActivity(): Promise<boolean> {
  const now = Date.now();
  if (cacheValue !== null && now - cacheAt < TTL_MS) return cacheValue;

  let result = false;
  try {
    const { profile } = await getCurrentProfile();
    if (profile && profile.role !== "super_admin") {
      const { count } = await createClient()
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", profile.tenant_id);
      result = (count ?? 0) === 0;
    }
  } catch {
    result = false;
  }

  cacheValue = result;
  cacheAt = Date.now();
  return result;
}

/** Buang cache — panggil setelah checkout supaya status contoh ikut diperbarui. */
export function resetDemoModeCache() {
  cacheValue = null;
  cacheAt = 0;
}

/** Versi hook untuk komponen yang butuh reaktif (mis. banner). */
export function useDemoMode(): { isDemo: boolean; loading: boolean } {
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    tenantHasNoActivity().then((v) => {
      if (!active) return;
      setIsDemo(v);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { isDemo, loading };
}
