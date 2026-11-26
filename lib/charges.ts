"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";

/**
 * Biaya layanan (service charge) & pajak. Rumus IDENTIK dengan fungsi
 * calc_charges() di database (migration_021) — server tetap yang menentukan
 * total sebenarnya; ini hanya untuk pratinjau layar & struk.
 *
 *   dasar   = subtotal - diskon
 *   service = dasar x service%
 *   pajak   = (dasar + service) x pajak%         (mode ditambahkan)
 *   total   = dasar + service + pajak
 *   Mode "sudah termasuk": pajak = (dasar + service) x p/(100+p), total = dasar + service
 *
 * Persentase dibatasi 2 desimal (NUMERIC(5,2) di DB) dan dihitung dengan
 * bilangan bulat agar pembulatannya sama persis dengan database.
 */
export interface ChargeSettings {
  servicePct: number;
  taxPct: number;
  taxInclusive: boolean;
  /** Nama yang tampil di kasir/struk/laporan, mis. "Service Charge", "PPN", "PB1". */
  serviceLabel: string;
  taxLabel: string;
}

export interface ChargeBreakdown {
  base: number;
  service: number;
  tax: number;
  total: number;
}

export const DEFAULT_SERVICE_LABEL = "Service";
export const DEFAULT_TAX_LABEL = "Pajak";

export const NO_CHARGES: ChargeSettings = {
  servicePct: 0,
  taxPct: 0,
  taxInclusive: false,
  serviceLabel: DEFAULT_SERVICE_LABEL,
  taxLabel: DEFAULT_TAX_LABEL,
};

export function computeCharges(base: number, s: ChargeSettings): ChargeBreakdown {
  const b = Math.max(0, Math.round(base));
  const sp = Math.round((s.servicePct || 0) * 100); // persen x 100 (integer)
  const tp = Math.round((s.taxPct || 0) * 100);
  const service = Math.round((b * sp) / 10000);
  const taxable = b + service;
  if (s.taxInclusive) {
    const tax = Math.round((taxable * tp) / (10000 + tp));
    return { base: b, service, tax, total: taxable };
  }
  const tax = Math.round((taxable * tp) / 10000);
  return { base: b, service, tax, total: taxable + tax };
}

export function hasCharges(s: ChargeSettings) {
  return s.servicePct > 0 || s.taxPct > 0;
}

let cached: ChargeSettings | null = null;
let inflight: Promise<ChargeSettings> | null = null;

async function load(): Promise<ChargeSettings> {
  try {
    const { profile } = await getCurrentProfile();
    if (!profile) return NO_CHARGES;
    const supabase = createClient();
    // Kolom nama (migration_022) bisa belum ada → ulangi tanpa kolom itu agar persen tetap terbaca.
    const first = await supabase
      .from("tenants")
      .select("service_charge_pct, tax_pct, tax_inclusive, service_label, tax_label")
      .eq("id", profile.tenant_id)
      .single();
    let data = first.data;
    if (first.error) {
      ({ data } = await supabase.from("tenants").select("service_charge_pct, tax_pct, tax_inclusive").eq("id", profile.tenant_id).single());
    }
    if (!data) return NO_CHARGES;
    const d = data as Record<string, unknown>;
    return {
      servicePct: Number(d.service_charge_pct ?? 0),
      taxPct: Number(d.tax_pct ?? 0),
      taxInclusive: !!d.tax_inclusive,
      serviceLabel: String(d.service_label ?? "").trim() || DEFAULT_SERVICE_LABEL,
      taxLabel: String(d.tax_label ?? "").trim() || DEFAULT_TAX_LABEL,
    };
  } catch {
    return NO_CHARGES; // kolom belum ada (migration_021 belum dijalankan) / offline → tanpa biaya
  }
}

export function resetChargeSettingsCache() {
  cached = null;
  inflight = null;
}

/** Pengaturan biaya tenant (di-cache selama sesi halaman). */
export function useChargeSettings(): ChargeSettings {
  const [settings, setSettings] = useState<ChargeSettings>(cached ?? NO_CHARGES);
  useEffect(() => {
    if (cached) {
      setSettings(cached);
      return;
    }
    inflight = inflight ?? load();
    inflight.then((v) => {
      cached = v;
      setSettings(v);
    });
  }, []);
  return settings;
}
