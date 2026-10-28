"use client";

import { useCallback, useEffect, useState } from "react";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { createClient } from "@/lib/supabase/client";

// Hasil "tenant belum punya transaksi" di-cache sebentar supaya berpindah
// antar halaman tidak memicu belasan query count. TTL pendek supaya begitu
// transaksi pertama dibuat, contoh cepat hilang tanpa perlu reload penuh.
const TTL_MS = 10_000;
let cacheValue: boolean | null = null;
let cacheAt = 0;

/**
 * Kunci localStorage untuk "saya sudah paham, sembunyikan mode contoh".
 *
 * PENTING: tanpa ini, tenant baru terjebak — mode contoh hanya hilang setelah
 * ada transaksi, sementara transaksi pertama ditolak oleh guard mode contoh.
 * Tombol tutup pada banner sekarang benar-benar menyimpan pilihan pengguna,
 * sehingga guard penjualan tidak bisa mengunci kafe baru selamanya.
 */
const DISMISS_KEY = "capos:demo-dismissed:v1";

/** Event internal: semua komponen yang memakai hook ikut berubah tanpa reload. */
const DEMO_EVENT = "capos:demo-mode-changed";

function safeGetItem(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    // Mode privat / storage diblokir → anggap belum ditutup.
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  } catch {
    // Diabaikan: kegagalan menyimpan preferensi tidak boleh memblokir UI.
  }
}

function broadcast(): void {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(DEMO_EVENT));
  } catch {
    // Diabaikan.
  }
}

/** True kalau pengguna sudah menutup mode contoh secara permanen di perangkat ini. */
export function isDemoDismissed(): boolean {
  return safeGetItem(DISMISS_KEY) === "1";
}

/**
 * Sembunyikan mode contoh untuk seterusnya (per perangkat).
 * Dipanggil dari tombol tutup banner; cache in-memory ikut dimatikan supaya
 * guard yang membaca `tenantHasNoActivity()` langsung berhenti memblokir.
 */
export function dismissDemoMode(): void {
  safeSetItem(DISMISS_KEY, "1");
  cacheValue = false;
  cacheAt = Date.now();
  broadcast();
}

/**
 * True kalau tenant BELUM punya satu pun transaksi.
 *
 * Ini satu-satunya pemicu "mode contoh": selama belum ada transaksi, halaman
 * yang mendukung menampilkan data contoh; setelah transaksi pertama ada,
 * semua contoh hilang.
 *
 * CATATAN: fungsi ini hanya boleh dipakai untuk MEMILIH DATA YANG DITAMPILKAN.
 * Jangan pernah dipakai untuk menolak transaksi/penjualan — itu yang membuat
 * tenant baru tidak bisa bertransaksi sama sekali.
 */
export async function tenantHasNoActivity(): Promise<boolean> {
  // Pengguna sudah menutup mode contoh → jangan pernah aktif lagi.
  if (isDemoDismissed()) return false;

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
export function resetDemoModeCache(): void {
  cacheValue = null;
  cacheAt = 0;
  broadcast();
}

/** Versi hook untuk komponen yang butuh reaktif (mis. banner). */
export function useDemoMode(): {
  isDemo: boolean;
  loading: boolean;
  dismiss: () => void;
} {
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const evaluate = () => {
      tenantHasNoActivity().then((v) => {
        if (!active) return;
        setIsDemo(v);
        setLoading(false);
      });
    };

    evaluate();

    const onChange = () => {
      cacheValue = null;
      cacheAt = 0;
      evaluate();
    };

    window.addEventListener(DEMO_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      active = false;
      window.removeEventListener(DEMO_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const dismiss = useCallback(() => {
    dismissDemoMode();
  }, []);

  return { isDemo, loading, dismiss };
}
