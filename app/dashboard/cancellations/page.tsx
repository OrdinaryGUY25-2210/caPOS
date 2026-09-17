"use client";

import { useEffect, useState } from "react";
import { History, User, Building2, Undo2, XCircle } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import { Skeleton, SkeletonList } from "@/components/Skeleton";

/**
 * Log Pembatalan (BARU) — sebelumnya alasan pembatalan pesanan/item cuma
 * tersimpan di tabel audit_log (ditulis oleh cancel_order()/
 * void_order_item(), migration_013) tanpa satu pun halaman yang
 * membacanya. Kartu KDS sempat menampilkan orders.notes, tapi order yang
 * sudah CANCELLED otomatis difilter keluar dari layar KDS — jadi alasan
 * pembatalan praktis tidak pernah terlihat lagi setelah kejadian. Halaman
 * ini murni BACA dari audit_log yang sudah ada (tidak ada perubahan
 * skema/RLS — tabelnya sudah readable lewat kebijakan branch-scoped yang
 * sudah ada di migration_013).
 */

const ACTION_LABEL: Record<string, string> = {
  VOID_ORDER: "Pembatalan Pesanan",
  VOID_ITEM: "Pembatalan Item",
};

const ACTION_ICON: Record<string, any> = {
  VOID_ORDER: XCircle,
  VOID_ITEM: Undo2,
};

interface LogRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string | null;
  new_value: { amount?: number } | null;
  created_at: string;
  user_name: string | null;
  branch_name: string | null;
}

export default function CancellationsPage() {
  const { selectedBranchId, canSwitchBranch } = useBranch();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { profile } = await getCurrentProfile();
      if (!profile) {
        setLoading(false);
        return;
      }

      const supabase = createClient();
      let query = supabase
        .from("audit_log")
        .select("id, action, entity_type, entity_id, reason, new_value, created_at, profiles(full_name), branches(name)")
        .eq("tenant_id", profile.tenant_id)
        .in("action", ["VOID_ORDER", "VOID_ITEM"])
        .order("created_at", { ascending: false })
        .limit(200);

      if (selectedBranchId !== ALL_BRANCHES) {
        query = query.eq("branch_id", selectedBranchId);
      }

      const { data } = await query;
      setRows(
        (data ?? []).map((r: any) => ({
          id: r.id,
          action: r.action,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          reason: r.reason,
          new_value: r.new_value,
          created_at: r.created_at,
          user_name: r.profiles?.full_name ?? null,
          branch_name: r.branches?.name ?? null,
        }))
      );
      setLoading(false);
    })();
  }, [selectedBranchId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3 w-60" />
        </div>
        <SkeletonList rows={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
          <History size={20} className="text-neutral-400" /> Log Pembatalan
        </h1>
        <p className="text-sm text-neutral-500">
          Riwayat alasan pembatalan pesanan &amp; item dari kasir/manager (200 terakhir).
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-neutral-400">
          Belum ada riwayat pembatalan.
        </div>
      ) : (
        <div className="card divide-y divide-neutral-100">
          {rows.map((r) => {
            const Icon = ACTION_ICON[r.action] ?? History;
            return (
              <div key={r.id} className="flex items-start gap-3 p-4">
                <div className="w-9 h-9 rounded-xl bg-urgent-light text-urgent flex items-center justify-center shrink-0 mt-0.5">
                  <Icon size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-neutral-900">
                      {ACTION_LABEL[r.action] ?? r.action}
                    </p>
                    {typeof r.new_value?.amount === "number" && (
                      <span className="text-xs font-semibold text-urgent">
                        {formatRupiah(r.new_value.amount)}
                      </span>
                    )}
                  </div>
                  {r.reason && <p className="text-sm text-neutral-600 mt-0.5">&quot;{r.reason}&quot;</p>}
                  <p className="text-xs text-neutral-400 flex items-center gap-2 mt-1 flex-wrap">
                    <span className="flex items-center gap-1">
                      <User size={11} /> {r.user_name ?? "Tidak diketahui"}
                    </span>
                    {canSwitchBranch && selectedBranchId === ALL_BRANCHES && r.branch_name && (
                      <span className="flex items-center gap-1">
                        <Building2 size={11} /> {r.branch_name}
                      </span>
                    )}
                    <span>{new Date(r.created_at).toLocaleString("id-ID")}</span>
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
