"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw, ShieldAlert, CheckCircle2, XCircle, PackageCheck } from "lucide-react";
import Modal from "@/components/Modal";
import { createClient } from "@/lib/supabase/client";
import { getCurrentProfile } from "@/lib/getCurrentProfile";
import { formatRupiah } from "@/lib/utils";
import type { Refund, RefundReasonCategory, RefundType } from "@/lib/types";

const REASONS: { value: RefundReasonCategory; label: string }[] = [
  { value: "CUSTOMER_REQUEST", label: "Permintaan pelanggan" },
  { value: "WRONG_ORDER", label: "Pesanan salah" },
  { value: "DUPLICATE_PAYMENT", label: "Pembayaran ganda" },
  { value: "PRODUCT_UNAVAILABLE", label: "Produk tidak tersedia" },
  { value: "DAMAGED", label: "Rusak" },
  { value: "QUALITY_ISSUE", label: "Masalah kualitas" },
  { value: "OTHER", label: "Lainnya" },
];

interface TxItemRow {
  id: string;
  product_id: string;
  qty: number;
  subtotal: number;
  product_name: string;
}

/**
 * Refund (Phase 2 Update 3, poin 34-37, 76). Selalu membuat record baru
 * lewat request_refund() — transaksi asli TIDAK PERNAH diubah. Refund
 * <= Rp50.000 langsung lunas untuk kasir; di atas itu masuk antrean
 * persetujuan manager (bagian bawah modal ini, hanya tampil untuk
 * manager/owner).
 */
