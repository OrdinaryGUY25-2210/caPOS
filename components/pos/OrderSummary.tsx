"use client";

import { formatRupiah, cx } from "@/lib/utils";

export default function OrderSummary({
  subtotal,
  discountPct,
  memberDiscount,
  voucherDiscount,
  pointsDiscount,
  servicePct,
  serviceCharge,
  taxPct,
  taxAmount,
  total,
  compact = false,
}: {
  subtotal: number;
  discountPct: number;
  memberDiscount: number;
  voucherDiscount: number;
  pointsDiscount: number;
  servicePct: number;
  serviceCharge: number;
  taxPct: number;
  taxAmount: number;
  total: number;
  compact?: boolean;
}) {
  return (
    <div className={cx("space-y-1 text-sm", !compact && "pt-1")}>
      <Row label="Subtotal" value={formatRupiah(subtotal)} muted />
      {memberDiscount > 0 && (
        <Row label={`Diskon Member (${discountPct}%)`} value={`-${formatRupiah(memberDiscount)}`} accent />
      )}
      {voucherDiscount > 0 && <Row label="Diskon Voucher" value={`-${formatRupiah(voucherDiscount)}`} accent />}
      {pointsDiscount > 0 && <Row label="Tukar Poin" value={`-${formatRupiah(pointsDiscount)}`} accent />}
      {servicePct > 0 && (
        <Row label={`Service (${servicePct}%)`} value={formatRupiah(serviceCharge)} muted />
      )}
      {taxPct > 0 && <Row label={`Pajak (${taxPct}%)`} value={formatRupiah(taxAmount)} muted />}
      <div
        className={cx(
          "flex justify-between font-bold text-neutral-900 border-t border-dashed border-neutral-200",
          compact ? "text-base pt-2 mt-2" : "text-base pt-2 mt-1"
        )}
      >
        <span>Total</span>
        <span>{formatRupiah(total)}</span>
      </div>
    </div>
  );
}

function Row({ label, value, muted, accent }: { label: string; value: string; muted?: boolean; accent?: boolean }) {
  return (
    <div className={cx("flex justify-between", accent ? "text-primary" : muted ? "text-neutral-500" : "text-neutral-700")}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}