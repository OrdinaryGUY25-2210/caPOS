"use client";

import { CheckCircle2, Printer, Plus } from "lucide-react";
import Modal from "@/components/Modal";
import Receipt, { type ReceiptData } from "@/components/Receipt";
import { PosButton } from "./ui";
import { printReceipt } from "@/lib/utils";

export default function CheckoutSuccess({
  receipt,
  onClose,
  onNewTransaction,
}: {
  receipt: ReceiptData | null;
  onClose: () => void;
  onNewTransaction: () => void;
}) {
  if (!receipt) return null;
  return (
    <Modal
      title="Transaksi Berhasil"
      onClose={onClose}
      maxWidth="sm:max-w-md"
      footer={
        <div className="flex flex-col gap-2">
          <PosButton
            onClick={() => printReceipt(receipt.width)}
            icon={<Printer size={16} />}
            fullWidth
          >
            Cetak Struk
          </PosButton>
          <div className="flex gap-2">
            <PosButton variant="outline" onClick={onClose} className="flex-1">
              Tutup
            </PosButton>
            <PosButton
              variant="outline"
              onClick={onNewTransaction}
              icon={<Plus size={14} />}
              className="flex-1"
            >
              Transaksi Baru
            </PosButton>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col items-center text-center gap-2 py-2">
          <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
            <CheckCircle2 size={28} className="text-emerald-600" />
          </div>
          <p className="text-base font-semibold text-neutral-900">Pembayaran diterima</p>
          <p className="text-xs text-neutral-500">
            Invoice <span className="font-mono">{receipt.invoiceNumber}</span>
          </p>
        </div>

        <div className="rounded-2xl bg-neutral-100 p-3 flex justify-center">
          <Receipt data={receipt} />
        </div>
      </div>
    </Modal>
  );
}