export default function RefundModal({
  transactionId,
  invoiceNumber,
  totalAmount,
  onClose,
}: {
  transactionId: string;
  invoiceNumber: string;
  totalAmount: number;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<TxItemRow[]>([]);
  const [existingRefunds, setExistingRefunds] = useState<Refund[]>([]);
  const [isManager, setIsManager] = useState(false);

  const [refundType, setRefundType] = useState<RefundType>("FULL");
  const [selectedQty, setSelectedQty] = useState<Record<string, number>>({});
  const [reasonCategory, setReasonCategory] = useState<RefundReasonCategory>("CUSTOMER_REQUEST");
  const [reasonNote, setReasonNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  // Migrasi 019: toggle "Restore Stock to Inventory" — dicentang default
  // true (kebanyakan refund memang harus mengembalikan bahan baku).
  const [restoreStockOnSubmit, setRestoreStockOnSubmit] = useState(true);
  const [restoreStockOnApprove, setRestoreStockOnApprove] = useState<Record<string, boolean>>({});
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  async function load() {
    setLoading(true);
    const { profile } = await getCurrentProfile();
    setIsManager(profile?.role === "manager" || profile?.role === "owner" || profile?.role === "super_admin");

    const { data: itemRows } = await supabase
      .from("transaction_items")
      .select("id, product_id, qty, subtotal, products(name)")
      .eq("transaction_id", transactionId);
    setItems(((itemRows as any[]) ?? []).map((r) => ({ id: r.id, product_id: r.product_id, qty: r.qty, subtotal: r.subtotal, product_name: r.products?.name ?? "Produk" })));

    const { data: refundRows } = await supabase.from("refunds").select("*").eq("transaction_id", transactionId).order("created_at", { ascending: false });
    setExistingRefunds((refundRows as Refund[]) ?? []);
    setLoading(false);
  }

  const alreadyRefunded = existingRefunds.filter((r) => r.status !== "REJECTED").reduce((s, r) => s + r.amount, 0);
  const remaining = totalAmount - alreadyRefunded;

  const itemRefundAmount = items.reduce((sum, it) => {
    const qty = selectedQty[it.id] ?? 0;
    return sum + (it.subtotal / it.qty) * qty;
  }, 0);

  const amount = refundType === "FULL" ? remaining : itemRefundAmount;

  async function handleSubmit() {
    if (amount <= 0) {
      alert("Nominal refund harus lebih dari 0.");
      return;
    }
    if (amount > remaining) {
      alert(`Nominal refund melebihi jumlah yang dapat dikembalikan (sisa ${formatRupiah(remaining)}).`);
      return;
    }
    setSubmitting(true);
    const refundItems =
      refundType === "FULL"
        ? null
        : items
            .filter((it) => (selectedQty[it.id] ?? 0) > 0)
            .map((it) => ({ transaction_item_id: it.id, product_name: it.product_name, qty: selectedQty[it.id], amount: (it.subtotal / it.qty) * selectedQty[it.id] }));

    const { data: refundId, error } = await supabase.rpc("request_refund", {
      p_transaction_id: transactionId,
      p_refund_type: refundType,
      p_amount: Math.round(amount),
      p_items: refundItems,
      p_reason_category: reasonCategory,
      p_reason_note: reasonNote || null,
    });
    setSubmitting(false);
    if (error) {
      if (error.message.includes("REFUND_EXCEEDS_TOTAL")) alert("Jumlah refund melebihi jumlah yang dapat dikembalikan.");
      else alert("Gagal mengajukan refund: " + error.message);
      return;
    }

    // request_refund menentukan status sendiri di server (>Rp50rb tanpa
    // manager = PENDING_APPROVAL, selain itu langsung COMPLETED). Kalau
    // langsung lunas DAN toggle "Restore Stock to Inventory" dicentang,
    // kembalikan stok sekarang juga — kalau masih PENDING_APPROVAL, stok
    // baru dikembalikan saat manager menyetujui (lihat handleDecision).
    let msg = "Refund diajukan.";
    if (restoreStockOnSubmit && refundId) {
      const { data: refundRow } = await supabase.from("refunds").select("status").eq("id", refundId).single();
      if ((refundRow as { status: string } | null)?.status === "COMPLETED") {
        const ok = await restoreStockFor(refundId as string, /* silent */ true);
        msg = ok ? "Refund lunas & stok dikembalikan ke inventory." : "Refund lunas, tapi gagal mengembalikan stok — coba tombol \"Kembalikan Stok\" di riwayat.";
      }
    }
    setResultMsg(msg);
    load();
    setSelectedQty({});
    setReasonNote("");
  }

  /** Migrasi 019: panggil revert_recipe_stock() untuk 1 refund yang sudah COMPLETED. */
  async function restoreStockFor(refundId: string, silent = false): Promise<boolean> {
    setRestoringId(refundId);
    const { error } = await supabase.rpc("revert_recipe_stock", {
      p_transaction_id: transactionId,
      p_transaction_item_id: null,
      p_refund_id: refundId,
    });
    setRestoringId(null);
    if (error) {
      if (!silent) {
        if (error.message.includes("STOCK_ALREADY_RESTORED")) alert("Stok untuk refund ini sudah pernah dikembalikan.");
        else alert("Gagal mengembalikan stok: " + error.message);
      }
      return false;
    }
    await load();
    return true;
  }

  async function handleDecision(refundId: string, decision: "APPROVED" | "REJECTED") {
    setDeciding(refundId);
    const { error } = await supabase.rpc("approve_refund", { p_refund_id: refundId, p_decision: decision });
    setDeciding(null);
    if (error) {
      alert("Gagal memproses persetujuan: " + error.message);
      return;
    }
    if (decision === "APPROVED" && restoreStockOnApprove[refundId] !== false) {
      await restoreStockFor(refundId, true);
    }
    load();
  }

  if (loading) {
    return (
      <Modal title={`Refund — ${invoiceNumber}`} onClose={onClose}>
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-neutral-400" size={20} /></div>
      </Modal>
    );
  }

  const pendingRefunds = existingRefunds.filter((r) => r.status === "PENDING_APPROVAL");

  return (
    <Modal title={`Refund — ${invoiceNumber}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500">Total transaksi</span>
          <span className="font-semibold">{formatRupiah(totalAmount)}</span>
        </div>
        {alreadyRefunded > 0 && (
          <div className="flex justify-between text-sm text-urgent">
            <span>Sudah/sedang direfund</span>
            <span className="font-semibold">-{formatRupiah(alreadyRefunded)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm border-t border-neutral-100 pt-2">
          <span className="text-neutral-500">Sisa dapat direfund</span>
          <span className="font-bold text-primary">{formatRupiah(remaining)}</span>
        </div>

        {remaining <= 0 ? (
          <p className="text-sm text-neutral-500 py-2">Transaksi ini sudah direfund penuh.</p>
        ) : (
          <>
            <div className="flex gap-2">
              <button onClick={() => setRefundType("FULL")} className={`flex-1 text-sm py-2 rounded-lg border ${refundType === "FULL" ? "border-primary bg-primary-light text-primary" : "border-neutral-200 text-neutral-500"}`}>
                Refund Penuh
              </button>
              <button onClick={() => setRefundType("ITEM")} className={`flex-1 text-sm py-2 rounded-lg border ${refundType === "ITEM" ? "border-primary bg-primary-light text-primary" : "border-neutral-200 text-neutral-500"}`}>
                Pilih Item
              </button>
            </div>

            {refundType === "ITEM" && (
              <div className="space-y-2">
                {items.map((it) => (
                  <div key={it.id} className="flex items-center justify-between text-sm">
                    <span>{it.product_name} <span className="text-neutral-400">(dibeli {it.qty})</span></span>
                    <input
                      type="number"
                      min={0}
                      max={it.qty}
                      value={selectedQty[it.id] ?? 0}
                      onChange={(e) => setSelectedQty({ ...selectedQty, [it.id]: Math.max(0, Math.min(it.qty, Number(e.target.value))) })}
                      className="input-field w-16 text-center py-1"
                    />
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-neutral-700 mb-1 block">Alasan</label>
              <select value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value as RefundReasonCategory)} className="input-field">
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <textarea value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} placeholder="Catatan tambahan (opsional)" className="input-field text-sm" rows={2} />

            <div className="flex justify-between font-bold text-sm">
              <span>Nominal refund</span>
              <span className="text-urgent">{formatRupiah(amount)}</span>
            </div>

            <label className="flex items-center gap-2 text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 cursor-pointer">
              <input
                type="checkbox"
                checked={restoreStockOnSubmit}
                onChange={(e) => setRestoreStockOnSubmit(e.target.checked)}
                className="accent-primary"
              />
              <PackageCheck size={14} className="text-neutral-400" />
              Restore Stock to Inventory
              <span className="text-xs text-neutral-400 ml-auto">kembalikan bahan baku</span>
            </label>

            {amount > 50000 && !isManager && (
              <p className="text-xs text-warning flex items-center gap-1"><ShieldAlert size={12} /> Di atas Rp50.000 — akan menunggu persetujuan manager.</p>
            )}

            <button disabled={submitting || amount <= 0} onClick={handleSubmit} className="btn-primary w-full flex items-center justify-center gap-2">
              {submitting ? <Loader2 className="animate-spin" size={16} /> : <RotateCcw size={16} />} Ajukan Refund
            </button>
            {resultMsg && <p className="text-xs text-center text-neutral-500">{resultMsg}</p>}
          </>
        )}

        {isManager && pendingRefunds.length > 0 && (
          <div className="border-t border-neutral-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-neutral-700">Menunggu persetujuan Anda</p>
            {pendingRefunds.map((r) => (
              <div key={r.id} className="bg-warning-light rounded-lg px-3 py-2 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium">{formatRupiah(r.amount)}</p>
                    <p className="text-xs text-neutral-500">{REASONS.find((x) => x.value === r.reason_category)?.label}{r.reason_note ? ` — ${r.reason_note}` : ""}</p>
                  </div>
                  <div className="flex gap-1">
                    <button disabled={deciding === r.id} onClick={() => handleDecision(r.id, "APPROVED")} className="p-1.5 rounded-lg bg-primary text-white"><CheckCircle2 size={14} /></button>
                    <button disabled={deciding === r.id} onClick={() => handleDecision(r.id, "REJECTED")} className="p-1.5 rounded-lg bg-urgent text-white"><XCircle size={14} /></button>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restoreStockOnApprove[r.id] !== false}
                    onChange={(e) => setRestoreStockOnApprove((prev) => ({ ...prev, [r.id]: e.target.checked }))}
                    className="accent-primary"
                  />
                  <PackageCheck size={12} /> Restore Stock to Inventory saat disetujui
                </label>
              </div>
            ))}
          </div>
        )}

        {existingRefunds.some((r) => r.status === "COMPLETED") && (
          <div className="border-t border-neutral-100 pt-3 space-y-2">
            <p className="text-xs font-semibold text-neutral-700">Riwayat refund lunas</p>
            {existingRefunds
              .filter((r) => r.status === "COMPLETED")
              .map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm bg-neutral-50 rounded-lg px-3 py-2">
                  <div>
                    <p className="font-medium">{formatRupiah(r.amount)}</p>
                    <p className="text-xs text-neutral-500">
                      {r.stock_restored ? (
                        <span className="text-emerald-600 flex items-center gap-1"><PackageCheck size={11} /> Stok sudah dikembalikan</span>
                      ) : (
                        "Stok belum dikembalikan"
                      )}
                    </p>
                  </div>
                  {!r.stock_restored && (
                    <button
                      disabled={restoringId === r.id}
                      onClick={() => restoreStockFor(r.id)}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-primary text-primary flex items-center gap-1"
                    >
                      {restoringId === r.id ? <Loader2 className="animate-spin" size={12} /> : <PackageCheck size={12} />}
                      Kembalikan Stok
                    </button>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
