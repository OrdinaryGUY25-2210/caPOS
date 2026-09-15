"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, TIER_LABEL, type Tier } from "@/lib/tier";
import { Skeleton } from "@/components/Skeleton";

/**
 * Phase 2A.2 §7-8 (Revision 01 audit finding) — beberapa halaman analitik
 * (Jam Sibuk, Menu Engineering) dipasarkan sebagai fitur EKSKLUSIF Supreme
 * di halaman Langganan (`COMPARISON_ROWS`: "Jam Ramai (Peak Hours)" dan
 * "Menu Terlaris" → supreme: true, free/pro: false), tapi sebelum
 * perbaikan ini halamannya sendiri tidak punya pengecekan tier SAMA
 * SEKALI — siapa pun yang tahu URL-nya (atau klik dari sidebar, yang juga
 * menampilkannya ke semua role tanpa penanda kunci) langsung dapat akses
 * penuh walau masih Free/Pro. Ini pelanggaran langsung terhadap §7/§8:
 * "Feature visibility must reflect actual authorization/business logic"
 * dan "must remain synchronized with the actual entitlement logic".
 *
 * Komponen ini menutup celah itu di level HALAMAN (bukan cuma
 * menyembunyikan link di sidebar, yang gampang dilewati dengan akses URL
 * langsung) — dibungkus di sekitar konten yang genuinely Supreme-only.
 */
export default function PremiumFeatureLock({
  featureName,
  minTier = "supreme",
  children,
}: {
  /** Nama fitur untuk pesan upgrade, mis. "Jam Sibuk (Peak Hours)". */
  featureName: string;
  /** Tier minimum yang boleh akses. Default "supreme" (perilaku lama, dipakai Jam Sibuk). */
  minTier?: Tier;
  children: React.ReactNode;
}) {
  const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, supreme: 2 };
  const [loading, setLoading] = useState(true);
  const [tier, setTier] = useState<Tier>("free");

  useEffect(() => {
    (async () => {
      const { profile } = await getCurrentProfile();
      if (!profile) {
        setLoading(false);
        return;
      }
      if (profile.role === "super_admin") {
        setTier("supreme");
        setLoading(false);
        return;
      }
      const { data: sub } = await createClient()
        .from("subscriptions")
        .select("status, plan")
        .eq("tenant_id", profile.tenant_id)
        .single();
      setTier(getTier(sub));
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (TIER_RANK[tier] < TIER_RANK[minTier]) {
    return (
      <div className="card p-8 text-center max-w-md mx-auto">
        <div className="w-12 h-12 rounded-xl bg-warning-light flex items-center justify-center mx-auto mb-3">
          <Lock className="text-warning" size={22} />
        </div>
        <h2 className="font-semibold text-neutral-900 mb-1">{featureName} — Fitur {TIER_LABEL[minTier]}</h2>
        <p className="text-sm text-neutral-500 mb-4">
          Fitur ini khusus untuk paket {TIER_LABEL[minTier]} ke atas. Paket Anda saat ini: {TIER_LABEL[tier]}.
        </p>
        <Link href="/dashboard/subscription" className="btn-primary inline-flex items-center gap-1.5">
          <Lock size={14} /> Upgrade ke {TIER_LABEL[minTier]}
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
