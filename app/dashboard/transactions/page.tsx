"use client";

import { useEffect, useState } from "react";
import { Receipt as ReceiptIcon, Lock, User, RotateCcw } from "lucide-react";
import Link from "next/link";
import { formatRupiah } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, FREE_TIER_LIMITS, TIER_LABEL, type Tier } from "@/lib/tier";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import { Skeleton, SkeletonList } from "@/components/Skeleton";
import RefundModal from "@/components/pos/RefundModal";

interface TxRow {
  id: string;
  invoice_number: string;
  total_amount: number;
  payment_method: string;
  created_at: string;
  cashier_name: string | null;
  branch_name: string | null;
  // Badge refund (BARU) — diisi lewat query terpisah ke tabel refunds
  // setelah daftar transaksi termuat (lihat di bawah).
  refundStatus: "PENDING_APPROVAL" | "COMPLETED" | null;
  refundedAmount: number;
}

export default function TransactionsPage() {
  const { selectedBranchId, canSwitchBranch } = useBranch();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [tier, setTier] = useState<Tier>("free");
  const [loading, setLoading] = useState(true);
  const [refundTarget, setRefundTarget] = useState<TxRow | null>(null);

  async function loadTransactions() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }

      const supabase = createClient();
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("status, plan")
        .eq("tenant_id", profile.tenant_id)
        .single();

      const currentTier = profile.role === "super_admin" ? "supreme" : getTier(sub);
      setTier(currentTier);

      let query = supabase
        .from("transactions")
        .select("id, invoice_number, total_amount, payment_method, created_at, profiles(full_name), branches(name)")
        .eq("tenant_id", profile.tenant_id)
        .order("created_at", { ascending: false });

      // Filter cabang: "Semua Cabang" (Laporan Konsolidasi) tidak difilter;
      // manager/kasir otomatis terkunci ke cabang mereka lewat context.
      if (selectedBranchId !== ALL_BRANCHES) {
        query = query.eq("branch_id", selectedBranchId);
      }

      // Tier Free hanya bisa lihat N hari terakhir — dibatasi di query
      // (bukan cuma dipotong tampilannya), supaya lebih hemat data yang
      // ditarik dari server juga.
      if (currentTier === "free") {
        const cutoff = new Date(Date.now() - FREE_TIER_LIMITS.historyDays * 24 * 60 * 60 * 1000);
        query = query.gte("created_at", cutoff.toISOString());
      } else {
        query = query.limit(200); // tetap dibatasi wajar biar query tidak berat
      }

      const { data } = await query;

      const txRows: TxRow[] = (data ?? []).map((t: any) => ({
        id: t.id,
        invoice_number: t.invoice_number,
        total_amount: t.total_amount,
        payment_method: t.payment_method,
        created_at: t.created_at,
        cashier_name: t.profiles?.full_name ?? null,
        branch_name: t.branches?.name ?? null,
        refundStatus: null,
        refundedAmount: 0,
      }));

      // Badge "Sudah di-refund" (BARU) — query terpisah ke refunds untuk
      // transaksi yang baru dimuat, supaya query utama di atas tetap
      // ringan (tidak perlu join manual per baris ke refunds).
      if (txRows.length > 0) {
        const { data: refundRows } = await supabase
          .from("refunds")
          .select("transaction_id, status, amount")
          .in("transaction_id", txRows.map((t) => t.id))
          .neq("status", "REJECTED");

        const byTx = new Map<string, { status: "PENDING_APPROVAL" | "COMPLETED"; amount: number }>();
        for (const r of refundRows ?? []) {
          const prev = byTx.get(r.transaction_id);
          const amount = (prev?.amount ?? 0) + Number(r.amount);
          // PENDING_APPROVAL menang di badge kalau ada campuran status,
          // supaya Owner tahu ada yang masih perlu keputusan.
          const status = prev?.status === "PENDING_APPROVAL" || r.status === "PENDING_APPROVAL" ? "PENDING_APPROVAL" : "COMPLETED";
          byTx.set(r.transaction_id, { status, amount });
        }
        for (const t of txRows) {
          const match = byTx.get(t.id);
          if (match) {
            t.refundStatus = match.status;
            t.refundedAmount = match.amount;
          }
        }
      }

      setRows(txRows);
      setLoading(false);
  }

  useEffect(() => {
    loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3 w-60" />
          </div>
        </div>
        <SkeletonList rows={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Riwayat Transaksi</h1>
          <p className="text-sm text-neutral-500">
            {tier === "free"
              ? `Menampilkan ${FREE_TIER_LIMITS.historyDays} hari terakhir (paket ${TIER_LABEL.free})`
              : "Riwayat lengkap transaksi kafe Anda"}
          </p>
        </div>
        {tier === "free" && (
          <Link href="/dashboard/subscription" className="btn-outline flex items-center gap-1.5 text-sm">
            <Lock size={14} /> Upgrade untuk riwayat lengkap
          </Link>
        )}
      </div>

      <div className="card divide-y divide-neutral-100">
        {rows.map((t) => (
          <div key={t.id} className="flex items-center justify-between p-4 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-primary-light text-primary-dark flex items-center justify-center shrink-0">
                <ReceiptIcon size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900 font-mono truncate">{t.invoice_number}</p>
                <p className="text-xs text-neutral-400 flex items-center gap-1">
                  <User size={11} />
                  {t.cashier_name ?? "Kasir"} · {new Date(t.created_at).toLocaleString("id-ID")}
                  {canSwitchBranch && selectedBranchId === ALL_BRANCHES && t.branch_name && <> · {t.branch_name}</>}
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="font-bold text-neutral-900 text-sm">{formatRupiah(t.total_amount)}</p>
              <p className="text-xs text-neutral-400 uppercase">{t.payment_method}</p>
              {t.refundStatus && (
                <span
                  className={
                    "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full mt-1 " +
                    (t.refundStatus === "COMPLETED" ? "bg-urgent-light text-urgent" : "bg-amber-100 text-amber-700")
                  }
                >
                  <RotateCcw size={10} />
                  {t.refundStatus === "COMPLETED"
                    ? `Sudah di-refund (${formatRupiah(t.refundedAmount)})`
                    : "Refund diajukan"}
                </span>
              )}
              <button
                onClick={() => setRefundTarget(t)}
                className="text-xs text-urgent flex items-center gap-1 mt-1 ml-auto"
              >
                <RotateCcw size={11} /> Refund
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="p-8 text-center text-neutral-400 text-sm">
            {tier === "free"
              ? `Belum ada transaksi dalam ${FREE_TIER_LIMITS.historyDays} hari terakhir.`
              : "Belum ada transaksi tercatat."}
          </p>
        )}
      </div>

      {refundTarget && (
        <RefundModal
          transactionId={refundTarget.id}
          invoiceNumber={refundTarget.invoice_number}
          totalAmount={refundTarget.total_amount}
          onClose={() => {
            setRefundTarget(null);
            loadTransactions(); // refresh badge refund kalau ada perubahan
          }}
        />
      )}
    </div>
  );
}
