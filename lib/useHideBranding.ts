"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";

/**
 * Apakah watermark "powered by caPOS" disembunyikan di struk? True hanya jika
 * (1) tenants.receipt_hide_branding aktif DAN (2) tenant masih Supreme saat
 * ini. Syarat (2) dicek ulang di sini supaya tenant yang sudah turun paket
 * tidak lagi memakainya walau flag lama masih tersimpan.
 * Hasil di-cache selama sesi halaman agar tiap <Receipt/> tidak query ulang.
 */
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

async function load(): Promise<boolean> {
  try {
    const { profile } = await getCurrentProfile();
    if (!profile) return false;
    const supabase = createClient();
    const { data: tenant } = await supabase.from("tenants").select("receipt_hide_branding").eq("id", profile.tenant_id).single();
    if (!tenant?.receipt_hide_branding) return false;
    if (profile.role === "super_admin") return true;
    const { data: tier } = await supabase.rpc("tenant_tier", { p_tenant_id: profile.tenant_id });
    return tier === "supreme";
  } catch {
    return false; // gagal/offline → tampilkan watermark (default aman)
  }
}

export function resetHideBrandingCache() {
  cached = null;
  inflight = null;
}

export function useHideBranding(explicit?: boolean): boolean {
  const [value, setValue] = useState<boolean>(explicit ?? cached ?? false);
  useEffect(() => {
    if (explicit !== undefined) {
      setValue(explicit);
      return;
    }
    if (cached !== null) {
      setValue(cached);
      return;
    }
    inflight = inflight ?? load();
    inflight.then((v) => {
      cached = v;
      setValue(v);
    });
  }, [explicit]);
  return value;
}
