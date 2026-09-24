"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { formatRupiah } from "@/lib/utils";
import PaymentMethod, { type PaymentMethod as Method } from "./PaymentMethod";
import CashPayment from "./CashPayment";
import QRISPayment, { type QrisState } from "./QRISPayment";
import OrderSummary from "./OrderSummary";
import { PosButton, ErrorState, SectionLabel } from "./ui";

export type { Method, QrisState };

export default function PaymentModal({
  isOpen,
  total,
  cashierName,
  orderTypeLabel,
  subtotal,
  discountPct,
  memberDiscount,
  voucherDiscount,
  pointsDiscount,
  servicePct,
  serviceCharge,
  taxPct,
  taxAmount,
  onConfirm,
  onClose,
  submitting,
  onCreateQris,
  onResetQris,
  qrisState,
}: {
  isOpen: boolean;
  total: number;
  cashierName: string;
  orderTypeLabel: string;
  subtotal: number;
  discountPct: number;
  memberDiscount: number;
  voucherDiscount: number;
  pointsDiscount: number;
  servicePct: number;
  serviceCharge: number;
  taxPct: number;
  taxAmount: number;
  onConfirm: (payload: { method: Method; cashReceived: number }) => void;
  onClose: () => void;
  submitting: boolean;
  onCreateQris: () => void;
  onResetQris: () => void;
  qrisState: QrisState;
}) {
  const [method, setMethod] = useState<Method>("cash");
  const [cash, setCash] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMethod("cash");
      setCash("");
      setConfirming(false);
      onResetQris();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const received = Number(cash) || 0;
  const insufficient = method === "cash" && (!cash || received < total);
  const qrisPending = method === "qris" && qrisState.enabled && qrisState.status !== "paid";
  const blockNext = submitting || insufficient || qrisPending;

  function handleMethodChange(m: Method) {
    setMethod(m);
    if (m !== "cash") setCash("");
    if (m !== "qris") onResetQris();
  }

  return (
    <Modal
      title="Konfirmasi Pembayaran"
      onClose={() => {
        if (submitting) return;
        onResetQris();
        onClose();
      }}
      footer={
        confirming ? (
          <div className="flex gap-2">
            <PosButton variant="outline" onClick={() => setConfirming(false)} disabled={submitting} className="flex-1">
              Batal
            </PosButton>
            <PosButton
              onClick={() => onConfirm({ method, cashReceived: method === "cash" ? received : total })}
              loading={submitting}
              className="flex-1"
            >
              Ya, Proses Transaksi
            </PosButton>
          </div>
        ) : (
          <PosButton onClick={() => setConfirming(true)} disabled={blockNext} fullWidth>
            {qrisState.status === "paid" ? "Pembayaran Diterima — Lanjut" : "Konfirmasi Pembayaran"}
          </PosButton>
        )
      }
    >
      <div className="space-y-4">
        <div className="text-center py-1">
          <p className="text-xs text-neutral-500">
            {orderTypeLabel} · Kasir {cashierName}
          </p>
          <p className="text-3xl font-bold text-primary mt-1">{formatRupiah(total)}</p>
        </div>

        {!confirming && (
          <>
            <div>
              <SectionLabel>Metode Pembayaran</SectionLabel>
              <PaymentMethod value={method} onChange={handleMethodChange} />
            </div>

            {method === "cash" && <CashPayment total={total} value={cash} onChange={setCash} />}
            {method === "qris" && <QRISPayment state={qrisState} onCreate={onCreateQris} />}
            {method === "debit" && (
              <div className="rounded-xl bg-neutral-50 border border-neutral-200 px-3 py-2.5 text-xs text-neutral-500">
                Verifikasi lewat mesin EDC, lalu tekan Konfirmasi Pembayaran.
              </div>
            )}

            <OrderSummary
              subtotal={subtotal}
              discountPct={discountPct}
              memberDiscount={memberDiscount}
              voucherDiscount={voucherDiscount}
              pointsDiscount={pointsDiscount}
              servicePct={servicePct}
              serviceCharge={serviceCharge}
              taxPct={taxPct}
              taxAmount={taxAmount}
              total={total}
              compact
            />
          </>
        )}

        {confirming && (
          <div className="space-y-3">
            <ErrorState
              message={`Pastikan pelanggan sudah membayar sebelum memproses. Metode: ${method.toUpperCase()}.`}
            />
            <OrderSummary
              subtotal={subtotal}
              discountPct={discountPct}
              memberDiscount={memberDiscount}
              voucherDiscount={voucherDiscount}
              pointsDiscount={pointsDiscount}
              servicePct={servicePct}
              serviceCharge={serviceCharge}
              taxPct={taxPct}
              taxAmount={taxAmount}
              total={total}
              compact
            />
            {method === "cash" && (
              <div className="flex justify-between text-sm">
                <span className="text-neutral-500">Kembalian</span>
                <span className="font-semibold text-emerald-600">{formatRupiah(received - total)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}