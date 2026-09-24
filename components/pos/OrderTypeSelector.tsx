"use client";

import { ShoppingBag, UtensilsCrossed, Bike } from "lucide-react";
import { cx } from "@/lib/utils";
import { ORDER_TYPE_LABELS, type OrderType } from "./types";

const OPTIONS: { value: OrderType; icon: typeof ShoppingBag; label: string }[] = [
  { value: "dine-in", icon: UtensilsCrossed, label: ORDER_TYPE_LABELS["dine-in"] },
  { value: "takeaway", icon: ShoppingBag, label: ORDER_TYPE_LABELS["takeaway"] },
  { value: "delivery", icon: Bike, label: ORDER_TYPE_LABELS["delivery"] },
];

export default function OrderTypeSelector({
  value,
  onChange,
}: {
  value: OrderType;
  onChange: (v: OrderType) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cx(
              "flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-medium transition-colors touch-manipulation",
              active
                ? "bg-primary text-white border-primary"
                : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
            )}
            aria-pressed={active}
          >
            <Icon size={14} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}