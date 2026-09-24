"use client";

import { useState } from "react";
import { Trash2, StickyNote } from "lucide-react";
import { cx, formatRupiah } from "@/lib/utils";
import { PosInput, QuantityStepper } from "./ui";
import type { CartLine } from "./types";

export default function CartItem({
  item,
  onUpdateQty,
  onSetQty,
  onRemove,
  onUpdateNotes,
}: {
  item: CartLine;
  onUpdateQty: (id: string, delta: number) => void;
  onSetQty: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const configParts = [item.variantName, ...(item.modifiers ?? []).map((m) => m.name)].filter(Boolean);
  const lineTotal = item.unitPrice * item.qty;

  return (
    <div className="py-2.5 border-b border-neutral-100 last:border-0">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-neutral-900 truncate">{item.name}</p>
          {configParts.length > 0 && (
            <p className="text-xs text-primary-dark truncate">{configParts.join(" · ")}</p>
          )}
          <p className="text-xs text-neutral-500">
            {formatRupiah(item.unitPrice)}
            {item.qty > 1 && <span className="text-neutral-400"> · total {formatRupiah(lineTotal)}</span>}
          </p>
          {item.notes && !editingNotes && (
            <p className="text-xs text-amber-600 mt-0.5 truncate">📝 {item.notes}</p>
          )}
        </div>
        <QuantityStepper
          value={item.qty}
          onChange={(v) => onSetQty(item.cartItemId, v)}
          min={0}
          size="sm"
          ariaLabel={`Jumlah ${item.name}`}
        />
      </div>

      <div className="flex items-center justify-between mt-1.5">
        <button
          type="button"
          onClick={() => setEditingNotes((v) => !v)}
          className={cx(
            "flex items-center gap-1 text-[11px] font-medium transition-colors touch-manipulation",
            item.notes ? "text-amber-600" : "text-neutral-400 hover:text-neutral-600"
          )}
        >
          <StickyNote size={11} /> {item.notes ? "Edit catatan" : "Catatan"}
        </button>
        <button
          onClick={() => onRemove(item.cartItemId)}
          className="text-neutral-300 hover:text-urgent p-1 touch-manipulation"
          aria-label="Hapus item"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {editingNotes && (
        <PosInput
          value={item.notes}
          onChange={(e) => onUpdateNotes(item.cartItemId, e.target.value)}
          onBlur={() => setEditingNotes(false)}
          autoFocus
          placeholder="cth: tanpa gula, extra shot"
          className="text-xs mt-1.5"
        />
      )}
    </div>
  );
}