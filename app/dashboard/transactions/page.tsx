"use client";

import { useEffect, useState } from "react";
import { Receipt as ReceiptIcon, Lock, Loader2, User } from "lucide-react";
import Link from "next/link";
import { formatRupiah } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, FREE_TIER_LIMITS, TIER_LABEL, type Tier } from "@/lib/tier";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";

interface TxRow {
  id: string;
  invoice_number: string;
  total_amount: number;
  payment_method: string;
  created_at: string;
  cashier_name: string | null;
  branch_name: string | null;
}

export default function TransactionsPage() {
  const { selectedBranchId, canSwitchBranch } = useBranch();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [tier, setTier] = useState<Tier>("free");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
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

      setRows(
        (data ?? []).map((t: any) => ({
          id: t.id,
          invoice_number: t.invoice_number,
          total_amount: t.total_amount,
          payment_method: t.payment_method,
          created_at: t.created_at,
          cashier_name: t.profiles?.full_name ?? null,
          branch_name: t.branches?.name ?? null,
        }))
      );
      setLoading(false);
    })();
  }, [selectedBranchId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-400">
        <Loader2 className="animate-spin mr-2" size={18} /> Memuat riwayat transaksi...
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
    </div>
  );
}
