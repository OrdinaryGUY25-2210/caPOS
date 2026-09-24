"use client";

import { cx, formatNumberWithDots, formatRupiah, stripNumberDots } from "@/lib/utils";
import { SectionLabel, PosInput } from "./ui";

const PRESETS = [
  { label: "Uang Pas", value: (t: number) => t },
  { label: "Rp 20rb", value: () => 20000 },
  { label: "Rp 50rb", value: () => 50000 },
  { label: "Rp 100rb", value: () => 100000 },
];

export default function CashPayment({
  total,
  value,
  onChange,
  autoFocus = true,
}: {
  total: number;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const received = Number(value) || 0;
  const change = received - total;
  const insufficient = !value || received < total;

  return (
    <div className="space-y-2">
      <SectionLabel>Uang Diterima</SectionLabel>
      <PosInput
        type="text"
        inputMode="numeric"
        autoFocus={autoFocus}
        value={formatNumberWithDots(value)}
        onChange={(e) => onChange(stripNumberDots(e.target.value))}
        placeholder="Contoh: 100.000"
        className="text-lg font-semibold"
        aria-label="Uang diterima"
      />
      <div className="grid grid-cols-4 gap-2">
        {PRESETS.map((p) => {
          const v = p.value(total);
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(String(v))}
              className={cx(
                "py-2 rounded-xl border text-xs font-semibold transition-colors touch-manipulation",
                Number(value) === v
                  ? "bg-primary border-primary text-white"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-100"
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {value && (
        <p
          className={cx(
            "text-sm font-semibold text-right",
            insufficient ? "text-urgent" : "text-emerald-600"
          )}
          role="status"
        >
          {insufficient ? `Kurang ${formatRupiah(-change)}` : `Kembalian: ${formatRupiah(change)}`}
        </p>
      )}
    </div>
  );
}