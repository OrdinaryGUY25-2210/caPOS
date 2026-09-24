"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import Modal from "@/components/Modal";
import { cx } from "@/lib/utils";
import type { Ingredient } from "@/lib/types";

/**
 * Inventory §7 — "Adjustment"/"Waste": tambah stok (restock) atau kurangi
 * (waste/rusak) satu bahan baku. Dipisah dari app/dashboard/ingredients/page.tsx
 * (sebelumnya `AdjustStockModal` lokal di file itu).
 */
export default function StockAdjustmentModal({
  ingredient,
  saving,
  onClose,
  onSubmit,
}: {
  ingredient: Ingredient;
  saving: boolean;
  onClose: () => void;
  onSubmit: (ing: Ingredient, qty: number, note: string) => void;
}) {
  const [qtyInput, setQtyInput] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [note, setNote] = useState("");
  const rawQty = qtyInput === "" ? 0 : Number(qtyInput);
  const signedQty = direction === "in" ? rawQty : -rawQty;

  return (
    <Modal
      title={`Sesuaikan Stok — ${ingredient.name}`}
      onClose={onClose}
      footer={
        <button
          disabled={saving || rawQty <= 0}
          onClick={() => onSubmit(ingredient, signedQty, note)}
          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving && <Loader2 className="animate-spin" size={16} />}
          Simpan Penyesuaian
        </button>
      }
    >
      <div className="flex gap-2">
        <button
          onClick={() => setDirection("in")}
          className={cx("flex-1 rounded-xl py-2 text-sm font-medium border", direction === "in" ? "border-primary-dark bg-primary-light text-primary-dark" : "border-neutral-200 text-neutral-500")}
        >
          Tambah Stok (Restock)
        </button>
        <button
          onClick={() => setDirection("out")}
          className={cx("flex-1 rounded-xl py-2 text-sm font-medium border", direction === "out" ? "border-urgent bg-urgent-light text-urgent" : "border-neutral-200 text-neutral-500")}
        >
          Kurangi (Waste/Rusak)
        </button>
      </div>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Jumlah ({ingredient.inventory_unit})</label>
        <input
          type="text"
          inputMode="decimal"
          value={qtyInput}
          onChange={(e) => setQtyInput(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="Contoh: 5000"
          className="input-field"
        />
      </div>
      <div>
        <label className="text-sm font-medium text-neutral-700 mb-1 block">Catatan</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: Beli dari supplier A" className="input-field" />
      </div>
    </Modal>
  );
}
