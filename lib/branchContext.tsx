"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import type { Branch } from "@/lib/types";

/** Kunci localStorage — supaya pilihan cabang Owner tetap sama walau reload/tab baru. */
const STORAGE_KEY = "capos_selected_branch";

/** Nilai spesial untuk "Laporan Konsolidasi (Gabungan Seluruh Cabang)". */
export const ALL_BRANCHES = "all" as const;

interface BranchContextValue {
  /** Semua cabang tenant (hanya terisi untuk owner — manager/kasir tidak perlu daftar lengkap ini). */
  branches: Branch[];
  /** ID cabang yang sedang dipilih, atau ALL_BRANCHES untuk Laporan Konsolidasi. */
  selectedBranchId: string | typeof ALL_BRANCHES;
  /** Cabang yang sedang aktif dilihat (null kalau ALL_BRANCHES atau belum termuat). */
  selectedBranch: Branch | null;
  /** true kalau user boleh switch cabang (owner/super_admin) — manager/kasir terkunci ke 1 cabang. */
  canSwitchBranch: boolean;
  /** Cabang penugasan user (untuk manager/kasir) — dipakai sebagai satu-satunya opsi. */
  ownBranchId: string | null;
  loading: boolean;
  setSelectedBranchId: (id: string | typeof ALL_BRANCHES) => void;
  refreshBranches: () => Promise<void>;
}

const BranchContext = createContext<BranchContextValue | null>(null);

export function BranchProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchIdState] = useState<string | typeof ALL_BRANCHES>(ALL_BRANCHES);
  const [canSwitchBranch, setCanSwitchBranch] = useState(false);
  const [ownBranchId, setOwnBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }

    const isOwnerLike = profile.role === "owner" || profile.role === "super_admin";
    setCanSwitchBranch(isOwnerLike);
    setOwnBranchId(profile.branch_id);

    const supabase = createClient();
    const { data } = await supabase
      .from("branches")
      .select("*")
      .eq("tenant_id", profile.tenant_id)
      .order("is_main", { ascending: false })
      .order("created_at", { ascending: true });

    const list = (data as Branch[]) ?? [];
    setBranches(list);

    if (isOwnerLike) {
      // Owner: pulihkan pilihan tersimpan (kalau masih valid), default ke
      // Laporan Konsolidasi kalau belum pernah pilih apa-apa.
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (saved && (saved === ALL_BRANCHES || list.some((b) => b.id === saved))) {
        setSelectedBranchIdState(saved);
      } else {
        setSelectedBranchIdState(ALL_BRANCHES);
      }
    } else {
      // Manager/Kasir: terkunci ke cabang penugasannya sendiri, tidak ada
      // pilihan Konsolidasi (mereka memang cuma boleh lihat 1 cabang).
      setSelectedBranchIdState(profile.branch_id ?? ALL_BRANCHES);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setSelectedBranchId = useCallback(
    (id: string | typeof ALL_BRANCHES) => {
      setSelectedBranchIdState(id);
      if (canSwitchBranch && typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, id);
      }
    },
    [canSwitchBranch]
  );

  const selectedBranch = selectedBranchId === ALL_BRANCHES ? null : branches.find((b) => b.id === selectedBranchId) ?? null;

  return (
    <BranchContext.Provider
      value={{
        branches,
        selectedBranchId,
        selectedBranch,
        canSwitchBranch,
        ownBranchId,
        loading,
        setSelectedBranchId,
        refreshBranches: load,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) {
    throw new Error("useBranch harus dipanggil di dalam <BranchProvider>. Bungkus halaman dengan DashboardShell.");
  }
  return ctx;
}

/**
 * Terapkan filter cabang ke sebuah Supabase query builder — helper kecil
 * supaya tiap halaman laporan tidak menulis ulang logika "kalau ALL_BRANCHES
 * jangan difilter, kalau tidak filter branch_id" berkali-kali.
 */
export function applyBranchFilter<T extends { eq: (col: string, val: string) => T }>(
  query: T,
  selectedBranchId: string | typeof ALL_BRANCHES
): T {
  if (selectedBranchId === ALL_BRANCHES) return query;
  return query.eq("branch_id", selectedBranchId);
}
