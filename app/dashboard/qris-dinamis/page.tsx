"use client";

import { useEffect, useState } from "react";
import { ScanLine, Building2, RefreshCw, CheckCircle2, Clock, XCircle, AlertTriangle } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import { Skeleton, SkeletonList } from "@/components/Skeleton";

/**
 * Riwayat QRIS Dinamis kasir POS (migration_018) — murni BACA dari
 * `pos_qris_payments`, yang RLS-nya sudah scoped tenant/branch (owner
 * lihat semua cabang, manager/kasir cuma cabang sendiri), sama seperti
 * pola app/dashboard/cancellations. Tidak ada tulis di sini SAMA SEKALI
 * — status hanya pernah diubah oleh webhook (app/api/midtrans/notification)
 * atau oleh route status-nendiri saat menandai kedaluwarsa
 * (app/api/pos/qris-status/[orderId]).
 */

const STATUS_LABEL: Record<string, string> = {
  pending: "Menunggu Pembayaran",
  paid: "Lunas",
  failed: "Gagal",
  expired: "Kedaluwarsa",
};

const STATUS_ICON: Record<string, any> = {
  pending: Clock,
  paid: CheckCircle2,
  failed: XCircle,
  expired: AlertTriangle,
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending: "badge-warning",
  paid: "badge-active",
  failed: "badge-urgent",
  expired: "badge-urgent",
};

interface Row {
  id: string;
  order_id: string;
  gross_amount: number;
  status: string;
  created_at: string;
  branch_name: string | null;
}

export default function QrisDinamisPage() {
  const { selectedBranchId, canSwitchBranch } = useBranch();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }

    const supabase = createClient();
    let query = supabase
      .from("pos_qris_payments")
      .select("id, order_id, gross_amount, status, created_at, branches(name)")
      .eq("tenant_id", profile.tenant_id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (selectedBranchId !== ALL_BRANCHES) {
      query = query.eq("branch_id", selectedBranchId);
    }

    const { data } = await query;
    setRows(
      (data ?? []).map((r: any) => ({
        id: r.id,
        order_id: r.order_id,
        gross_amount: Number(r.gross_amount),
        status: r.status,
        created_at: r.created_at,
        branch_name: r.branches?.name ?? null,
      }))
    );
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [selectedBranchId]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

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

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            <ScanLine size={20} className="text-neutral-400" /> QRIS Dinamis (Kasir)
          </h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            Riwayat transaksi QRIS Dinamis Midtrans dari kasir POS (200 terakhir) — terpisah dari langganan aplikasi.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-neutral-200 text-neutral-600 hover:bg-neutral-100 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          Muat Ulang
        </button>
      </div>

      {pendingCount > 0 && (
        <div className="rounded-xl bg-warning-light text-warning text-sm px-4 py-3">
          {pendingCount} transaksi masih <strong>Menunggu Pembayaran</strong>. Kode QRIS Midtrans biasanya kedaluwarsa
          otomatis sekitar 5 menit setelah dibuat kalau tidak dibayar — statusnya akan berubah sendiri saat kasir
          membuka ulang transaksi tersebut di /pos.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card p-10 text-center text-sm text-neutral-400">Belum ada transaksi QRIS Dinamis.</div>
      ) : (
        <div className="card divide-y divide-neutral-100">
          {rows.map((r) => {
            const Icon = STATUS_ICON[r.status] ?? Clock;
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-neutral-900">{formatRupiah(r.gross_amount)}</p>
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE_CLASS[r.status] ?? "badge-urgent"}`}>
                      <Icon size={11} />
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400 flex items-center gap-2 mt-1 flex-wrap font-mono">
                    {r.order_id}
                  </p>
                  <p className="text-xs text-neutral-400 flex items-center gap-2 mt-1 flex-wrap">
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
