"use client";
 
import { useEffect, useState } from "react";
import { Receipt as ReceiptIcon, Lock, User, RotateCcw, Filter, HandCoins, XCircle, Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { formatRupiah } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { getTier, FREE_TIER_LIMITS, TIER_LABEL, type Tier } from "@/lib/tier";
import { useBranch, ALL_BRANCHES } from "@/lib/branchContext";
import { Skeleton, SkeletonList } from "@/components/Skeleton";
import RefundModal from "@/components/pos/RefundModal";
import Modal from "@/components/Modal";
import SupervisorPinModal from "@/components/SupervisorPinModal";
import { tenantHasNoActivity } from "@/lib/demoMode";
import DemoBadge from "@/components/demo/DemoBadge";
import { DEMO_TX_ROWS } from "@/lib/demoData";

interface TxRow {
  id: string;
  invoice_number: string;
  total_amount: number;
  payment_method: string;
  created_at: string;
  cashier_name: string | null;
  branch_name: string | null;
  branch_id: string | null;
  // Badge refund (BARU) — diisi lewat query terpisah ke tabel refunds
  // setelah daftar transaksi termuat (lihat di bawah).
  refundStatus: "PENDING_APPROVAL" | "COMPLETED" | null;
  refundedAmount: number;
  // migration_023 — uang tunai & siklus kembalian.
  cash_received?: number | null;
  change_amount?: number;
  change_status?: "NONE" | "PENDING" | "SETTLED" | "WRITTEN_OFF";
  change_due_at?: string | null;
}

interface BranchOption {
  id: string;
  name: string;
}

export default function TransactionsPage() {
  const { selectedBranchId, canSwitchBranch } = useBranch();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [tier, setTier] = useState<Tier>("free");
  const [loading, setLoading] = useState(true);
  const [refundTarget, setRefundTarget] = useState<TxRow | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>(selectedBranchId);

  // migration_023 — kelola kembalian PENDING langsung dari riwayat.
  const [role, setRole] = useState<string>("");
  const [changeBusyId, setChangeBusyId] = useState<string | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [writeOffTarget, setWriteOffTarget] = useState<TxRow | null>(null);
  const [writeOffReason, setWriteOffReason] = useState("");
  const [pinTarget, setPinTarget] = useState<TxRow | null>(null);

  useEffect(() => {
    setBranchFilter(selectedBranchId);
  }, [selectedBranchId]);

  async function loadBranches(profileTenantId: string) {
    const supabase = createClient();
    const { data } = await supabase
      .from("branches")
      .select("id, name")
      .eq("tenant_id", profileTenantId)
      .eq("is_active", true)
      .order("name");
    setBranches((data as BranchOption[]) || []);
  }

  async function loadTransactions() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    if (!profile) {
      setLoading(false);
      return;
    }
    setRole(profile.role);

    if (branches.length === 0) {
      await loadBranches(profile.tenant_id);
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
        .select("id, invoice_number, total_amount, payment_method, created_at, branch_id, cash_received, change_amount, change_status, change_due_at, profiles(full_name), branches(name)")
        .eq("tenant_id", profile.tenant_id)
        .order("created_at", { ascending: false });

      // Filter cabang: "Semua Cabang" (Laporan Konsolidasi) tidak difilter;
      // manager/kasir otomatis terkunci ke cabang mereka lewat context.
      const effectiveFilter = branchFilter;
      if (effectiveFilter && effectiveFilter !== ALL_BRANCHES) {
        query = query.eq("branch_id", effectiveFilter);
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
        branch_id: t.branch_id ?? null,
        refundStatus: null,
        refundedAmount: 0,
        cash_received: t.cash_received ?? null,
        change_amount: Number(t.change_amount ?? 0),
        change_status: (t.change_status ?? "NONE") as TxRow["change_status"],
        change_due_at: t.change_due_at ?? null,
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

      const noActivity = await tenantHasNoActivity();
      const showDemo = txRows.length === 0 && noActivity;
      setIsDemo(showDemo);
      setRows(showDemo ? (DEMO_TX_ROWS as TxRow[]) : txRows);
      setLoading(false);
  }

  async function handleConfirmChange(t: TxRow) {
    setChangeBusyId(t.id);
    setChangeError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("confirm_change", {
      p_transaction_id: t.id,
      p_notes: null,
    });
    setChangeBusyId(null);
    if (error) {
      setChangeError(error.message);
      return;
    }
    await loadTransactions();
  }

  async function doWriteOff(t: TxRow, reason: string, pin: string | null) {
    const supabase = createClient();
    const { error } = await supabase.rpc("write_off_change", {
      p_transaction_id: t.id,
      p_reason: reason,
      p_supervisor_pin: pin,
    });
    if (error) return { error: error.message };
    await loadTransactions();
    return {};
  }

  function openWriteOff(t: TxRow) {
    setChangeError(null);
    if (role === "cashier") {
      setPinTarget(t);
    } else {
      setWriteOffReason("");
      setWriteOffTarget(t);
    }
  }

  useEffect(() => {
    loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter]);

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
          {isDemo && <DemoBadge />}
          <p className="text-sm text-neutral-500">
            {tier === "free"
              ? `Menampilkan ${FREE_TIER_LIMITS.historyDays} hari terakhir (paket ${TIER_LABEL.free})`
              : "Riwayat lengkap transaksi kafe Anda"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(canSwitchBranch || branches.length > 0) && (
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-neutral-400" />
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="px-3 py-2 border border-neutral-200 rounded-lg text-sm"
              >
                <option value={ALL_BRANCHES}>Semua Cabang</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {tier === "free" && (
            <Link href="/dashboard/subscription" className="btn-outline flex items-center gap-1.5 text-sm">
              <Lock size={14} /> Upgrade untuk riwayat lengkap
            </Link>
          )}
        </div>
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
                  {(branchFilter === ALL_BRANCHES || canSwitchBranch) && t.branch_name && <> · {t.branch_name}</>}
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="font-bold text-neutral-900 text-sm">{formatRupiah(t.total_amount)}</p>
              <p className="text-xs text-neutral-400 uppercase">
                {t.payment_method}
                {t.cash_received != null && ` · diterima ${formatRupiah(t.cash_received)}`}
              </p>
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
              {t.change_status === "PENDING" && (
                <div className="mt-1 space-y-1">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    <HandCoins size={10} /> Kembalian PENDING {formatRupiah(t.change_amount ?? 0)}
                  </span>
                  {t.change_due_at && (
                    <p className="text-[10px] text-neutral-400">
                      Batas ambil {new Date(t.change_due_at).toLocaleString("id-ID")}
                    </p>
                  )}
                  <div className="flex gap-1 justify-end">
                    <button
                      disabled={changeBusyId === t.id}
                      onClick={() => handleConfirmChange(t)}
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 flex items-center gap-1 disabled:opacity-60"
                    >
                      {changeBusyId === t.id ? <Loader2 className="animate-spin" size={10} /> : <HandCoins size={10} />}
                      Diserahkan
                    </button>
                    <button
                      disabled={changeBusyId === t.id}
                      onClick={() => openWriteOff(t)}
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-urgent-light text-urgent flex items-center gap-1 disabled:opacity-60"
                    >
                      <XCircle size={10} /> Hapuskan
                    </button>
                  </div>
                  {changeError && <p className="text-[10px] text-urgent max-w-[220px] ml-auto">{changeError}</p>}
                </div>
              )}
              {t.change_status === "SETTLED" && (t.change_amount ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 mt-1">
                  <HandCoins size={10} /> Kembalian diserahkan
                </span>
              )}
              {t.change_status === "WRITTEN_OFF" && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500 mt-1">
                  <XCircle size={10} /> Kembalian dihapuskan
                </span>
              )}
              {t.change_status !== "PENDING" && (
                <button
                  onClick={() => setRefundTarget(t)}
                  className="text-xs text-urgent flex items-center gap-1 mt-1 ml-auto"
                >
                  <RotateCcw size={11} /> Refund
                </button>
              )}
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

      {/* migration_023 — manager/owner: write-off cukup alasan (tanpa PIN). */}
      {writeOffTarget && (
        <Modal
          title={`Hapuskan Kembalian — ${writeOffTarget.invoice_number}`}
          onClose={() => setWriteOffTarget(null)}
          footer={
            <button
              disabled={!writeOffReason.trim() || changeBusyId === writeOffTarget.id}
              onClick={async () => {
                const target = writeOffTarget;
                setChangeBusyId(target.id);
                setChangeError(null);
                const result = await doWriteOff(target, writeOffReason.trim(), null);
                setChangeBusyId(null);
                if (result.error) {
                  setChangeError(result.error);
                  return;
                }
                setWriteOffTarget(null);
              }}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {changeBusyId === writeOffTarget.id && <Loader2 className="animate-spin" size={16} />}
              Hapuskan &amp; Catat Kas Masuk
            </button>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-neutral-600 flex items-start gap-2">
              <ShieldAlert size={15} className="shrink-0 mt-0.5 text-amber-600" />
              Kembalian {formatRupiah(writeOffTarget.change_amount ?? 0)} akan dihapuskan dan dicatat sebagai kas
              masuk. Tindakan ini masuk audit log.
            </p>
            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Alasan</label>
              <textarea
                value={writeOffReason}
                onChange={(e) => setWriteOffReason(e.target.value)}
                rows={2}
                className="input-field resize-none"
                placeholder="Contoh: pelanggan tidak kembali mengambil kembalian"
              />
            </div>
            {changeError && <p className="text-xs text-urgent">{changeError}</p>}
          </div>
        </Modal>
      )}

      {/* migration_023 — kasir: write-off wajib PIN supervisor. */}
      {pinTarget && (
        <SupervisorPinModal
          action="WRITE_OFF_CHANGE"
          branchId={pinTarget.branch_id}
          contextLabel={`${pinTarget.invoice_number} — kembalian ${formatRupiah(pinTarget.change_amount ?? 0)}`}
          onClose={() => setPinTarget(null)}
          onConfirm={async ({ pin, reason }) => {
            setChangeBusyId(pinTarget.id);
            const result = await doWriteOff(pinTarget, reason, pin);
            setChangeBusyId(null);
            if (!result.error) setPinTarget(null);
            return result;
          }}
        />
      )}
    </div>
  );
}
