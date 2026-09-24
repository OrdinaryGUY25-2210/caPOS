"use client";

import type { OrderItem } from "@/lib/types";

export default function KitchenItem({
  item,
  stationName,
}: {
  item: OrderItem;
  stationName?: string;
}) {
  const configParts = [
    item.variant_name,
    ...(item.modifier_selections ?? []).map((m) => m.name),
  ].filter(Boolean);

  return (
    <div className="py-1.5 border-b border-dashed border-neutral-200 last:border-0">
      <div className="flex items-start gap-2">
        <span className="text-sm font-bold text-neutral-900 tabular-nums w-7 shrink-0 pt-px">
          {item.qty}×
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-neutral-900 leading-tight break-words">
            {item.product_name}
          </p>
          {configParts.length > 0 && (
            <p className="text-xs text-primary-dark mt-0.5 leading-tight">{configParts.join(" · ")}</p>
          )}
          {item.notes && (
            <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-1 inline-block">
              📝 {item.notes}
            </p>
          )}
          {stationName && (
            <p className="text-[10px] uppercase tracking-wide text-neutral-400 mt-0.5">{stationName}</p>
          )}
        </div>
      </div>
    </div>
  );
}