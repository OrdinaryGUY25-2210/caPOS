"use client";

import { ScanLine, Gift } from "lucide-react";
import Modal from "@/components/Modal";
import { formatRupiah } from "@/lib/utils";
import type { SelectedCustomer } from "./types";

export default function DiscountModal({
  isOpen,
  onClose,
  subtotal,
  memberCode,
  discountPct,
  voucherCode,
  voucherDiscount,
  voucherError,
  selectedCustomer,
  pointsInput,
  pointsDiscount,
  redeemingPoints,
  onApplyMember,
  onApplyVoucher,
  onSetMemberCode,
  onSetVoucherCode,
  onSetPointsInput,
  onRedeemPoints,
}: {
  isOpen: boolean;
  onClose: () => void;
  subtotal: number;
  memberCode: string;
  discountPct: number;
  voucherCode: string;
  voucherDiscount: number;
  voucherError: string | null;
  selectedCustomer: SelectedCustomer | null;
  pointsInput: string;
  pointsDiscount: number;
  redeemingPoints: boolean;
  onApplyMember: () => void;
  onApplyVoucher: () => void;
  onSetMemberCode: (v: string) => void;
  onSetVoucherCode: (v: string) => void;
  onSetPointsInput: (v: string) => void;
  onRedeemPoints: () => void;
}) {
  if (!isOpen) return null;

  const memberDiscountPreview = Math.round((subtotal * discountPct) / 100);

  return (
    <Modal title="Diskon & Voucher" onClose={onClose} maxWidth="sm:max-w-md">
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Kode Member</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
              <input
                value={memberCode}
                onChange={(e) => onSetMemberCode(e.target.value)}
                placeholder="Kode / Scan QR"
                data-discount-input
                className="input-field pl-9 text-sm"
              />
            </div>
            <button onClick={onApplyMember} className="btn-outline text-sm px-3 shrink-0">
              Pakai
            </button>
          </div>
          {discountPct > 0 && (
            <p className="text-xs text-emerald-600 mt-1">
              Diskon member {discountPct}% aktif ({formatRupiah(memberDiscountPreview)}).
            </p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium text-neutral-700 mb-1 block">Kode Voucher</label>
          <div className="flex gap-2">
            <input
              value={voucherCode}
              onChange={(e) => onSetVoucherCode(e.target.value.toUpperCase())}
              placeholder="cth: HEMAT20"
              className="input-field flex-1 text-sm"
            />
            <button onClick={onApplyVoucher} className="btn-outline text-sm px-3 shrink-0">
              Cek
            </button>
          </div>
          {voucherError && <p className="text-xs text-urgent mt-1">{voucherError}</p>}
          {voucherDiscount > 0 && (
            <p className="text-xs text-emerald-600 mt-1">
              Voucher memberi potongan {formatRupiah(voucherDiscount)}.
            </p>
          )}
        </div>

        {selectedCustomer && (selectedCustomer.loyaltyBalance ?? 0) > 0 ? (
          <div>
            <label className="text-sm font-medium text-neutral-700 mb-1 flex items-center gap-1.5">
              <Gift size={13} className="text-primary" /> Tukar Poin Loyalitas
            </label>
            <div className="flex gap-2 items-center">
              <span className="text-xs text-neutral-500 shrink-0">
                Saldo: {selectedCustomer.loyaltyBalance}
              </span>
              <input
                value={pointsInput}
                onChange={(e) => onSetPointsInput(e.target.value.replace(/\D/g, ""))}
                placeholder="Jml poin"
                inputMode="numeric"
                className="input-field flex-1 text-sm"
              />
              <button
                onClick={onRedeemPoints}
                disabled={redeemingPoints || !pointsInput}
                className="btn-outline text-sm px-3 shrink-0 disabled:opacity-60"
              >
                {redeemingPoints ? "..." : "Tukar"}
              </button>
            </div>
            {pointsDiscount > 0 && (
              <p className="text-xs text-emerald-600 mt-1">
                Poin sudah dipakai: -{formatRupiah(pointsDiscount)}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-neutral-400 text-center py-2">
            {selectedCustomer
              ? "Pelanggan ini belum punya saldo poin."
              : "Pilih pelanggan dari keranjang untuk menukar poin loyalitas."}
          </p>
        )}
      </div>
    </Modal>
  );
}