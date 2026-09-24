"use client";

import { Banknote, QrCode, CreditCard } from "lucide-react";
import { cx } from "@/lib/utils";

export type PaymentMethod = "cash" | "qris" | "debit";

const OPTIONS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: "cash", label: "Tunai", icon: Banknote },
  { value: "qris", label: "QRIS", icon: QrCode },
  { value: "debit", label: "Kartu", icon: CreditCard },
];

export default function PaymentMethod({
  value,
  onChange,
  disabled,
}: {
  value: PaymentMethod;
  onChange: (v: PaymentMethod) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cx(
              "flex flex-col items-center justify-center gap-1 py-3 rounded-xl border transition-colors touch-manipulation disabled:opacity-50",
              active
                ? "bg-primary border-primary text-white"
                : "border-neutral-200 text-neutral-600 hover:bg-neutral-100"
            )}
          >
            <Icon size={18} />
            <span className="text-xs font-semibold">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}