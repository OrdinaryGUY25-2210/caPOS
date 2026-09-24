"use client";

import { Receipt as ReceiptIcon, User, RotateCcw, ChevronRight } from "lucide-react";
import { formatRupiah } from "@/lib/utils";

export interface TxRow {
  id: string;
  invoice_number: string;
  total_amount: number;
  payment_method: string;
  created_at: string;
  cashier_name: string | null;
  branch_name: string | null;
  refundStatus: "PENDING_APPROVAL" | "COMPLETED" | null;
  refundedAmount: number;
}

/**
 * Transactions §10 — "Transaction list" + "Status" (badge refund), dipisah
 * dari app/dashboard/transactions/page.tsx. Sekarang baris ini bisa
 * di-klik untuk buka detail (lihat TransactionDetailModal) — sebelumnya
 * satu-satunya aksi di baris adalah tombol Refund langsung.
 */
export default function TransactionRow({
  tx,
  showBranch,
  onOpenDetail,
}: {
  tx: TxRow;
  showBranch: boolean;
  onOpenDetail: () => void;
}) {
  return (
    <button onClick={onOpenDetail} className="w-full flex items-center justify-between p-4 gap-3 text-left hover:bg-neutral-50/60">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-primary-light text-primary-dark flex items-center justify-center shrink-0">
          <ReceiptIcon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-neutral-900 font-mono truncate">{tx.invoice_number}</p>
          <p className="text-xs text-neutral-400 flex items-center gap-1">
            <User size={11} />
            {tx.cashier_name ?? "Kasir"} · {new Date(tx.created_at).toLocaleString("id-ID")}
            {showBranch && tx.branch_name && <> · {tx.branch_name}</>}
          </p>
        </div>
      </div>
      <div className="text-right shrink-0 flex items-center gap-2">
        <div>
          <p className="font-bold text-neutral-900 text-sm">{formatRupiah(tx.total_amount)}</p>
          <p className="text-xs text-neutral-400 uppercase">{tx.payment_method}</p>
          {tx.refundStatus && (
            <span
              className={
                "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full mt-1 " +
                (tx.refundStatus === "COMPLETED" ? "bg-urgent-light text-urgent" : "bg-amber-100 text-amber-700")
              }
            >
              <RotateCcw size={10} />
              {tx.refundStatus === "COMPLETED" ? `Sudah di-refund (${formatRupiah(tx.refundedAmount)})` : "Refund diajukan"}
            </span>
          )}
        </div>
        <ChevronRight size={16} className="text-neutral-300" />
      </div>
    </button>
  );
}
