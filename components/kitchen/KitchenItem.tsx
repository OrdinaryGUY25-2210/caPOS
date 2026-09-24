"use client";

import React from "react";

// Tipe data fleksibel untuk menangani properti 'notes' maupun 'note'
export interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  notes?: string;
  note?: string;
  modifiers?: Array<{ name: string; value?: string }>;
  variant?: { name: string };
  [key: string]: any;
}

interface KitchenItemProps {
  item: OrderItem;
}

export default function KitchenItem({ item }: KitchenItemProps) {
  // Mengambil catatan dari item.notes atau item.note sebagai fallback
  const itemNote = item.notes || item.note;

  const configParts: string[] = [];
  if (item.variant?.name) {
    configParts.push(item.variant.name);
  }
  if (item.modifiers && item.modifiers.length > 0) {
    item.modifiers.forEach((m) => configParts.push(m.name));
  }

  return (
    <div className="py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
            {item.quantity}x {item.name}
          </span>
          {configParts.length > 0 && (
            <p className="text-xs text-zinc-500 mt-0.5 leading-tight">
              {configParts.join(" · ")}
            </p>
          )}
          {itemNote && (
            <p className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-1 inline-block">
              📝 {itemNote}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
